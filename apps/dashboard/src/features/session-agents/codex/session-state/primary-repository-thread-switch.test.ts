import { describe, expect, it } from "vitest";

import {
  resolvePrimaryRepositoryThreadSwitchAction,
  resolvePrimaryRepositoryThreadSwitchCwd,
} from "./primary-repository-thread-switch.js";

describe("resolvePrimaryRepositoryThreadSwitchCwd", () => {
  it("uses the selected repository path when present", () => {
    expect(
      resolvePrimaryRepositoryThreadSwitchCwd({
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toBe("/root/acme/repo-2");
  });

  it("uses the workspace root when no repository is selected", () => {
    expect(
      resolvePrimaryRepositoryThreadSwitchCwd({
        selectedRepositoryPath: null,
      }),
    ).toBe("/root");
  });
});

describe("resolvePrimaryRepositoryThreadSwitchAction", () => {
  it("reuses the most recently updated matching thread", () => {
    expect(
      resolvePrimaryRepositoryThreadSwitchAction({
        matchingThreads: [
          {
            createdAt: 10,
            cwd: "/root/acme/repo-2",
            id: "thread_older",
            name: null,
            preview: null,
            updatedAt: 25,
          },
          {
            createdAt: 12,
            cwd: "/root/acme/repo-2",
            id: "thread_newer",
            name: null,
            preview: null,
            updatedAt: 30,
          },
        ],
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toEqual({
      type: "resume_existing_thread",
      threadId: "thread_newer",
    });
  });

  it("falls back to createdAt when updatedAt is missing", () => {
    expect(
      resolvePrimaryRepositoryThreadSwitchAction({
        matchingThreads: [
          {
            createdAt: 10,
            cwd: "/root/acme/repo-2",
            id: "thread_older",
            name: null,
            preview: null,
            updatedAt: null,
          },
          {
            createdAt: 12,
            cwd: "/root/acme/repo-2",
            id: "thread_newer",
            name: null,
            preview: null,
            updatedAt: null,
          },
        ],
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toEqual({
      type: "resume_existing_thread",
      threadId: "thread_newer",
    });
  });

  it("starts a new thread when there is no matching thread", () => {
    expect(
      resolvePrimaryRepositoryThreadSwitchAction({
        matchingThreads: [],
        selectedRepositoryPath: "/root/acme/repo-2",
      }),
    ).toEqual({
      cwd: "/root/acme/repo-2",
      type: "start_new_thread",
    });
  });

  it("starts a workspace-root thread when None is selected and no match exists", () => {
    expect(
      resolvePrimaryRepositoryThreadSwitchAction({
        matchingThreads: [],
        selectedRepositoryPath: null,
      }),
    ).toEqual({
      cwd: "/root",
      type: "start_new_thread",
    });
  });
});
