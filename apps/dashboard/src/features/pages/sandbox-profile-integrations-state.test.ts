import { describe, expect, it } from "vitest";

import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import {
  applySandboxProfileBindingEditorRowChanges,
  reconcileBindingsToEditorRows,
} from "./sandbox-profile-integrations-state.js";

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

function editorRow(input: {
  clientId: string;
  id?: string;
  connectionId: string;
  kind: SandboxProfileBindingEditorRow["kind"];
  config: Record<string, unknown>;
}): SandboxProfileBindingEditorRow {
  return {
    clientId: input.clientId,
    ...(input.id === undefined ? {} : { id: input.id }),
    connectionId: input.connectionId,
    kind: input.kind,
    config: input.config,
  };
}

function submittedBinding(input: {
  id?: string;
  clientRef: string;
  connectionId: string;
  kind: SandboxProfileBindingEditorRow["kind"];
  config: Record<string, unknown>;
}): Parameters<typeof reconcileBindingsToEditorRows>[0]["submittedBindings"][number] {
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    clientRef: input.clientRef,
    connectionId: input.connectionId,
    kind: input.kind,
    config: input.config,
  };
}

function persistedBinding(input: {
  id: string;
  connectionId: string;
  kind: SandboxProfileBindingEditorRow["kind"];
  config: Record<string, unknown>;
}): Parameters<typeof reconcileBindingsToEditorRows>[0]["bindings"][number] {
  return input;
}

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

  it("keeps the client id for returned persisted rows that already exist", () => {
    const result = reconcileBindingsToEditorRows({
      currentRows: [OpenAiRow, GitHubRow],
      submittedBindings: [
        submittedBinding({
          id: "binding-openai",
          clientRef: "row-openai",
          connectionId: "connection-openai-updated",
          kind: "agent",
          config: {},
        }),
      ],
      bindings: [
        persistedBinding({
          id: "binding-openai",
          connectionId: "connection-openai-updated",
          kind: "agent",
          config: {
            model: {
              name: "gpt-5.2",
              reasoningEffort: "high",
            },
          },
        }),
      ],
    });

    expect(result).toEqual([
      {
        clientId: "row-openai",
        id: "binding-openai",
        connectionId: "connection-openai-updated",
        kind: "agent",
        config: {
          model: {
            name: "gpt-5.2",
            reasoningEffort: "high",
          },
        },
      },
    ]);
  });

  it("keeps the draft client id for newly persisted rows after their first save", () => {
    const result = reconcileBindingsToEditorRows({
      currentRows: [
        editorRow({
          clientId: "row-linear-draft",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
      ],
      submittedBindings: [
        submittedBinding({
          clientRef: "row-linear-draft",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
      ],
      bindings: [
        persistedBinding({
          id: "binding-linear",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
      ],
    });

    expect(result).toEqual([
      {
        clientId: "row-linear-draft",
        id: "binding-linear",
        connectionId: "connection-linear",
        kind: "connector",
        config: {
          tools: ["issues"],
        },
      },
    ]);
  });

  it("matches multiple newly persisted rows by submitted values when response order differs", () => {
    const result = reconcileBindingsToEditorRows({
      currentRows: [
        editorRow({
          clientId: "row-linear-draft",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
        editorRow({
          clientId: "row-jira-draft",
          connectionId: "connection-jira",
          kind: "connector",
          config: {
            tools: ["tickets"],
          },
        }),
      ],
      submittedBindings: [
        submittedBinding({
          clientRef: "row-linear-draft",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
        submittedBinding({
          clientRef: "row-jira-draft",
          connectionId: "connection-jira",
          kind: "connector",
          config: {
            tools: ["tickets"],
          },
        }),
      ],
      bindings: [
        persistedBinding({
          id: "binding-jira",
          connectionId: "connection-jira",
          kind: "connector",
          config: {
            tools: ["tickets"],
          },
        }),
        persistedBinding({
          id: "binding-linear",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
      ],
    });

    expect(result.map((row) => row.clientId)).toEqual(["row-jira-draft", "row-linear-draft"]);
  });

  it("assigns a new client id to returned rows that cannot be matched", () => {
    const result = reconcileBindingsToEditorRows({
      currentRows: [OpenAiRow],
      submittedBindings: [],
      bindings: [
        persistedBinding({
          id: "binding-linear",
          connectionId: "connection-linear",
          kind: "connector",
          config: {
            tools: ["issues"],
          },
        }),
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.clientId).toMatch(/^binding-\d+$/);
    expect(result[0]).toMatchObject({
      id: "binding-linear",
      connectionId: "connection-linear",
      kind: "connector",
      config: {
        tools: ["issues"],
      },
    });
  });

  it("omits current rows that are missing from the returned persisted bindings", () => {
    const result = reconcileBindingsToEditorRows({
      currentRows: [OpenAiRow, GitHubRow],
      submittedBindings: [
        submittedBinding({
          id: "binding-github",
          clientRef: "row-github",
          connectionId: "connection-github",
          kind: "git",
          config: {
            repositories: ["mistle"],
          },
        }),
      ],
      bindings: [
        persistedBinding({
          id: "binding-github",
          connectionId: "connection-github",
          kind: "git",
          config: {
            repositories: ["mistle"],
          },
        }),
      ],
    });

    expect(result).toEqual([GitHubRow]);
  });
});
