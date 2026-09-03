'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Station } from '@/types/ticket';
import { supabase } from '@/lib/supabaseClient';

function toStation(row: any): Station {
  return {
    id: row.id,
    stationType: row.station_type,
    label: row.label,
    active: Boolean(row.active),
    currentTicketId: row.current_ticket_id ?? undefined,
    employeeName: row.employee_name ?? undefined,
  };
}

export default function AccessPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStations = async () => {
    const { data } = await supabase
      .from('stations')
      .select('*')
      .eq('active', true)
      .order('station_type')
      .order('label');
    setStations((data ?? []).map(toStation));
    setLoading(false);
  };

  useEffect(() => {
    loadStations();
    const poller = window.setInterval(loadStations, 5000);
    return () => window.clearInterval(poller);
  }, []);

  const cajas = stations.filter((station) => station.stationType === 'CAJA');
  const cubiculos = stations.filter((station) => station.stationType === 'CUBICULO');

  const stationButton = (station: Station) => (
    <Link
      key={station.id}
      href={`/cajero/${station.id}`}
      className="group rounded-2xl border border-blue-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-blue-500 hover:shadow-xl"
    >
      <span className="block text-xs font-black uppercase tracking-[0.2em] text-blue-600">Abrir atención</span>
      <span className="mt-2 block text-2xl font-black text-slate-950">{station.stationType === 'CAJA' ? 'Caja' : 'Cubículo'} {station.label}</span>
      <span className="mt-2 block text-sm font-semibold text-slate-500">Ir a esta estación</span>
    </Link>
  );

  return (
    <main className="min-h-screen bg-white p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-[2rem] border border-sky-100 bg-sky-50 p-6 text-slate-900 shadow-xl sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-sky-700">Accesos de la jornada</p>
          <h1 className="mt-3 text-4xl font-black">Selecciona un puesto</h1>
          <p className="mt-2 text-slate-500">Abre rápidamente el módulo que necesitas utilizar.</p>
        </header>

        {loading ? <div className="rounded-2xl bg-white p-8 text-center shadow-lg">Cargando accesos...</div> : (
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl">
              <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black text-slate-950">Cajas abiertas</h2><span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">{cajas.length}</span></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cajas.map(stationButton)}{cajas.length === 0 && <p className="text-slate-500">No hay cajas abiertas.</p>}</div>
            </section>

            <section className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl">
              <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-black text-slate-950">Cubículos abiertos</h2><span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800">{cubiculos.length}</span></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cubiculos.map(stationButton)}{cubiculos.length === 0 && <p className="text-slate-500">No hay cubículos abiertos.</p>}</div>
            </section>

            <section className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl">
              <h2 className="text-2xl font-black text-slate-950">Kiosco</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2"><Link href="/kiosco" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 transition hover:-translate-y-1 hover:bg-emerald-100"><span className="block text-xs font-black uppercase tracking-[0.2em] text-emerald-700">Emitir turnos</span><span className="mt-2 block text-2xl font-black text-slate-950">Kiosco principal</span><span className="mt-2 block text-sm font-semibold text-slate-500">Ir al módulo de emisión</span></Link><Link href="/admin" className="rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:-translate-y-1 hover:bg-slate-100"><span className="block text-xs font-black uppercase tracking-[0.2em] text-slate-500">Configuración</span><span className="mt-2 block text-2xl font-black text-slate-950">Volver al administrador</span></Link></div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
