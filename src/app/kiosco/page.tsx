'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { ClientProfile, ServiceType, Ticket } from '@/types/ticket';
import { TicketPrintView } from '@/components/kiosco/TicketPrintView';

const serviceOptions: { value: ServiceType; label: string }[] = [
  { value: 'CAJA', label: 'Caja' },
  { value: 'SERVICIO_CLIENTE', label: 'Servicio al Cliente' },
];

const profileOptions: { value: ClientProfile; label: string }[] = [
  { value: 'PN', label: 'Persona Natural' },
  { value: 'TE', label: 'Tercera Edad' },
];

function toTicket(row: any): Ticket {
  return {
    id: row.id ?? crypto.randomUUID(),
    code: row.code ?? 'T-001',
    sequence: Number(row.sequence ?? 1),
    profile: row.profile ?? 'PN',
    serviceType: row.service_type ?? row.serviceType ?? 'CAJA',
    status: row.status ?? 'WAITING',
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    stationId: row.station_id ?? row.stationId,
    calledAt: row.called_at ?? row.calledAt,
    startedAt: row.started_at ?? row.startedAt,
    completedAt: row.completed_at ?? row.completedAt,
  };
}

export default function KioscoPage() {
  const [selectedService, setSelectedService] = useState<ServiceType | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ClientProfile | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');

  const completeSelection = !!selectedService && !!selectedProfile;

  async function handleGenerateTicket() {
    if (!selectedService || !selectedProfile) {
      return;
    }

    setIsLoading(true);
    setMessage('');

    try {
      let generatedCode = '';

      const { data: rpcCode, error: rpcError } = await supabase.rpc('generate_ticket_code', {
        p_service_type: selectedService,
        p_profile: selectedProfile,
      });

      if (rpcError) {
        const fallback = `${selectedProfile === 'TE' ? 'TE' : selectedService === 'CAJA' ? 'C' : 'SC'}-${String(
          Math.floor(Math.random() * 900) + 100,
        )}`;
        generatedCode = fallback;
      } else {
        generatedCode = typeof rpcCode === 'string' ? rpcCode : `${selectedProfile}-${Date.now()}`;
      }

      const { data, error } = await supabase
        .from('tickets')
        .insert({
          code: generatedCode,
          profile: selectedProfile,
          service_type: selectedService,
          status: 'WAITING',
          sequence: Date.now() % 100000,
          attempts: 0,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      const createdTicket = toTicket(data);
      setTicket(createdTicket);
      setMessage('Ticket emitido correctamente. Imprimiendo...');

      setTimeout(() => {
        window.print();
      }, 400);
    } catch (error) {
      console.error(error);
      setMessage('No se pudo generar el ticket. Inténtalo nuevamente.');
    } finally {
      setIsLoading(false);
    }
  }

  const resetFlow = () => {
    setSelectedService(null);
    setSelectedProfile(null);
    setTicket(null);
    setMessage('');
  };

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-800">
      <div className="mx-auto max-w-4xl rounded-3xl bg-white p-6 shadow-lg">
        <div className="mb-8 text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Kiosco</p>
          <h1 className="mt-2 text-3xl font-bold">Solicitar turno</h1>
        </div>

        {!ticket && (
          <div className="space-y-8">
            <section>
              <p className="mb-4 text-lg font-semibold">Paso 1: Selecciona el trámite</p>
              <div className="grid gap-4 md:grid-cols-2">
                {serviceOptions.map((option) => {
                  const isActive = selectedService === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedService(option.value)}
                      className={`rounded-2xl border-2 p-6 text-left text-xl font-semibold transition ${
                        isActive
                          ? 'border-blue-600 bg-blue-600 text-white shadow-lg'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <p className="mb-4 text-lg font-semibold">Paso 2: Selecciona tu perfil</p>
              <div className="grid gap-4 md:grid-cols-2">
                {profileOptions.map((option) => {
                  const isActive = selectedProfile === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedProfile(option.value)}
                      className={`rounded-2xl border-2 p-6 text-left text-xl font-semibold transition ${
                        isActive
                          ? 'border-emerald-600 bg-emerald-600 text-white shadow-lg'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="flex flex-col items-center gap-4 pt-4">
              <button
                type="button"
                disabled={!completeSelection || isLoading}
                onClick={handleGenerateTicket}
                className="w-full max-w-md rounded-2xl bg-slate-900 px-6 py-4 text-lg font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoading ? 'Generando ticket...' : 'Solicitar ticket'}
              </button>

              {message && <p className="text-sm text-red-600">{message}</p>}
            </div>
          </div>
        )}

        {ticket && (
          <div className="space-y-6 text-center">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
              <p className="text-sm uppercase tracking-[0.25em] text-emerald-700">Ticket generado</p>
              <h2 className="mt-3 text-5xl font-black text-slate-900">{ticket.code}</h2>
              <p className="mt-3 text-lg text-slate-700">
                {ticket.serviceType === 'CAJA' ? 'Caja' : 'Servicio al Cliente'} ·{' '}
                {ticket.profile === 'TE' ? 'Tercera Edad' : 'Persona Natural'}
              </p>
            </div>

            <button
              type="button"
              onClick={resetFlow}
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium text-slate-700 hover:bg-slate-100"
            >
              Solicitar otro ticket
            </button>
          </div>
        )}
      </div>

      {ticket && <TicketPrintView ticket={ticket} />}
    </main>
  );
}
