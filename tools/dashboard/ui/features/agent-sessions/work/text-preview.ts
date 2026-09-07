/**
 * Collapses arbitrary Markdown/plain text into a single-line, plain-text preview for
 * Level 2's compact timeline (areas/work-ux-presentation.md § "Row density and
 * grouping"; corrected direction: Commentary/Reasoning must never render full Markdown
 * inline). This is presentation-only whitespace/syntax stripping of text the server
 * already classified as Commentary/Reasoning — it does not inspect or reclassify what
 * the item *is*, only how its own text is compacted for a one-line preview. The full,
 * unmodified text remains available in Work Details (Level 3).
 */
export function previewPlainText(markdown: string, maxLength = 140): string {
  if (!markdown) return '';

  let text = markdown
    // Fenced/inline code: keep the content, drop the syntax noise.
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ''))
    .replace(/`([^`]*)`/g, '$1')
    // Markdown links/images: keep the visible label only.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Heading/list/blockquote leading markers at the start of a line.
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    // Emphasis markers.
    .replace(/(\*\*\*|\*\*|\*|___|__|_)/g, '')
    // Collapse all whitespace (including newlines) into single spaces.
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}
