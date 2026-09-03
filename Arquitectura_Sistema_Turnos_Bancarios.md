# Arquitectura — Sistema de Gestión de Turnos Bancarios
### Next.js + Tailwind + Supabase (Realtime + Postgres) + Vercel

En Vercel Hobby no se configura un cron frecuente. La pantalla pública y los módulos operativos usan polling y Realtime para actualizar la cola; la ruta `/api/verificar-ausentes` queda disponible para una ejecución manual o un servicio externo.

## Estructura actual del proyecto

```text
src/app/                 rutas y pantallas del sistema
src/app/admin/           configuración de jornada y dashboard
src/app/accesos/         selección de caja, cubículo o kiosco
src/app/cajero/[stationId]/ atención de una estación
src/app/kiosco/          emisión de tickets
src/app/pantalla-publica/ tablero para la sala de espera
src/components/          componentes visuales reutilizables
src/lib/                 cliente Supabase y lógica de colas
src/types/               contratos TypeScript
public/sounds/           audio de llamado
supabase-schema.sql      esquema y funciones de PostgreSQL
```

El acceso de los cajeros se realiza desde `/accesos`; no se debe enlazar una estación fija como `/cajero/1`, porque las estaciones activas se determinan diariamente desde el panel administrativo.

---

## 1. Modelo de datos / Estructura de Tickets y Estaciones

### Tabla `tickets`

```sql
create type ticket_status as enum ('WAITING', 'CALLING', 'IN_PROGRESS', 'COMPLETED', 'ABSENT');
create type client_profile as enum ('PN', 'TE');            -- Persona Natural / Tercera Edad
create type service_type as enum ('CAJA', 'SERVICIO_CLIENTE');

create table tickets (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,                 -- "PN-001", "TE-002", "C-014"
  sequence       int  not null,
  profile        client_profile not null,
  service_type   service_type not null,
  status         ticket_status not null default 'WAITING',
  station_id     uuid references stations(id),  -- se asigna al llamar
  attempts       int not null default 0,         -- solo estadístico
  created_at     timestamptz not null default now(),
  called_at      timestamptz,                    -- entra a CALLING
  started_at     timestamptz,                    -- entra a IN_PROGRESS
  completed_at   timestamptz
);
```

### Tabla `stations` (reemplaza a "cajeros" — ahora cubre Cajas y Cubículos)

```sql
create type station_type as enum ('CAJA', 'CUBICULO');

create table stations (
  id                 uuid primary key default gen_random_uuid(),
  station_type       station_type not null,
  label              text not null,      -- "1", "2" para CAJA · "A", "B" para CUBICULO
  active             boolean not null default true,
  current_ticket_id  uuid references tickets(id),
  employee_name      text
);
```

Regla de etiquetado: **CAJA → números** (1, 2, 3…), **CUBICULO → letras** (A, B, C…). Esto se muestra tal cual en la Pantalla Pública ("Ticket C-014 → Caja 2", "Ticket SC-007 → Cubículo A").

### Tabla `priority_state` (memoria del algoritmo, una fila por trámite)

```sql
create table priority_state (
  service_type            service_type primary key,
  te_served_since_switch  int not null default 0,
  current_ratio_te        int not null default 1
);
```

### Tabla `daily_sequence` (numeración que se reinicia cada día)

```sql
create table daily_sequence (
  service_type  service_type not null,
  profile       client_profile not null,
  seq_date      date not null default current_date,
  last_value    int not null default 0,
  primary key (service_type, profile, seq_date)
);
```

### Tipos TypeScript (`/src/types/ticket.ts`)

```typescript
export type TicketStatus = 'WAITING' | 'CALLING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABSENT';
export type ClientProfile = 'PN' | 'TE';
export type ServiceType = 'CAJA' | 'SERVICIO_CLIENTE';
export type StationType = 'CAJA' | 'CUBICULO';

export interface Ticket {
  id: string;
  code: string;
  sequence: number;
  profile: ClientProfile;
  serviceType: ServiceType;
  status: TicketStatus;
  stationId?: string;
  attempts: number;
  createdAt: string;
  calledAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Station {
  id: string;
  stationType: StationType;
  label: string;          // "1", "2"... o "A", "B"...
  active: boolean;
  currentTicketId?: string;
  employeeName?: string;
}
```

### Transiciones de estado (5 estados — sin agregar más)

```
WAITING → CALLING → IN_PROGRESS → COMPLETED     (final)
              ↓
           ABSENT                                (final — solo alcanzable desde CALLING)
```

- `CALLING`: se acaba de llamar, suena la alerta en Pantalla Pública. El cliente va caminando hacia la estación.
- `IN_PROGRESS`: el cliente ya llegó, se le está atendiendo. Ya no se puede marcar `ABSENT`.
- `ABSENT`: el ticket queda **cerrado definitivamente**; no reingresa a `WAITING`. `attempts` es solo para estadística.
- Botones del Módulo Cajero: **"Llamar Siguiente"** (`WAITING→CALLING`, y automáticamente pasa a `IN_PROGRESS` cuando el cajero confirma que el cliente llegó — no hace falta un botón nuevo, basta un segundo clic o un pequeño temporizador), **"Ausente"** (solo habilitado en `CALLING`), **"Finalizar Ticket"** (`IN_PROGRESS→COMPLETED`).

---

## 2. Función pura del selector de prioridad (colas separadas por trámite)

**Mejora 1 aplicada:** el algoritmo ya no corre sobre una sola cola global — se ejecuta **de forma independiente para Caja y para Servicio al Cliente**, cada uno con su propio estado. Así una persona que espera Servicio al Cliente nunca le "roba" el turno a alguien que espera Caja.

```typescript
// /src/lib/ticketQueue.ts
import type { Ticket } from '@/types/ticket';

/** Por debajo de este número de PN en espera (dentro de ese trámite), TE tiene prioridad 2 a 1 */
export const PN_LOW_BACKLOG = 5;

export interface Ratio { te: number; pn: number; }

export interface PriorityState {
  teServedSinceSwitch: number;
  currentRatioTe: number;
}

export interface PrioritySelectorResult {
  ticket: Ticket | null;
  updatedState: PriorityState;
}

function getRatio(pnQueueLength: number): Ratio {
  if (pnQueueLength < PN_LOW_BACKLOG) return { te: 2, pn: 1 };
  return { te: 1, pn: 1 };
}

/**
 * Se invoca UNA VEZ POR TRÁMITE (una vez para 'CAJA', otra para 'SERVICIO_CLIENTE'),
 * cada una con su propia cola TE/PN y su propio PriorityState — nunca se mezclan.
 */
export function selectNextTicket(
  teQueue: Ticket[],
  pnQueue: Ticket[],
  state: PriorityState
): PrioritySelectorResult {
  const teAvailable = teQueue.length > 0;
  const pnAvailable = pnQueue.length > 0;

  if (!teAvailable && !pnAvailable) return { ticket: null, updatedState: state };
  if (!teAvailable) return { ticket: pnQueue[0], updatedState: { ...state, teServedSinceSwitch: 0 } };
  if (!pnAvailable) return { ticket: teQueue[0], updatedState: state };

  const ratio = getRatio(pnQueue.length);
  const teServedSinceSwitch = ratio.te !== state.currentRatioTe ? 0 : state.teServedSinceSwitch;

  if (teServedSinceSwitch < ratio.te) {
    return {
      ticket: teQueue[0],
      updatedState: { teServedSinceSwitch: teServedSinceSwitch + 1, currentRatioTe: ratio.te },
    };
  }

  return {
    ticket: pnQueue[0],
    updatedState: { teServedSinceSwitch: 0, currentRatioTe: ratio.te },
  };
}
```

En el servidor mantienes dos instancias de `PriorityState` (una por `service_type`), por ejemplo como dos filas en `priority_state`.

---

## Mejora 2 — Concurrencia: evitar que dos cajeros llamen el mismo ticket

Si dos cajeros presionan "Llamar Siguiente" casi al mismo tiempo, **nunca hagas** "leer la cola en el cliente → decidir en JS → hacer update" como dos pasos separados: hay una ventana de carrera donde ambos leen el mismo ticket como disponible. La solución es una función de Postgres (`RPC`) que hace todo dentro de **una sola transacción con bloqueo de filas**:

```sql
create or replace function call_next_ticket(p_service_type service_type, p_station_id uuid)
returns tickets
language plpgsql
as $$
declare
  v_state   priority_state%rowtype;
  v_pn_count int;
  v_ratio_te int;
  v_chosen  tickets%rowtype;
begin
  -- Bloquea la fila de estado de ESTE trámite: si otro cajero está llamando
  -- al mismo tiempo para el mismo trámite, espera su turno (no hay carrera).
  select * into v_state from priority_state where service_type = p_service_type for update;

  select count(*) into v_pn_count from tickets
    where service_type = p_service_type and profile = 'PN' and status = 'WAITING';

  v_ratio_te := case when v_pn_count < 5 then 2 else 1 end;
  if v_ratio_te <> v_state.current_ratio_te then
    v_state.te_served_since_switch := 0;
  end if;

  if v_state.te_served_since_switch < v_ratio_te then
    select * into v_chosen from tickets
      where service_type = p_service_type and profile = 'TE' and status = 'WAITING'
      order by created_at asc limit 1 for update skip locked;
  end if;

  if not found then
    select * into v_chosen from tickets
      where service_type = p_service_type and profile = 'PN' and status = 'WAITING'
      order by created_at asc limit 1 for update skip locked;
    if found then
      update priority_state set te_served_since_switch = 0, current_ratio_te = v_ratio_te
        where service_type = p_service_type;
    end if;
  else
    update priority_state set te_served_since_switch = v_state.te_served_since_switch + 1,
      current_ratio_te = v_ratio_te where service_type = p_service_type;
  end if;

  if not found then
    return null; -- no hay tickets en espera para este trámite
  end if;

  update tickets set status = 'CALLING', station_id = p_station_id, called_at = now()
    where id = v_chosen.id returning * into v_chosen;

  update stations set current_ticket_id = v_chosen.id where id = p_station_id;

  return v_chosen;
end;
$$;
```

El cajero llama esto desde el frontend con `supabase.rpc('call_next_ticket', { p_service_type: 'CAJA', p_station_id: stationId })`. `FOR UPDATE SKIP LOCKED` garantiza que si dos cajeros disparan la función casi simultáneamente, cada uno se queda con un ticket distinto — nunca el mismo.

---

## Mejora 3 — Numeración diaria (se reinicia cada día)

```sql
create or replace function generate_ticket_code(p_service_type service_type, p_profile client_profile)
returns text language plpgsql as $$
declare
  v_seq int;
  v_prefix text;
begin
  insert into daily_sequence (service_type, profile, seq_date, last_value)
  values (p_service_type, p_profile, current_date, 1)
  on conflict (service_type, profile, seq_date)
  do update set last_value = daily_sequence.last_value + 1
  returning last_value into v_seq;

  v_prefix := case
    when p_profile = 'TE' then 'TE'
    when p_service_type = 'CAJA' then 'C'
    else 'SC'
  end;

  return v_prefix || '-' || lpad(v_seq::text, 3, '0');
end;
$$;
```

Como `seq_date` es parte de la llave primaria de `daily_sequence`, el primer ticket del día siguiente automáticamente vuelve a `-001` sin ningún cron ni tarea de reinicio manual.

---

## Mejora 4 — Timeout automático para "Ausente"

Se implementa con un **Vercel Cron Job** (ya que despliegas ahí de todas formas), que revisa cada minuto si hay tickets `CALLING` desde hace demasiado tiempo:

```json
// vercel.json
{
  {}
}
```

```typescript
// /src/app/api/verificar-ausentes/route.ts
import { supabaseServer } from '@/lib/supabaseClient';

const TIMEOUT_SEGUNDOS = 90; // tiempo máximo para que el cliente llegue a la estación

export async function GET() {
  const limite = new Date(Date.now() - TIMEOUT_SEGUNDOS * 1000).toISOString();

  const { data, error } = await supabaseServer
    .from('tickets')
    .update({ status: 'ABSENT' })
    .eq('status', 'CALLING')
    .lt('called_at', limite)
    .select();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ marcadosAusentes: data?.length ?? 0 });
}
```

Esto libera automáticamente la estación (puedes además limpiar `stations.current_ticket_id` en el mismo endpoint) sin depender de que el cajero recuerde presionar "Ausente" manualmente.

---

## Pantalla Pública — mostrar ticket + estación asignada

```tsx
// /src/components/pantalla-publica/TicketDisplay.tsx
export function TicketDisplay({ ticket, station }: { ticket: Ticket; station: Station }) {
  const etiquetaEstacion =
    station.stationType === 'CAJA' ? `Caja ${station.label}` : `Cubículo ${station.label}`;

  return (
    <div className="text-center">
      <p className="text-6xl font-bold">{ticket.code}</p>
      <p className="text-3xl mt-4">{etiquetaEstacion}</p>
    </div>
  );
}
```

Como `stations.label` ya se guarda como número ("1","2"...) para `CAJA` y como letra ("A","B"...) para `CUBICULO`, no hace falta ninguna lógica adicional de formateo — solo el prefijo "Caja" o "Cubículo" según `station_type`.

---

## Apertura del día y apertura/cierre de estaciones en caliente

**Inicio del día (N cajas, M cubículos):** una pantalla simple de configuración (puede ser parte del Módulo Cajero, con rol de supervisor) que llama una función `inicializarEstaciones(n, m)`:

```typescript
// /src/lib/stations.ts
export async function inicializarEstaciones(n: number, m: number) {
  const cajas = Array.from({ length: n }, (_, i) => ({
    station_type: 'CAJA' as const,
    label: String(i + 1),          // "1", "2", "3"...
  }));

  const cubiculos = Array.from({ length: m }, (_, i) => ({
    station_type: 'CUBICULO' as const,
    label: String.fromCharCode(65 + i), // "A", "B", "C"...
  }));

  await supabase.from('stations').insert([...cajas, ...cubiculos]);
}
```

**Abrir/cerrar una estación durante el día:** simplemente se actualiza `active`:

```typescript
export async function toggleStation(stationId: string, active: boolean) {
  await supabase.from('stations').update({ active }).eq('id', stationId);
}
```

Dos reglas importantes a implementar en el Módulo Cajero:
1. **`call_next_ticket` solo debe considerar estaciones con `active = true`** — si una caja está cerrada, no debe poder llamar tickets desde ella (agrega `and stations.active` a la validación antes de llamar la RPC, o valida `p_station_id` dentro de la función).
2. **No permitir cerrar una estación que tiene un ticket en `IN_PROGRESS`** — el cajero debe finalizar o marcar ausente antes de poder cerrar su caja/cubículo. Esto evita perder de vista a un cliente que ya está siendo atendido.

La Pantalla Pública y el Kiosco pueden consultar `stations` filtrando por `active = true` para saber cuántas cajas/cubículos están operativos en cada momento (útil también para mostrar "Cajas abiertas: 3 de 5" si quieres ese detalle informativo).

---

## 3. Estructura de carpetas recomendada (Next.js App Router)

```
sistema-turnos-bancarios/
├── src/
│   ├── app/
│   │   ├── kiosco/
│   │   │   └── page.tsx
│   │   ├── pantalla-publica/
│   │   │   └── page.tsx
│   │   ├── cajero/
│   │   │   └── [stationId]/
│   │   │       └── page.tsx
│   │   ├── supervisor/
│   │   │   └── page.tsx              # apertura del día, abrir/cerrar estaciones
│   │   ├── api/
│   │   │   └── verificar-ausentes/
│   │   │       └── route.ts          # Vercel Cron: timeout automático
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── kiosco/
│   │   │   ├── TramiteSelector.tsx
│   │   │   ├── PerfilSelector.tsx
│   │   │   └── TicketPrintView.tsx
│   │   ├── pantalla-publica/
│   │   │   ├── TicketDisplay.tsx
│   │   │   └── AlertaSonora.tsx
│   │   ├── cajero/
│   │   │   ├── CajeroPanel.tsx
│   │   │   └── ColaEnEspera.tsx
│   │   ├── supervisor/
│   │   │   └── GestionEstaciones.tsx
│   │   └── shared/
│   │       └── Button.tsx
│   │
│   ├── lib/
│   │   ├── supabaseClient.ts
│   │   ├── ticketQueue.ts            # selectNextTicket() — versión cliente/preview
│   │   ├── ticketGenerator.ts
│   │   ├── stations.ts               # inicializar / abrir / cerrar estaciones
│   │   └── constants.ts
│   │
│   ├── hooks/
│   │   └── useRealtimeTickets.ts
│   │
│   └── types/
│       └── ticket.ts
│
├── public/
│   └── sounds/
│       └── notificacion.mp3
│
├── vercel.json                        # configuración de Vercel
├── tailwind.config.ts
├── next.config.js
└── package.json
```

---

## 4. Estrategia CSS `@media print` (impresora de matriz de puntos)

```css
/* /src/styles/print.css */
@media print {
  body * { visibility: hidden; }

  #ticket-print-area,
  #ticket-print-area * { visibility: visible; }

  #ticket-print-area {
    position: absolute;
    top: 0;
    left: 0;
    width: 58mm;
    padding: 4mm 2mm;
    font-family: 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.3;
    color: #000;
    background: #fff;
    page-break-inside: avoid;
  }

  #ticket-print-area .ticket-codigo {
    font-size: 22px;
    font-weight: bold;
    text-align: center;
    letter-spacing: 2px;
  }

  #ticket-print-area .ticket-separador {
    border-top: 1px dashed #000;
    margin: 3mm 0;
  }

  @page {
    size: 58mm auto;
    margin: 0;
  }
}
```

```tsx
// /src/components/kiosco/TicketPrintView.tsx
export function TicketPrintView({ ticket }: { ticket: Ticket }) {
  return (
    <div id="ticket-print-area" className="hidden print:block">
      <p className="ticket-codigo">{ticket.code}</p>
      <div className="ticket-separador" />
      <p>Trámite: {ticket.serviceType === 'CAJA' ? 'Caja' : 'Servicio al Cliente'}</p>
      <p>Fecha: {new Date(ticket.createdAt).toLocaleString()}</p>
      <div className="ticket-separador" />
      <p>Espere a ser llamado por pantalla</p>
    </div>
  );
}
```

---

## Resumen de lo removido del alcance

- **Firebase** eliminado del stack — solo Supabase (Postgres + Realtime).
- **Sin dashboard administrativo/reportes** adicional fuera de lo pedido.
- **Sin estados extra** más allá de los 5 (`WAITING`, `CALLING`, `IN_PROGRESS`, `COMPLETED`, `ABSENT`) — nada de "pausado" ni "transferido".
