import { describe, expect, it } from "vitest";

import { resolveChatDiffOptions } from "./chat-diff-view.js";

describe("ChatDiffView", () => {
  it("uses the resolved Mistle appearance for Pierre diff rendering", () => {
    expect(resolveChatDiffOptions({ themeType: "dark" }).themeType).toBe("dark");
    expect(resolveChatDiffOptions({ themeType: "light" }).themeType).toBe("light");
  });
});
