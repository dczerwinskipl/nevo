import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

interface ColorToken {
  name: string;
  value: string;
  sourceLine: number;
  description: string;
}

interface ColorGroup {
  title: string;
  sourceRange: string;
  description: string;
  tokens: ColorToken[];
}

const COLOR_GROUPS: ColorGroup[] = [
  {
    title: 'Neutral Foundation',
    sourceRange: 'tools/dashboard/ui/index.css:6-14',
    description:
      'Neutral foundation tokens. These values must never be derived from --accent. Dashboard is dark-only (color-scheme: dark, no light theme toggle).',
    tokens: [
      { name: '--background', value: '#090a0d', sourceLine: 6, description: 'Default canvas background' },
      { name: '--surface', value: '#0f1116', sourceLine: 7, description: 'Base component surface' },
      { name: '--surface-raised', value: '#14171d', sourceLine: 8, description: 'Raised cards and modal panels' },
      { name: '--surface-hover', value: '#191d24', sourceLine: 9, description: 'Hover state for interactive surfaces' },
      { name: '--border', value: '#252a33', sourceLine: 10, description: 'Standard subtle border' },
      { name: '--border-strong', value: '#343b47', sourceLine: 11, description: 'Prominent structural border' },
      { name: '--foreground', value: '#f1f3f5', sourceLine: 12, description: 'Primary high-contrast text' },
      { name: '--muted', value: '#929baa', sourceLine: 13, description: 'Secondary subdued text' },
      { name: '--muted-strong', value: '#c7cdd6', sourceLine: 14, description: 'Readable prose and commentary' },
    ],
  },
  {
    title: 'Interaction & Active State',
    sourceRange: 'tools/dashboard/ui/index.css:17-21',
    description: 'Accent and interactive focus tokens.',
    tokens: [
      { name: '--accent', value: '#3882f6', sourceLine: 17, description: 'Primary brand and action color' },
      { name: '--accent-strong', value: '#1d4ed8', sourceLine: 18, description: 'Active and pressed states' },
      { name: '--accent-foreground', value: '#f8fafc', sourceLine: 19, description: 'High-contrast text on accent' },
      { name: '--accent-muted', value: 'color-mix(in srgb, var(--accent) 10%, transparent)', sourceLine: 20, description: 'Subtle accent wash' },
      { name: '--accent-border', value: 'color-mix(in srgb, var(--accent) 35%, var(--border))', sourceLine: 21, description: 'Accent border highlight' },
    ],
  },
  {
    title: 'Semantic State',
    sourceRange: 'tools/dashboard/ui/index.css:24-39',
    description: 'Status feedback colors: success, warning, danger, info.',
    tokens: [
      { name: '--success', value: '#35c76f', sourceLine: 24, description: 'Completed and verified state' },
      { name: '--success-strong', value: '#7bdc99', sourceLine: 25, description: 'Prominent success accent' },
      { name: '--success-muted', value: 'color-mix(in srgb, var(--success) 10%, transparent)', sourceLine: 26, description: 'Subtle success background' },
      { name: '--success-border', value: 'color-mix(in srgb, var(--success) 28%, var(--border))', sourceLine: 27, description: 'Success border' },

      { name: '--warning', value: '#f59e0b', sourceLine: 28, description: 'In-review or attention-required state' },
      { name: '--warning-strong', value: '#fcd34d', sourceLine: 29, description: 'Prominent warning text' },
      { name: '--warning-muted', value: 'color-mix(in srgb, var(--warning) 10%, transparent)', sourceLine: 30, description: 'Subtle warning background' },
      { name: '--warning-border', value: 'color-mix(in srgb, var(--warning) 28%, var(--border))', sourceLine: 31, description: 'Warning border' },

      { name: '--danger', value: '#ef4444', sourceLine: 32, description: 'Error and failure state' },
      { name: '--danger-strong', value: '#fca5a5', sourceLine: 33, description: 'Prominent danger text' },
      { name: '--danger-muted', value: 'color-mix(in srgb, var(--danger) 10%, transparent)', sourceLine: 34, description: 'Subtle danger background' },
      { name: '--danger-border', value: 'color-mix(in srgb, var(--danger) 28%, var(--border))', sourceLine: 35, description: 'Danger border' },

      { name: '--info', value: '#06b6d4', sourceLine: 36, description: 'Informational and ready state' },
      { name: '--info-strong', value: '#67e8f9', sourceLine: 37, description: 'Prominent info text' },
      { name: '--info-muted', value: 'color-mix(in srgb, var(--info) 10%, transparent)', sourceLine: 38, description: 'Subtle info background' },
      { name: '--info-border', value: 'color-mix(in srgb, var(--info) 28%, var(--border))', sourceLine: 39, description: 'Info border' },
    ],
  },
  {
    title: 'Lane Presentation',
    sourceRange: 'tools/dashboard/ui/index.css:42-48',
    description: 'Workflow lane badges and status indicators.',
    tokens: [
      { name: '--lane-new', value: 'var(--muted)', sourceLine: 42, description: 'New change lane' },
      { name: '--lane-design', value: '#8b5cf6', sourceLine: 43, description: 'Design lane' },
      { name: '--lane-ready', value: 'var(--info)', sourceLine: 44, description: 'Ready for implementation lane' },
      { name: '--lane-implementation', value: 'var(--accent)', sourceLine: 45, description: 'In-implementation lane' },
      { name: '--lane-review', value: 'var(--warning)', sourceLine: 46, description: 'In-review lane' },
      { name: '--lane-done', value: 'var(--success)', sourceLine: 47, description: 'Done / verified lane' },
      { name: '--lane-danger', value: 'var(--danger)', sourceLine: 48, description: 'Blocked / danger lane' },
    ],
  },
  {
    title: 'Categories',
    sourceRange: 'tools/dashboard/ui/index.css:50-51',
    description: 'Category accent tokens.',
    tokens: [
      { name: '--cat-1', value: '#fb923c', sourceLine: 50, description: 'Category 1 accent' },
      { name: '--cat-2', value: '#60a5fa', sourceLine: 51, description: 'Category 2 accent' },
    ],
  },
];

function ColorPaletteFoundation() {
  return (
    <div className="space-y-8 p-6 text-[var(--foreground)]">
      <div>
        <h1 className="text-2xl font-bold">Color Foundation Tokens</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Live tokens declared in <code className="text-[var(--foreground)]">tools/dashboard/ui/index.css:6-51</code>.
          The dashboard is exclusively dark-mode (<code className="text-[var(--foreground)]">color-scheme: dark</code>). No alternate light theme exists.
        </p>
      </div>

      {COLOR_GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <div className="border-b border-[var(--border)] pb-2">
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="text-xs text-[var(--muted)]">
              {group.description} ({group.sourceRange})
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {group.tokens.map((token) => (
              <div
                key={token.name}
                data-token={token.name}
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs shadow-xs"
              >
                <div className="mb-2.5 flex items-center gap-2">
                  <div
                    className="size-8 shrink-0 rounded-md border border-[var(--border-strong)]"
                    style={{ backgroundColor: `var(${token.name})` }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono font-medium text-[var(--foreground)]">
                      {token.name}
                    </div>
                    <div className="truncate font-mono text-[10px] text-[var(--muted)]">
                      {token.value}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-[var(--muted-strong)]">{token.description}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta: Meta<typeof ColorPaletteFoundation> = {
  title: 'Foundations/Colors',
  component: ColorPaletteFoundation,
};

export default meta;
type Story = StoryObj<typeof ColorPaletteFoundation>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const rootStyle = window.getComputedStyle(document.documentElement);

    // Verify all key semantic color tokens resolve to non-empty values
    expect(rootStyle.getPropertyValue('--background').trim()).toBe('#090a0d');
    expect(rootStyle.getPropertyValue('--foreground').trim()).toBe('#f1f3f5');
    expect(rootStyle.getPropertyValue('--accent').trim()).toBe('#3882f6');
    expect(rootStyle.getPropertyValue('--success').trim()).toBe('#35c76f');
    expect(rootStyle.getPropertyValue('--warning').trim()).toBe('#f59e0b');
    expect(rootStyle.getPropertyValue('--danger').trim()).toBe('#ef4444');
    expect(rootStyle.getPropertyValue('--info').trim()).toBe('#06b6d4');
    expect(rootStyle.getPropertyValue('--cat-1').trim()).toBe('#fb923c');
    expect(rootStyle.getPropertyValue('--cat-2').trim()).toBe('#60a5fa');

    // Verify every rendered swatch card exists
    const swatches = canvasElement.querySelectorAll('[data-token]');
    expect(swatches.length).toBe(39); // 9 neutral + 5 interaction + 16 semantic + 7 lane + 2 cat
  },
};
