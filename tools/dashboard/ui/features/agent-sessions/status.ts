import type { StatusTone } from '@/shared/status-tone';

export function sessionStatusTone(status?: 'idle' | 'running' | 'waitingForUser' | string | null): StatusTone {
  switch (status) {
    case 'running':
    case 'Aktywna':
      return 'active';
    case 'waitingForUser':
    case 'Oczekuje':
      return 'warning';
    case 'idle':
    case 'Bezczynna':
    default:
      return 'neutral';
  }
}

export function formatSessionStatus(status?: 'idle' | 'running' | 'waitingForUser' | string | null): string {
  switch (status) {
    case 'running':
    case 'Aktywna':
      return 'Aktywna';
    case 'waitingForUser':
    case 'Oczekuje':
      return 'Oczekuje';
    case 'idle':
    case 'Bezczynna':
    default:
      return 'Bezczynna';
  }
}
