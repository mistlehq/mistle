import { describe, expect, it } from "vitest";

import { buildCodexTurnInputItems } from "./codex-operations.js";

describe("buildCodexTurnInputItems", () => {
  it("prepends trimmed text ahead of local image items", () => {
    expect(
      buildCodexTurnInputItems({
        text: "  describe this screenshot  ",
        attachments: [
          {
            type: "localImage",
            path: "/tmp/attachments/thread_123/image.png",
          },
        ],
      }),
    ).toEqual([
      {
        type: "text",
        text: "describe this screenshot",
      },
      {
        type: "localImage",
        path: "/tmp/attachments/thread_123/image.png",
      },
    ]);
  });

  it("returns image-only turn inputs when no text is present", () => {
    expect(
      buildCodexTurnInputItems({
        text: "   ",
        attachments: [
          {
            type: "localImage",
            path: "/tmp/attachments/thread_123/image.png",
          },
        ],
      }),
    ).toEqual([
      {
        type: "localImage",
        path: "/tmp/attachments/thread_123/image.png",
      },
    ]);
  });

  it("rejects empty turn inputs", () => {
    expect(() =>
      buildCodexTurnInputItems({
        text: "   ",
        attachments: [],
      }),
    ).toThrow("Provide text or at least one attachment before starting a turn.");
  });
});
