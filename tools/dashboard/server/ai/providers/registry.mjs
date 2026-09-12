import {
  AiNotFoundError,
  AiValidationError,
  CapabilityNotSupportedError,
  validateProviderDescriptor,
} from '../contracts.mjs';

export class AgentProviderRegistry {
  #providers = new Map();
  #disposePromise;

  constructor(providers = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    if (!provider || typeof provider !== 'object') {
      throw new AiValidationError('Provider must be an object.');
    }
    const descriptor = validateProviderDescriptor(provider.descriptor);
    for (const method of ['startTurn', 'cancelTurn']) {
      if (typeof provider[method] !== 'function') {
        throw new AiValidationError(`Provider '${descriptor.id}' must implement required method '${method}'.`, {
          provider: descriptor.id,
          method,
        });
      }
    }
    if (this.#providers.has(descriptor.id)) {
      throw new Error(`AI provider '${descriptor.id}' is already registered.`);
    }
    this.#providers.set(descriptor.id, { provider, descriptor });
    return this;
  }

  unregister(provider) {
    return this.#providers.delete(provider);
  }

  has(provider) {
    return this.#providers.has(provider);
  }

  list() {
    return [...this.#providers.keys()];
  }

  descriptors() {
    return [...this.#providers.values()].map((entry) => {
      let desc = entry.descriptor;
      if (typeof entry.provider.isAvailable === 'function') {
        const avail = entry.provider.isAvailable();
        const installed =
          avail?.installed !== undefined
            ? Boolean(avail.installed)
            : (desc.health?.installed ?? (avail?.available !== false));
        const status = avail?.status || (installed ? 'healthy' : 'unavailable');
        const health = {
          ...desc.health,
          enabled: desc.enabled !== false,
          installed,
          status,
          ...(avail?.version ? { version: avail.version } : (desc.health?.version ? { version: desc.health.version } : {})),
          ...(avail?.authenticated !== undefined
            ? { authenticated: avail.authenticated }
            : (desc.health?.authenticated !== undefined ? { authenticated: desc.health.authenticated } : {})),
          ...(avail?.unavailableReason
            ? { unavailableReason: String(avail.unavailableReason) }
            : (desc.health?.unavailableReason ? { unavailableReason: desc.health.unavailableReason } : {})),
        };
        desc = {
          ...desc,
          enabled: health.enabled,
          available: health.installed && health.status !== 'unavailable',
          health,
          ...(health.unavailableReason ? { unavailableReason: health.unavailableReason } : {}),
        };
      }
      return desc;
    });
  }


  get(provider) {
    const entry = this.#providers.get(provider);
    if (!entry) throw new AiNotFoundError(`AI provider '${provider}' was not found.`, { provider });
    return entry;
  }

  require(provider, capability, method) {
    const entry = this.get(provider);
    if (!entry.descriptor.capabilities[capability] || (method && typeof entry.provider[method] !== 'function')) {
      throw new CapabilityNotSupportedError(provider, capability);
    }
    return entry.provider;
  }

  dispose() {
    this.#disposePromise ??= Promise.allSettled(
      [...this.#providers.values()]
        .filter(({ provider }) => typeof provider.dispose === 'function')
        .map(({ provider }) => Promise.resolve().then(() => provider.dispose())),
    );
    return this.#disposePromise;
  }
}

export function createAgentProviderRegistry(providers) {
  return new AgentProviderRegistry(providers);
}
