import type { AgentExecutionMode } from './types';

export interface ModeMeta {
  id: AgentExecutionMode;
  label: string;
  description: string;
}

export const AI_MODES: readonly ModeMeta[] = [
  {
    id: 'ask',
    label: 'Ask (Plan)',
    description: 'Tylko odczyt i analiza bez modyfikacji plików',
  },
  {
    id: 'edit',
    label: 'Edit (Domyślny)',
    description: 'Bezpieczna edycja kodu w workspace',
  },
  {
    id: 'agent',
    label: 'Agent (Auto)',
    description: 'Pełna autonomia z pominięciem pytań o uprawnienia',
  },
] as const;

export const AI_MODE_MAP: Record<AgentExecutionMode, ModeMeta> = {
  ask: AI_MODES[0],
  edit: AI_MODES[1],
  agent: AI_MODES[2],
};

export function getModeMeta(mode: AgentExecutionMode): ModeMeta {
  return AI_MODE_MAP[mode] ?? AI_MODE_MAP.edit;
}
