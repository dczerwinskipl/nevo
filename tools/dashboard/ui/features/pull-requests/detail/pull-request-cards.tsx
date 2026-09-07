import { AlertTriangle, ChevronRight, Files, GitBranch, GitPullRequest, UserRound } from 'lucide-react';

import type { AvailablePullRequest, UnavailablePullRequest } from '../types';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';
import { stateLabel, stateTone } from '../changes/status';

export function PullRequestSummaryCard({
  pullRequest,
  onOpen,
}: {
  pullRequest: AvailablePullRequest;
  onOpen: () => void;
}) {
  return (
    <Card className="overflow-hidden transition-colors hover:border-accent/35">
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left sm:items-center sm:p-5"
        onClick={onOpen}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-fg-muted">
          <GitPullRequest className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={stateTone(pullRequest)}>{stateLabel(pullRequest)}</Badge>
            <span className="text-[11px] text-fg-muted">
              {pullRequest.providerLabel} #{pullRequest.number}
            </span>
          </div>
          <h3 className="mt-2 text-sm leading-5 font-semibold text-fg-primary sm:text-base">{pullRequest.title}</h3>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-fg-muted">
            {pullRequest.author && (
              <span className="inline-flex items-center gap-1.5">
                <UserRound className="size-3.5" />
                {pullRequest.author.login}
              </span>
            )}
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <GitBranch className="size-3.5 shrink-0" />
              <span className="max-w-40 truncate font-mono">
                {pullRequest.head.name || pullRequest.head.label || 'head'}
              </span>
              <span>→</span>
              <span className="max-w-40 truncate font-mono">
                {pullRequest.base.name || pullRequest.base.label || 'base'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Files className="size-3.5" />
              {pullRequest.stats.changedFiles} plików
            </span>
            <span className="font-semibold text-diff-addition">+{pullRequest.stats.additions}</span>
            <span className="font-semibold text-diff-deletion">−{pullRequest.stats.deletions}</span>
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-accent sm:mt-0" />
      </button>
    </Card>
  );
}

export function UnavailableCard({ result }: { result: UnavailablePullRequest }) {
  return (
    <Card className="border-status-warning/15 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-status-warning/15 bg-status-warning/6 text-status-warning">
          <AlertTriangle className="size-4" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{result.reference.provider}</Badge>
            <span className="text-[11px] text-fg-muted">
              {result.reference.repository} #{result.reference.number}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-fg-muted">{result.message}</p>
        </div>
      </div>
    </Card>
  );
}
