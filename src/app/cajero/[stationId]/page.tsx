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

  const fetchStation = async () => {
    const { data, error } = await supabase
      .from('stations')
      .select('*')
      .eq('id', stationId)
      .single();

    if (error) {
      console.error('Error fetching station:', error);
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

  const fetchCurrentTicket = async (resolvedServiceType: ServiceType) => {
    const { data: activeTickets, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('station_id', stationId)
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
      await fetchCurrentTicket(resolvedServiceType);
      await fetchWaitingTickets(resolvedServiceType);
      setLoading(false);
    };

    bootstrap();
  }, [stationId]);

  useEffect(() => {
    if (!stationId || !serviceType) return;

    const channel = supabase
      .channel(`tickets-${stationId}`)
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

          if (nextStationId === stationId && ['CALLING', 'IN_PROGRESS'].includes(updatedTicket.status)) {
            setCurrentTicket(toTicket(updatedTicket));
          }

          if (nextStationId !== stationId && previousStationId === stationId) {
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
            await fetchCurrentTicket(serviceType);
          };
          nextCurrent();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stationId, serviceType]);

  const handleCallNextTicket = async () => {
    if (!stationId || !serviceType) return;
    setActionLoading(true);
    setMessage('');

    const { data, error } = await supabase.rpc('call_next_ticket', {
      p_service_type: serviceType,
      p_station_id: stationId,
    });

    if (error) {
      console.error('Error calling next ticket:', error);
      setMessage('No hay tickets disponibles para este trámite.');
      setActionLoading(false);
      return;
    }

    setCurrentTicket(data ? toTicket(data) : null);
    await fetchWaitingTickets(serviceType);
    if (data) {
      setMessage(`Ticket ${data.code} llamado correctamente.`);
    } else {
      setMessage('No hay tickets en espera para este trámite.');
    }
    setActionLoading(false);
  };

  const handleMarkAbsent = async () => {
    if (!currentTicket) {
      setMessage('No hay un ticket en atención para marcar ausente.');
      return;
    }

    setActionLoading(true);
    const { error } = await supabase
      .from('tickets')
      .update({
        status: 'ABSENT',
        station_id: null,
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

    await supabase.from('stations').update({ current_ticket_id: null }).eq('id', stationId);
    setCurrentTicket(null);
    setMessage('Ticket marcado como ausente.');
    setActionLoading(false);
    await fetchWaitingTickets(serviceType as ServiceType);
  };

  const handleFinalizeAttention = async () => {
    if (!currentTicket) {
      setMessage('No hay un ticket en atención para finalizar.');
      return;
    }

    setActionLoading(true);
    const { error } = await supabase
      .from('tickets')
      .update({
        status: 'COMPLETED',
        station_id: null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', currentTicket.id);

    if (error) {
      console.error('Error finalizing ticket:', error);
      setMessage('No se pudo finalizar la atención.');
      setActionLoading(false);
      return;
    }

    await supabase.from('stations').update({ current_ticket_id: null }).eq('id', stationId);
    setCurrentTicket(null);
    setMessage('Atención finalizada correctamente.');
    setActionLoading(false);
    await fetchWaitingTickets(serviceType as ServiceType);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-3xl bg-white p-8 text-center shadow-lg">
          <p className="text-lg font-medium text-slate-600">Cargando estación...</p>
        </div>
      </main>
    );
  }

  if (!station) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-3xl bg-white p-8 text-center shadow-lg">
          <p className="text-lg font-medium text-red-600">No se encontró la estación solicitada.</p>
        </div>
      </main>
    );
  }

  const currentStatus: TicketStatus | 'SIN_TICKET' = currentTicket ? currentTicket.status : 'SIN_TICKET';

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-800">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Módulo de Cajero</p>
              <h1 className="mt-2 text-3xl font-bold">Estación {station.label}</h1>
            </div>
            <div className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              {station.stationType === 'CAJA' ? 'Caja' : 'Cubículo'}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <section className="rounded-3xl bg-white p-6 shadow-lg">
            <h2 className="mb-5 text-2xl font-bold">Atención actual</h2>

            {currentTicket ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
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
                    className="rounded-2xl bg-blue-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    Llamar Siguiente Ticket
                  </button>

                  <button
                    type="button"
                    onClick={handleMarkAbsent}
                    disabled={actionLoading || currentTicket.status !== 'CALLING'}
                    className="rounded-2xl bg-amber-500 px-5 py-4 text-base font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-amber-200"
                  >
                    Marcar Ausente
                  </button>

                  <button
                    type="button"
                    onClick={handleFinalizeAttention}
                    disabled={actionLoading}
                    className="rounded-2xl bg-emerald-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
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
                    className="rounded-2xl bg-blue-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    Llamar Siguiente Ticket
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-2xl bg-amber-200 px-5 py-4 text-base font-semibold text-white cursor-not-allowed"
                  >
                    Marcar Ausente
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-2xl bg-emerald-200 px-5 py-4 text-base font-semibold text-white cursor-not-allowed"
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

          <aside className="rounded-3xl bg-slate-900 p-6 text-white shadow-lg">
            <h2 className="mb-5 text-2xl font-bold">Lista de espera</h2>

            <div className="space-y-3">
              {waitingTickets.length === 0 ? (
                <div className="rounded-2xl bg-slate-800 p-4 text-slate-300">Sin tickets en espera.</div>
              ) : (
                waitingTickets.map((ticket, index) => (
                  <div
                    key={ticket.id}
                    className="rounded-2xl bg-slate-800 p-4 text-left"
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
