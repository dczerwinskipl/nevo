import { generateSpecsIndexes } from './operation.mjs';

export function handleGenerate() {
  const built = generateSpecsIndexes();
  console.log(`Generated: specs/active.generated.md (${built.activeCount} changes)`);
  console.log(`Generated: specs/archive.generated.md (${built.archiveCount} changes)`);
  console.log('Generated: specs/index.generated.json');
}
