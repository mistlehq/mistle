import { describe, expect, it } from "vitest";

import { ChatDiffOptions } from "./chat-diff-view.js";

describe("ChatDiffView", () => {
  it("pins diff rendering to the light theme", () => {
    expect(ChatDiffOptions.themeType).toBe("light");
  });
});
