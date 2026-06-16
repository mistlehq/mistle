import { describe, expect, it } from "vitest";

import { parseClaudeCodeSessionListResult } from "./client.js";

describe("parseClaudeCodeSessionListResult", () => {
  it("preserves empty Claude Code session titles for the navigator display fallback", () => {
    expect(
      parseClaudeCodeSessionListResult({
        sessions: [
          {
            id: "ses_empty_title",
            title: "",
            cwd: null,
            createdAt: null,
            updatedAt: 100,
          },
        ],
      }),
    ).toEqual([
      {
        id: "ses_empty_title",
        title: "",
        cwd: null,
        createdAt: null,
        updatedAt: 100,
      },
    ]);
  });
});
