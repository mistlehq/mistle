import type {
  OpenCodeEvent,
  OpenCodeMessageWithParts,
  OpenCodePermissionRequest,
} from "@mistle/integrations-definitions/agent-runtimes/opencode/client";
import { describe, expect, it } from "vitest";

import { formatSemanticChatDetail } from "../../../chat/chat-semantic-projection.js";
import { createInitialOpenCodeChatState, reduceOpenCodeChatState } from "./opencode-chat-state.js";

describe("reduceOpenCodeChatState", () => {
  it("hydrates persisted user and assistant messages into chat entries", () => {
    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Please update the docs",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              id: "part_reasoning",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: "I will inspect the repo.",
              time: {
                start: 2,
                end: 3,
              },
              type: "reasoning",
            },
            {
              id: "part_text",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: "Updated the docs.",
              time: {
                start: 4,
                end: 5,
              },
              type: "text",
            },
          ],
        }),
      ],
    });

    expect(state.entries).toMatchObject([
      {
        id: "msg_user",
        kind: "user-message",
        text: "Please update the docs",
        turnId: "msg_user",
      },
      {
        id: "msg_user:thinking:part_reasoning",
        kind: "semantic-group",
        semanticKind: "thinking",
        turnId: "msg_user",
        items: [
          {
            id: "part_reasoning",
            label: "Thought",
            detail: "I will inspect the repo.",
            output: "I will inspect the repo.",
            sourceKind: "reasoning",
          },
        ],
      },
      {
        id: "part_text",
        kind: "assistant-message",
        text: "Updated the docs.",
        turnId: "msg_user",
      },
    ]);
  });

  it("preserves full OpenCode reasoning text beyond the compact row detail", () => {
    const fullReasoningText = [
      "I will inspect the repository structure, compare the current OpenCode projection against the shared semantic renderer contract,",
      "and then preserve the full reasoning body inside the expandable semantic output.",
    ].join(" ");

    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Please update the docs",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              id: "part_reasoning",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: fullReasoningText,
              time: {
                start: 2,
                end: 3,
              },
              type: "reasoning",
            },
          ],
        }),
      ],
    });

    expect(state.entries).toContainEqual(
      expect.objectContaining({
        id: "msg_user:thinking:part_reasoning",
        kind: "semantic-group",
        semanticKind: "thinking",
        items: [
          expect.objectContaining({
            id: "part_reasoning",
            detail: formatSemanticChatDetail({
              detail: fullReasoningText,
              maxLength: 88,
            }),
            output: fullReasoningText,
          }),
        ],
      }),
    );
  });

  it("suppresses OpenCode placeholder reasoning parts before semantic grouping", () => {
    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Please update the docs",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: ["", "[]", "{}", "null"].map((text, index) => ({
            id: `part_reasoning_${String(index)}`,
            messageID: "msg_assistant",
            sessionID: "ses_test",
            text,
            time: {
              start: index + 2,
              end: index + 3,
            },
            type: "reasoning" as const,
          })),
        }),
      ],
    });

    expect(state.entries).toEqual([
      expect.objectContaining({
        id: "msg_user",
        kind: "user-message",
      }),
    ]);
  });

  it("applies text deltas and part updates by OpenCode ids", () => {
    const hydrated = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Build it",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              id: "part_text",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: "He",
              time: {
                start: 1,
              },
              type: "text",
            },
          ],
        }),
      ],
    });

    const deltaApplied = reduceOpenCodeChatState(hydrated, {
      type: "event_received",
      event: createEvent({
        id: "evt_delta",
        type: "message.part.delta",
        properties: {
          sessionID: "ses_test",
          messageID: "msg_assistant",
          partID: "part_text",
          field: "text",
          delta: "llo",
        },
      }),
    });
    expect(deltaApplied.entries).toContainEqual(
      expect.objectContaining({
        id: "part_text",
        kind: "assistant-message",
        text: "Hello",
        status: "completed",
      }),
    );

    const updated = reduceOpenCodeChatState(deltaApplied, {
      type: "event_received",
      event: createEvent({
        id: "evt_update",
        type: "message.part.updated",
        properties: {
          sessionID: "ses_test",
          time: 2,
          part: {
            id: "part_text",
            messageID: "msg_assistant",
            sessionID: "ses_test",
            text: "Hello world",
            time: {
              start: 1,
              end: 2,
            },
            type: "text",
          },
        },
      }),
    });

    expect(updated.entries).toContainEqual(
      expect.objectContaining({
        id: "part_text",
        kind: "assistant-message",
        text: "Hello world",
        status: "completed",
      }),
    );
  });

  it("groups OpenCode shell tools and keeps unknown tools visible as generic items", () => {
    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Run tests",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              callID: "call_bash",
              id: "part_bash",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              state: {
                input: {
                  command: "pnpm test",
                  cwd: "/workspace",
                },
                metadata: {},
                output: "passed",
                status: "completed",
                time: {
                  start: 1,
                  end: 2,
                },
                title: "Run tests",
              },
              tool: "bash",
              type: "tool",
            },
            {
              callID: "call_custom",
              id: "part_custom",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              state: {
                error: "tool failed",
                input: {},
                status: "error",
                time: {
                  start: 3,
                  end: 4,
                },
              },
              tool: "custom_tool",
              type: "tool",
            },
          ],
        }),
      ],
    });

    expect(state.entries).toContainEqual(
      expect.objectContaining({
        id: "msg_user:running-commands:part_bash",
        kind: "semantic-group",
        semanticKind: "running-commands",
        status: "completed",
        items: [
          expect.objectContaining({
            id: "part_bash",
            sourceKind: "command-execution",
            label: "Command",
            detail: "pnpm test",
            command: "pnpm test",
            output: "passed",
            status: "completed",
          }),
        ],
      }),
    );
    expect(state.entries).toContainEqual(
      expect.objectContaining({
        id: "part_custom",
        kind: "generic-item",
        itemType: "opencode-tool",
        body: "tool failed",
      }),
    );
  });

  it("groups adjacent OpenCode semantic tools by semantic kind", () => {
    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Update the docs",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              callID: "call_read",
              id: "part_read",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              state: {
                input: {
                  filePath: "README.md",
                },
                metadata: {},
                output: "old docs",
                status: "completed",
                time: {
                  start: 1,
                  end: 2,
                },
                title: "Read README.md",
              },
              tool: "read",
              type: "tool",
            },
            {
              callID: "call_edit",
              id: "part_edit",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              state: {
                input: {
                  filePath: "README.md",
                },
                metadata: {
                  diff: [
                    "--- a/README.md",
                    "+++ b/README.md",
                    "@@ -1 +1 @@",
                    "-old docs",
                    "+new docs",
                  ].join("\n"),
                },
                output: "Edit applied successfully.",
                status: "completed",
                time: {
                  start: 3,
                  end: 4,
                },
                title: "Edit README.md",
              },
              tool: "edit",
              type: "tool",
            },
          ],
        }),
      ],
    });

    expect(state.entries).toEqual([
      expect.objectContaining({
        id: "msg_user",
        kind: "user-message",
      }),
      expect.objectContaining({
        id: "msg_user:exploring:part_read",
        kind: "semantic-group",
        semanticKind: "exploring",
        counts: {
          reads: 1,
          searches: 0,
          lists: 0,
        },
        items: [
          expect.objectContaining({
            id: "part_read",
            label: "Read",
            detail: "README.md",
            sourcePath: "README.md",
            output: "old docs",
          }),
        ],
      }),
      expect.objectContaining({
        id: "msg_user:making-edits:part_edit",
        kind: "semantic-group",
        semanticKind: "making-edits",
        items: [
          expect.objectContaining({
            id: "part_edit",
            label: "File change",
            detail: "README.md",
            output: [
              "--- a/README.md",
              "+++ b/README.md",
              "@@ -1 +1 @@",
              "-old docs",
              "+new docs",
            ].join("\n"),
          }),
        ],
      }),
    ]);
  });

  it("keeps OpenCode edit status text generic when no diff metadata is available", () => {
    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createUserMessage({
          id: "msg_user",
          text: "Update the docs",
        }),
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              callID: "call_edit",
              id: "part_edit",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              state: {
                input: {
                  filePath: "README.md",
                },
                metadata: {},
                output: "Edit applied successfully.",
                status: "completed",
                time: {
                  start: 1,
                  end: 2,
                },
                title: "Edit README.md",
              },
              tool: "edit",
              type: "tool",
            },
          ],
        }),
      ],
    });

    expect(state.entries).toContainEqual(
      expect.objectContaining({
        id: "part_edit",
        kind: "generic-item",
        itemType: "opencode-tool",
        title: "edit",
        body: "Edit applied successfully.",
      }),
    );
    expect(state.entries).not.toContainEqual(
      expect.objectContaining({
        semanticKind: "making-edits",
      }),
    );
  });

  it("surfaces session errors and clears running state on idle", () => {
    const busy = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "event_received",
      event: createEvent({
        id: "evt_busy",
        type: "session.status",
        properties: {
          sessionID: "ses_test",
          status: {
            type: "busy",
          },
        },
      }),
    });
    expect(busy.status).toBe("busy");

    const failed = reduceOpenCodeChatState(busy, {
      type: "event_received",
      event: createEvent({
        id: "evt_error",
        type: "session.error",
        properties: {
          sessionID: "ses_test",
          error: {
            name: "UnknownError",
            data: {
              message: "provider failed",
            },
          },
        },
      }),
    });
    expect(failed.status).toBe("failed");
    expect(failed.completedErrorMessage).toBe("provider failed");

    const idle = reduceOpenCodeChatState(failed, {
      type: "event_received",
      event: createEvent({
        id: "evt_idle",
        type: "session.idle",
        properties: {
          sessionID: "ses_test",
        },
      }),
    });
    expect(idle.status).toBe("idle");
  });

  it("keeps retrying sessions in progress", () => {
    const retrying = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "event_received",
      event: createEvent({
        id: "evt_retry",
        type: "session.status",
        properties: {
          sessionID: "ses_test",
          status: {
            type: "retry",
            attempt: 1,
            message: "retrying provider request",
            next: 123,
          },
        },
      }),
    });

    expect(retrying.status).toBe("busy");
  });

  it("surfaces permission requests and removes them when replied", () => {
    const asked = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "event_received",
      event: createEvent({
        id: "evt_permission",
        type: "permission.asked",
        properties: {
          id: "perm_test",
          sessionID: "ses_test",
          permission: "bash",
          patterns: ["pnpm test"],
          metadata: {},
          always: [],
        },
      }),
    });
    expect(asked.pendingPermissions).toHaveLength(1);
    expect(asked.entries).toContainEqual(
      expect.objectContaining({
        id: "permission:perm_test",
        kind: "generic-item",
        itemType: "opencode-permission",
        title: "Permission requested",
      }),
    );

    const replied = reduceOpenCodeChatState(asked, {
      type: "event_received",
      event: createEvent({
        id: "evt_permission_replied",
        type: "permission.replied",
        properties: {
          sessionID: "ses_test",
          requestID: "perm_test",
          reply: "once",
        },
      }),
    });
    expect(replied.pendingPermissions).toEqual([]);
    expect(replied.entries).not.toContainEqual(
      expect.objectContaining({
        id: "permission:perm_test",
      }),
    );
  });

  it("clears session-scoped state when hydrating another session", () => {
    const staleBusyPermissionState = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "event_received",
      event: createEvent({
        id: "evt_permission",
        type: "permission.asked",
        properties: {
          id: "perm_stale",
          sessionID: "ses_old",
          permission: "bash",
          patterns: ["pnpm test"],
          metadata: {},
          always: [],
        },
      }),
    });
    const staleFailedState = reduceOpenCodeChatState(staleBusyPermissionState, {
      type: "event_received",
      event: createEvent({
        id: "evt_error",
        type: "session.error",
        properties: {
          sessionID: "ses_old",
          error: {
            name: "UnknownError",
            data: {
              message: "stale error",
            },
          },
        },
      }),
    });

    const hydrated = reduceOpenCodeChatState(staleFailedState, {
      type: "hydrate_messages",
      sessionId: "ses_new",
      messages: [
        createUserMessage({
          id: "msg_new",
          text: "New session prompt",
        }),
      ],
    });

    expect(hydrated.sessionId).toBe("ses_new");
    expect(hydrated.pendingPermissions).toEqual([]);
    expect(hydrated.completedErrorMessage).toBeNull();
    expect(hydrated.status).toBeNull();
    expect(hydrated.entries).not.toContainEqual(
      expect.objectContaining({
        id: "permission:perm_stale",
      }),
    );
  });

  it("applies buffered events after hydrating message snapshots", () => {
    const hydrated = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              id: "part_text",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: "He",
              time: {
                start: 1,
              },
              type: "text",
            },
          ],
        }),
      ],
      bufferedEvents: [
        createEvent({
          id: "evt_delta",
          type: "message.part.delta",
          properties: {
            sessionID: "ses_test",
            messageID: "msg_assistant",
            partID: "part_text",
            field: "text",
            delta: "llo",
          },
        }),
        createEvent({
          id: "evt_permission",
          type: "permission.asked",
          properties: {
            id: "perm_buffered",
            sessionID: "ses_test",
            permission: "bash",
            patterns: ["pnpm test"],
            metadata: {},
            always: [],
          },
        }),
      ],
    });

    expect(hydrated.entries).toContainEqual(
      expect.objectContaining({
        id: "part_text",
        kind: "assistant-message",
        text: "Hello",
      }),
    );
    expect(hydrated.pendingPermissions).toEqual([
      expect.objectContaining({
        id: "perm_buffered",
      }),
    ]);
  });

  it("hydrates permissions that were already pending before event subscription", () => {
    const hydrated = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [],
      pendingPermissions: [
        createPermissionRequest({
          id: "perm_existing",
          sessionId: "ses_test",
        }),
        createPermissionRequest({
          id: "perm_other_session",
          sessionId: "ses_other",
        }),
      ],
    });

    expect(hydrated.pendingPermissions).toEqual([
      expect.objectContaining({
        id: "perm_existing",
        sessionID: "ses_test",
      }),
    ]);
    expect(hydrated.entries).toContainEqual(
      expect.objectContaining({
        id: "permission:perm_existing",
        kind: "generic-item",
        itemType: "opencode-permission",
      }),
    );
  });

  it("ignores live and buffered events for other OpenCode sessions", () => {
    const hydrated = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              id: "part_text",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: "He",
              time: {
                start: 1,
              },
              type: "text",
            },
          ],
        }),
      ],
      bufferedEvents: [
        createEvent({
          id: "evt_other_status",
          type: "session.status",
          properties: {
            sessionID: "ses_other",
            status: {
              type: "busy",
            },
          },
        }),
        createEvent({
          id: "evt_other_permission",
          type: "permission.asked",
          properties: createPermissionRequest({
            id: "perm_other",
            sessionId: "ses_other",
          }),
        }),
      ],
    });

    const afterOtherSessionDelta = reduceOpenCodeChatState(hydrated, {
      type: "event_received",
      event: createEvent({
        id: "evt_other_delta",
        type: "message.part.delta",
        properties: {
          sessionID: "ses_other",
          messageID: "msg_assistant",
          partID: "part_text",
          field: "text",
          delta: "llo",
        },
      }),
    });

    expect(afterOtherSessionDelta.sessionId).toBe("ses_test");
    expect(afterOtherSessionDelta.status).toBeNull();
    expect(afterOtherSessionDelta.pendingPermissions).toEqual([]);
    expect(afterOtherSessionDelta.entries).toContainEqual(
      expect.objectContaining({
        id: "part_text",
        kind: "assistant-message",
        text: "He",
      }),
    );
  });

  it("throws explicit errors for unsupported critical deltas", () => {
    const state = reduceOpenCodeChatState(createInitialOpenCodeChatState(), {
      type: "hydrate_messages",
      sessionId: "ses_test",
      messages: [
        createAssistantMessage({
          id: "msg_assistant",
          parentId: "msg_user",
          parts: [
            {
              id: "part_text",
              messageID: "msg_assistant",
              sessionID: "ses_test",
              text: "hello",
              time: {
                start: 1,
              },
              type: "text",
            },
          ],
        }),
      ],
    });

    expect(() =>
      reduceOpenCodeChatState(state, {
        type: "event_received",
        event: createEvent({
          id: "evt_delta",
          type: "message.part.delta",
          properties: {
            sessionID: "ses_test",
            messageID: "msg_assistant",
            partID: "part_text",
            field: "unsupported",
            delta: "x",
          },
        }),
      }),
    ).toThrow("OpenCode part delta field 'unsupported' is not supported.");
  });
});

function createEvent(payload: OpenCodeEvent["payload"]): OpenCodeEvent {
  return {
    directory: "/workspace",
    payload,
  };
}

function createPermissionRequest(input: {
  id: string;
  sessionId: string;
}): OpenCodePermissionRequest {
  return {
    id: input.id,
    sessionID: input.sessionId,
    permission: "bash",
    patterns: ["pnpm test"],
    metadata: {},
    always: [],
  };
}

function createUserMessage(input: { id: string; text: string }): OpenCodeMessageWithParts {
  return {
    info: {
      agent: "build",
      id: input.id,
      model: {
        modelID: "gpt-5",
        providerID: "openai",
      },
      role: "user",
      sessionID: "ses_test",
      time: {
        created: 1,
      },
    },
    parts: [
      {
        id: `${input.id}_part`,
        messageID: input.id,
        sessionID: "ses_test",
        text: input.text,
        type: "text",
      },
    ],
  };
}

function createAssistantMessage(input: {
  id: string;
  parentId: string;
  parts: OpenCodeMessageWithParts["parts"];
}): OpenCodeMessageWithParts {
  return {
    info: {
      agent: "build",
      cost: 0,
      id: input.id,
      mode: "build",
      modelID: "gpt-5",
      parentID: input.parentId,
      path: {
        cwd: "/workspace",
        root: "/workspace",
      },
      providerID: "openai",
      role: "assistant",
      sessionID: "ses_test",
      time: {
        created: 2,
      },
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    },
    parts: input.parts,
  };
}
