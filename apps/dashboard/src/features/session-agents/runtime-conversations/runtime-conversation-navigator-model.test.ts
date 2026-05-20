import { describe, expect, it } from "vitest";

import { projectRuntimeConversationNavigatorRows } from "./runtime-conversation-navigator-model.js";

const Conversations = [
  {
    id: "conversation_old",
    title: "Old work",
    cwd: "/workspace/repo-a",
    createdAt: 10,
    updatedAt: 20,
  },
  {
    id: "conversation_new",
    title: "New work",
    cwd: "/workspace/repo-a",
    createdAt: 30,
    updatedAt: 50,
  },
  {
    id: "conversation_other_repo",
    title: "",
    cwd: "/workspace/repo-b",
    createdAt: 40,
    updatedAt: 60,
  },
];

describe("projectRuntimeConversationNavigatorRows", () => {
  it("orders all conversations by recent activity and marks row metadata", () => {
    expect(
      projectRuntimeConversationNavigatorRows({
        activeConversationId: "conversation_new",
        activeConversation: {
          id: "conversation_new",
          cwd: "/workspace/repo-a",
        },
        availableConversations: Conversations,
        originalConversationId: "conversation_old",
        pendingConversationId: "conversation_old",
        pendingServerRequestConversationIds: ["conversation_new", "conversation_new"],
      }),
    ).toEqual([
      {
        id: "conversation_other_repo",
        title: "Untitled conversation",
        cwd: "/workspace/repo-b",
        cwdSectionLabel: "repo-b",
        lastActivityAt: 60,
        isActive: false,
        isOpening: false,
        isOriginal: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "conversation_new",
        title: "New work",
        cwd: "/workspace/repo-a",
        cwdSectionLabel: "repo-a",
        lastActivityAt: 50,
        isActive: true,
        isOpening: false,
        isOriginal: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 2,
      },
      {
        id: "conversation_old",
        title: "Old work",
        cwd: "/workspace/repo-a",
        cwdSectionLabel: "repo-a",
        lastActivityAt: 20,
        isActive: false,
        isOpening: true,
        isOriginal: true,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
    ]);
  });

  it("does not need to pin the active conversation because all conversations are visible", () => {
    expect(
      projectRuntimeConversationNavigatorRows({
        activeConversationId: "conversation_other_repo",
        activeConversation: {
          id: "conversation_other_repo",
          cwd: "/workspace/repo-b",
        },
        availableConversations: Conversations,
        originalConversationId: null,
        pendingConversationId: null,
        pendingServerRequestConversationIds: [],
      }).map((row) => ({
        id: row.id,
        isPinnedCurrent: row.isPinnedCurrent,
      })),
    ).toEqual([
      {
        id: "conversation_other_repo",
        isPinnedCurrent: false,
      },
      {
        id: "conversation_new",
        isPinnedCurrent: false,
      },
      {
        id: "conversation_old",
        isPinnedCurrent: false,
      },
    ]);
  });

  it("pins the active conversation when it is outside the latest page", () => {
    expect(
      projectRuntimeConversationNavigatorRows({
        activeConversationId: "conversation_outside_latest",
        activeConversation: {
          id: "conversation_outside_latest",
          cwd: "/workspace/repo-c",
        },
        availableConversations: Conversations,
        originalConversationId: "conversation_outside_latest",
        pendingConversationId: null,
        pendingServerRequestConversationIds: ["conversation_outside_latest"],
      }).map((row) => ({
        id: row.id,
        title: row.title,
        cwdSectionLabel: row.cwdSectionLabel,
        isActive: row.isActive,
        isOriginal: row.isOriginal,
        isPinnedCurrent: row.isPinnedCurrent,
        pendingServerRequestCount: row.pendingServerRequestCount,
      })),
    ).toEqual([
      {
        id: "conversation_outside_latest",
        title: "New conversation",
        cwdSectionLabel: "repo-c",
        isActive: true,
        isOriginal: true,
        isPinnedCurrent: true,
        pendingServerRequestCount: 1,
      },
      {
        id: "conversation_other_repo",
        title: "Untitled conversation",
        cwdSectionLabel: "repo-b",
        isActive: false,
        isOriginal: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "conversation_new",
        title: "New work",
        cwdSectionLabel: "repo-a",
        isActive: false,
        isOriginal: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "conversation_old",
        title: "Old work",
        cwdSectionLabel: "repo-a",
        isActive: false,
        isOriginal: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
    ]);
  });

  it("pins the active conversation when the runtime has no cwd for an empty conversation", () => {
    expect(
      projectRuntimeConversationNavigatorRows({
        activeConversationId: "conversation_empty",
        activeConversation: {
          id: "conversation_empty",
          cwd: null,
        },
        availableConversations: [],
        originalConversationId: null,
        pendingConversationId: null,
        pendingServerRequestConversationIds: [],
      }).map((row) => ({
        id: row.id,
        title: row.title,
        cwd: row.cwd,
        cwdSectionLabel: row.cwdSectionLabel,
        isActive: row.isActive,
        isPinnedCurrent: row.isPinnedCurrent,
      })),
    ).toEqual([
      {
        id: "conversation_empty",
        title: "New conversation",
        cwd: "",
        cwdSectionLabel: "Current conversation",
        isActive: true,
        isPinnedCurrent: true,
      },
    ]);
  });

  it("uses created time as activity when updated time is missing", () => {
    const conversations = [
      {
        id: "conversation_created_recently",
        title: "Created recently",
        cwd: "/workspace/repo-a",
        createdAt: 70,
        updatedAt: null,
      },
      {
        id: "conversation_updated",
        title: "Updated",
        cwd: "/workspace/repo-a",
        createdAt: 10,
        updatedAt: 50,
      },
    ];
    const rows = projectRuntimeConversationNavigatorRows({
      activeConversationId: null,
      activeConversation: null,
      availableConversations: conversations,
      originalConversationId: null,
      pendingConversationId: null,
      pendingServerRequestConversationIds: [],
    });

    expect(rows.map((row) => ({ id: row.id, lastActivityAt: row.lastActivityAt }))).toEqual([
      {
        id: "conversation_created_recently",
        lastActivityAt: 70,
      },
      {
        id: "conversation_updated",
        lastActivityAt: 50,
      },
    ]);
  });
});
