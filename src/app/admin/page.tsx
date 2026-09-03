'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Station, Ticket } from '@/types/ticket';

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

function toTicket(row: any): Ticket {
  return {
    id: row.id,
    code: row.code,
    sequence: Number(row.sequence ?? 0),
    profile: row.profile,
    serviceType: row.service_type,
    status: row.status,
    stationId: row.station_id ?? undefined,
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at,
    calledAt: row.called_at ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}

function minutesBetween(start?: string, end?: string) {
  if (!start || !end) return null;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

export default function AdminPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [session, setSession] = useState<any>(null);
  const [cajas, setCajas] = useState(2);
  const [cubiculos, setCubiculos] = useState(1);
  const [tab, setTab] = useState<'operation' | 'dashboard'>('operation');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const loadData = async () => {
    setLoading(true);
    const [{ data: stationData }, { data: ticketData }, { data: sessionData }] = await Promise.all([
      supabase.from('stations').select('*').order('station_type').order('label'),
      supabase.from('tickets').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('workday_sessions').select('*').eq('status', 'OPEN').order('opened_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const mappedStations = (stationData ?? []).map(toStation);
    setStations(mappedStations);
    setTickets((ticketData ?? []).map(toTicket));
    setSession(sessionData ?? null);
    setCajas(Math.max(1, mappedStations.filter((station) => station.stationType === 'CAJA' && station.active).length));
    setCubiculos(Math.max(1, mappedStations.filter((station) => station.stationType === 'CUBICULO' && station.active).length));
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const activeStations = stations.filter((station) => station.active);
  const todayTickets = useMemo(() => {
    if (!session?.opened_at) return tickets;
    return tickets.filter((ticket) => ticket.status === 'WAITING' || (ticket.calledAt && new Date(ticket.calledAt) >= new Date(session.opened_at)));
  }, [tickets, session]);

  const metrics = useMemo(() => {
    const completed = todayTickets.filter((ticket) => ticket.status === 'COMPLETED' || ticket.status === 'ABSENT');
    const attended = todayTickets.filter((ticket) => ticket.status === 'COMPLETED');
    const waits = completed.map((ticket) => minutesBetween(ticket.createdAt, ticket.calledAt)).filter((value): value is number => value !== null);
    const services = attended.map((ticket) => minutesBetween(ticket.startedAt ?? ticket.calledAt, ticket.completedAt)).filter((value): value is number => value !== null);
    return {
      called: todayTickets.filter((ticket) => Boolean(ticket.calledAt)).length,
      completed: attended.length,
      absent: todayTickets.filter((ticket) => ticket.status === 'ABSENT').length,
      waiting: todayTickets.filter((ticket) => ticket.status === 'WAITING').length,
      averageWait: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : 0,
      minService: services.length ? Math.min(...services) : 0,
      maxService: services.length ? Math.max(...services) : 0,
      averageService: services.length ? Math.round(services.reduce((sum, value) => sum + value, 0) / services.length) : 0,
    };
  }, [todayTickets]);

  const stationStats = useMemo(() => {
    return stations.map((station) => {
      const attended = todayTickets.filter((ticket) => ticket.stationId === station.id && ticket.status === 'COMPLETED');
      const durations = attended.map((ticket) => minutesBetween(ticket.startedAt ?? ticket.calledAt, ticket.completedAt)).filter((value): value is number => value !== null);
      return { station, count: attended.length, average: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0 };
    }).filter((item) => item.count > 0);
  }, [stations, todayTickets]);

  const applyStationPlan = async () => {
    setSaving(true);
    setMessage('');
    try {
      const nextStations = [...stations];
      const ensureStations = async (type: 'CAJA' | 'CUBICULO', count: number) => {
        const existing = nextStations.filter((station) => station.stationType === type).sort((a, b) => a.label.localeCompare(b.label));
        if (existing.length < count) {
          const newRows = Array.from({ length: count - existing.length }, (_, index) => ({
            station_type: type,
            label: type === 'CAJA' ? String(existing.length + index + 1) : String.fromCharCode(65 + existing.length + index),
            active: false,
          }));
          const { error } = await supabase.from('stations').insert(newRows);
          if (error) throw error;
        }
      };

      await ensureStations('CAJA', cajas);
      await ensureStations('CUBICULO', cubiculos);
      const { data: freshData, error: refreshError } = await supabase.from('stations').select('*').order('station_type').order('label');
      if (refreshError) throw refreshError;
      const freshStations = (freshData ?? []).map(toStation);
      await Promise.all(freshStations.map((station) => {
        const sameType = freshStations.filter((item) => item.stationType === station.stationType).sort((a, b) => a.label.localeCompare(b.label));
        const limit = station.stationType === 'CAJA' ? cajas : cubiculos;
        const stationIndex = sameType.findIndex((item) => item.id === station.id);
        const label = station.stationType === 'CUBICULO'
          ? String.fromCharCode(65 + stationIndex)
          : String(stationIndex + 1);
        return supabase.from('stations').update({ active: stationIndex < limit, label }).eq('id', station.id);
      }));
      await loadData();
      setMessage('Configuración de estaciones actualizada.');
    } catch (error) {
      console.error(error);
      setMessage('No se pudo actualizar la configuración. Revisa que hayas aplicado el esquema de Supabase.');
    } finally {
      setSaving(false);
    }
  };

  const openDay = async () => {
    setSaving(true);
    setMessage('');
    try {
      if (session) {
        setMessage('Ya existe una jornada abierta.');
        return;
      }
      const { data, error } = await supabase.from('workday_sessions').insert({ status: 'OPEN' }).select().single();
      if (error) throw error;
      setSession(data);
      await applyStationPlan();
      setMessage('Jornada abierta correctamente.');
    } catch (error) {
      console.error(error);
      setMessage('No se pudo abrir la jornada. Aplica primero supabase-schema.sql.');
    } finally {
      setSaving(false);
    }
  };

  const closeDay = async () => {
    if (!session) return;
    setSaving(true);
    const { error } = await supabase.from('workday_sessions').update({ status: 'CLOSED', closed_at: new Date().toISOString() }).eq('id', session.id);
    if (error) setMessage('No se pudo cerrar la jornada.');
    else {
      setSession(null);
      setMessage('Jornada cerrada correctamente.');
    }
    setSaving(false);
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-white text-slate-800"><p className="text-lg">Cargando panel de administración...</p></main>;

  return (
    <main className="min-h-screen bg-white p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[2rem] border border-sky-100 bg-sky-50 p-6 text-slate-900 shadow-xl sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-sm font-bold uppercase tracking-[0.3em] text-sky-700">Centro de control</p><h1 className="mt-3 text-4xl font-black">Administración diaria</h1><p className="mt-2 text-slate-500">Configura la atención y consulta el rendimiento de tu oficina.</p></div>
            <div className={`rounded-full px-4 py-2 text-sm font-bold ${session ? 'bg-emerald-200 text-emerald-900' : 'bg-slate-200 text-slate-600'}`}>{session ? 'Jornada abierta' : 'Jornada cerrada'}</div>
          </div>
        </header>

        <nav className="flex gap-2 rounded-2xl border border-white bg-white/80 p-2 shadow-sm">
          <button type="button" onClick={() => setTab('operation')} className={`rounded-xl px-5 py-3 font-bold ${tab === 'operation' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Operación</button>
          <button type="button" onClick={() => setTab('dashboard')} className={`rounded-xl px-5 py-3 font-bold ${tab === 'dashboard' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Dashboard de atención</button>
        </nav>

        {tab === 'operation' ? (
          <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-blue-700">Jornada</p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Apertura del día</h2>
              <p className="mt-2 text-slate-500">Define cuántas estaciones estarán disponibles para atender.</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <label className="font-bold">Cajas<input type="number" min="0" max="50" value={cajas} onChange={(event) => setCajas(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg" /></label>
                <label className="font-bold">Cubículos<input type="number" min="0" max="50" value={cubiculos} onChange={(event) => setCubiculos(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-lg" /></label>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={openDay} disabled={saving || Boolean(session)} className="rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300">Abrir jornada</button>
                <button type="button" onClick={closeDay} disabled={saving || !session} className="rounded-xl bg-slate-900 px-5 py-3 font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300">Cerrar jornada</button>
              </div>
              {session && <Link href="/accesos" className="mt-4 block rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-center font-bold text-blue-800 transition hover:bg-blue-100">Ver accesos de la jornada</Link>}
              <button type="button" onClick={applyStationPlan} disabled={saving} className="mt-3 text-sm font-bold text-blue-700 hover:text-blue-900">Guardar solo configuración de estaciones</button>
              {message && <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800">{message}</p>}
            </div>

            <div className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl">
              <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold uppercase tracking-[0.25em] text-slate-500">Estado actual</p><h2 className="mt-2 text-2xl font-black text-slate-950">Estaciones disponibles</h2></div><span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">{activeStations.length} activas</span></div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {stations.map((station) => <div key={station.id} className={`rounded-2xl border p-4 ${station.active ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50 opacity-70'}`}><div className="flex items-center justify-between"><span className="text-lg font-black">{station.stationType === 'CAJA' ? 'Caja' : 'Cubículo'} {station.label}</span><span className={`text-xs font-black uppercase ${station.active ? 'text-emerald-700' : 'text-slate-500'}`}>{station.active ? 'Activa' : 'Cerrada'}</span></div><p className="mt-2 text-sm text-slate-500">{station.currentTicketId ? 'Ticket en atención' : 'Sin ticket asignado'}</p></div>)}
              </div>
            </div>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Llamados', metrics.called], ['Atendidos', metrics.completed], ['Ausentes', metrics.absent], ['En espera', metrics.waiting]].map(([label, value]) => <div key={label} className="rounded-2xl border border-white bg-white/90 p-5 shadow-lg"><p className="text-sm font-bold uppercase tracking-wider text-slate-500">{label}</p><p className="mt-2 text-4xl font-black text-slate-950">{value}</p></div>)}</div>
              <div className="grid gap-4 sm:grid-cols-3"><div className="rounded-2xl bg-sky-100 p-5 text-sky-950"><p className="text-sm font-bold uppercase">Espera promedio</p><p className="mt-2 text-3xl font-black">{metrics.averageWait} min</p></div><div className="rounded-2xl bg-emerald-100 p-5 text-emerald-950"><p className="text-sm font-bold uppercase">Atención mínima</p><p className="mt-2 text-3xl font-black">{metrics.minService} min</p></div><div className="rounded-2xl bg-amber-100 p-5 text-amber-950"><p className="text-sm font-bold uppercase">Atención máxima</p><p className="mt-2 text-3xl font-black">{metrics.maxService} min</p></div></div>
            <div className="rounded-[2rem] border border-white bg-white/90 p-6 shadow-xl"><h2 className="text-2xl font-black text-slate-950">Atención por estación</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{stationStats.map(({ station, count, average }) => <div key={station.id} className="rounded-2xl bg-slate-100 p-4"><p className="font-bold text-slate-500">{station.stationType === 'CAJA' ? 'Caja' : 'Cubículo'} {station.label}</p><p className="mt-2 text-3xl font-black text-slate-950">{count}</p><p className="text-sm text-slate-500">clientes · {average} min promedio</p></div>)}{stationStats.length === 0 && <p className="text-slate-500">Aún no hay atenciones finalizadas por estación.</p>}</div></div>
            <div className="overflow-hidden rounded-[2rem] border border-white bg-white/90 shadow-xl"><div className="border-b border-slate-200 p-6"><h2 className="text-2xl font-black text-slate-950">Detalle de atención</h2><p className="mt-1 text-slate-500">Cada ticket llamado durante la jornada actual.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-6 py-4">Ticket</th><th className="px-6 py-4">Servicio</th><th className="px-6 py-4">Estación</th><th className="px-6 py-4">Espera</th><th className="px-6 py-4">Atención</th><th className="px-6 py-4">Estado</th></tr></thead><tbody>{todayTickets.filter((ticket) => ticket.calledAt).map((ticket) => <tr key={ticket.id} className="border-t border-slate-100"><td className="px-6 py-4 font-black text-slate-950">{ticket.code}</td><td className="px-6 py-4">{ticket.serviceType === 'CAJA' ? 'Caja' : 'Servicio al Cliente'}</td><td className="px-6 py-4">{ticket.stationId ? stations.find((station) => station.id === ticket.stationId)?.label ?? ticket.stationId : 'Sin estación'}</td><td className="px-6 py-4">{minutesBetween(ticket.createdAt, ticket.calledAt) ?? '-'} min</td><td className="px-6 py-4">{minutesBetween(ticket.startedAt ?? ticket.calledAt, ticket.completedAt) ?? '-'} min</td><td className="px-6 py-4 font-bold">{ticket.status}</td></tr>)}{todayTickets.filter((ticket) => ticket.calledAt).length === 0 && <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-500">Aún no hay atenciones registradas en esta jornada.</td></tr>}</tbody></table></div></div>
          </section>
        )}
      </div>
    </main>
  );
}
