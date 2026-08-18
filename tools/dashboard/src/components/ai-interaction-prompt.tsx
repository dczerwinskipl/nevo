import { useState } from 'react';
import { Check, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { AiInteraction, AiPermissionInteraction, AiQuestionInteraction } from '@/lib/types';
import { cn } from '@/lib/utils';

export function PermissionPrompt({
  interaction,
  disabled = false,
  onResolve,
}: {
  interaction: AiPermissionInteraction | Extract<AiInteraction, { kind: 'permission' }>;
  disabled?: boolean;
  onResolve: (response: unknown) => void;
}) {
  return (
    <Card className="border-amber-300/25 bg-amber-300/5 p-4 shadow-sm">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-200" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--foreground)]">
            Wymagana zgoda: <span className="font-mono text-[var(--accent)]">{interaction.toolName}</span>
          </p>
          {interaction.details && (
            <p className="mt-1 text-xs text-[var(--muted)]">{interaction.details}</p>
          )}
          {interaction.input && (
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-[var(--border)] bg-black/30 p-3 font-mono text-[10px] text-[var(--muted-strong)]">
              {JSON.stringify(interaction.input, null, 2)}
            </pre>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => onResolve({ decision: 'allow' })}
            >
              <Check className="mr-1.5 size-3.5" />
              Zezwól
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => onResolve({ decision: 'deny' })}
            >
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
  interaction: AiQuestionInteraction;
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
    <Card className="border-[color-mix(in_srgb,var(--accent)_25%,var(--border))] bg-[var(--surface-raised)] p-4 shadow-sm">
      <p className="text-sm font-semibold text-[var(--foreground)]">Pytania do Ciebie</p>
      <div className="mt-4 space-y-5">
        {interaction.questions.map((question) => (
          <fieldset key={question.id}>
            <legend className="text-xs font-semibold text-[var(--foreground)]">
              {question.header ? `${question.header}: ` : ''}
              {question.question}
            </legend>
            {question.options?.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {question.options.map((option) => {
                  const current = answers[question.id];
                  const checked = Array.isArray(current)
                    ? current.includes(option.label)
                    : current === option.label;

                  return (
                    <label
                      key={option.label}
                      className={cn(
                        'flex cursor-pointer gap-2 rounded-lg border p-3 text-xs transition-colors',
                        checked
                          ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] text-[var(--foreground)]'
                          : 'border-[var(--border)] text-[var(--muted-strong)] hover:border-white/20'
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
                            const values = Array.isArray(prev[question.id])
                              ? (prev[question.id] as string[])
                              : [];
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
                          <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}

                <label
                  className={cn(
                    'rounded-lg border p-3 text-xs sm:col-span-2',
                    customAnswers[question.id]
                      ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]'
                      : 'border-[var(--border)]'
                  )}
                >
                  <span className="font-semibold text-[var(--foreground)]">Inna odpowiedź</span>
                  <input
                    className="mt-2 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--accent)] sm:text-xs"
                    placeholder="Wpisz własną odpowiedź…"
                    value={customAnswers[question.id] || ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCustomAnswers((prev) => ({ ...prev, [question.id]: value }));
                      setAnswers((prev) => ({
                        ...prev,
                        [question.id]: question.multiSelect
                          ? value.trim()
                            ? [value]
                            : []
                          : value,
                      }));
                    }}
                  />
                </label>
              </div>
            ) : (
              <input
                className="mt-2 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base outline-none focus:border-[var(--accent)] sm:text-sm"
                value={typeof answers[question.id] === 'string' ? (answers[question.id] as string) : ''}
                onChange={(event) =>
                  setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
                }
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
