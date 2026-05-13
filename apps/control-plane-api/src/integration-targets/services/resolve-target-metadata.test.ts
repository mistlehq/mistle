import { describe, expect, it } from "vitest";

import { resolveTargetMetadata } from "./resolve-target-metadata.js";

describe("resolveTargetMetadata", () => {
  it("requires override-only targets to resolve to a registered integration definition", () => {
    expect(() =>
      resolveTargetMetadata({
        familyId: "renamed-openai",
        variantId: "custom-openai",
        displayNameOverride: "Custom OpenAI",
        descriptionOverride: "Custom OpenAI target",
      }),
    ).toThrow("Integration definition 'renamed-openai::custom-openai' was not found.");
  });
});
