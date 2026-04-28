import { describe, expect, it } from "vitest";

import {
  buildSavedFieldValuePatch,
  createAutoSaveFieldTimeoutRefs,
  resolveAutoSaveFieldTimeoutRefs,
} from "./auto-save-behavior.js";

describe("createAutoSaveFieldTimeoutRefs", () => {
  it("creates timeout ref pairs for each field", () => {
    expect(
      createAutoSaveFieldTimeoutRefs({
        fieldKeys: ["clientId", "clientSecret"],
      }),
    ).toEqual({
      clientId: {
        fadeStartTimeoutRef: { current: null },
        fadeEndTimeoutRef: { current: null },
      },
      clientSecret: {
        fadeStartTimeoutRef: { current: null },
        fadeEndTimeoutRef: { current: null },
      },
    });
  });

  it("resolves timeout refs for a field", () => {
    const timeoutRefs = createAutoSaveFieldTimeoutRefs({
      fieldKeys: ["clientId"],
    });

    expect(
      resolveAutoSaveFieldTimeoutRefs({
        timeoutRefs,
        fieldKey: "clientId",
      }),
    ).toEqual({
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    });
  });

  it("fails fast when timeout refs are missing for a field", () => {
    expect(() =>
      resolveAutoSaveFieldTimeoutRefs({
        timeoutRefs: {},
        fieldKey: "clientId",
      }),
    ).toThrow("Auto-save timeout refs are missing for field 'clientId'.");
  });
});

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
