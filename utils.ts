
import { TicketStatus } from './types';

export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

export const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dateString;
  }
};

export const translateStatus = (status: TicketStatus | string): string => {
  if (status === TicketStatus.ForBilling) return 'Faturado';
  if (status === TicketStatus.Reversed) return 'Revertido';
  return status;
};

export const debounce = <F extends (...args: any[]) => void>(func: F, wait: number) => {
  let timeout: number | undefined;
  return (...args: Parameters<F>) => {
    clearTimeout(timeout);
    timeout = window.setTimeout(() => func(...args), wait);
  };
};
