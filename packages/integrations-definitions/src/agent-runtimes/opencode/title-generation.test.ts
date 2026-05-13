import { immediateSleeper } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import {
  normalizeGeneratedOpenCodeConversationTitle,
  waitForGeneratedOpenCodeConversationTitle,
} from "./title-generation.js";

describe("normalizeGeneratedOpenCodeConversationTitle", () => {
  it("normalizes whitespace, caps length, and removes trailing punctuation", () => {
    expect(
      normalizeGeneratedOpenCodeConversationTitle(
        "  Build   OpenCode title generation that waits for completion!!!",
      ),
    ).toBe("Build OpenCode title generation that waits for com");
  });
});

describe("waitForGeneratedOpenCodeConversationTitle", () => {
  it("waits until OpenCode replaces the pre-turn title", async () => {
    let titleIndex = 0;

    await expect(
      waitForGeneratedOpenCodeConversationTitle({
        previousTitle: "New Session",
        readCurrentTitle: async () => {
          const title = titleIndex === 0 ? "New Session" : "  Generated   automation title.  ";
          titleIndex += 1;
          return title;
        },
        sleeper: immediateSleeper,
        pollIntervalMs: 1,
        timeoutMs: 2,
      }),
    ).resolves.toBe("Generated automation title");
  });

  it("fails when OpenCode keeps returning the pre-turn title", async () => {
    await expect(
      waitForGeneratedOpenCodeConversationTitle({
        previousTitle: "New Session",
        readCurrentTitle: async () => "New Session",
        sleeper: immediateSleeper,
        pollIntervalMs: 1,
        timeoutMs: 2,
      }),
    ).rejects.toThrow("Timed out waiting for OpenCode to generate a conversation title.");
  });
});
