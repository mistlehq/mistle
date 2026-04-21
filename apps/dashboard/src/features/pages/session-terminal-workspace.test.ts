import { describe, expect, it } from "vitest";

import { buildNextTerminalPanelDefinition } from "./session-terminal-workspace.js";

describe("buildNextTerminalPanelDefinition", () => {
  it("uses the legacy terminal id for the first terminal", () => {
    expect(buildNextTerminalPanelDefinition([])).toEqual({
      id: "terminal",
      title: "Terminal",
    });
  });

  it("increments the numeric suffix for additional terminals", () => {
    expect(buildNextTerminalPanelDefinition(["terminal", "terminal-2", "terminal-4"])).toEqual({
      id: "terminal-5",
      title: "Terminal 5",
    });
  });

  it("ignores unrelated Dockview panel ids", () => {
    expect(buildNextTerminalPanelDefinition(["changes", "cli", "terminal"])).toEqual({
      id: "terminal-2",
      title: "Terminal 2",
    });
  });
});
