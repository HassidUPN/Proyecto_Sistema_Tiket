# Despliegue del sistema de turnos bancarios

## 1) Configurar las variables reales
Crea un archivo `.env.local` con tus datos reales:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-clave-anon-publica
```

## 2) Crear la base de datos real en Supabase
1. Abre tu proyecto en Supabase.
2. Ve a SQL Editor.
3. Pega el contenido de `supabase-schema.sql`.
4. Ejecuta la consulta.

Esto crea:
- `workday_sessions`
- `tickets`
- `stations`
- `priority_state`
- `daily_sequence`
- enum `ticket_status`, `client_profile`, `service_type`, `station_type`
- función `generate_ticket_code`
- función `call_next_ticket`

La función de llamado solo permite estaciones activas y registra `started_at` para calcular los tiempos del dashboard. Si la base ya tenía el esquema anterior, vuelve a ejecutar el archivo completo en SQL Editor antes de desplegar.

## 3) Reemplazar el audio de notificación
Sustituye el archivo placeholder en:

```text
public/sounds/notificacion.mp3
```

por un archivo MP3 real de tu notificación.

## 4) Impresión directa del kiosco

El navegador no permite que una página web oculte el diálogo de impresión por seguridad. El kiosco ya inicia la impresión automáticamente después de crear el ticket, pero para imprimir sin mostrar el diálogo debes abrir Chrome con `--kiosk-printing` y configurar la impresora térmica como predeterminada.

En Windows, cierra las ventanas de Chrome y ejecuta:

```powershell
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk http://localhost:3000/kiosco
```

Para producción, reemplaza la URL por la dirección de Vercel. Con esta configuración el ticket se envía directamente a la impresora predeterminada. Si Chrome está instalado en otra ubicación, usa la ruta de ese ejecutable.

## 5) Desplegar a Vercel
1. Subir este repositorio a GitHub.
2. Crear proyecto nuevo en Vercel.
3. Importar el repositorio.
4. En Variables de entorno agregas:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Haz deploy.

## 6) Validar el flujo
- Entrar a `/kiosco`
- Elegir trámite y perfil
- Generar ticket
- Confirmar impresión
- Revisar `/pantalla-publica`
- Revisar `/cajero/[stationId]`
- Entrar a `/admin`, abrir la jornada y activar las estaciones necesarias
- Entrar a `/accesos` y seleccionar la caja o cubículo correspondiente
- Revisar el dashboard de atención y sus tiempos
