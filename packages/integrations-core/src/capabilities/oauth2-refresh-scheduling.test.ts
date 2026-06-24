import { describe, expect, it } from "vitest";

import { resolveOAuth2NextRefreshAtFromExpiresIn } from "./oauth2-refresh-scheduling.js";

describe("resolveOAuth2NextRefreshAtFromExpiresIn", () => {
  it("resolves the next refresh before expires_in by the configured buffer", () => {
    const now = new Date("2026-06-24T03:00:00.000Z");

    expect(
      resolveOAuth2NextRefreshAtFromExpiresIn({
        buffer: 5 * 60 * 1_000,
        now: () => now,
        expiresIn: 3_600,
      }),
    ).toEqual(new Date("2026-06-24T03:55:00.000Z"));
  });

  it("caps the configured buffer for short-lived tokens", () => {
    const now = new Date("2026-06-24T03:00:00.000Z");

    expect(
      resolveOAuth2NextRefreshAtFromExpiresIn({
        buffer: 5 * 60 * 1_000,
        now: () => now,
        expiresIn: 60,
      }),
    ).toEqual(new Date("2026-06-24T03:00:54.000Z"));
  });

  it("returns undefined when expires_in or the buffer cannot produce a schedule", () => {
    const now = () => new Date("2026-06-24T03:00:00.000Z");

    expect(
      resolveOAuth2NextRefreshAtFromExpiresIn({
        buffer: 5 * 60 * 1_000,
        now,
        expiresIn: undefined,
      }),
    ).toBeUndefined();
    expect(
      resolveOAuth2NextRefreshAtFromExpiresIn({
        buffer: 5 * 60 * 1_000,
        now,
        expiresIn: "not-a-number",
      }),
    ).toBeUndefined();
    expect(
      resolveOAuth2NextRefreshAtFromExpiresIn({
        buffer: -1,
        now,
        expiresIn: 3_600,
      }),
    ).toBeUndefined();
  });
});
