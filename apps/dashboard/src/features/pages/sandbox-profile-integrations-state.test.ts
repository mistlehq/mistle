import { describe, expect, it } from "vitest";

import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import { applySandboxProfileBindingEditorRowChanges } from "./sandbox-profile-integrations-state.js";

const OpenAiRow: SandboxProfileBindingEditorRow = {
  clientId: "row-openai",
  id: "binding-openai",
  connectionId: "connection-openai",
  kind: "agent",
  config: {
    tools: ["codex"],
    model: {
      name: "gpt-5.2",
      reasoningEffort: "medium",
    },
  },
};

const GitHubRow: SandboxProfileBindingEditorRow = {
  clientId: "row-github",
  id: "binding-github",
  connectionId: "connection-github",
  kind: "git",
  config: {
    repositories: ["mistle"],
  },
};

describe("sandbox profile integrations state", () => {
  it("returns null when a row change keeps the selected connection and config unchanged", () => {
    const result = applySandboxProfileBindingEditorRowChanges({
      rows: [OpenAiRow, GitHubRow],
      clientId: "row-openai",
      changes: {
        connectionId: "connection-openai",
        config: {
          model: {
            reasoningEffort: "medium",
            name: "gpt-5.2",
          },
          tools: ["codex"],
        },
      },
    });

    expect(result).toBeNull();
  });

  it("returns updated rows when a row change modifies observable binding state", () => {
    const result = applySandboxProfileBindingEditorRowChanges({
      rows: [OpenAiRow, GitHubRow],
      clientId: "row-openai",
      changes: {
        config: {
          model: {
            name: "gpt-5.2",
            reasoningEffort: "high",
          },
          tools: ["codex"],
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.[0]).toEqual({
      ...OpenAiRow,
      config: {
        model: {
          name: "gpt-5.2",
          reasoningEffort: "high",
        },
        tools: ["codex"],
      },
    });
    expect(result?.[1]).toBe(GitHubRow);
  });

  it("throws when no row matches the requested client id", () => {
    expect(() =>
      applySandboxProfileBindingEditorRowChanges({
        rows: [OpenAiRow, GitHubRow],
        clientId: "missing-row",
        changes: {
          connectionId: "connection-other",
        },
      }),
    ).toThrow("Sandbox profile integration row 'missing-row' was not found.");
  });
});
