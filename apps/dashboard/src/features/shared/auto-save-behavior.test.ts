import { describe, expect, it } from "vitest";

import { buildSavedFieldValuePatch } from "./auto-save-behavior.js";

describe("buildSavedFieldValuePatch", () => {
  it("builds a normalized patch for saved fields", () => {
    const patch = buildSavedFieldValuePatch({
      draft: {
        clientId: " new-client-id ",
        clientSecret: " new-client-secret ",
        signingSecret: " unsaved-signing-secret ",
      },
      fieldKeys: ["clientId", "clientSecret"],
      normalizeValue: (value) => value.trim(),
    });

    expect(patch).toEqual({
      clientId: "new-client-id",
      clientSecret: "new-client-secret",
    });
  });

  it("fails fast when a requested draft field is missing", () => {
    expect(() =>
      buildSavedFieldValuePatch({
        draft: {
          clientId: "client-id",
        },
        fieldKeys: ["clientSecret"],
        normalizeValue: (value) => value.trim(),
      }),
    ).toThrow("Draft field 'clientSecret' is missing.");
  });
});
