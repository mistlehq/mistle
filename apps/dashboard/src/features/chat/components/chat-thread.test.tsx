// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatThread } from "./chat-thread.js";

describe("ChatThread", () => {
  it("renders multiline commands in the same code-block treatment as command output", () => {
    render(
      <ChatThread
        entries={[
          {
            id: "user_1",
            turnId: "turn_1",
            kind: "user-message",
            text: "write the file",
            status: "completed",
          },
          {
            id: "cmd_1",
            turnId: "turn_1",
            kind: "command-execution",
            command: `/bin/sh -lc "cat > /workspace/two-little-pigs.md <<'EOF'\n# Two Little Pigs\nEOF"`,
            output: null,
            cwd: "/workspace",
            exitCode: null,
            commandStatus: "completed",
            reason: null,
            status: "completed",
          },
        ]}
      />,
    );

    const renderedCommand = screen.getByText(/# Two Little Pigs/);
    expect(renderedCommand.tagName).toBe("PRE");
    expect(renderedCommand.className).toContain("bg-muted");
  });
});
