import { describe, expect, it } from "vitest";

import {
  resolveCodexConnectionStateTransition,
  selectCodexConnectionThreadStrategy,
} from "./codex-session-lifecycle-policy.js";

describe("codex session lifecycle policy", () => {
  it("disconnects the transport when the connection closes or errors", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: false,
        isGatewayServiceRestart: false,
        state: "closed",
        errorMessage: null,
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: "The Codex session connection closed.",
      isGatewayServiceRestart: false,
      recoverableDisconnectMessage: null,
      recoverableDisconnectStrategy: null,
    });

    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: false,
        isGatewayServiceRestart: false,
        state: "error",
        errorMessage: "Socket failed.",
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: "Socket failed.",
      isGatewayServiceRestart: false,
      recoverableDisconnectMessage: null,
      recoverableDisconnectStrategy: null,
    });
  });

  it("surfaces connected-session transport loss as a recoverable disconnect", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: true,
        isGatewayServiceRestart: false,
        state: "closed",
        errorMessage: "Stream dropped.",
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: null,
      isGatewayServiceRestart: false,
      recoverableDisconnectMessage: "Stream dropped.",
      recoverableDisconnectStrategy: "reconnect_transport",
    });
  });

  it("uses the gateway restart message for recoverable service-restart websocket closes", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: true,
        isGatewayServiceRestart: true,
        state: "closed",
        errorMessage: "service_restart",
      }),
    ).toEqual({
      shouldDisconnectSession: true,
      lifecycleErrorMessage: null,
      isGatewayServiceRestart: true,
      recoverableDisconnectMessage: "Gateway service is restarting.",
      recoverableDisconnectStrategy: "reconnect_transport",
    });
  });

  it("does not disconnect the transport for non-terminal transport states", () => {
    expect(
      resolveCodexConnectionStateTransition({
        hasConnectedSession: false,
        isGatewayServiceRestart: false,
        state: "ready",
        errorMessage: null,
      }),
    ).toEqual({
      shouldDisconnectSession: false,
      lifecycleErrorMessage: null,
      isGatewayServiceRestart: false,
      recoverableDisconnectMessage: null,
      recoverableDisconnectStrategy: null,
    });
  });

  it("resumes the oldest created available thread", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        targetThreadId: null,
        availableThreads: [
          {
            id: "thread_old",
            name: null,
            preview: null,
            cwd: "/root",
            createdAt: 10,
            updatedAt: 10,
          },
          {
            id: "thread_new",
            name: null,
            preview: null,
            cwd: "/root",
            createdAt: 20,
            updatedAt: 20,
          },
        ],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_old",
    });
  });

  it("resumes the loaded thread even when it is missing from the available page", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        targetThreadId: null,
        availableThreads: [],
        loadedThreadIds: ["thread_loaded_only"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_loaded_only",
    });
  });

  it("prefers the explicit persisted thread binding when available", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        targetThreadId: "thread_persisted",
        availableThreads: [
          {
            id: "thread_persisted",
            name: null,
            preview: null,
            cwd: "/root",
            createdAt: 5,
            updatedAt: 5,
          },
          {
            id: "thread_old",
            name: null,
            preview: null,
            cwd: "/root",
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        loadedThreadIds: ["thread_loaded_only"],
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_persisted",
    });
  });

  it("starts a new thread when none exist yet", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        targetThreadId: null,
        availableThreads: [],
        loadedThreadIds: [],
      }),
    ).toEqual({
      type: "start_new",
    });
  });

  it("resumes the most recently updated available thread for post-cli restore selection", () => {
    expect(
      selectCodexConnectionThreadStrategy({
        targetThreadId: null,
        availableThreads: [
          {
            id: "thread_old_but_active",
            name: null,
            preview: null,
            cwd: "/root",
            createdAt: 10,
            updatedAt: 30,
          },
          {
            id: "thread_newer_but_stale",
            name: null,
            preview: null,
            cwd: "/root",
            createdAt: 20,
            updatedAt: 20,
          },
        ],
        loadedThreadIds: [],
        selectionPolicy: "most_recently_updated",
      }),
    ).toEqual({
      type: "resume",
      threadId: "thread_old_but_active",
    });
  });
});
