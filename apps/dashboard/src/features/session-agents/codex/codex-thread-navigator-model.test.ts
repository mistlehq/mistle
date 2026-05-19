import { describe, expect, it } from "vitest";

import {
  projectCodexThreadNavigatorRows,
  resolveDefaultCodexThreadId,
} from "./codex-thread-navigator-model.js";

const Threads = [
  {
    id: "thread_old",
    name: "Old work",
    preview: "Preview",
    cwd: "/workspace/repo-a",
    createdAt: 10,
    updatedAt: 20,
  },
  {
    id: "thread_new",
    name: null,
    preview: "New work\nsecond line",
    cwd: "/workspace/repo-a",
    createdAt: 30,
    updatedAt: 50,
  },
  {
    id: "thread_other_repo",
    name: null,
    preview: null,
    cwd: "/workspace/repo-b",
    createdAt: 40,
    updatedAt: 60,
  },
];

describe("projectCodexThreadNavigatorRows", () => {
  it("orders all threads by recent activity and marks row metadata", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_new",
        activeThread: {
          id: "thread_new",
          cwd: "/workspace/repo-a",
        },
        availableThreads: Threads,
        pendingThreadId: "thread_old",
        pendingServerRequestThreadIds: ["thread_new", "thread_new"],
      }),
    ).toEqual([
      {
        id: "thread_other_repo",
        title: "Untitled thread",
        cwd: "/workspace/repo-b",
        cwdSectionLabel: "repo-b",
        isActive: false,
        isOpening: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "thread_new",
        title: "New work",
        cwd: "/workspace/repo-a",
        cwdSectionLabel: "repo-a",
        isActive: true,
        isOpening: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 2,
      },
      {
        id: "thread_old",
        title: "Old work",
        cwd: "/workspace/repo-a",
        cwdSectionLabel: "repo-a",
        isActive: false,
        isOpening: true,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
    ]);
  });

  it("does not need to pin the active thread because all threads are visible", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_other_repo",
        activeThread: {
          id: "thread_other_repo",
          cwd: "/workspace/repo-b",
        },
        availableThreads: Threads,
        pendingThreadId: null,
        pendingServerRequestThreadIds: [],
      }).map((row) => ({
        id: row.id,
        isPinnedCurrent: row.isPinnedCurrent,
      })),
    ).toEqual([
      {
        id: "thread_other_repo",
        isPinnedCurrent: false,
      },
      {
        id: "thread_new",
        isPinnedCurrent: false,
      },
      {
        id: "thread_old",
        isPinnedCurrent: false,
      },
    ]);
  });

  it("pins the active thread when it is outside the latest page", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_outside_latest",
        activeThread: {
          id: "thread_outside_latest",
          cwd: "/workspace/repo-c",
        },
        availableThreads: Threads,
        pendingThreadId: null,
        pendingServerRequestThreadIds: ["thread_outside_latest"],
      }).map((row) => ({
        id: row.id,
        title: row.title,
        cwdSectionLabel: row.cwdSectionLabel,
        isActive: row.isActive,
        isPinnedCurrent: row.isPinnedCurrent,
        pendingServerRequestCount: row.pendingServerRequestCount,
      })),
    ).toEqual([
      {
        id: "thread_outside_latest",
        title: "New thread",
        cwdSectionLabel: "repo-c",
        isActive: true,
        isPinnedCurrent: true,
        pendingServerRequestCount: 1,
      },
      {
        id: "thread_other_repo",
        title: "Untitled thread",
        cwdSectionLabel: "repo-b",
        isActive: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "thread_new",
        title: "New work",
        cwdSectionLabel: "repo-a",
        isActive: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "thread_old",
        title: "Old work",
        cwdSectionLabel: "repo-a",
        isActive: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
    ]);
  });

  it("resolves the default thread from recent activity", () => {
    expect(
      resolveDefaultCodexThreadId({
        availableThreads: Threads,
      }),
    ).toBe("thread_other_repo");
  });
});
