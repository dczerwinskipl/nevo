import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readUi(relative) {
  return readFileSync(fileURLToPath(new URL(`../ui/${relative}`, import.meta.url)), 'utf8');
}

test('new generic agent session exposes provider model selection and forwards it to createSession', () => {
  const source = readUi('features/agent-sessions/create-agent-session-dialog.tsx');

  assert.match(source, /const \[model, setModel\] = useState\(''\)/);
  assert.match(source, /selectedModel=\{model\}/);
  assert.match(source, /onSelectModel=\{setModel\}/);
  assert.match(source, /\.\.\.\(model \? \{ model \} : \{\}\)/);
  assert.match(source, /<option value="">Default<\/option>/);
});

test('new-spec AI planning exposes provider model selection and forwards it to session creation', () => {
  const formSource = readUi('screens/specification-console/create-specification/use-create-specification-form.ts');
  const sectionSource = readUi('screens/specification-console/create-specification/specification-ai-planning-section.tsx');
  const dialogSource = readUi('screens/specification-console/create-specification/create-specification-dialog.tsx');

  assert.match(formSource, /const \[model, setModel\] = useState\(''\)/);
  assert.match(formSource, /const providerModels = selectedProviderObj\?\.models \?\? \[\]/);
  assert.match(formSource, /\.\.\.\(model \? \{ model \} : \{\}\)/);
  assert.match(sectionSource, /<option value="">Default<\/option>/);
  assert.match(dialogSource, /models=\{form\.providerModels\}/);
  assert.match(dialogSource, /selectedModel=\{form\.model\}/);
  assert.match(dialogSource, /onModelChange=\{form\.setModel\}/);
});
