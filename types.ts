
export enum TicketStatus {
  ForBilling = 'ForBilling',
  Reversed = 'Reversed'
}

export interface IHSTicket {
  ticketId: string;
  taskId: string;
  spxtn: string;
  driver: string;
  station: string;
  slaDeadline: string;
  assignee: string;
  pnrValue: number;
  rejectionReason: string;
  createdTime: string;
  status: TicketStatus;
  cep?: string;
}

export interface DriverStats {
  name: string;
  totalTickets: number;
  totalValue: number;
  faturados: number;
  faturadosValue: number;
  revertidos: number;
  revertidosValue: number;
  routes?: string[]; // Nova propriedade para armazenar as rotas
}

export interface RouteStats {
  cep: string;
  locationName: string; // Ex: "São Paulo, SP"
  totalTickets: number;
  faturados: number;
  revertidos: number;
  totalValue: number;
  drivers: Set<string>;
}
