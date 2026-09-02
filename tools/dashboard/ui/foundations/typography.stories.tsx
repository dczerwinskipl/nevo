import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

interface TypographySample {
  utility: string;
  nominalSize: string;
  nominalLineHeight: string;
  provisionalToken: string;
  intendedRole: string;
  inCodeReality: string;
}

const SCALE_SAMPLES: TypographySample[] = [
  {
    utility: 'text-4xl font-semibold',
    nominalSize: '36px (2.25rem)',
    nominalLineHeight: '40px (2.5rem)',
    provisionalToken: '— (Aspirational Display)',
    intendedRole: 'Hero / prominent statistic headers',
    inCodeReality: 'Used in dashboard metrics and high-impact headings',
  },
  {
    utility: 'text-3xl font-semibold',
    nominalSize: '30px (1.875rem)',
    nominalLineHeight: '36px (2.25rem)',
    provisionalToken: '— (Aspirational Display)',
    intendedRole: 'Large page or section overview header',
    inCodeReality: 'Used in major section titles',
  },
  {
    utility: 'text-2xl font-bold',
    nominalSize: '24px (1.5rem)',
    nominalLineHeight: '32px (2rem)',
    provisionalToken: 'text-page-title (1.5rem to 1.75rem)',
    intendedRole: 'Page or primary workspace title',
    inCodeReality: 'Used for primary page headers (e.g. SpecificationDetail, Smoke)',
  },
  {
    utility: 'text-xl font-semibold',
    nominalSize: '20px (1.25rem)',
    nominalLineHeight: '28px (1.75rem)',
    provisionalToken: 'text-section-title (1.125rem / 18px)',
    intendedRole: 'Major section header',
    inCodeReality: 'Standardized spec-detail and panel H2 headings',
  },
  {
    utility: 'text-lg font-semibold',
    nominalSize: '18px (1.125rem)',
    nominalLineHeight: '28px (1.75rem)',
    provisionalToken: 'text-section-title (1.125rem)',
    intendedRole: 'Section headers and primary card titles',
    inCodeReality: 'Active in session panel headers and dialog headings',
  },
  {
    utility: 'text-base font-medium',
    nominalSize: '16px (1rem)',
    nominalLineHeight: '24px (1.5rem)',
    provisionalToken: 'text-card-title (0.9375rem to 1rem)',
    intendedRole: 'Object / card title, default root text size',
    inCodeReality: 'Root body size and card title default',
  },
  {
    utility: 'text-sm font-normal',
    nominalSize: '14px (0.875rem)',
    nominalLineHeight: '20px (1.25rem)',
    provisionalToken: 'text-body (0.875rem)',
    intendedRole: 'Normal application text, prose, narrative commentary',
    inCodeReality: 'Primary text scale for chat messages, summaries, and inputs',
  },
  {
    utility: 'text-xs font-medium',
    nominalSize: '12px (0.75rem)',
    nominalLineHeight: '16px (1rem)',
    provisionalToken: 'text-meta (0.75rem) / text-compact (0.8125rem)',
    intendedRole: 'Dense operational rows, timelines, badge labels, metadata',
    inCodeReality: 'Most heavily used utility (134+ occurrences) across all features',
  },
  {
    utility: 'text-[11px] font-normal',
    nominalSize: '11px (0.6875rem)',
    nominalLineHeight: '16px (1rem)',
    provisionalToken: 'text-micro (0.6875rem)',
    intendedRole: 'Exceptional micro metadata only',
    inCodeReality: 'Dense operational tables and timestamp details (33+ occurrences)',
  },
  {
    utility: 'text-[10px] font-semibold',
    nominalSize: '10px (0.625rem)',
    nominalLineHeight: '14px (0.875rem)',
    provisionalToken: '— (Sub-micro, non-standard)',
    intendedRole: 'Ultra-compact badges, pill counters, and status tags',
    inCodeReality: 'Second most common size in dashboard UI (78+ occurrences)',
  },
  {
    utility: 'text-[9px] font-semibold',
    nominalSize: '9px (0.5625rem)',
    nominalLineHeight: '12px (0.75rem)',
    provisionalToken: '— (Sub-micro, non-standard)',
    intendedRole: 'Micro badges and compact status indicators',
    inCodeReality: 'Used in compact badge labels and subtle subtitles',
  },
  {
    utility: 'text-[8px] font-bold',
    nominalSize: '8px (0.5rem)',
    nominalLineHeight: '10px (0.625rem)',
    provisionalToken: '— (Sub-micro, non-standard)',
    intendedRole: 'Micro pill badges and tiny count indicators',
    inCodeReality: 'Used for tiny count bubbles in dense lists',
  },
];

const WEIGHT_SAMPLES = [
  { name: 'font-normal', weight: '400', role: 'Normal body text, commentary, secondary prose' },
  { name: 'font-medium', weight: '500', role: 'Compact emphasis, active navigation, interactive buttons' },
  { name: 'font-semibold', weight: '600', role: 'Card titles, section headings, status badges (most frequent: 111+)' },
  { name: 'font-bold', weight: '700', role: 'Exceptional emphasis, page titles, high-priority counters' },
  { name: 'font-black', weight: '900', role: 'Specialized high-contrast numeric indicators' },
];

function TypographyFoundation() {
  return (
    <div className="space-y-10 p-6 text-[var(--foreground)]">
      {/* 1. Header and Font Stack Documentation */}
      <div>
        <h1 className="text-2xl font-bold">Typography Foundation</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Live typography tokens and Tailwind v4 utility scales in active use across the dashboard.
        </p>
      </div>

      {/* 2. Font Family Reality & Fallback Notice */}
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
        <h2 className="text-lg font-semibold">Font Family & Stack</h2>
        <div className="rounded-md border border-[var(--border-strong)] bg-[var(--background)] p-3 font-mono text-xs">
          <code>Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif</code>
        </div>
        <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-200/90 space-y-1">
          <p className="font-semibold text-amber-300">Implementation Reality & Fallback Risk Notice:</p>
          <p>
            Declared in <code className="text-amber-100">tools/dashboard/ui/index.css:52</code>. There is currently{' '}
            <strong>no bundled @font-face or webfont loader</strong> for &quot;Inter&quot; in the application.
            If &quot;Inter&quot; is not installed locally on the client OS, the browser immediately falls back to the system font stack
            (<code className="text-amber-100">system-ui</code>, Segoe UI, etc.). This story documents reality rather than assuming Inter is always rendered.
          </p>
        </div>
      </section>

      {/* 3. Provisional Scale vs. Production Reality Cross-Reference */}
      <section className="space-y-4">
        <div className="border-b border-[var(--border)] pb-2">
          <h2 className="text-lg font-semibold">Active Type Scale & Provisional Mapping</h2>
          <p className="text-xs text-[var(--muted)]">
            Cross-referenced against <code className="text-[var(--foreground)]">docs/development/ui-ux-guidelines.md §3.1</code>.
            Note: The semantic token names in §3.1 (<code className="text-[var(--foreground)]">text-page-title</code>,{' '}
            <code className="text-[var(--foreground)]">text-body</code>, etc.) are provisional target direction and do{' '}
            <strong>not exist</strong> in CSS/Tailwind today. The codebase uses the Tailwind utilities below.
          </p>
        </div>

        <div className="space-y-4">
          {SCALE_SAMPLES.map((sample) => (
            <div
              key={sample.utility}
              data-sample={sample.utility.split(' ')[0]}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] pb-2">
                <span className="font-mono text-xs font-semibold text-[var(--accent)]">{sample.utility}</span>
                <span className="font-mono text-[11px] text-[var(--muted)]">
                  Nominal: {sample.nominalSize} / {sample.nominalLineHeight}
                </span>
                <span className="font-mono text-[11px] text-[var(--muted-strong)]">
                  Target: {sample.provisionalToken}
                </span>
              </div>
              <div className="py-2">
                <div className={sample.utility}>The quick brown fox jumps over the lazy dog</div>
              </div>
              <div className="flex justify-between text-xs text-[var(--muted)]">
                <span>Role: {sample.intendedRole}</span>
                <span className="text-[var(--muted-strong)]">Usage: {sample.inCodeReality}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Font Weight Scale */}
      <section className="space-y-4">
        <div className="border-b border-[var(--border)] pb-2">
          <h2 className="text-lg font-semibold">Active Font Weights</h2>
          <p className="text-xs text-[var(--muted)]">
            Font weights actually in use across <code className="text-[var(--foreground)]">tools/dashboard/ui/</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WEIGHT_SAMPLES.map((w) => (
            <div
              key={w.name}
              data-weight={w.name}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-[var(--foreground)]">{w.name}</span>
                <span className="font-mono text-xs text-[var(--muted)]">weight: {w.weight}</span>
              </div>
              <div className={`text-base ${w.name}`}>Previewing {w.weight} weight</div>
              <p className="text-xs text-[var(--muted)]">{w.role}</p>
            </div>
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

    // 2. Verify text-2xl sample computes to 24px
    const sample2xl = canvasElement.querySelector('[data-sample="text-2xl"] .text-2xl');
    expect(sample2xl).not.toBeNull();
    const style2xl = window.getComputedStyle(sample2xl!);
    expect(style2xl.fontSize).toBe('24px');
    expect(style2xl.fontWeight).toBe('700');

    // 3. Verify text-sm sample computes to 14px
    const sampleSm = canvasElement.querySelector('[data-sample="text-sm"] .text-sm');
    expect(sampleSm).not.toBeNull();
    const styleSm = window.getComputedStyle(sampleSm!);
    expect(styleSm.fontSize).toBe('14px');

    // 4. Verify text-xs sample computes to 12px
    const sampleXs = canvasElement.querySelector('[data-sample="text-xs"] .text-xs');
    expect(sampleXs).not.toBeNull();
    const styleXs = window.getComputedStyle(sampleXs!);
    expect(styleXs.fontSize).toBe('12px');

    // 5. Verify text-[10px] sample computes to 10px
    const sample10px = canvasElement.querySelector('[data-sample="text-[10px]"] .text-\\[10px\\]');
    expect(sample10px).not.toBeNull();
    const style10px = window.getComputedStyle(sample10px!);
    expect(style10px.fontSize).toBe('10px');

    // 6. Verify font-semibold sample computes to weight 600
    const sampleSemibold = canvasElement.querySelector('[data-weight="font-semibold"] .font-semibold');
    expect(sampleSemibold).not.toBeNull();
    const styleSemibold = window.getComputedStyle(sampleSemibold!);
    expect(styleSemibold.fontWeight).toBe('600');
  },
};
