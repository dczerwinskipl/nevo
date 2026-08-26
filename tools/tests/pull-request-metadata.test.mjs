import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildProgram } from '../specs.mjs';
import { handlePullRequestAdd } from '../specs/query.mjs';
import {
  addPullRequestReference,
  normalizePullRequestReference,
} from '../specs/pull-requests.mjs';
import {
  loadChange,
  loadChangeAnywhere,
} from '../specs/store.mjs';
import { validatePullRequestReferences } from '../specs/validation.mjs';

function fixture({ archived = false } = {}) {
  const root = join(tmpdir(), `nevo-pr-reference-${process.pid}-${Date.now()}-${Math.random()}`);
  const activeDir = join(root, 'active');
  const archiveDir = join(root, 'archive');
  const base = archived ? archiveDir : activeDir;
  const changeDir = join(base, 'sample');
  mkdirSync(changeDir, { recursive: true });
  writeFileSync(join(changeDir, 'change.yaml'), `# preserved comment\nid: sample\ntitle: Sample\nstatus: draft\ntasks: []\n`);
  return {
    root, activeDir, archiveDir, changeDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('normalizes GitHub, GitLab, self-hosted, and future provider references', () => {
  assert.deepEqual(normalizePullRequestReference({ provider: ' GitHub ', repository: '/OpenAI/codex.git/', number: '12' }), {
    provider: 'github', base_url: 'https://github.com', repository: 'OpenAI/codex', number: 12,
  });
  assert.equal(normalizePullRequestReference({ provider: 'gitlab', repository: 'group/sub/project', number: 3 }).base_url, 'https://gitlab.com');
  assert.equal(normalizePullRequestReference({
    provider: 'gitlab', base_url: 'https://git.example.test/root/', repository: 'group/project', number: 4,
  }).base_url, 'https://git.example.test/root');
  assert.equal(normalizePullRequestReference({
    provider: 'forge-x', base_url: 'http://forge.local', repository: 'team/project', number: 5,
  }).provider, 'forge-x');
});

test('rejects invalid reference fields with field-specific errors', () => {
  assert.throws(() => normalizePullRequestReference({ provider: '', repository: 'a/b', number: 1 }), /provider/);
  assert.throws(() => normalizePullRequestReference({ provider: 'custom', repository: 'a/b', number: 1 }), /base_url/);
  assert.throws(() => normalizePullRequestReference({ provider: 'github', base_url: 'file:\/\/local', repository: 'a/b', number: 1 }), /base_url/);
  assert.throws(() => normalizePullRequestReference({ provider: 'github', repository: '../repo', number: 1 }), /repository/);
  assert.throws(() => normalizePullRequestReference({ provider: 'github', repository: 'owner/repo', number: 0 }), /number/);
});

test('validation accepts a missing collection and detects invalid or duplicate entries', () => {
  const errors = [];
  validatePullRequestReferences({}, errors, 'fixture');
  assert.deepEqual(errors, []);

  validatePullRequestReferences({ pull_requests: [
    { provider: 'github', repository: 'Owner/Repo', number: 7 },
    { provider: 'GITHUB', base_url: 'https://github.com/', repository: 'owner/repo.git', number: '7' },
    { provider: 'github', repository: 'owner/repo', number: -1 },
  ] }, errors, 'fixture');
  assert.ok(errors.some(error => /duplicate pull request reference/.test(error)));
  assert.ok(errors.some(error => /number/.test(error)));
});

test('structurally appends once while preserving unrelated YAML', () => {
  const sample = fixture();
  try {
    const change = loadChange('sample', sample.activeDir);
    const first = addPullRequestReference(change, { provider: 'github', repository: 'Owner/Repo', number: 21 });
    const second = addPullRequestReference(change, { provider: 'github', repository: 'Owner/Repo', number: 22 });
    const duplicate = addPullRequestReference(change, { provider: 'GITHUB', base_url: 'https://github.com/', repository: 'owner/repo.git', number: '21' });
    assert.equal(first.added, true);
    assert.equal(second.added, true);
    assert.equal(duplicate.added, false);
    const written = readFileSync(join(sample.changeDir, 'change.yaml'), 'utf8');
    assert.match(written, /# preserved comment/);
    assert.equal((written.match(/provider: github/g) || []).length, 2);
    assert.deepEqual(loadChange('sample', sample.activeDir).pull_requests.map(reference => reference.number), [21, 22]);
  } finally {
    sample.cleanup();
  }
});

test('active-first lookup and command support active and archived changes idempotently', () => {
  for (const archived of [false, true]) {
    const sample = fixture({ archived });
    try {
      const located = loadChangeAnywhere('sample', sample);
      assert.equal(located.location, archived ? 'archive' : 'active');
      const first = handlePullRequestAdd('sample', {
        provider: 'github', repository: 'owner/repo', number: '42',
      }, sample);
      const second = handlePullRequestAdd('sample', {
        provider: 'github', repository: 'OWNER/REPO', number: 42,
      }, sample);
      assert.equal(first.added, true);
      assert.equal(second.added, false);
    } finally {
      sample.cleanup();
    }
  }
});

test('Commander help exposes the pull-request-add command and approved flags', () => {
  const program = buildProgram();
  assert.match(program.helpInformation(), /pull-request-add/);
  const command = program.commands.find(item => item.name() === 'pull-request-add');
  assert.ok(command);
  const help = command.helpInformation();
  assert.match(help, /--provider/);
  assert.match(help, /--repository/);
  assert.match(help, /--number/);
  assert.match(help, /--base-url/);
});
