import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const dashboardRoot = fileURLToPath(new URL('..', import.meta.url));
export const uiRoot = resolve(dashboardRoot, 'ui');

export const sharedAliases = {
  '@': uiRoot,
};
