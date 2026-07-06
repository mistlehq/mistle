import { describe, expect, it } from "vitest";

import type { BrowserStorage } from "../shared/browser-storage.js";
import {
  captureDesignerLandingPromptHandoff,
  DesignerLandingPromptHandoffStorageKey,
  DesignerLandingPromptHandoffTtlMs,
  readPendingDesignerLandingPromptHandoff,
} from "./designer-landing-handoff.js";

function createMemoryStorage(): BrowserStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, value);
    },
  };
}

describe("Designer landing handoff", () => {
  it("captures a valid root prompt with one idempotency key and a 30 minute expiry", () => {
    const storage = createMemoryStorage();

    const result = captureDesignerLandingPromptHandoff({
      createIdempotencyKey: () => "landing-key-001",
      nowMs: 1_000,
      pathname: "/",
      search: "?prompt=%20Build%20a%20triage%20agent%20&source=hero",
      storage,
    });

    expect(result).toEqual({
      kind: "captured",
      sanitizedSearch: "?source=hero",
    });
    expect(
      readPendingDesignerLandingPromptHandoff({
        nowMs: 1_000 + DesignerLandingPromptHandoffTtlMs - 1,
        storage,
      }),
    ).toEqual({
      expiresAtMs: 1_000 + DesignerLandingPromptHandoffTtlMs,
      idempotencyKey: "landing-key-001",
      prompt: "Build a triage agent",
    });
  });

  it("ignores prompts outside the root route", () => {
    const storage = createMemoryStorage();

    expect(
      captureDesignerLandingPromptHandoff({
        createIdempotencyKey: () => "landing-key-002",
        nowMs: 1_000,
        pathname: "/settings",
        search: "?prompt=Build",
        storage,
      }),
    ).toEqual({ kind: "not-root-route" });
    expect(storage.entries.has(DesignerLandingPromptHandoffStorageKey)).toBe(false);
  });

  it("removes invalid prompt query parameters without storing a handoff", () => {
    const storage = createMemoryStorage();

    expect(
      captureDesignerLandingPromptHandoff({
        createIdempotencyKey: () => "landing-key-003",
        nowMs: 1_000,
        pathname: "/",
        search: "?prompt=%20%20&keep=1",
        storage,
      }),
    ).toEqual({
      kind: "ignored-invalid-prompt",
      sanitizedSearch: "?keep=1",
    });
    expect(storage.entries.has(DesignerLandingPromptHandoffStorageKey)).toBe(false);
  });

  it("returns storage-blocked without sanitizing the prompt source", () => {
    const storage = {
      getItem(): string | null {
        return null;
      },
      removeItem(): void {},
      setItem(): void {
        throw new DOMException("Blocked", "SecurityError");
      },
    };

    expect(
      captureDesignerLandingPromptHandoff({
        createIdempotencyKey: () => "landing-key-004",
        nowMs: 1_000,
        pathname: "/",
        search: "?prompt=Build&source=hero",
        storage,
      }),
    ).toEqual({
      kind: "storage-blocked",
      prompt: "Build",
      sanitizedSearch: "?source=hero",
    });
  });

  it("clears expired handoffs when reading", () => {
    const storage = createMemoryStorage();

    captureDesignerLandingPromptHandoff({
      createIdempotencyKey: () => "landing-key-005",
      nowMs: 1_000,
      pathname: "/",
      search: "?prompt=Build",
      storage,
    });

    expect(
      readPendingDesignerLandingPromptHandoff({
        nowMs: 1_000 + DesignerLandingPromptHandoffTtlMs,
        storage,
      }),
    ).toBeNull();
    expect(storage.entries.has(DesignerLandingPromptHandoffStorageKey)).toBe(false);
  });
});
