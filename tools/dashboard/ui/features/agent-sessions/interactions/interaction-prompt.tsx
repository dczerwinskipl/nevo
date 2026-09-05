import { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { AgentInteraction, AgentPermissionInteraction, AgentQuestionInteraction } from '../types';
import { cn } from '@/lib/utils';

export function PermissionPrompt({
  interaction,
  disabled = false,
  onResolve,
}: {
  interaction: AgentPermissionInteraction | Extract<AgentInteraction, { kind: 'permission' }>;
  disabled?: boolean;
  onResolve: (response: unknown) => void;
}) {
  return (
    <Card className="border-status-warning/25 bg-status-warning/10 p-4 shadow-sm">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-status-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg-primary">
            Wymagana zgoda: <span className="font-mono text-accent">{interaction.toolName}</span>
          </p>
          {interaction.details && <p className="mt-1 text-xs text-fg-muted">{interaction.details}</p>}
          {interaction.input && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[10px] text-fg-secondary">
              {JSON.stringify(interaction.input, null, 2)}
            </pre>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={disabled} onClick={() => onResolve({ decision: 'allow' })}>
              <Check className="mr-1.5 size-3.5" />
              Zezwól
            </Button>
            <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onResolve({ decision: 'deny' })}>
              <X className="mr-1.5 size-3.5" />
              Odmów
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function QuestionPrompt({
  interaction,
  disabled = false,
  onResolve,
}: {
  interaction: AgentQuestionInteraction;
  disabled?: boolean;
  onResolve: (response: unknown) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});

  const ready = interaction.questions.every((question) => {
    const value = answers[question.id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
  });

  return (
    <Card className="border-accent/25 bg-surface-raised p-4 shadow-sm">
      <p className="text-sm font-semibold text-fg-primary">Pytania do Ciebie</p>
      <div className="mt-4 space-y-5">
        {interaction.questions.map((question) => (
          <fieldset key={question.id}>
            <legend className="text-xs font-semibold text-fg-primary">
              {question.header ? `${question.header}: ` : ''}
              {question.question}
            </legend>
            {question.options?.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {question.options.map((option) => {
                  const current = answers[question.id];
                  const checked = Array.isArray(current) ? current.includes(option.label) : current === option.label;

                  return (
                    <label
                      key={option.label}
                      className={cn(
                        'flex cursor-pointer gap-2 rounded-lg border p-3 text-xs transition-colors',
                        checked
                          ? 'border-accent bg-accent/8 text-fg-primary'
                          : 'border-border text-fg-secondary hover:border-border-strong',
                      )}
                    >
                      <input
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        name={question.id}
                        checked={checked}
                        onChange={() => {
                          setCustomAnswers((prev) => ({ ...prev, [question.id]: '' }));
                          setAnswers((prev) => {
                            if (!question.multiSelect) return { ...prev, [question.id]: option.label };
                            const values = Array.isArray(prev[question.id]) ? (prev[question.id] as string[]) : [];
                            return {
                              ...prev,
                              [question.id]: checked
                                ? values.filter((v) => v !== option.label)
                                : [...values, option.label],
                            };
                          });
                        }}
                      />
                      <span>
                        <span className="font-semibold">{option.label}</span>
                        {option.description && (
                          <span className="mt-1 block text-[10px] leading-4 text-fg-muted">{option.description}</span>
                        )}
                      </span>
                    </label>
                  );
                })}

                <label
                  className={cn(
                    'rounded-lg border p-3 text-xs sm:col-span-2',
                    customAnswers[question.id] ? 'border-accent bg-accent/8' : 'border-border',
                  )}
                >
                  <span className="font-semibold text-fg-primary">Inna odpowiedź</span>
                  <input
                    className="mt-2 h-9 w-full rounded-lg border border-border bg-surface px-3 text-base outline-none focus:border-accent sm:text-xs"
                    placeholder="Wpisz własną odpowiedź…"
                    value={customAnswers[question.id] || ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCustomAnswers((prev) => ({ ...prev, [question.id]: value }));
                      setAnswers((prev) => ({
                        ...prev,
                        [question.id]: question.multiSelect ? (value.trim() ? [value] : []) : value,
                      }));
                    }}
                  />
                </label>
              </div>
            ) : (
              <input
                className="mt-2 h-10 w-full rounded-lg border border-border bg-surface px-3 text-base outline-none focus:border-accent sm:text-sm"
                value={typeof answers[question.id] === 'string' ? (answers[question.id] as string) : ''}
                onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
              />
            )}
          </fieldset>
        ))}
      </div>
      <Button
        className="mt-5"
        size="sm"
        disabled={disabled || !ready}
        onClick={() =>
          onResolve({
            answers: interaction.questions.map((question) => ({
              questionId: question.id,
              value: answers[question.id],
            })),
          })
        }
      >
        Wyślij odpowiedzi
      </Button>
    </Card>
  );
}
