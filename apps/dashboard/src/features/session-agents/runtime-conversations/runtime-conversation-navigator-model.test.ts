import { describe, expect, it } from "vitest";

import {
  projectRuntimeConversationNavigatorRows,
  type RuntimeConversationSummary,
} from "./runtime-conversation-navigator-model.js";

function createConversation(
  input: Omit<RuntimeConversationSummary, "lineage"> & {
    lineage?: RuntimeConversationSummary["lineage"];
  },
): RuntimeConversationSummary {
  return {
    ...input,
    lineage: input.lineage ?? null,
  };
}

const Conversations = [
  createConversation({
    id: "conversation_old",
    title: "Old work",
    cwd: "/workspace/repo-a",
    createdAt: 10,
    updatedAt: 20,
  }),
  createConversation({
    id: "conversation_new",
    title: "New work",
    cwd: "/workspace/repo-a",
    createdAt: 30,
    updatedAt: 50,
  }),
  createConversation({
    id: "conversation_other_repo",
    title: "",
    cwd: "/workspace/repo-b",
    createdAt: 40,
    updatedAt: 60,
  }),
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
        lineage: null,
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
        lineage: null,
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
        lineage: null,
      },
    ]);
  });

  it("keeps child conversations activity-sorted while projecting lineage metadata", () => {
    const rows = projectRuntimeConversationNavigatorRows({
      activeConversationId: "conversation_child",
      activeConversation: {
        id: "conversation_child",
        cwd: "/workspace/repo-a",
      },
      availableConversations: [
        createConversation({
          id: "conversation_parent",
          title: "Parent work",
          cwd: "/workspace/repo-a",
          createdAt: 10,
          updatedAt: 20,
        }),
        createConversation({
          id: "conversation_child",
          title: "Child work",
          cwd: "/workspace/repo-a",
          createdAt: 30,
          updatedAt: 70,
          lineage: {
            parentConversationId: "conversation_parent",
            label: "Subagent",
            detail: "reviewer",
          },
        }),
      ],
      originalConversationId: null,
      pendingConversationId: null,
      pendingServerRequestConversationIds: [],
    });

    expect(
      rows.map((row) => ({
        id: row.id,
        lineage: row.lineage,
      })),
    ).toEqual([
      {
        id: "conversation_child",
        lineage: {
          parentConversationId: "conversation_parent",
          label: "Subagent",
          detail: "reviewer",
          depth: 1,
          parentTitle: "Parent work",
        },
      },
      {
        id: "conversation_parent",
        lineage: null,
      },
    ]);
  });

  it("shows child conversation lineage even when the parent is outside the row set", () => {
    const rows = projectRuntimeConversationNavigatorRows({
      activeConversationId: null,
      activeConversation: null,
      availableConversations: [
        createConversation({
          id: "conversation_child",
          title: "Child work",
          cwd: "/workspace/repo-a",
          createdAt: 30,
          updatedAt: 70,
          lineage: {
            parentConversationId: "conversation_parent",
            label: "Subagent",
            detail: null,
          },
        }),
      ],
      originalConversationId: null,
      pendingConversationId: null,
      pendingServerRequestConversationIds: [],
    });

    expect(rows[0]?.lineage).toEqual({
      parentConversationId: "conversation_parent",
      label: "Subagent",
      detail: null,
      depth: 1,
      parentTitle: null,
    });
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
        lineage: null,
      },
      {
        id: "conversation_updated",
        title: "Updated",
        cwd: "/workspace/repo-a",
        createdAt: 10,
        updatedAt: 50,
        lineage: null,
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
