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
  it("orders repository-scoped threads by recent activity and marks row metadata", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_new",
        availableThreads: Threads,
        loadedThreadIds: ["thread_new"],
        pendingThreadId: "thread_old",
        scope: "repository",
        selectedRepositoryPath: "/workspace/repo-a",
      }),
    ).toEqual([
      {
        id: "thread_new",
        title: "New work",
        preview: "New work\nsecond line",
        cwd: "/workspace/repo-a",
        cwdLabel: null,
        createdAt: 30,
        updatedAt: 50,
        isActive: true,
        isLoaded: true,
        isOpening: false,
        isPinnedCurrent: false,
      },
      {
        id: "thread_old",
        title: "Old work",
        preview: "Preview",
        cwd: "/workspace/repo-a",
        cwdLabel: null,
        createdAt: 10,
        updatedAt: 20,
        isActive: false,
        isLoaded: false,
        isOpening: true,
        isPinnedCurrent: false,
      },
    ]);
  });

  it("pins the active thread when it is outside the current repository scope", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_other_repo",
        availableThreads: Threads,
        loadedThreadIds: [],
        pendingThreadId: null,
        scope: "repository",
        selectedRepositoryPath: "/workspace/repo-a",
      }).map((row) => ({
        id: row.id,
        cwdLabel: row.cwdLabel,
        isPinnedCurrent: row.isPinnedCurrent,
      })),
    ).toEqual([
      {
        id: "thread_other_repo",
        cwdLabel: "repo-b",
        isPinnedCurrent: true,
      },
      {
        id: "thread_new",
        cwdLabel: null,
        isPinnedCurrent: false,
      },
      {
        id: "thread_old",
        cwdLabel: null,
        isPinnedCurrent: false,
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
