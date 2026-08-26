import { archiveChange } from './operation.mjs';

export function handleArchive(changeSlug) {
  archiveChange(changeSlug);
  console.log(`Change '${changeSlug}' archived to specs/archive/.`);
}
