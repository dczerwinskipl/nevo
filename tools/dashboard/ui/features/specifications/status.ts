import type { StatusTone } from '@/shared/status-tone';
import { formatStatus } from '../../lib/utils.ts';

export function specStatusTone(status?: string | null): StatusTone {
  switch (status) {
    case 'approved':
    case 'verified':
    case 'archived':
    case 'completed':
      return 'success';
    case 'implemented':
    case 'review':
    case 'warning':
      return 'warning';
    case 'in-implementation':
    case 'running':
      return 'active';
    case 'failed':
    case 'error':
      return 'error';
    case 'draft':
    default:
      return 'neutral';
  }
}

export function taskStatusTone(status?: string | null): StatusTone {
  return specStatusTone(status);
}

export function formatSpecificationStatus(status?: string | null): string {
  if (!status) return '';
  return formatStatus(status);
}

export function formatTaskStatus(status?: string | null): string {
  if (!status) return '';
  return formatStatus(status);
}
