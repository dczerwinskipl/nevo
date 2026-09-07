import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { AgentSessionDetails } from './agent-session-details';
import type { SessionTaskItem } from './session-tasks';
import type { AgentExecutionMode, AgentSession, TaskNavigationTarget } from './types';

export interface AgentSessionSpecContext {
  title?: string;
  slug?: string;
}

export interface AgentSessionDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spec?: AgentSessionSpecContext | null;
  session?: AgentSession | null;
  tasks: SessionTaskItem[];
  provider: string;
  mode: AgentExecutionMode;
  onOpenTask: (target: TaskNavigationTarget | string) => void;
  onDelete: () => void;
  deleting?: boolean;
  disabled?: boolean;
}

export function AgentSessionDetailsSheet({
  open,
  onOpenChange,
  spec,
  session,
  tasks,
  provider,
  mode,
  onOpenTask,
  onDelete,
  deleting = false,
  disabled = false,
}: AgentSessionDetailsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Szczegóły sesji</SheetTitle>
          <SheetDescription>Kontekst wykonania i powiązania aktywnej sesji AI</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <AgentSessionDetails
            specTitle={spec?.title}
            specId={session?.specId}
            specSlug={spec?.slug}
            tasks={tasks}
            provider={provider}
            mode={mode}
            onOpenTask={(target) => onOpenTask(target)}
            onDelete={onDelete}
            deleting={deleting}
            disabled={disabled}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
