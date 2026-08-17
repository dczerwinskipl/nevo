import {
  AiNotFoundError,
  CapabilityNotSupportedError,
  validateProviderDescriptor,
} from './contracts.mjs';

export class AiAdapterRegistry {
  #adapters = new Map();

  constructor(adapters = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    const descriptor = validateProviderDescriptor(adapter?.descriptor);
    if (this.#adapters.has(descriptor.id)) {
      throw new Error(`AI provider '${descriptor.id}' is already registered.`);
    }
    this.#adapters.set(descriptor.id, { adapter, descriptor });
    return this;
  }

  unregister(provider) {
    return this.#adapters.delete(provider);
  }

  has(provider) {
    return this.#adapters.has(provider);
  }

  list() {
    return [...this.#adapters.keys()];
  }

  descriptors() {
    return [...this.#adapters.values()].map(entry => entry.descriptor);
  }

  get(provider) {
    const entry = this.#adapters.get(provider);
    if (!entry) throw new AiNotFoundError(`AI provider '${provider}' was not found.`, { provider });
    return entry;
  }

  require(provider, capability, method) {
    const entry = this.get(provider);
    if (!entry.descriptor.capabilities[capability] || (method && typeof entry.adapter[method] !== 'function')) {
      throw new CapabilityNotSupportedError(provider, capability);
    }
    return entry.adapter;
  }
}

export function createAiAdapterRegistry(adapters) {
  return new AiAdapterRegistry(adapters);
}

