import type { Cache } from "@mistle/cache";
import { z } from "zod";

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
      integrationConnectionId: string;
      actingUserRequired: boolean;
      actingUserId?: string;
      credentialKind?: string;
    }
  | {
      testEnvironmentId?: string;
      bindingId: string;
      credentialResolverKind: "mistle_mcp_token";
      organizationId: string;
      sandboxInstanceId: string;
      apiKeyId: string;
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

export type CredentialCacheInvalidationResult = {
  deletedEntryCount: number;
};

const CachedCredentialRecordSchema = z
  .object({
    version: z.literal(1),
    credential: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("value"),
          value: z.string(),
          expiresAt: z.string().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("aws_session"),
          accessKeyId: z.string(),
          secretAccessKey: z.string(),
          sessionToken: z.string(),
          expiresAt: z.string(),
        })
        .strict(),
    ]),
    expiresAtMs: z.number().int().positive(),
  })
  .strict();

const CachedCredentialIndexSchema = z.array(z.string().min(1));

type CachedCredentialRecord = z.infer<typeof CachedCredentialRecordSchema>;

function serializeCredentialRecord(record: CachedCredentialRecord): string {
  return JSON.stringify(record);
}

function parseCredentialRecord(serializedRecord: string): CachedCredentialRecord {
  return CachedCredentialRecordSchema.parse(JSON.parse(serializedRecord));
}

function serializeCredentialIndex(keys: readonly string[]): string {
  return JSON.stringify(keys);
}

function parseCredentialIndex(serializedIndex: string): string[] {
  return CachedCredentialIndexSchema.parse(JSON.parse(serializedIndex));
}

type CredentialCacheRecord = {
  credential: CachedCredential;
  expiresAtMs: number;
};

type CredentialCacheInput = {
  cache: Cache;
  defaultTtlSeconds: number;
  refreshSkewSeconds: number;
  now: () => number;
};

function toCacheKey(input: CredentialCacheKeyInput): string {
  if (input.credentialResolverKind === "integration_connection") {
    return `gateway-egress-credential:${[
      input.testEnvironmentId ?? "",
      input.bindingId,
      input.credentialResolverKind,
      input.connectionId,
      input.secretType,
      input.slotKey ?? "",
      input.resolverKey ?? "",
    ].join(":")}`;
  }

  if (input.credentialResolverKind === "mistle_mcp_token") {
    return `gateway-egress-credential:${[
      input.testEnvironmentId ?? "",
      input.bindingId,
      input.credentialResolverKind,
      input.organizationId,
      input.sandboxInstanceId,
      input.apiKeyId,
    ].join(":")}`;
  }

  return `gateway-egress-credential:${[
    input.testEnvironmentId ?? "",
    input.bindingId,
    input.credentialResolverKind,
    input.organizationId,
    input.providerFamily,
    input.integrationConnectionId,
    String(input.actingUserRequired),
    input.actingUserId ?? "",
    input.credentialKind ?? "",
  ].join(":")}`;
}

function toConnectionIndexKey(input: { testEnvironmentId?: string; connectionId: string }): string {
  return `gateway-egress-credential-index:${[
    input.testEnvironmentId ?? "",
    "integration_connection",
    input.connectionId,
  ].join(":")}`;
}

function toConnectionIndexKeyForCacheKey(input: CredentialCacheKeyInput): string | undefined {
  if (input.credentialResolverKind !== "integration_connection") {
    return undefined;
  }

  return toConnectionIndexKey({
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
    connectionId: input.connectionId,
  });
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
  readonly #cache: Cache;
  readonly #defaultTtlSeconds: number;
  readonly #refreshSkewMs: number;
  readonly #now: () => number;

  public constructor(input: CredentialCacheInput) {
    this.#cache = input.cache;
    this.#defaultTtlSeconds = input.defaultTtlSeconds;
    this.#refreshSkewMs = input.refreshSkewSeconds * 1000;
    this.#now = input.now;
  }

  public async getWithResult(input: CredentialCacheKeyInput): Promise<CredentialCacheLookupResult> {
    const key = toCacheKey(input);
    const serializedEntry = await this.#cache.get(key);
    if (serializedEntry === null) {
      return {
        result: "miss",
      };
    }

    const entry = parseCredentialRecord(serializedEntry);
    const now = this.#now();
    const refreshBoundaryMs = entry.expiresAtMs - this.#refreshSkewMs;
    if (now >= refreshBoundaryMs) {
      await this.#cache.delete(key);
      await this.#removeFromConnectionIndex(input, key);
      return {
        result: "refresh_skew_expired",
      };
    }

    return {
      credential: entry.credential,
      result: "hit",
    };
  }

  public async set(input: CredentialCacheKeyInput, credential: CachedCredential): Promise<void> {
    const key = toCacheKey(input);
    const now = this.#now();
    const expiresAtMs = resolveExpiryMs({
      credential,
      nowMs: now,
      defaultTtlSeconds: this.#defaultTtlSeconds,
    });

    if (expiresAtMs <= now) {
      await this.#cache.delete(key);
      await this.#removeFromConnectionIndex(input, key);
      return;
    }

    const entry: CredentialCacheRecord = {
      credential,
      expiresAtMs,
    };

    await this.#cache.set(key, serializeCredentialRecord({ version: 1, ...entry }), {
      ttlMs: expiresAtMs - now,
    });
    await this.#addToConnectionIndex(input, key);
  }

  public async invalidateIntegrationConnection(input: {
    testEnvironmentId?: string;
    connectionId: string;
  }): Promise<CredentialCacheInvalidationResult> {
    const indexKey = toConnectionIndexKey(input);
    const serializedIndex = await this.#cache.get(indexKey);
    if (serializedIndex === null) {
      return {
        deletedEntryCount: 0,
      };
    }

    const cacheKeys = new Set(parseCredentialIndex(serializedIndex));
    await Promise.all([...cacheKeys].map(async (cacheKey) => this.#cache.delete(cacheKey)));
    await this.#cache.delete(indexKey);

    return {
      deletedEntryCount: cacheKeys.size,
    };
  }

  async #addToConnectionIndex(input: CredentialCacheKeyInput, cacheKey: string): Promise<void> {
    const indexKey = toConnectionIndexKeyForCacheKey(input);
    if (indexKey === undefined) {
      return;
    }

    const serializedIndex = await this.#cache.get(indexKey);
    const indexKeys = serializedIndex === null ? [] : parseCredentialIndex(serializedIndex);
    if (indexKeys.includes(cacheKey)) {
      return;
    }

    await this.#cache.set(indexKey, serializeCredentialIndex([...indexKeys, cacheKey].sort()));
  }

  async #removeFromConnectionIndex(
    input: CredentialCacheKeyInput,
    cacheKey: string,
  ): Promise<void> {
    const indexKey = toConnectionIndexKeyForCacheKey(input);
    if (indexKey === undefined) {
      return;
    }

    const serializedIndex = await this.#cache.get(indexKey);
    if (serializedIndex === null) {
      return;
    }

    const nextIndexKeys = parseCredentialIndex(serializedIndex).filter((key) => key !== cacheKey);
    if (nextIndexKeys.length === 0) {
      await this.#cache.delete(indexKey);
      return;
    }

    await this.#cache.set(indexKey, serializeCredentialIndex(nextIndexKeys));
  }
}
