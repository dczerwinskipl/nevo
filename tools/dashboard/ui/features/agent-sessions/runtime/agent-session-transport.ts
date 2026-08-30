import type { AgentSessionSnapshot } from '../types.ts';

export type AgentSessionLoadErrorKind = 'network' | 'not_found' | 'http';

export class AgentSessionLoadError extends Error {
  readonly kind: AgentSessionLoadErrorKind;
  readonly status?: number;
  readonly title: string;

  constructor(message: string, options: { kind: AgentSessionLoadErrorKind; status?: number; title: string }) {
    super(message);
    this.name = 'AgentSessionLoadError';
    this.kind = options.kind;
    this.status = options.status;
    this.title = options.title;
  }
}

export function classifySessionLoadError(
  err: unknown,
  provider?: string,
  sessionId?: string,
): AgentSessionLoadError {
  if (err instanceof AgentSessionLoadError) {
    return err;
  }

  if (
    err instanceof TypeError ||
    (err instanceof Error &&
      (err.name === 'FetchError' ||
        err.message.includes('fetch') ||
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('NetworkError')))
  ) {
    return new AgentSessionLoadError(
      'Nie udało się nawiązać połączenia z serwerem dashboardu. Upewnij się, że serwer NEvo jest uruchomiony.',
      {
        kind: 'network',
        title: 'Nie można połączyć z dashboardem',
      },
    );
  }

  if (err && typeof err === 'object' && 'status' in err && typeof (err as any).status === 'number') {
    const status = (err as any).status as number;
    const msg = (err as any).message || '';
    if (status === 404) {
      return new AgentSessionLoadError(
        msg || `Sesja ${sessionId || ''} dla providera ${provider || ''} nie została znaleziona lub jest niedostępna.`,
        {
          kind: 'not_found',
          status: 404,
          title: 'Sesja nie znaleziona',
        },
      );
    }
    return new AgentSessionLoadError(
      msg || `Serwer dashboardu zwrócił błąd HTTP ${status}.`,
      {
        kind: 'http',
        status,
        title: `Błąd serwera (${status})`,
      },
    );
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('404')) {
    return new AgentSessionLoadError(
      `Sesja ${sessionId || ''} dla providera ${provider || ''} nie została znaleziona lub jest niedostępna.`,
      {
        kind: 'not_found',
        status: 404,
        title: 'Sesja nie znaleziona',
      },
    );
  }

  return new AgentSessionLoadError(
    message || 'Wystąpił nieoczekiwany błąd podczas wczytywania sesji.',
    {
      kind: 'http',
      title: 'Błąd wczytywania sesji',
    },
  );
}

export async function fetchAgentSessionSnapshot(
  provider: string,
  providerSessionId: string,
  fetchFn: typeof fetch = fetch,
): Promise<AgentSessionSnapshot> {
  let res: Response;
  try {
    res = await fetchFn(`/api/agent-sessions/${encodeURIComponent(provider)}/${encodeURIComponent(providerSessionId)}`);
  } catch (err) {
    throw classifySessionLoadError(err, provider, providerSessionId);
  }

  if (!res.ok) {
    let errorMsg = '';
    try {
      const errData = await res.json();
      errorMsg = errData?.error?.message || errData?.message || '';
    } catch {
      // ignore non-json response body
    }

    if (res.status === 404) {
      throw new AgentSessionLoadError(
        errorMsg || `Sesja "${providerSessionId}" dla providera "${provider}" nie została znaleziona lub została usunięta.`,
        {
          kind: 'not_found',
          status: 404,
          title: 'Sesja nie znaleziona',
        },
      );
    }

    throw new AgentSessionLoadError(
      errorMsg || `Serwer dashboardu zwrócił błąd: ${res.status} ${res.statusText}`,
      {
        kind: 'http',
        status: res.status,
        title: `Błąd serwera (${res.status})`,
      },
    );
  }

  const data = await res.json();
  return data.session as AgentSessionSnapshot;
}
