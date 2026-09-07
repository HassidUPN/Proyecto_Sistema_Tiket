import type { Ticket } from '@/types/ticket';

// ESC/POS "print and feed n lines" — impresoras matriciales con driver de texto (Generic/Text Only)
// pasan estos bytes de control directo a la impresora, forzando un avance físico de papel
// que el CSS/driver no puede recortar.
const ESC_FEED_5_LINES = '\x1B\x64\x05';

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
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="ticket-row ticket-print-spacer-line">
          {'\u00A0'}
        </div>
      ))}
      <div className="ticket-row" aria-hidden="true">{ESC_FEED_5_LINES}</div>
    </div>
  );
}
