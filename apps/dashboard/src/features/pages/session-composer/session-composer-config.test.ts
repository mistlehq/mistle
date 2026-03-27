import { describe, expect, it } from "vitest";

import { readComposerConfigSnapshot } from "./session-composer-config.js";

describe("session-composer-config", () => {
  it("reads composer-relevant fields from config JSON", () => {
    expect(
      readComposerConfigSnapshot(
        JSON.stringify({
          model: "gpt-5.4",
          model_reasoning_effort: "high",
          approval_mode: "manual",
        }),
      ),
    ).toEqual({
      model: "gpt-5.4",
      modelReasoningEffort: "high",
    });
  });

  it("returns null fields for missing, invalid, or malformed config", () => {
    expect(readComposerConfigSnapshot(null)).toEqual({
      model: null,
      modelReasoningEffort: null,
    });

    expect(readComposerConfigSnapshot("not-json")).toEqual({
      model: null,
      modelReasoningEffort: null,
    });

    expect(readComposerConfigSnapshot(JSON.stringify(["not", "an", "object"]))).toEqual({
      model: null,
      modelReasoningEffort: null,
    });

    expect(
      readComposerConfigSnapshot(
        JSON.stringify({
          model: 123,
          model_reasoning_effort: true,
        }),
      ),
    ).toEqual({
      model: null,
      modelReasoningEffort: null,
    });
  });
});
