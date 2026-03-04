import { describe, expect, it } from "vitest";

import { formatConnectionDisplayName } from "./format-connection-display-name.js";

describe("formatConnectionDisplayName", () => {
  it("returns the integration target display name for a connection", () => {
    expect(
      formatConnectionDisplayName({
        connection: {
          id: "icn_01",
          targetKey: "openai-default",
        },
        targets: [
          {
            targetKey: "openai-default",
            displayName: "OpenAI",
          },
        ],
      }),
    ).toBe("OpenAI");
  });

  it("throws when the target metadata for the connection is missing", () => {
    expect(() =>
      formatConnectionDisplayName({
        connection: {
          id: "icn_01",
          targetKey: "openai-default",
        },
        targets: [],
      }),
    ).toThrow(
      "Integration target metadata is missing for connection 'icn_01' with target key 'openai-default'.",
    );
  });
});
