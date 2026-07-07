// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import {
  captureDesignerLandingPromptHandoff,
  DesignerLandingPromptHandoffStorageKey,
  DesignerLandingPromptHandoffTtlMs,
  readPendingDesignerLandingPromptHandoff,
} from "./designer-landing-handoff.js";

describe("Designer landing handoff", () => {
  afterEach(() => {
    window.sessionStorage.removeItem(DesignerLandingPromptHandoffStorageKey);
  });

  it("captures a valid root prompt with one idempotency key and a 30 minute expiry", () => {
    const result = captureDesignerLandingPromptHandoff({
      createIdempotencyKey: () => "landing-key-001",
      nowMs: 1_000,
      pathname: "/",
      search: "?prompt=%20Build%20a%20triage%20agent%20&source=hero",
      storage: window.sessionStorage,
    });

    expect(result).toEqual({
      kind: "captured",
      sanitizedSearch: "?source=hero",
    });
    expect(
      readPendingDesignerLandingPromptHandoff({
        nowMs: 1_000 + DesignerLandingPromptHandoffTtlMs - 1,
        storage: window.sessionStorage,
      }),
    ).toEqual({
      expiresAtMs: 1_000 + DesignerLandingPromptHandoffTtlMs,
      idempotencyKey: "landing-key-001",
      prompt: "Build a triage agent",
    });
  });

  it("ignores prompts outside the root route", () => {
    expect(
      captureDesignerLandingPromptHandoff({
        createIdempotencyKey: () => "landing-key-002",
        nowMs: 1_000,
        pathname: "/settings",
        search: "?prompt=Build",
        storage: window.sessionStorage,
      }),
    ).toEqual({ kind: "not-root-route" });
    expect(window.sessionStorage.getItem(DesignerLandingPromptHandoffStorageKey)).toBeNull();
  });

  it("removes invalid prompt query parameters without storing a handoff", () => {
    expect(
      captureDesignerLandingPromptHandoff({
        createIdempotencyKey: () => "landing-key-003",
        nowMs: 1_000,
        pathname: "/",
        search: "?prompt=%20%20&keep=1",
        storage: window.sessionStorage,
      }),
    ).toEqual({
      kind: "ignored-invalid-prompt",
      sanitizedSearch: "?keep=1",
    });
    expect(window.sessionStorage.getItem(DesignerLandingPromptHandoffStorageKey)).toBeNull();
  });

  it("returns storage-blocked when browser storage is unavailable", () => {
    expect(
      captureDesignerLandingPromptHandoff({
        createIdempotencyKey: () => "landing-key-004",
        nowMs: 1_000,
        pathname: "/",
        search: "?prompt=Build&source=hero",
        storage: null,
      }),
    ).toEqual({
      kind: "storage-blocked",
      prompt: "Build",
      sanitizedSearch: "?source=hero",
    });
  });

  it("clears expired handoffs when reading", () => {
    captureDesignerLandingPromptHandoff({
      createIdempotencyKey: () => "landing-key-005",
      nowMs: 1_000,
      pathname: "/",
      search: "?prompt=Build",
      storage: window.sessionStorage,
    });

    expect(
      readPendingDesignerLandingPromptHandoff({
        nowMs: 1_000 + DesignerLandingPromptHandoffTtlMs,
        storage: window.sessionStorage,
      }),
    ).toBeNull();
    expect(window.sessionStorage.getItem(DesignerLandingPromptHandoffStorageKey)).toBeNull();
  });
});
