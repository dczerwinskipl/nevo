import { Eye, FileEdit, FilePlus, ListTree, Search, Terminal, FlaskConical, Globe, Wrench } from 'lucide-react';
import type { ComponentType } from 'react';
import type { ToolKindV2 } from '../types.ts';

/**
 * Small, secondary type icon per tool kind (areas/work-ux-presentation.md § "Icon
 * vocabulary"). Never used for Commentary/Reasoning — those stay text-first everywhere.
 */
export const TOOL_KIND_ICONS_V2: Record<ToolKindV2, ComponentType<{ className?: string }>> = {
  read: Eye,
  edit: FileEdit,
  write: FilePlus,
  list: ListTree,
  search: Search,
  command: Terminal,
  test: FlaskConical,
  web: Globe,
  other: Wrench,
};
