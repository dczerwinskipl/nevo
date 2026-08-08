// Tests for task 18 (compound-actions-and-dependency-aware-status, D34/D35,
// area compound-actions-and-dependency-aware-status): `spec-approve.md`'s
// "Approve and start" outcome continues directly into implementation on
// success, closing FU-002. `spec-approve.md` is a prompt/instruction file,
// not executable code — these are template-shape regression tests over its
// actual current wording, the same technique task 13's own
// review-compaction.test.mjs already uses for templates/review-report.md.
// Run: node --test tools/tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function specApproveContent() {
  return readFileSync(join(ROOT, '.claude/commands/nevo-ai/spec-approve.md'), 'utf8').replace(/\r\n/g, '\n');
}

describe('spec-approve.md — "Approve and start" continues into implementation on success (AC1, AC2)', () => {
  const content = specApproveContent();
  const approveAndStartSection = content.slice(
    content.indexOf('## Approve and start'),
    content.indexOf('## Rules'),
  );

  test('the successful start path instructs continuing directly into implementation, in the same turn, with no further ask', () => {
    assert.match(approveAndStartSection, /continue directly into\s+implementation, in this same turn/);
    assert.match(approveAndStartSection, /do\s+not stop, do not ask whether to begin/);
  });

  test('the successful path never instructs ending with "Implement, then ..." — the ending-shape table also drops it for approved-and-started', () => {
    const endingSection = content.slice(content.indexOf('## Ending the response'));
    assert.doesNotMatch(endingSection, /Implement, then \/nevo-ai:task-review/);
  });

  test('the ending-shape table names /nevo-ai:task-review as the next *command* after approved-and-started, not a "go implement" handoff', () => {
    const endingSection = content.slice(content.indexOf('## Ending the response'));
    assert.match(endingSection, /\/nevo-ai:task-review <change-id> <task-id>`[\s\S]{0,80}`approved-and-started`/);
  });
});

describe('spec-approve.md — plain "Approve" (option 1) is unmodified (AC2, regression)', () => {
  const content = specApproveContent();

  test('plain approve\'s own next-command mapping still points at /nevo-ai:task-start, not implementation continuation', () => {
    const endingSection = content.slice(content.indexOf('## Ending the response'));
    assert.match(endingSection, /a plain successful\s+approval \(option 1\); `\/nevo-ai:task-start <change-id> <task-id>`|`\/nevo-ai:task-start <change-id> <task-id>` after a plain successful/);
  });

  test('the four-outcome menu (approve / approve and start / keep as draft / show report) is unchanged', () => {
    assert.match(content, /1\. Approve\s*\n\s*2\. Approve and start implementation\s*\n\s*3\. Keep as draft\s*\n\s*4\. Show me the review report first/);
  });
});

describe('spec-approve.md — every existing D17 stop condition is preserved (AC3)', () => {
  const content = specApproveContent();
  const approveAndStartSection = content.slice(
    content.indexOf('## Approve and start'),
    content.indexOf('## Rules'),
  );

  for (const marker of ['confirm-required', 'unsafe_manual', 'not_retryable', 'partially_completed', 'REC-05', 'REC-09']) {
    test(`still documents the ${marker} branch`, () => {
      assert.match(approveAndStartSection, new RegExp(marker));
    });
  }

  test('a repair confirmation is still documented as asked at most once', () => {
    assert.match(content, /at most once/);
  });
});

describe('spec-approve.md — the general compound-action completion rule is recorded (D34/D35)', () => {
  test('states that an owner-facing compound action completes the operation its own label promises', () => {
    assert.match(specApproveContent(), /compound action completes the operation promised by its own label/);
  });
});
