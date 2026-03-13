import { describe, expect, it } from "vitest";

import {
  createInitialCodexServerRequestsState,
  reduceCodexServerRequestsState,
} from "./codex-server-requests-state.js";

describe("reduceCodexServerRequestsState", () => {
  it("captures command approval requests", () => {
    const state = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: 11,
        method: "item/commandExecution/requestApproval",
        params: {
          itemId: "cmd_1",
          threadId: "thread_1",
          turnId: "turn_1",
          reason: "Needs approval",
          command: "rm -rf /tmp/build",
          cwd: "/workspace",
          availableDecisions: ["accept", "decline", "cancel"],
          networkApprovalContext: {
            host: "example.com",
            protocol: "https",
            port: 443,
          },
        },
      },
    });

    expect(state.entries).toEqual([
      {
        requestId: 11,
        method: "item/commandExecution/requestApproval",
        kind: "command-approval",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "cmd_1",
        reason: "Needs approval",
        command: "rm -rf /tmp/build",
        cwd: "/workspace",
        availableDecisions: ["accept", "decline", "cancel"],
        networkHost: "example.com",
        networkProtocol: "https",
        networkPort: "443",
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("captures file change approval requests", () => {
    const state = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: "req_1",
        method: "item/fileChange/requestApproval",
        params: {
          itemId: "file_1",
          threadId: "thread_1",
          turnId: "turn_1",
          reason: "Write approval",
          grantRoot: "/workspace/src",
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        },
      },
    });

    expect(state.entries).toEqual([
      {
        requestId: "req_1",
        method: "item/fileChange/requestApproval",
        kind: "file-change-approval",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "file_1",
        reason: "Write approval",
        grantRoot: "/workspace/src",
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("uses protocol default file change decisions when the request omits them", () => {
    const state = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: "req_2",
        method: "item/fileChange/requestApproval",
        params: {
          itemId: "file_2",
          threadId: "thread_1",
          turnId: "turn_1",
          reason: "Write approval",
          grantRoot: "/workspace/src",
        },
      },
    });

    expect(state.entries).toEqual([
      {
        requestId: "req_2",
        method: "item/fileChange/requestApproval",
        kind: "file-change-approval",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "file_2",
        reason: "Write approval",
        grantRoot: "/workspace/src",
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("uses protocol default file change decisions when the request sends an empty list", () => {
    const state = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: "req_3",
        method: "item/fileChange/requestApproval",
        params: {
          itemId: "file_3",
          threadId: "thread_1",
          turnId: "turn_1",
          availableDecisions: [],
        },
      },
    });

    expect(state.entries).toEqual([
      {
        requestId: "req_3",
        method: "item/fileChange/requestApproval",
        kind: "file-change-approval",
        threadId: "thread_1",
        turnId: "turn_1",
        itemId: "file_3",
        reason: null,
        grantRoot: null,
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("captures tool/requestUserInput requests", () => {
    const state = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: 17,
        method: "tool/requestUserInput",
        params: {
          questions: [
            {
              header: "Choice",
              id: "q1",
              question: "Which option?",
              options: [
                {
                  label: "A",
                  description: "First option",
                  isOther: false,
                },
                {
                  label: "B",
                  isOther: true,
                },
              ],
            },
          ],
        },
      },
    });

    expect(state.entries).toEqual([
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
                description: "First option",
                isOther: false,
              },
              {
                label: "B",
                description: null,
                isOther: true,
              },
            ],
          },
        ],
        status: "pending",
        responseErrorMessage: null,
      },
    ]);
  });

  it("ignores unsupported server requests", () => {
    const state = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: 17,
        method: "tool/unsupported",
        params: {
          title: "Choose",
          questions: [{ id: "q1", question: "Which option?" }],
        },
      },
    });

    expect(state.entries).toEqual([]);
  });

  it("marks a request as responding and restores error state on response failure", () => {
    const pending = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: 11,
        method: "item/commandExecution/requestApproval",
        params: {
          itemId: "cmd_1",
          threadId: "thread_1",
          turnId: "turn_1",
        },
      },
    });

    const responding = reduceCodexServerRequestsState(pending, {
      type: "server_request_response_started",
      requestId: 11,
    });
    const failed = reduceCodexServerRequestsState(responding, {
      type: "server_request_response_failed",
      requestId: 11,
      errorMessage: "Socket closed.",
    });

    expect(responding.entries[0]).toMatchObject({
      requestId: 11,
      status: "responding",
      responseErrorMessage: null,
    });
    expect(failed.entries[0]).toMatchObject({
      requestId: 11,
      status: "pending",
      responseErrorMessage: "Socket closed.",
    });
  });

  it("removes a request when serverRequest/resolved arrives", () => {
    const pending = reduceCodexServerRequestsState(createInitialCodexServerRequestsState(), {
      type: "server_request_received",
      request: {
        id: 11,
        method: "item/commandExecution/requestApproval",
        params: {
          itemId: "cmd_1",
          threadId: "thread_1",
          turnId: "turn_1",
        },
      },
    });

    const resolved = reduceCodexServerRequestsState(pending, {
      type: "notification_received",
      notification: {
        method: "serverRequest/resolved",
        params: {
          requestId: 11,
        },
      },
    });

    expect(resolved.entries).toEqual([]);
  });
});
