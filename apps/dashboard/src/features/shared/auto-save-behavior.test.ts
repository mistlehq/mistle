import { describe, expect, it } from "vitest";

import {
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
