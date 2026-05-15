import { describe, expect, it } from "vitest";

import { shouldGenerateInitialSessionTitle } from "./session-workbench-turn-starters.js";

describe("shouldGenerateInitialSessionTitle", () => {
  it("generates an initial session title only for the first message while the title is unset", () => {
    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: null,
        messageCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: undefined,
        messageCount: 0,
      }),
    ).toBe(true);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: "Existing title",
        messageCount: 0,
      }),
    ).toBe(false);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: "sbi_123",
        cachedTitle: null,
        messageCount: 1,
      }),
    ).toBe(false);

    expect(
      shouldGenerateInitialSessionTitle({
        sandboxInstanceId: null,
        cachedTitle: null,
        messageCount: 0,
      }),
    ).toBe(false);
  });
});
