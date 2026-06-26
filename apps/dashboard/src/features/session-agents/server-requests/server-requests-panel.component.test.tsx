// @vitest-environment jsdom

import { systemSleeper } from "@mistle/time";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupTestQueryClients,
  createTestQueryClient,
} from "../../../test-support/query-client.js";
import { HttpApiError } from "../../api/http-api-error.js";
import type { ServerRequestEntry } from "./server-request-entries.js";
import { ServerRequestsPanel, shouldPollResourceSelectionQuery } from "./server-requests-panel.js";

type ResourceSelectionQuestion = Extract<
  ServerRequestEntry,
  { kind: "tool-user-input" }
>["questions"][number];

function seedResourceQuery(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  connectionId: string;
  search: string;
  handles: readonly string[];
}): void {
  input.queryClient.setQueryData(
    ["integration-connections", input.connectionId, "resources", "repository", input.search],
    {
      connectionId: input.connectionId,
      familyId: "github",
      kind: "repository",
      syncState: "ready",
      items: input.handles.map((handle) => ({
        id: `repo_${handle.replace(/[^a-zA-Z0-9]+/gu, "_")}`,
        familyId: "github",
        kind: "repository",
        handle,
        displayName: handle,
        status: "accessible",
        metadata: {},
      })),
    },
  );
}

function renderResourceSelectionRequest(input: {
  initialSelectedHandles: readonly string[];
  searchPlaceholder?: string | undefined;
  seed?: (queryClient: ReturnType<typeof createTestQueryClient>) => void;
}): { submittedResults: unknown[] } {
  const submittedResults: unknown[] = [];
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  input.seed?.(queryClient);

  const question: ResourceSelectionQuestion = {
    header: "Repositories",
    id: "github-review-repositories",
    inputKind: "integrationConnectionResourceMultiSelect",
    question: "Which GitHub repositories should this agent review?",
    resourceSelection: {
      connectionId: "icn_test_github",
      resourceKind: "repository",
      resourceLabelPlural: "repositories",
      ...(input.searchPlaceholder === undefined
        ? {}
        : { searchPlaceholder: input.searchPlaceholder }),
      initialSelectedHandles: input.initialSelectedHandles,
    },
  };

  render(
    <QueryClientProvider client={queryClient}>
      <ServerRequestsPanel
        entries={[
          {
            requestId: "resource-selection-request-1",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [question],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />
    </QueryClientProvider>,
  );

  return { submittedResults };
}

describe("ServerRequestsPanel", () => {
  afterEach(async () => {
    await cleanupTestQueryClients();
  });

  it("renders command approvals in the standalone panel when passed through", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: 11,
            method: "item/commandExecution/requestApproval",
            kind: "command-approval",
            threadId: "thread_1",
            turnId: "turn_1",
            itemId: "cmd_1",
            reason: "Needs approval",
            command: "rm -rf /tmp/build",
            cwd: "/root",
            availableDecisions: ["accept", "decline"],
            networkHost: null,
            networkProtocol: null,
            networkPort: null,
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "accept" }));

    expect(submittedResults).toEqual([
      {
        decision: "accept",
      },
    ]);
  });

  it("collects tool/requestUserInput answers before submitting", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: 17,
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Choice",
                id: "q1",
                question: "Which option?",
                options: [
                  {
                    label: "A",
                    isOther: false,
                  },
                  {
                    label: "Other",
                    isOther: true,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.queryByText("Choice")).toBeNull();
    expect(screen.getByText("Which option?").textContent).toBe("Which option?");
    expect(screen.queryByText("First option")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: {
        value: "Custom answer",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submittedResults).toEqual([
      {
        answers: [
          {
            id: "q1",
            value: "Custom answer",
          },
        ],
      },
    ]);
  });

  it("cancels tool/requestUserInput requests without submitting answers", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: 17,
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Choice",
                id: "q1",
                question: "Which option?",
                options: [
                  {
                    label: "Other",
                    isOther: true,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(submittedResults).toEqual([
      {
        decision: "cancel",
      },
    ]);
  });

  it("renders short selectable user input options as numbered rows", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "triage-source-choice-request-1",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Intake source",
                id: "triage-source-choice",
                question: "What should the triaging agent watch first?",
                options: [
                  {
                    label: "GitHub issues/PRs",
                    isOther: false,
                  },
                  {
                    label: "Slack messages",
                    isOther: false,
                  },
                  {
                    label: "Support tickets",
                    isOther: false,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByText("What should the triaging agent watch first?").textContent).toBe(
      "What should the triaging agent watch first?",
    );
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByText("1").textContent).toBe("1");
    expect(screen.getByText("2").textContent).toBe("2");
    expect(screen.getByText("3").textContent).toBe("3");
    expect(screen.getByRole("button", { name: "Cancel" }).textContent).toBe("Cancel");

    fireEvent.click(screen.getByRole("button", { name: /Slack messages/u }));

    expect(submittedResults).toEqual([
      {
        answers: [
          {
            id: "triage-source-choice",
            value: "Slack messages",
          },
        ],
      },
    ]);
  });

  it("cancels selectable tool/requestUserInput requests from the top-right action", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "triage-source-choice-request-1",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Intake source",
                id: "triage-source-choice",
                question: "What should the triaging agent watch first?",
                options: [
                  {
                    label: "GitHub issues/PRs",
                    isOther: false,
                  },
                  {
                    label: "Slack messages",
                    isOther: false,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(submittedResults).toEqual([
      {
        decision: "cancel",
      },
    ]);
  });

  it("renders long selectable user input options as numbered rows", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "next-action-request-1",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Suggested next actions",
                id: "next-action",
                question: "What should Designer do next?",
                options: [
                  {
                    label: "Stop all sequences - let's start fresh with new messaging",
                    isOther: false,
                  },
                  {
                    label:
                      "Don't stop yet - show me who accepted my LinkedIn connection so I can follow up manually",
                    isOther: false,
                  },
                  {
                    label:
                      "Keep the sequences running - I want to workshop new copy first, then update",
                    isOther: false,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.queryByText("Suggested next actions")).toBeNull();
    expect(screen.getByText("What should Designer do next?").textContent).toBe(
      "What should Designer do next?",
    );
    expect(screen.queryByText("User input requested")).toBeNull();
    expect(screen.queryByText("Input needed")).toBeNull();
    expect(screen.queryByText("tool/requestUserInput")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(screen.getByText("1").textContent).toBe("1");
    expect(
      screen.queryByText("Keeps outreach active while surfacing manual follow-up targets."),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Don't stop yet - show me who accepted my LinkedIn connection/u,
      }),
    );

    expect(submittedResults).toEqual([
      {
        answers: [
          {
            id: "next-action",
            value:
              "Don't stop yet - show me who accepted my LinkedIn connection so I can follow up manually",
          },
        ],
      },
    ]);
  });

  it("submits a prefilled multiline user input answer unchanged", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "editor-request-1",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: "Pi",
                id: "editor",
                question: "Edit instructions",
                options: [
                  {
                    label: "Response",
                    defaultValue: "Keep this text",
                    inputKind: "textarea",
                    isOther: true,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByDisplayValue("Keep this text")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(submittedResults).toEqual([
      {
        answers: [
          {
            id: "editor",
            value: "Keep this text",
          },
        ],
      },
    ]);
  });

  it("submits empty resource selection answers", async () => {
    const { submittedResults } = renderResourceSelectionRequest({
      initialSelectedHandles: [],
      seed: (queryClient) => {
        seedResourceQuery({
          queryClient,
          connectionId: "icn_test_github",
          search: "",
          handles: [],
        });
      },
    });

    const submitButton = screen.getByRole("button", { name: "Submit" });
    await waitFor(() => {
      expect(submitButton.getAttribute("disabled")).toBeNull();
    });
    fireEvent.click(submitButton);

    expect(submittedResults).toEqual([
      {
        answers: [
          {
            id: "github-review-repositories",
            value: [],
          },
        ],
      },
    ]);
  });

  it("keeps resource selection answers disabled while selected resources are unavailable", () => {
    const { submittedResults } = renderResourceSelectionRequest({
      initialSelectedHandles: ["mistle/private-internal-tools"],
      seed: (queryClient) => {
        seedResourceQuery({
          queryClient,
          connectionId: "icn_test_github",
          search: "",
          handles: [],
        });
      },
    });

    const submitButton = screen.getByRole("button", { name: "Submit" });
    expect(submitButton.getAttribute("disabled")).toBe("");
    fireEvent.click(submitButton);

    expect(submittedResults).toEqual([]);
  });

  it("keeps unavailable resource selections disabled while searching", async () => {
    const { submittedResults } = renderResourceSelectionRequest({
      initialSelectedHandles: ["mistle/private-internal-tools"],
      searchPlaceholder: "Search repositories",
      seed: (queryClient) => {
        seedResourceQuery({
          queryClient,
          connectionId: "icn_test_github",
          search: "",
          handles: [],
        });
        seedResourceQuery({
          queryClient,
          connectionId: "icn_test_github",
          search: "mistle",
          handles: [],
        });
      },
    });

    fireEvent.change(
      screen.getByRole("combobox", {
        name: "Which GitHub repositories should this agent review?",
      }),
      {
        target: {
          value: "mistle",
        },
      },
    );
    await systemSleeper.sleep(350);

    const submitButton = screen.getByRole("button", { name: "Submit" });
    expect(submitButton.getAttribute("disabled")).toBe("");
    fireEvent.click(submitButton);

    expect(submittedResults).toEqual([]);
  });

  it("keeps first-time resource sync polling from refresh through in-progress conflicts until resources are ready", () => {
    const syncRequiredError = new HttpApiError({
      operation: "listIntegrationConnectionResources",
      status: 409,
      body: {
        code: "RESOURCE_SYNC_REQUIRED",
        message: "Resource sync is required before resources can be listed.",
      },
      code: "RESOURCE_SYNC_REQUIRED",
      message: "Resource sync is required before resources can be listed.",
    });
    const syncInProgressError = new HttpApiError({
      operation: "listIntegrationConnectionResources",
      status: 409,
      body: {
        code: "RESOURCE_SYNC_IN_PROGRESS",
        message: "Resource sync is still in progress.",
      },
      code: "RESOURCE_SYNC_IN_PROGRESS",
      message: "Resource sync is still in progress.",
    });

    expect(
      shouldPollResourceSelectionQuery({
        data: undefined,
        error: syncRequiredError,
        refreshHasStartedSync: false,
      }),
    ).toBe(false);
    expect(
      shouldPollResourceSelectionQuery({
        data: undefined,
        error: syncRequiredError,
        refreshHasStartedSync: true,
      }),
    ).toBe(true);
    expect(
      shouldPollResourceSelectionQuery({
        data: undefined,
        error: syncInProgressError,
        refreshHasStartedSync: false,
      }),
    ).toBe(true);
    expect(
      shouldPollResourceSelectionQuery({
        data: {
          connectionId: "icn_test_github",
          familyId: "github",
          kind: "repository",
          syncState: "ready",
          items: [],
        },
        error: null,
        refreshHasStartedSync: true,
      }),
    ).toBe(false);
  });

  it("renders OpenCode permission requests in the standalone panel", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "permission-1",
            method: "opencode/permission/requestApproval",
            kind: "opencode-permission",
            sessionId: "session-1",
            permission: "bash",
            patterns: ["pnpm test"],
            availableDecisions: ["once", "always", "reject"],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByText("OpenCode permission").textContent).toBe("OpenCode permission");
    expect(screen.getByText("bash: pnpm test").textContent).toBe("bash: pnpm test");

    fireEvent.click(screen.getByRole("button", { name: "once" }));

    expect(submittedResults).toEqual([
      {
        decision: "once",
      },
    ]);
  });

  it("renders Claude Code permission requests in the standalone panel", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "permission-1",
            method: "claude-code/permission/requestApproval",
            kind: "claude-code-permission",
            sessionId: "session-1",
            toolName: "Bash",
            toolInputJson: '{\n  "command": "pnpm test"\n}',
            availableDecisions: ["once", "reject"],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByText("Claude Code permission").textContent).toBe("Claude Code permission");
    expect(screen.getByText("Bash").textContent).toBe("Bash");
    expect(screen.getByText(/pnpm test/u).textContent).toContain("pnpm test");

    fireEvent.click(screen.getByRole("button", { name: "reject" }));

    expect(submittedResults).toEqual([
      {
        decision: "reject",
      },
    ]);
  });

  it("renders Pi confirmation requests in the standalone panel", () => {
    const submittedResults: unknown[] = [];

    render(
      <ServerRequestsPanel
        entries={[
          {
            requestId: "pi-confirm-1",
            method: "pi/extensionUi/confirm",
            kind: "pi-extension-ui-confirm",
            title: "Run command?",
            message: "Allow Pi to run pnpm test?",
            availableDecisions: ["confirm", "cancel"],
            status: "pending",
            responseErrorMessage: null,
          },
        ]}
        isRespondingToServerRequest={false}
        onRespondToServerRequest={(_requestId, result) => {
          submittedResults.push(result);
        }}
      />,
    );

    expect(screen.getByText("Pi confirmation").textContent).toBe("Pi confirmation");
    expect(screen.getByText("Allow Pi to run pnpm test?").textContent).toBe(
      "Allow Pi to run pnpm test?",
    );

    fireEvent.click(screen.getByRole("button", { name: "confirm" }));

    expect(submittedResults).toEqual([
      {
        decision: "confirm",
      },
    ]);
  });
});
