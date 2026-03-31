import { createSecretKey } from "node:crypto";

export function toNonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

export function toSecretKey(secret: string): ReturnType<typeof createSecretKey> {
  return createSecretKey(new TextEncoder().encode(secret));
}
