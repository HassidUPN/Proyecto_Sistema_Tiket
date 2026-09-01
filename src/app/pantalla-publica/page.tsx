'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Station, Ticket } from '@/types/ticket';

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

function toStation(row: any): Station {
  return {
    id: row.id,
    stationType: row.station_type ?? row.stationType,
    label: row.label,
    active: Boolean(row.active),
    currentTicketId: row.current_ticket_id ?? row.currentTicketId,
    employeeName: row.employee_name ?? row.employeeName,
  };
}

export default function PantallaPublicaPage() {
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  const [station, setStation] = useState<Station | null>(null);
  const [recentCalls, setRecentCalls] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const stationLabel = useMemo(() => {
    if (!station) return 'Sin estación';
    return station.stationType === 'CAJA' ? `Caja ${station.label}` : `Cubículo ${station.label}`;
  }, [station]);

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

  const fetchCurrentCalledTicket = async () => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('status', 'CALLING')
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching current called ticket:', error);
      return;
    }

    if (!data) {
      setCurrentTicket(null);
      setStation(null);
      return;
    }

    const ticket = toTicket(data);
    setCurrentTicket(ticket);

    const { data: stationData, error: stationError } = await supabase
      .from('stations')
      .select('*')
      .eq('id', ticket.stationId)
      .single();

    if (!stationError && stationData) {
      setStation(toStation(stationData));
    }
  };

  const fetchRecentCalls = async () => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .in('status', ['CALLING', 'IN_PROGRESS', 'COMPLETED', 'ABSENT'])
      .not('called_at', 'is', null)
      .order('called_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching recent calls:', error);
      return;
    }

    setRecentCalls((data ?? []).map(toTicket).slice(0, 5));
  };

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true);
      await fetchCurrentCalledTicket();
      await fetchRecentCalls();
      setLoading(false);
    };

    bootstrap();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('pantalla-publica-ticket-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tickets',
        },
        async (payload) => {
          const nextTicket = payload.new as any;

          if (nextTicket.status === 'CALLING') {
            const ticket = toTicket(nextTicket);
            setCurrentTicket(ticket);

            const { data: stationData } = await supabase
              .from('stations')
              .select('*')
              .eq('id', ticket.stationId)
              .single();

            if (stationData) {
              setStation(toStation(stationData));
            }

            setRecentCalls((prev) => {
              const next = [ticket, ...prev.filter((item) => item.id !== ticket.id)];
              return next.slice(0, 5);
            });

            playNotification();
          }

          const previousTicket = payload.old as any;

          if (previousTicket && previousTicket.status === 'CALLING' && nextTicket.status !== 'CALLING') {
            setRecentCalls((prev) => [
              ...prev.filter((item) => item.id !== nextTicket.id),
            ]);
          }

          await fetchRecentCalls();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 text-white">
        <p className="text-2xl font-semibold">Cargando pantalla pública...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-900 p-8 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="rounded-3xl border border-slate-700 bg-slate-800 p-6 text-center shadow-2xl">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-300">Sala de espera</p>
          <h1 className="mt-4 text-4xl font-black">Banco</h1>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-3xl border border-sky-500 bg-slate-800 p-10 text-center shadow-2xl">
            <p className="text-sm uppercase tracking-[0.25em] text-sky-300">Ahora atendiendo</p>

            {currentTicket ? (
              <>
                <div className="mt-8 text-7xl font-black tracking-widest text-white">
                  {currentTicket.code}
                </div>
                <div className="mt-8 text-3xl font-semibold text-sky-200">{stationLabel}</div>
              </>
            ) : (
              <>
                <div className="mt-8 text-6xl font-black tracking-widest text-slate-400">--</div>
                <div className="mt-8 text-3xl font-semibold text-slate-400">Esperando llamado</div>
              </>
            )}
          </div>

          <aside className="rounded-3xl border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <h2 className="text-xl font-bold uppercase tracking-[0.2em] text-slate-300">Últimos 5 llamados</h2>

            <div className="mt-6 space-y-3">
              {recentCalls.length === 0 ? (
                <div className="rounded-2xl bg-slate-700 p-4 text-slate-300">Sin llamados recientes.</div>
              ) : (
                recentCalls.map((ticket, index) => (
                  <div key={ticket.id ?? `${ticket.code}-${index}`} className="rounded-2xl bg-slate-700 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-2xl font-bold text-white">{ticket.code}</span>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-300">#{index + 1}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-300">
                      {ticket.stationId ? `Estación: ${ticket.stationId}` : 'Estación: sin asignación'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
