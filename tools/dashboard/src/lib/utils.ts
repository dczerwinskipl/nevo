import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return 'Brak daty';
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatStatus(status: string) {
  const labels: Record<string, string> = {
    draft: 'Draft',
    approved: 'Approved',
    'in-implementation': 'W implementacji',
    implemented: 'Review',
    verified: 'Gotowe',
    archived: 'Archiwum',
    abandoned: 'Porzucone',
  };
  return labels[status] ?? status;
}

export function pluralizeTasks(count: number) {
  if (count === 1) return 'zadanie';
  const lastTwo = count % 100;
  const last = count % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'zadania';
  return 'zadań';
}
