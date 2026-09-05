import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { useLayoutEffect, useRef, useState } from 'react';

interface UtilityItem {
  utility: string;
  sourceFile: string;
  category: 'font-size' | 'line-height' | 'font-weight';
  provisionalMapping?: string;
}

const FONT_SIZE_UTILITIES: UtilityItem[] = [
  {
    utility: 'text-5xl',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/specification-detail.tsx',
    category: 'font-size',
    provisionalMapping: 'Hero display heading (aspirational)',
  },
  {
    utility: 'text-4xl',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/specification-detail.tsx',
    category: 'font-size',
    provisionalMapping: 'Major display heading (aspirational)',
  },
  {
    utility: 'text-3xl',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/specification-detail.tsx',
    category: 'font-size',
    provisionalMapping: 'Section overview heading',
  },
  {
    utility: 'text-2xl',
    sourceFile: 'tools/dashboard/ui/foundations/smoke.stories.tsx',
    category: 'font-size',
    provisionalMapping: 'text-page-title (target: 1.5rem to 1.75rem)',
  },
  {
    utility: 'text-xl',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx',
    category: 'font-size',
    provisionalMapping: 'text-section-title (target: 1.125rem / 18px)',
  },
  {
    utility: 'text-lg',
    sourceFile: 'tools/dashboard/ui/features/pull-requests/detail/pull-request-detail.tsx',
    category: 'font-size',
    provisionalMapping: 'text-section-title (target: 1.125rem)',
  },
  {
    utility: 'text-base',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx',
    category: 'font-size',
    provisionalMapping: 'text-card-title (target: 0.9375rem to 1rem)',
  },
  {
    utility: 'text-[15px]',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/specification-detail.tsx',
    category: 'font-size',
    provisionalMapping: 'Intermediate card heading',
  },
  {
    utility: 'text-sm',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx',
    category: 'font-size',
    provisionalMapping: 'text-body (target: 0.875rem)',
  },
  {
    utility: 'text-[13px]',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/status-board.tsx',
    category: 'font-size',
    provisionalMapping: 'text-compact (target: 0.8125rem)',
  },
  {
    utility: 'text-xs',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx',
    category: 'font-size',
    provisionalMapping: 'text-meta (target: 0.75rem)',
  },
  {
    utility: 'text-[11px]',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx',
    category: 'font-size',
    provisionalMapping: 'text-micro (target: 0.6875rem)',
  },
  {
    utility: 'text-[10px]',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx',
    category: 'font-size',
    provisionalMapping: 'Sub-micro badges and tags',
  },
  {
    utility: 'text-[9px]',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-list.tsx',
    category: 'font-size',
    provisionalMapping: 'Sub-micro label indicator',
  },
  {
    utility: 'text-[8px]',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx',
    category: 'font-size',
    provisionalMapping: 'Micro counter badge',
  },
];

const LINE_HEIGHT_UTILITIES: UtilityItem[] = [
  {
    utility: 'leading-none',
    sourceFile: 'tools/dashboard/ui/components/ui/dialog.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-tight',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/specification-detail.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-normal',
    sourceFile: 'tools/dashboard/ui/features/operations/operation-progress.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-relaxed',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/transcript/reasoning-view.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-4',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/interactions/interaction-prompt.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-5',
    sourceFile: 'tools/dashboard/ui/features/pull-requests/detail/pull-request-cards.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-6',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/transcript/transcript-message.tsx',
    category: 'line-height',
  },
  {
    utility: 'leading-7',
    sourceFile: 'tools/dashboard/ui/features/specifications/detail/specification-detail.tsx',
    category: 'line-height',
  },
];

const FONT_WEIGHT_UTILITIES: UtilityItem[] = [
  {
    utility: 'font-normal',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx',
    category: 'font-weight',
    provisionalMapping: 'weight-regular (400)',
  },
  {
    utility: 'font-medium',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx',
    category: 'font-weight',
    provisionalMapping: 'weight-medium (500)',
  },
  {
    utility: 'font-semibold',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx',
    category: 'font-weight',
    provisionalMapping: 'weight-semibold (600)',
  },
  {
    utility: 'font-bold',
    sourceFile: 'tools/dashboard/ui/features/agent-sessions/agent-session-details.tsx',
    category: 'font-weight',
    provisionalMapping: 'Exceptional emphasis (700)',
  },
  {
    utility: 'font-black',
    sourceFile: 'tools/dashboard/ui/features/specifications/navigation/specification-sidebar.tsx',
    category: 'font-weight',
    provisionalMapping: 'High-contrast numeric indicator (900)',
  },
];

function TypographyUtilityCard({ item }: { item: UtilityItem }) {
  const probeRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ fontSize: '', lineHeight: '', fontWeight: '' });

  useLayoutEffect(() => {
    if (probeRef.current) {
      const computed = window.getComputedStyle(probeRef.current);
      setMetrics({
        fontSize: computed.fontSize,
        lineHeight: computed.lineHeight,
        fontWeight: computed.fontWeight,
      });
    }
  }, [item.utility]);

  return (
    <div
      data-typography-item={item.utility}
      className="space-y-2.5 rounded-lg border border-border bg-surface p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
        <span className="font-mono text-xs font-semibold text-accent">{item.utility}</span>
        <span className="font-mono text-[11px] text-fg-muted">
          Source: <code className="text-fg-primary">{item.sourceFile.split('/').pop()}</code>
        </span>
      </div>

      <div className="py-2">
        <div ref={probeRef} data-probe="true" className={item.utility}>
          The quick brown fox jumps over the lazy dog
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2 font-mono text-xs text-fg-muted">
        <div className="flex gap-4">
          <span>
            fontSize:{' '}
            <strong data-metric="font-size" className="text-fg-primary">
              {metrics.fontSize || 'measuring…'}
            </strong>
          </span>
          <span>
            lineHeight:{' '}
            <strong data-metric="line-height" className="text-fg-primary">
              {metrics.lineHeight || 'measuring…'}
            </strong>
          </span>
          <span>
            fontWeight:{' '}
            <strong data-metric="font-weight" className="text-fg-primary">
              {metrics.fontWeight || 'measuring…'}
            </strong>
          </span>
        </div>
        {item.provisionalMapping && (
          <span className="font-sans text-[11px] text-fg-secondary">Target: {item.provisionalMapping}</span>
        )}
      </div>
    </div>
  );
}

function TypographyFoundation() {
  return (
    <div className="space-y-10 p-6 text-fg-primary">
      {/* 1. Header and Font Stack Documentation */}
      <div>
        <h1 className="text-2xl font-bold">Typography Foundation</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Inventories of distinct font-size, line-height, and font-weight utilities actively present in{' '}
          <code className="text-fg-primary">tools/dashboard/ui/features</code> and{' '}
          <code className="text-fg-primary">tools/dashboard/ui/components/ui</code>. Metrics shown are read live via{' '}
          <code className="text-fg-primary">getComputedStyle</code>.
        </p>
      </div>

      {/* 2. Font Family Reality & Fallback Notice */}
      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Font Family & Stack</h2>
        <div className="rounded-md border border-border-strong bg-background p-3 font-mono text-xs">
          <code>
            Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif
          </code>
        </div>
        <div className="space-y-1 rounded-md border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-fg-secondary">
          <p className="font-semibold text-status-warning">Implementation Reality & Fallback Risk Notice:</p>
          <p>
            Declared in <code className="text-fg-primary">tools/dashboard/ui/index.css</code>. There is currently{' '}
            <strong>no bundled @font-face or webfont loader</strong> for &quot;Inter&quot; in the application. If
            &quot;Inter&quot; is not installed locally on the client OS, the browser immediately falls back to the
            system font stack (<code className="text-fg-primary">system-ui</code>, Segoe UI, etc.). This story documents
            reality rather than assuming Inter is always rendered.
          </p>
        </div>
      </section>

      {/* 3. Font Size Utilities Inventory */}
      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold">1. Font-Size Utilities</h2>
          <p className="text-xs text-fg-muted">
            Distinct active font-size utilities across the UI, cross-referenced with provisional targets from{' '}
            <code className="text-fg-primary">docs/development/ui-ux-guidelines.md</code>.
          </p>
        </div>

        <div className="space-y-3">
          {FONT_SIZE_UTILITIES.map((item) => (
            <TypographyUtilityCard key={item.utility} item={item} />
          ))}
        </div>
      </section>

      {/* 4. Line Height Utilities Inventory */}
      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold">2. Line-Height Utilities</h2>
          <p className="text-xs text-fg-muted">Explicit line-height utilities in active use across components.</p>
        </div>

        <div className="space-y-3">
          {LINE_HEIGHT_UTILITIES.map((item) => (
            <TypographyUtilityCard key={item.utility} item={item} />
          ))}
        </div>
      </section>

      {/* 5. Font Weight Utilities Inventory */}
      <section className="space-y-4">
        <div className="border-b border-border pb-2">
          <h2 className="text-lg font-semibold">3. Font-Weight Utilities</h2>
          <p className="text-xs text-fg-muted">Font weights actually in use, mapped to nominal numeric weights.</p>
        </div>

        <div className="space-y-3">
          {FONT_WEIGHT_UTILITIES.map((item) => (
            <TypographyUtilityCard key={item.utility} item={item} />
          ))}
        </div>
      </section>
    </div>
  );
}

const meta: Meta<typeof TypographyFoundation> = {
  title: 'Foundations/Typography',
  component: TypographyFoundation,
};

export default meta;
type Story = StoryObj<typeof TypographyFoundation>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    // 1. Verify body font family contains Inter and system fallback
    const bodyStyle = window.getComputedStyle(document.body);
    expect(bodyStyle.fontFamily).toContain('Inter');
    expect(bodyStyle.fontFamily).toContain('system-ui');

    // 2. Verify all typography utility cards render with live computed metrics
    const cards = canvasElement.querySelectorAll<HTMLElement>('[data-typography-item]');
    expect(cards.length).toBe(FONT_SIZE_UTILITIES.length + LINE_HEIGHT_UTILITIES.length + FONT_WEIGHT_UTILITIES.length);

    for (const card of cards) {
      const probe = card.querySelector<HTMLElement>('[data-probe="true"]');
      expect(probe).not.toBeNull();

      const computed = window.getComputedStyle(probe!);

      const displayedFontSize = card.querySelector('[data-metric="font-size"]')?.textContent?.trim();
      expect(displayedFontSize).toBe(computed.fontSize);
      expect(computed.fontSize).toBeTruthy();

      const displayedLineHeight = card.querySelector('[data-metric="line-height"]')?.textContent?.trim();
      expect(displayedLineHeight).toBe(computed.lineHeight);
      expect(computed.lineHeight).toBeTruthy();

      const displayedFontWeight = card.querySelector('[data-metric="font-weight"]')?.textContent?.trim();
      expect(displayedFontWeight).toBe(computed.fontWeight);
      expect(computed.fontWeight).toBeTruthy();
    }
  },
};
