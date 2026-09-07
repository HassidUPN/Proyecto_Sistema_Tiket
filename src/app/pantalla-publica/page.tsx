'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Station, Ticket } from '@/types/ticket';

function toTicket(row: any): Ticket {
  return {
    id: row.id, code: row.code, sequence: Number(row.sequence ?? 0), profile: row.profile,
    serviceType: row.service_type ?? row.serviceType, status: row.status,
    stationId: row.station_id ?? row.stationId, attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at ?? row.createdAt, calledAt: row.called_at ?? row.calledAt,
    startedAt: row.started_at ?? row.startedAt, completedAt: row.completed_at ?? row.completedAt,
  };
}

function toStation(row: any): Station {
  return {
    id: row.id, stationType: row.station_type ?? row.stationType, label: row.label,
    active: Boolean(row.active), currentTicketId: row.current_ticket_id ?? row.currentTicketId,
    employeeName: row.employee_name ?? row.employeeName,
  };
}

function stationName(station: Station) {
  return station.stationType === 'CAJA' ? `Caja ${station.label}` : `Cubículo ${station.label}`;
}

export default function PantallaPublicaPage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [currentByStation, setCurrentByStation] = useState<Record<string, Ticket>>({});
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  const [nextTickets, setNextTickets] = useState<Ticket[]>([]);
  const [recentTickets, setRecentTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundMessage, setSoundMessage] = useState('');
  const lastNotifiedTicketId = useRef<string | null>(null);

  const playFallbackBeep = () => {
    const AudioContextConstructor = window.AudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.35);
    oscillator.addEventListener('ended', () => context.close());
  };

  const playNotification = (ticketId?: string | null) => {
    if (!soundEnabled || !ticketId || lastNotifiedTicketId.current === ticketId) return;
    lastNotifiedTicketId.current = ticketId;
    const audio = new Audio('/sounds/notificacion.mp3');
    audio.play().catch(() => playFallbackBeep());
  };

  const clearAbandonedCalls = async () => {
    try {
      await fetch('/api/verificar-ausentes');
    } catch (error) {
      console.error('Error clearing abandoned calls:', error);
    }
  };

  const loadBoard = async (notify = true) => {
    await clearAbandonedCalls();
    const [{ data: stationData, error: stationError }, { data: activeData, error: activeError }, { data: waitingData }, { data: recentData }] = await Promise.all([
      supabase.from('stations').select('*').eq('active', true).order('station_type').order('label'),
      supabase.from('tickets').select('*').eq('status', 'CALLING').order('called_at', { ascending: false }).limit(50),
      supabase.from('tickets').select('*').eq('status', 'WAITING').order('created_at', { ascending: true }).limit(3),
      supabase.from('tickets').select('*').eq('status', 'COMPLETED').order('completed_at', { ascending: false }).limit(3),
    ]);

    if (stationError || activeError) {
      console.error('Error loading public board:', stationError ?? activeError);
      setLoading(false);
      return;
    }

    const activeStations = (stationData ?? []).map(toStation);
    const activeTickets = (activeData ?? []).map(toTicket);
    const byStation: Record<string, Ticket> = {};
    activeTickets.forEach((ticket) => { if (ticket.stationId) byStation[ticket.stationId] = ticket; });
    const newest = activeTickets[0] ?? null;
    setStations(activeStations);
    setCurrentByStation(byStation);
    setCurrentTicket(newest);
    setNextTickets((waitingData ?? []).map(toTicket));
    setRecentTickets((recentData ?? []).map(toTicket));
    if (notify && newest?.id) {
      playNotification(newest.id);
    } else {
      lastNotifiedTicketId.current = newest?.id ?? null;
    }
    setLoading(false);
  };

  useEffect(() => {
    loadBoard(false);
    const poller = window.setInterval(() => loadBoard(), 3000);
    return () => window.clearInterval(poller);
  }, [soundEnabled]);

  useEffect(() => {
    const channel = supabase.channel('pantalla-publica-board').on(
      'postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => loadBoard(),
    ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [soundEnabled]);

  const stationGroups = useMemo(() => ({
    cajas: stations.filter((station) => station.stationType === 'CAJA'),
    cubiculos: stations.filter((station) => station.stationType === 'CUBICULO'),
  }), [stations]);

  const enableSound = async () => {
    try {
      const audio = new Audio('/sounds/notificacion.mp3');
      audio.volume = 0;
      await audio.play();
      audio.pause();
      setSoundMessage('');
      setSoundEnabled(true);
    } catch {
      try {
        playFallbackBeep();
        setSoundMessage('');
        setSoundEnabled(true);
      } catch {
        setSoundMessage('Pulsa nuevamente para permitir el sonido en este navegador.');
      }
    }
    if (!soundEnabled && !window.AudioContext) {
      setSoundMessage('Pulsa nuevamente para permitir el sonido en este navegador.');
    }
  };

  const stationCard = (station: Station) => {
    const ticket = currentByStation[station.id];
    return (
      <div key={station.id} className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black text-slate-950">{stationName(station)}</h3><span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" /></div>
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Atendiendo</p>
        <p className="mt-1 text-3xl font-black tracking-wider text-sky-800">{ticket?.code ?? '--'}</p>
      </div>
    );
  };

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-white text-slate-800"><p className="text-2xl font-semibold">Cargando pantalla pública...</p></main>;

  return (
    <main className="min-h-screen bg-white p-4 text-slate-800 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-sky-100 bg-sky-50 px-6 py-5 shadow-xl sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div><p className="text-xs font-bold uppercase tracking-[0.45em] text-sky-700">Sala de espera</p><h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Banco</h1></div>
          {!soundEnabled && <div className="text-right"><button type="button" onClick={enableSound} className="rounded-xl bg-sky-200 px-4 py-3 text-sm font-bold text-sky-950 transition hover:bg-sky-300">Activar sonido</button>{soundMessage && <p className="mt-2 max-w-xs text-xs text-amber-700">{soundMessage}</p>}</div>}
        </header>

        <section className="grid gap-5 lg:grid-cols-[1fr_1.45fr_1fr]">
          <aside className="order-2 rounded-[2rem] border border-sky-100 bg-sky-50 p-5 shadow-xl lg:order-1"><h2 className="text-lg font-black uppercase tracking-[0.2em] text-sky-700">Próximos 3</h2><div className="mt-5 space-y-3">{nextTickets.length ? nextTickets.map((ticket, index) => <div key={ticket.id} className="rounded-2xl border border-sky-100 bg-white p-4"><div className="flex justify-between"><span className="text-2xl font-black text-slate-950">{ticket.code}</span><span className="text-xs font-bold text-slate-400">#{index + 1}</span></div><p className="mt-1 text-sm text-slate-500">{ticket.serviceType === 'CAJA' ? 'Caja' : 'Servicio al Cliente'}</p></div>) : <p className="rounded-2xl bg-white p-4 text-slate-500">No hay tickets en espera.</p>}</div></aside>
          <section className="order-1 flex min-h-[360px] flex-col items-center justify-center rounded-[2rem] border border-sky-200 bg-sky-50 p-8 text-center shadow-xl lg:order-2"><p className="text-sm font-bold uppercase tracking-[0.4em] text-sky-700">Llamado actual</p><p className="mt-8 text-7xl font-black tracking-[0.22em] text-slate-950 drop-shadow-[0_0_18px_rgba(125,211,252,0.5)] sm:text-8xl">{currentTicket?.code ?? '--'}</p><p className="mt-7 text-3xl font-bold text-sky-800">{currentTicket?.stationId ? stationName(stations.find((station) => station.id === currentTicket.stationId) ?? { id: '', stationType: 'CAJA', label: '?', active: true }) : 'Esperando llamado'}</p></section>
          <aside className="order-3 rounded-[2rem] border border-emerald-100 bg-emerald-50 p-5 shadow-xl"><h2 className="text-lg font-black uppercase tracking-[0.2em] text-emerald-800">Últimos 3 atendidos</h2><div className="mt-5 space-y-3">{recentTickets.length ? recentTickets.map((ticket, index) => <div key={ticket.id} className="rounded-2xl border border-emerald-100 bg-white p-4"><div className="flex justify-between"><span className="text-2xl font-black text-slate-950">{ticket.code}</span><span className="text-xs font-bold text-slate-400">#{index + 1}</span></div><p className="mt-1 text-sm text-slate-500">Atendido</p></div>) : <p className="rounded-2xl bg-white p-4 text-slate-500">Sin atenciones recientes.</p>}</div></aside>
        </section>

        <section className="rounded-[2rem] border border-sky-100 bg-white p-5 shadow-xl sm:p-6"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.35em] text-slate-500">Estado en vivo</p><h2 className="mt-2 text-2xl font-black text-slate-950">Atención por puesto</h2></div><p className="text-sm text-slate-500">{stations.length} estaciones abiertas</p></div><div className="mt-5 grid gap-5 xl:grid-cols-2"><div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.25em] text-sky-700">Cajas</h3><div className="grid gap-3 sm:grid-cols-2">{stationGroups.cajas.map(stationCard)}{!stationGroups.cajas.length && <p className="text-slate-500">Sin cajas abiertas.</p>}</div></div><div><h3 className="mb-3 text-sm font-bold uppercase tracking-[0.25em] text-emerald-700">Cubículos</h3><div className="grid gap-3 sm:grid-cols-2">{stationGroups.cubiculos.map(stationCard)}{!stationGroups.cubiculos.length && <p className="text-slate-500">Sin cubículos abiertos.</p>}</div></div></div></section>
      </div>
    </main>
  );
}
