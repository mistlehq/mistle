import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import type { ChatEntry } from "../chat/chat-types.js";
import { SessionComposerFixturePropsWithPendingDiffComments } from "../session-agents/codex/fixtures/session-fixtures.js";
import type {
  PendingSessionDiffComment,
  PendingSessionDiffCommentInput,
} from "./session-diff-comment.js";
import {
  capturePendingSessionDiffCommentAnchor,
  buildSessionComposerPrompt,
  buildPendingSessionDiffCommentSummaryLabel,
  buildPendingSessionDiffCommentSummaryTitle,
  reconcilePendingSessionDiffComments,
} from "./session-diff-comment.js";
import { parseSessionDiffPatch } from "./session-diff-panel-model.js";
import { SessionDiffPanel } from "./session-diff-panel.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  renderSessionWorkbenchContentStory,
} from "./session-story-support.js";

const StoryBranchPatch = [
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-page.tsx b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "index 5e8dabc..9cbad42 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "@@ -1,5 +1,6 @@",
  ' import { Badge, Button } from "@mistle/ui";',
  '+import { GitDiffIcon, TerminalIcon } from "@phosphor-icons/react";',
  ' import { useEffect, useMemo } from "react";',
  " ",
  " export function SessionWorkbenchPage(): React.JSX.Element {",
  "@@ -132,6 +133,17 @@ function SessionWorkbenchPageContent(input: {",
  "         >",
  '           <TerminalIcon className="size-4" />',
  "         </Button>",
  "+        <Button",
  '+          aria-label="Diffs"',
  "+          aria-pressed={workbench.diffPanelState.isVisible}",
  '+          size="icon-sm"',
  '+          title="Diffs"',
  '+          type="button"',
  '+          variant="ghost"',
  "+        >",
  '+          <GitDiffIcon className="size-4" />',
  "+        </Button>",
  "       </div>",
  "     ),",
  "     [",
  "diff --git a/apps/dashboard/src/features/pages/session-diff-panel.tsx b/apps/dashboard/src/features/pages/session-diff-panel.tsx",
  "new file mode 100644",
  "index 0000000..1fd1b7a",
  "--- /dev/null",
  "+++ b/apps/dashboard/src/features/pages/session-diff-panel.tsx",
  "@@ -0,0 +1,32 @@",
  '+import { parsePatchFiles } from "@pierre/diffs";',
  '+import { FileDiff } from "@pierre/diffs/react";',
  "+",
  "+export function SessionDiffPanel(): React.JSX.Element {",
  "+  return <div />;",
  "+}",
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx b/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx",
  "index 7b2de0c..bf0af1d 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-page-view.stories.tsx",
  "@@ -174,6 +174,15 @@ export const CliSplitWithTerminal: Story = {",
  "       />",
  "     ),",
  "   },",
  "+};",
  "+",
  "+export const ChatWithDiffPanel: Story = {",
  "+  args: {",
  "+    isSecondaryPanelVisible: true,",
  "+    secondaryPanel: <SessionDiffPanel /> ,",
  "+  },",
  " };",
].join("\n");

const StoryRepositoryPath = "/workspace/mistle";
const StoryMovedCommentPatch = StoryBranchPatch.replace(
  '+          size="icon-sm"',
  ['+          data-slot="diff-trigger"', '+          size="icon-sm"'].join("\n"),
);
const StoryStaleCommentPatch = StoryBranchPatch.replace(
  '+          title="Diffs"',
  '+          title="Code changes"',
);

function resolveStoryFileDiff(input: { filePath: string; patch: string }) {
  const parsedPatch = parseSessionDiffPatch(input.patch);
  if (parsedPatch.kind !== "parsed") {
    throw new Error("Expected parsed story patch.");
  }

  const fileDiff = parsedPatch.files.find((candidateFileDiff) => {
    return candidateFileDiff.name.replace(/^[ab]\//, "") === input.filePath;
  });
  if (fileDiff === undefined) {
    throw new Error(`Missing story diff for ${input.filePath}.`);
  }

  return fileDiff;
}

function createStoryPendingComment(input: {
  body: string;
  filePath: string;
  id: string;
  lineNumber: number;
  patch: string;
  side: "additions" | "deletions";
}): PendingSessionDiffComment {
  const fileDiff = resolveStoryFileDiff({
    filePath: input.filePath,
    patch: input.patch,
  });
  const anchor = capturePendingSessionDiffCommentAnchor({
    fileDiff,
    lineNumber: input.lineNumber,
    side: input.side,
  });
  if (anchor === null) {
    throw new Error(`Could not capture story diff comment anchor for ${input.filePath}.`);
  }

  return {
    id: input.id,
    anchor,
    body: input.body,
    filePath: input.filePath,
    lineNumber: input.lineNumber,
    repositoryPath: StoryRepositoryPath,
    side: input.side,
    status: {
      kind: "current",
    },
  };
}

const StoryValidPendingComments = [
  createStoryPendingComment({
    body: "Request change",
    filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    id: "comment-story-1",
    lineNumber: 140,
    patch: StoryBranchPatch,
    side: "additions",
  }),
  createStoryPendingComment({
    body: "Use the shared overflow tooltip here.",
    filePath: "apps/dashboard/src/features/pages/session-diff-panel.tsx",
    id: "comment-story-2",
    lineNumber: 4,
    patch: StoryBranchPatch,
    side: "additions",
  }),
] satisfies readonly PendingSessionDiffComment[];

const StoryMovedPendingComments = [
  createStoryPendingComment({
    body: "Keep this aligned with the header icon button sizing.",
    filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    id: "comment-story-moved-1",
    lineNumber: 139,
    patch: StoryBranchPatch,
    side: "additions",
  }),
] satisfies readonly PendingSessionDiffComment[];

const StoryStalePendingComments = [
  createStoryPendingComment({
    body: "Retitle this action to match the existing copy.",
    filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    id: "comment-story-stale-1",
    lineNumber: 140,
    patch: StoryBranchPatch,
    side: "additions",
  }),
] satisfies readonly PendingSessionDiffComment[];

type StoryDiffWorkbenchProps = {
  autoOpenLocalComment?: boolean;
  errorNotice?: {
    message: string;
    title: string;
    variant: "alert" | "default";
  } | null;
  initialPendingComments?: readonly PendingSessionDiffComment[];
  patch: string;
  submittedComposerText?: string | undefined;
  submittedDiffComments?: readonly PendingSessionDiffComment[] | undefined;
};

function buildStoryPendingDiffCommentSummary(comments: readonly PendingSessionDiffComment[]): {
  count: number;
  label: string;
  staleCount: number;
  title: string;
} | null {
  if (comments.length === 0) {
    return null;
  }

  return {
    count: comments.length,
    label: buildPendingSessionDiffCommentSummaryLabel(comments.length),
    staleCount: comments.filter((comment) => comment.status.kind === "stale").length,
    title: buildPendingSessionDiffCommentSummaryTitle(comments),
  };
}

function buildSubmittedDiffCommentStoryEntries(input: {
  composerText: string;
  comments: readonly PendingSessionDiffComment[];
}): readonly ChatEntry[] {
  return [
    {
      id: "submitted-diff-comment-user",
      turnId: "submitted-diff-comment-turn",
      kind: "user-message",
      status: "completed",
      text: buildSessionComposerPrompt({
        composerText: input.composerText,
        pendingDiffComments: input.comments,
      }),
    },
  ];
}

function StoryDiffWorkbench({
  autoOpenLocalComment = false,
  errorNotice = null,
  initialPendingComments = [],
  patch,
  submittedComposerText,
  submittedDiffComments,
}: StoryDiffWorkbenchProps): React.JSX.Element {
  const [pendingComments, setPendingComments] =
    useState<readonly PendingSessionDiffComment[]>(initialPendingComments);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasAutoOpenedCommentRef = useRef(false);

  function addComment(comment: PendingSessionDiffCommentInput): void {
    setPendingComments((currentComments) => [
      ...currentComments,
      {
        ...comment,
        id: `${comment.filePath}:${comment.side}:${comment.lineNumber}:${currentComments.length}`,
        status: comment.status ?? {
          kind: "current",
        },
      },
    ]);
  }

  function updateComment(commentId: string, body: string): void {
    setPendingComments((currentComments) =>
      currentComments.map((comment) =>
        comment.id !== commentId
          ? comment
          : {
              ...comment,
              body,
            },
      ),
    );
  }

  function deleteComment(commentId: string): void {
    setPendingComments((currentComments) =>
      currentComments.filter((comment) => comment.id !== commentId),
    );
  }

  useEffect(() => {
    setPendingComments(initialPendingComments);
  }, [initialPendingComments]);

  useEffect(() => {
    const parsedPatch = parseSessionDiffPatch(patch);
    setPendingComments((currentComments) =>
      reconcilePendingSessionDiffComments({
        comments: currentComments,
        currentRepositoryPath: StoryRepositoryPath,
        fileDiffs: parsedPatch.kind === "parsed" ? parsedPatch.files : [],
      }),
    );
  }, [patch]);

  useEffect(() => {
    if (!autoOpenLocalComment || hasAutoOpenedCommentRef.current) {
      return;
    }

    let animationFrameId = 0;
    let attempts = 0;

    function tryOpenComment(): void {
      attempts += 1;

      const rootElement = rootRef.current;
      const diffContainer = rootElement?.querySelector("diffs-container");
      const shadowRoot = diffContainer?.shadowRoot;
      const hoveredLine =
        shadowRoot?.querySelector<HTMLElement>('[data-line-type="change-addition"]') ??
        shadowRoot?.querySelector<HTMLElement>("[data-line]");
      if (hoveredLine === null || hoveredLine === undefined) {
        if (attempts < 6) {
          animationFrameId = requestAnimationFrame(tryOpenComment);
        }
        return;
      }

      hoveredLine.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 12,
          clientY: 12,
          composed: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );

      const commentButton = diffContainer?.querySelector<HTMLButtonElement>(
        'button[aria-label="Add comment"]',
      );
      if (commentButton === null || commentButton === undefined) {
        if (attempts < 6) {
          animationFrameId = requestAnimationFrame(tryOpenComment);
        }
        return;
      }

      hasAutoOpenedCommentRef.current = true;
      commentButton.click();
    }

    animationFrameId = requestAnimationFrame(tryOpenComment);

    return () => {
      if (animationFrameId !== 0) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [autoOpenLocalComment, patch]);

  const mainContent =
    submittedComposerText === undefined || submittedDiffComments === undefined
      ? createStorySessionMainContent()
      : createStorySessionMainContent({
          chatEntries: buildSubmittedDiffCommentStoryEntries({
            comments: submittedDiffComments,
            composerText: submittedComposerText,
          }),
        });

  return (
    <div ref={rootRef}>
      {renderSessionWorkbenchContentStory({
        isSecondaryPanelVisible: true,
        mainContent,
        primaryBottomPanel: createStorySessionBottomPanel({
          composerViewModel: {
            ...SessionComposerFixturePropsWithPendingDiffComments,
            composerText: "",
            onClearPendingDiffComments: () => {
              setPendingComments([]);
            },
            pendingDiffCommentSummary: buildStoryPendingDiffCommentSummary(pendingComments),
          },
        }),
        secondaryPanel: (
          <SessionDiffPanel
            errorNotice={errorNotice}
            onDeleteComment={deleteComment}
            onUpdateComment={updateComment}
            patch={patch}
            pendingComments={pendingComments}
            repositoryPath={StoryRepositoryPath}
            summaryLabel="Compared with origin/main"
            title="Current changes"
            onAddComment={addComment}
          />
        ),
      })}
    </div>
  );
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/DiffPanel",
  component: StoryDiffWorkbench,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    patch: StoryBranchPatch,
  },
} satisfies Meta<typeof StoryDiffWorkbench>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AgainstMain: Story = {};

export const WithPendingDiffCommentBadges: Story = {
  args: {
    initialPendingComments: StoryValidPendingComments,
  },
};

export const WithMovedDiffComment: Story = {
  args: {
    initialPendingComments: StoryMovedPendingComments,
    patch: StoryMovedCommentPatch,
  },
};

export const WithCommentNeedingReview: Story = {
  args: {
    initialPendingComments: StoryStalePendingComments,
    patch: StoryStaleCommentPatch,
  },
};

export const WithOpenLocalComment: Story = {
  args: {
    autoOpenLocalComment: true,
  },
};

export const WithSubmittedDiffCommentMessage: Story = {
  args: {
    submittedComposerText: "Please address these before sending the next patch.",
    submittedDiffComments: [...StoryValidPendingComments],
  },
};

export const EmptyState: Story = {
  args: {
    patch: "",
  },
};

export const WorkspaceNotRepository: Story = {
  args: {
    errorNotice: {
      message: "Current workspace is not a git repository.",
      title: "Changes unavailable",
      variant: "default",
    },
    patch: "",
  },
};
