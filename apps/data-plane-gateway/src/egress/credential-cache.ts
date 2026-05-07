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

type CachedCredentialRecord = z.infer<typeof CachedCredentialRecordSchema>;

function serializeCredentialRecord(record: CachedCredentialRecord): string {
  return JSON.stringify(record);
}

function parseCredentialRecord(serializedRecord: string): CachedCredentialRecord {
  return CachedCredentialRecordSchema.parse(JSON.parse(serializedRecord));
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

  return `gateway-egress-credential:${[
    input.testEnvironmentId ?? "",
    input.bindingId,
    input.credentialResolverKind,
    input.organizationId,
    input.providerFamily,
    String(input.actingUserRequired),
    input.actingUserId ?? "",
    input.credentialKind ?? "",
  ].join(":")}`;
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
      return;
    }

    const entry: CredentialCacheRecord = {
      credential,
      expiresAtMs,
    };

    await this.#cache.set(key, serializeCredentialRecord({ version: 1, ...entry }), {
      ttlMs: expiresAtMs - now,
    });
  }
}
