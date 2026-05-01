export type CredentialCacheKeyInput =
  | {
      testEnvironmentId?: string;
      bindingId: string;
      credentialResolverKind: "integration_connection";
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    }
  | {
      testEnvironmentId?: string;
      bindingId: string;
      credentialResolverKind: "linked_principal";
      organizationId: string;
      providerFamily: string;
      actingUserRequired: boolean;
      actingUserId?: string;
      credentialKind?: string;
    };

export type CachedCredential =
  | {
      kind: "value";
      value: string;
      expiresAt?: string | undefined;
    }
  | {
      kind: "aws_session";
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken: string;
      expiresAt: string;
    };

export type CredentialCacheLookupResult = {
  credential?: CachedCredential;
  result: "hit" | "miss" | "refresh_skew_expired";
};

type CredentialCacheEntry = {
  credential: CachedCredential;
  expiresAtMs: number;
};

type CredentialCacheInput = {
  maxEntries: number;
  defaultTtlSeconds: number;
  refreshSkewSeconds: number;
  now: () => number;
};

function toCacheKey(input: CredentialCacheKeyInput): string {
  if (input.credentialResolverKind === "integration_connection") {
    return [
      input.testEnvironmentId ?? "",
      input.bindingId,
      input.credentialResolverKind,
      input.connectionId,
      input.secretType,
      input.slotKey ?? "",
      input.resolverKey ?? "",
    ].join(":");
  }

  return [
    input.testEnvironmentId ?? "",
    input.bindingId,
    input.credentialResolverKind,
    input.organizationId,
    input.providerFamily,
    String(input.actingUserRequired),
    input.actingUserId ?? "",
    input.credentialKind ?? "",
  ].join(":");
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

  getWithResult(input: CredentialCacheKeyInput): CredentialCacheLookupResult {
    const key = toCacheKey(input);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return {
        result: "miss",
      };
    }

    const now = this.#now();
    const refreshBoundaryMs = entry.expiresAtMs - this.#refreshSkewMs;
    if (now >= refreshBoundaryMs) {
      this.#entries.delete(key);
      return {
        result: "refresh_skew_expired",
      };
    }

    return {
      credential: entry.credential,
      result: "hit",
    };
  }

  get(input: CredentialCacheKeyInput): CachedCredential | undefined {
    return this.getWithResult(input).credential;
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
      credential,
      expiresAtMs,
    });
  }
}
