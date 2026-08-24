export type DashboardMode = 'active' | 'archive';

export type AppRoute =
  | { type: 'dashboard'; mode: DashboardMode }
  | { type: 'spec'; source: DashboardMode; slug: string }
  | { type: 'chat'; provider: string; sessionId: string; turnId: string | null };

export function parseRoute(pathname: string, search = ''): AppRoute {
  // 1. AI Chat Route: /ai/sessions/:provider/:sessionId
  const chatMatch = pathname.match(/^\/ai\/sessions\/([^/]+)\/([^/]+)$/);
  if (chatMatch) {
    try {
      const provider = decodeURIComponent(chatMatch[1]);
      const sessionId = decodeURIComponent(chatMatch[2]);
      const turnId = new URLSearchParams(search).get('turnId');
      return { type: 'chat', provider, sessionId, turnId };
    } catch {
      // Fallback
    }
  }

  // 2. Spec Detail Route with explicit source: /specs/(active|archive)/:slug
  const specMatch = pathname.match(/^\/specs\/(active|archive)\/([^/]+)$/);
  if (specMatch) {
    try {
      const source = specMatch[1] as DashboardMode;
      const slug = decodeURIComponent(specMatch[2]);
      return { type: 'spec', source, slug };
    } catch {
      // Fallback
    }
  }

  // 3. Spec Detail Route without explicit source: /specs/:slug
  const genericSpecMatch = pathname.match(/^\/specs\/([^/]+)$/);
  if (genericSpecMatch && genericSpecMatch[1] !== 'active' && genericSpecMatch[1] !== 'archive') {
    try {
      const slug = decodeURIComponent(genericSpecMatch[1]);
      return { type: 'spec', source: 'active', slug };
    } catch {
      // Fallback
    }
  }

  // 4. Archive Dashboard List: /archive or /specs/archive
  if (pathname === '/archive' || pathname === '/specs/archive') {
    return { type: 'dashboard', mode: 'archive' };
  }

  // 5. Active Dashboard List: / or /active or /specs/active
  return { type: 'dashboard', mode: 'active' };
}

export function formatRoute(route: AppRoute): string {
  switch (route.type) {
    case 'dashboard':
      return route.mode === 'archive' ? '/archive' : '/';
    case 'spec':
      return `/specs/${route.source}/${encodeURIComponent(route.slug)}`;
    case 'chat': {
      const base = `/ai/sessions/${encodeURIComponent(route.provider)}/${encodeURIComponent(route.sessionId)}`;
      return route.turnId ? `${base}?turnId=${encodeURIComponent(route.turnId)}` : base;
    }
  }
}

export function isSameRoute(a: AppRoute, b: AppRoute): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'dashboard' && b.type === 'dashboard') {
    return a.mode === b.mode;
  }
  if (a.type === 'spec' && b.type === 'spec') {
    return a.source === b.source && a.slug === b.slug;
  }
  if (a.type === 'chat' && b.type === 'chat') {
    return a.provider === b.provider && a.sessionId === b.sessionId && a.turnId === b.turnId;
  }
  return false;
}
