import type { Ticket } from '@/types/ticket';

export function TicketPrintView({ ticket }: { ticket: Ticket }) {
  const serviceLabel = ticket.serviceType === 'CAJA' ? 'Caja' : 'Servicio al Cliente';
  const profileLabel = ticket.profile === 'TE' ? 'Tercera Edad' : 'Persona Natural';
  const createdAt = new Date(ticket.createdAt).toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  return (
    <div id="ticket-print-area">
      <div className="ticket-header">BANCO</div>
      <div className="ticket-divider" />
      <div className="ticket-code">{ticket.code}</div>
      <div className="ticket-row">Trámite: {serviceLabel}</div>
      <div className="ticket-row">Perfil: {profileLabel}</div>
      <div className="ticket-row">Fecha: {createdAt}</div>
      <div className="ticket-divider" />
      <div className="ticket-row">Espere a ser llamado</div>
      <div className="ticket-print-spacer" />
    </div>
  );
}
