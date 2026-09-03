'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import type { ServiceType, Station, Ticket, TicketStatus } from '@/types/ticket';

function toTicket(row: any): Ticket {
  return {
    id: row.id,
    code: row.code,
    sequence: Number(row.sequence ?? 0),
    profile: row.profile,
    serviceType: row.service_type ?? row.serviceType,
    status: row.status,
    stationId: row.station_id ?? row.stationId,
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at ?? row.createdAt,
    calledAt: row.called_at ?? row.calledAt,
    startedAt: row.started_at ?? row.startedAt,
    completedAt: row.completed_at ?? row.completedAt,
  };
}

export default function CajeroPage() {
  const params = useParams<{ stationId: string }>();
  const stationId = params.stationId;

  const [station, setStation] = useState<Station | null>(null);
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  const [waitingTickets, setWaitingTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const serviceType = useMemo<ServiceType | null>(() => {
    if (!station) return null;
    return station.stationType === 'CAJA' ? 'CAJA' : 'SERVICIO_CLIENTE';
  }, [station]);

  const hasValidTicketId = (ticket: Ticket | null) => {
    return Boolean(ticket?.id && ticket.id !== 'null' && ticket.id !== 'undefined');
  };

  const fetchStation = async () => {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stationId);
    let data = null;
    let error = null;

    if (isUuid) {
      const result = await supabase
        .from('stations')
        .select('*')
        .eq('id', stationId)
        .maybeSingle();

      data = result.data;
      error = result.error;
    }

    if (!data) {
      const fallback = await supabase
        .from('stations')
        .select('*')
        .eq('label', stationId)
        .eq('station_type', 'CAJA')
        .limit(1)
        .maybeSingle();

      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Error fetching station by label for Caja:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    const mappedStation: Station = {
      id: data.id,
      stationType: data.station_type,
      label: data.label,
      active: Boolean(data.active),
      currentTicketId: data.current_ticket_id ?? undefined,
      employeeName: data.employee_name ?? undefined,
    };

    setStation(mappedStation);
    return mappedStation;
  };

  const fetchCurrentTicket = async (resolvedServiceType: ServiceType, targetStationId: string) => {
    const { data: activeTickets, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('station_id', targetStationId)
      .in('status', ['CALLING', 'IN_PROGRESS'])
      .order('called_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching current ticket:', error);
      return;
    }

    if (activeTickets && activeTickets.length > 0) {
      setCurrentTicket(toTicket(activeTickets[0]));
      return;
    }

    setCurrentTicket(null);
  };

  const playNotification = () => {
    try {
      const audio = new Audio('/sounds/notificacion.mp3');
      audio.play().catch(() => {
        // No bloquear la UI si el navegador exige interacción del usuario
      });
    } catch {
      // Ignorar silenciosamente si el navegador no permite audio
    }
  };

  const fetchWaitingTickets = async (resolvedServiceType: ServiceType) => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('service_type', resolvedServiceType)
      .eq('status', 'WAITING')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching waiting tickets:', error);
      return;
    }

    setWaitingTickets((data ?? []).map(toTicket));
  };

  useEffect(() => {
    if (!stationId) return;

    const bootstrap = async () => {
      setLoading(true);
      const resolvedStation = await fetchStation();
      if (!resolvedStation) {
        setLoading(false);
        return;
      }

      const resolvedServiceType = resolvedStation.stationType === 'CAJA' ? 'CAJA' : 'SERVICIO_CLIENTE';
      await fetchCurrentTicket(resolvedServiceType, resolvedStation.id);
      await fetchWaitingTickets(resolvedServiceType);
      setLoading(false);
    };

    bootstrap();
  }, [stationId]);

  useEffect(() => {
    if (!station || !serviceType) return;

    const refreshQueue = async () => {
      await fetchWaitingTickets(serviceType);
      await fetchCurrentTicket(serviceType, station.id);
    };

    refreshQueue();
    const poller = window.setInterval(refreshQueue, 4000);

    const channel = supabase
      .channel(`tickets-${station.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `service_type=eq.${serviceType}`,
        },
        (payload) => {
          const updatedTicket = payload.new as any;

          if (updatedTicket.status === 'WAITING') {
            setWaitingTickets((prev) => {
              const normalized = prev.filter((item) => item.id !== updatedTicket.id);
              return [...normalized, toTicket(updatedTicket)].sort((a, b) =>
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
              );
            });
          }

          const nextStationId = (updatedTicket as any)?.station_id ?? (updatedTicket as any)?.stationId;
          const previousStationId = (payload.old as any)?.station_id ?? (payload.old as any)?.stationId;

          if (nextStationId === station.id && ['CALLING', 'IN_PROGRESS'].includes(updatedTicket.status)) {
            setCurrentTicket(toTicket(updatedTicket));
          }

          if (nextStationId !== station.id && previousStationId === station.id) {
            setCurrentTicket((prev) => (prev && prev.id === updatedTicket.id ? null : prev));
          }

          const previousTicket = payload.old as any;

          if (
            previousTicket &&
            previousTicket.status === 'WAITING' &&
            updatedTicket.status !== 'WAITING'
          ) {
            setWaitingTickets((prev) => prev.filter((item) => item.id !== updatedTicket.id));
          }

          fetchWaitingTickets(serviceType);
          const nextCurrent = async () => {
            await fetchCurrentTicket(serviceType, station.id);
          };
          nextCurrent();
        },
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime unavailable for cashier queue. Polling fallback is active.');
        }
      });

    return () => {
      window.clearInterval(poller);
      supabase.removeChannel(channel);
    };
  }, [station, serviceType]);

  const handleCallNextTicket = async () => {
    if (!station || !serviceType) return;
    setActionLoading(true);
    setMessage('');

    try {
      const { data, error } = await supabase.rpc('call_next_ticket', {
        p_service_type: serviceType,
        p_station_id: station.id,
      });

      if (error) {
        console.error('Error calling next ticket:', error);
        setMessage('No hay tickets disponibles para este trámite.');
        setActionLoading(false);
        return;
      }

      let nextTicket: Ticket | null = null;

      if (data && data.id) {
        nextTicket = toTicket(data);
      } else {
        const { data: fallbackData } = await supabase
          .from('tickets')
          .select('*')
          .eq('service_type', serviceType)
          .eq('status', 'WAITING')
          .order('created_at', { ascending: true })
          .limit(1);

        if (fallbackData && fallbackData.length > 0) {
          nextTicket = toTicket(fallbackData[0]);
          const { error: fallbackError } = await supabase
            .from('tickets')
            .update({
              status: 'CALLING',
              station_id: station.id,
              called_at: new Date().toISOString(),
              started_at: new Date().toISOString(),
              completed_at: null,
            })
            .eq('id', nextTicket.id);

          if (fallbackError) {
            console.error('Error updating fallback ticket:', fallbackError);
          }
        }
      }

      setCurrentTicket(nextTicket);
      await fetchWaitingTickets(serviceType);

      if (nextTicket) {
        playNotification();
        setMessage(`Ticket ${nextTicket.code} llamado correctamente.`);
      } else {
        setMessage('No hay tickets en espera para este trámite.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkAbsent = async () => {
    if (!currentTicket || !station || !hasValidTicketId(currentTicket)) {
      setMessage('No hay un ticket en atención para marcar ausente.');
      return;
    }

    setActionLoading(true);
    const { error } = await supabase
      .from('tickets')
      .update({
        status: 'ABSENT',
        called_at: currentTicket.calledAt ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', currentTicket.id);

    if (error) {
      console.error('Error marking ticket absent:', error);
      setMessage('No se pudo marcar el ticket como ausente.');
      setActionLoading(false);
      return;
    }

    await supabase.from('stations').update({ current_ticket_id: null }).eq('id', station.id);
    setCurrentTicket(null);
    setMessage('Ticket marcado como ausente.');
    setActionLoading(false);
    await fetchWaitingTickets(serviceType as ServiceType);
  };

  const handleFinalizeAttention = async () => {
    if (!currentTicket || !station || !hasValidTicketId(currentTicket)) {
      setMessage('No hay un ticket en atención para finalizar.');
      return;
    }

    setActionLoading(true);
    const { error } = await supabase
      .from('tickets')
      .update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      })
      .eq('id', currentTicket.id);

    if (error) {
      console.error('Error finalizing ticket:', error);
      setMessage('No se pudo finalizar la atención.');
      setActionLoading(false);
      return;
    }

    await supabase.from('stations').update({ current_ticket_id: null }).eq('id', station.id);
    setCurrentTicket(null);
    setMessage('Atención finalizada correctamente.');
    setActionLoading(false);
    await fetchWaitingTickets(serviceType as ServiceType);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-sky-100 bg-white p-8 text-center shadow-xl">
          <p className="text-lg font-medium text-slate-600">Cargando estación...</p>
        </div>
      </main>
    );
  }

  if (!station) {
    return (
      <main className="min-h-screen bg-white p-6">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-sky-100 bg-white p-8 text-center shadow-xl">
          <p className="text-lg font-medium text-red-600">No se encontró la estación solicitada.</p>
        </div>
      </main>
    );
  }

  const currentStatus: TicketStatus | 'SIN_TICKET' = currentTicket ? currentTicket.status : 'SIN_TICKET';

  return (
    <main className="min-h-screen bg-white p-4 text-slate-800 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[2rem] border border-sky-100 bg-white p-6 shadow-[0_20px_60px_rgba(125,160,190,0.16)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Módulo de Cajero</p>
              <h1 className="mt-2 text-3xl font-bold">Estación {station.label}</h1>
            </div>
            <div className="rounded-full bg-sky-100 px-4 py-2 text-sm font-bold text-sky-800">
              {station.stationType === 'CAJA' ? 'Caja' : 'Cubículo'}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <section className="rounded-[2rem] border border-sky-100 bg-white p-6 shadow-[0_20px_60px_rgba(125,160,190,0.16)]">
            <h2 className="mb-5 text-2xl font-bold">Atención actual</h2>

            {currentTicket && hasValidTicketId(currentTicket) ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
                  <p className="text-sm uppercase tracking-[0.2em] text-blue-700">Ticket en atención</p>
                  <div className="mt-3 text-5xl font-black text-slate-900">{currentTicket.code}</div>
                  <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-700">
                    <span className="rounded-full bg-white px-3 py-1">{currentTicket.profile}</span>
                    <span className="rounded-full bg-white px-3 py-1">{currentTicket.serviceType}</span>
                    <span className="rounded-full bg-white px-3 py-1">{currentStatus}</span>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={handleCallNextTicket}
                    disabled={actionLoading}
                    className="rounded-2xl bg-sky-600 px-5 py-4 text-base font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-200 disabled:!text-sky-800"
                  >
                    Llamar Siguiente Ticket
                  </button>

                  <button
                    type="button"
                    onClick={handleMarkAbsent}
                    disabled={actionLoading || currentTicket.status !== 'CALLING'}
                    className="rounded-2xl bg-amber-300 px-5 py-4 text-base font-bold text-amber-950 shadow-md transition hover:-translate-y-0.5 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-100"
                  >
                    Marcar Ausente
                  </button>

                  <button
                    type="button"
                    onClick={handleFinalizeAttention}
                    disabled={actionLoading}
                    className="rounded-2xl bg-emerald-300 px-5 py-4 text-base font-bold text-emerald-950 shadow-md transition hover:-translate-y-0.5 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-100"
                  >
                    Finalizar Atención
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-600">
                  <p className="text-lg font-medium">No hay un ticket en atención.</p>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <button
                    type="button"
                    onClick={handleCallNextTicket}
                    disabled={actionLoading}
                    className="rounded-2xl bg-sky-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-200 disabled:!text-sky-800"
                  >
                    Llamar Siguiente Ticket
                  </button>
                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-2xl bg-amber-100 px-5 py-4 text-base font-semibold text-amber-800"
                  >
                    Marcar Ausente
                  </button>
                  <button
                    type="button"
                    disabled
                    className="cursor-not-allowed rounded-2xl bg-emerald-100 px-5 py-4 text-base font-semibold text-emerald-800"
                  >
                    Finalizar Atención
                  </button>
                </div>
              </div>
            )}

            {message && (
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                {message}
              </div>
            )}
          </section>

          <aside className="rounded-[2rem] border border-indigo-100 bg-indigo-50 p-6 text-slate-800 shadow-[0_20px_60px_rgba(125,160,190,0.16)]">
            <h2 className="mb-5 text-2xl font-bold">Lista de espera</h2>

            <div className="space-y-3">
              {waitingTickets.length === 0 ? (
                <div className="rounded-2xl bg-white p-4 text-slate-500">Sin tickets en espera.</div>
              ) : (
                waitingTickets.map((ticket, index) => (
                  <div
                    key={ticket.id}
                    className="rounded-2xl border border-indigo-100 bg-white p-4 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-bold">{ticket.code}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-300">#{index + 1}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      {ticket.profile} · {ticket.serviceType}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
