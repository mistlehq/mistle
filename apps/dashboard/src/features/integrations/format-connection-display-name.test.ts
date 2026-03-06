import { describe, expect, it } from "vitest";

import { formatConnectionDisplayName } from "./format-connection-display-name.js";

describe("formatConnectionDisplayName", () => {
  it("returns the integration connection display name", () => {
    expect(
      formatConnectionDisplayName({
        connection: {
          id: "icn_01",
          displayName: "Primary OpenAI Workspace",
        },
      }),
    ).toBe("Primary OpenAI Workspace");
  });

  it("throws when the connection display name is blank", () => {
    expect(() =>
      formatConnectionDisplayName({
        connection: {
          id: "icn_01",
          displayName: "   ",
        },
      }),
    ).toThrow("Integration connection 'icn_01' is missing a display name.");
  });
});
