export type CredentialCacheKeyInput = {
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type CachedCredential = {
  value: string;
  expiresAt?: string;
};

type CredentialCacheEntry = {
  value: string;
  expiresAtMs: number;
};

type CredentialCacheInput = {
  maxEntries: number;
  defaultTtlSeconds: number;
  refreshSkewSeconds: number;
  now: () => number;
};

function toCacheKey(input: CredentialCacheKeyInput): string {
  return [input.connectionId, input.secretType, input.purpose ?? "", input.resolverKey ?? ""].join(
    ":",
  );
}

function resolveExpiryMs(input: {
  credential: CachedCredential;
  nowMs: number;
  defaultTtlSeconds: number;
}): number {
  if (input.credential.expiresAt === undefined) {
    return input.nowMs + input.defaultTtlSeconds * 1000;
  }

  const expiresAtMs = Date.parse(input.credential.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    throw new Error(`Credential expiry timestamp '${input.credential.expiresAt}' is invalid.`);
  }

  return expiresAtMs;
}

export class CredentialCache {
  readonly #maxEntries: number;
  readonly #defaultTtlSeconds: number;
  readonly #refreshSkewMs: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, CredentialCacheEntry>();

  constructor(input: CredentialCacheInput) {
    this.#maxEntries = input.maxEntries;
    this.#defaultTtlSeconds = input.defaultTtlSeconds;
    this.#refreshSkewMs = input.refreshSkewSeconds * 1000;
    this.#now = input.now;
  }

  get(input: CredentialCacheKeyInput): string | undefined {
    const key = toCacheKey(input);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }

    const now = this.#now();
    const refreshBoundaryMs = entry.expiresAtMs - this.#refreshSkewMs;
    if (now >= refreshBoundaryMs) {
      this.#entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(input: CredentialCacheKeyInput, credential: CachedCredential): void {
    const key = toCacheKey(input);
    const now = this.#now();
    const expiresAtMs = resolveExpiryMs({
      credential,
      nowMs: now,
      defaultTtlSeconds: this.#defaultTtlSeconds,
    });

    if (expiresAtMs <= now) {
      this.#entries.delete(key);
      return;
    }

    if (!this.#entries.has(key) && this.#entries.size >= this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.#entries.delete(oldestKey);
      }
    }

    this.#entries.set(key, {
      value: credential.value,
      expiresAtMs,
    });
  }
}
