export type TicketStatus = 'WAITING' | 'CALLING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABSENT';
export type ClientProfile = 'PN' | 'TE';
export type ServiceType = 'CAJA' | 'SERVICIO_CLIENTE';
export type StationType = 'CAJA' | 'CUBICULO';

export interface Ticket {
  id: string;
  code: string;
  sequence: number;
  profile: ClientProfile;
  serviceType: ServiceType;
  status: TicketStatus;
  stationId?: string;
  attempts: number;
  createdAt: string;
  calledAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface Station {
  id: string;
  stationType: StationType;
  label: string;
  active: boolean;
  currentTicketId?: string;
  employeeName?: string;
}
