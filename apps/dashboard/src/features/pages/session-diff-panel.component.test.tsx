// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ResolvedAppearanceProvider } from "../appearance/appearance-provider.js";
import {
  capturePendingSessionDiffCommentAnchor,
  type PendingSessionDiffComment,
} from "./session-diff-comment.js";
import { parseSessionDiffPatch } from "./session-diff-panel-model.js";
import { SessionDiffPanel } from "./session-diff-panel.js";

const TestPatch = [
  "diff --git a/apps/dashboard/src/features/pages/session-workbench-page.tsx b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "index 1111111..2222222 100644",
  "--- a/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "+++ b/apps/dashboard/src/features/pages/session-workbench-page.tsx",
  "@@ -1,1 +1,2 @@",
  ' import { Badge } from "@mistle/ui";',
  '+import { Button } from "@mistle/ui";',
].join("\n");
const TestSummaryLabel = "Compared with origin/main";

function renderWithResolvedAppearance(ui: React.ReactElement): ReturnType<typeof render> {
  return render(
    <ResolvedAppearanceProvider resolvedAppearance="light">{ui}</ResolvedAppearanceProvider>,
  );
}

function createTestPendingComment(body = "Request change"): PendingSessionDiffComment {
  const parsedPatch = parseSessionDiffPatch(TestPatch);
  if (parsedPatch.kind !== "parsed") {
    throw new Error("Expected parsed patch fixture.");
  }

  const fileDiff = parsedPatch.files[0];
  if (fileDiff === undefined) {
    throw new Error("Expected parsed file diff.");
  }
  const anchor = capturePendingSessionDiffCommentAnchor({
    fileDiff,
    lineNumber: 2,
    side: "additions",
  });
  if (anchor === null) {
    throw new Error("Expected diff comment anchor.");
  }

  return {
    id: "comment-1",
    anchor,
    body,
    filePath: "apps/dashboard/src/features/pages/session-workbench-page.tsx",
    lineNumber: 2,
    repositoryPath: "/workspace/mistle",
    side: "additions",
    status: {
      kind: "current",
    },
  };
}

describe("SessionDiffPanel", () => {
  it("collapses and expands individual file diffs", () => {
    renderWithResolvedAppearance(
      <SessionDiffPanel
        patch={TestPatch}
        summaryLabel={TestSummaryLabel}
        title="Current changes"
      />,
    );

    const expandedToggle = screen.getByRole("button", {
      name: "Collapse apps/dashboard/src/features/pages/session-workbench-page.tsx",
    });

    expect(expandedToggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(expandedToggle);

    const collapsedToggle = screen.getByRole("button", {
      name: "Expand apps/dashboard/src/features/pages/session-workbench-page.tsx",
    });

    expect(collapsedToggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(collapsedToggle);

    expect(
      screen
        .getByRole("button", {
          name: "Collapse apps/dashboard/src/features/pages/session-workbench-page.tsx",
        })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("retains added comments in the diff panel and allows editing them", () => {
    function Harness(): React.JSX.Element {
      const [pendingComments, setPendingComments] = useState<readonly PendingSessionDiffComment[]>([
        createTestPendingComment(),
      ]);

      return (
        <SessionDiffPanel
          onUpdateComment={(commentId, body) => {
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
          }}
          patch={TestPatch}
          pendingComments={pendingComments}
          summaryLabel={TestSummaryLabel}
          title="Current changes"
        />
      );
    }

    renderWithResolvedAppearance(<Harness />);

    expect(screen.getByText("Request change")).toBeTruthy();

    fireEvent.focus(screen.getByDisplayValue("Request change"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Use the shared overflow tooltip here." },
    });
    fireEvent.blur(screen.getByRole("textbox"));

    expect(screen.getByDisplayValue("Use the shared overflow tooltip here.")).toBeTruthy();
  });

  it("removes retained comments from the diff panel", () => {
    function Harness(): React.JSX.Element {
      const [pendingComments, setPendingComments] = useState<readonly PendingSessionDiffComment[]>([
        createTestPendingComment(),
      ]);

      return (
        <SessionDiffPanel
          onDeleteComment={(commentId) => {
            setPendingComments((currentComments) =>
              currentComments.filter((comment) => comment.id !== commentId),
            );
          }}
          patch={TestPatch}
          pendingComments={pendingComments}
          summaryLabel={TestSummaryLabel}
          title="Current changes"
        />
      );
    }

    renderWithResolvedAppearance(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Delete comment on line R2" }));

    expect(screen.queryByDisplayValue("Request change")).toBeNull();
  });

  it("reverts saved comment edits when escape is pressed", () => {
    function Harness(): React.JSX.Element {
      const [pendingComments, setPendingComments] = useState<readonly PendingSessionDiffComment[]>([
        createTestPendingComment(),
      ]);

      return (
        <SessionDiffPanel
          onUpdateComment={(commentId, body) => {
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
          }}
          patch={TestPatch}
          pendingComments={pendingComments}
          summaryLabel={TestSummaryLabel}
          title="Current changes"
        />
      );
    }

    renderWithResolvedAppearance(<Harness />);

    const commentField = screen.getByDisplayValue("Request change");
    fireEvent.focus(commentField);
    fireEvent.change(commentField, {
      target: { value: "Use the shared overflow tooltip here." },
    });
    fireEvent.keyDown(commentField, { key: "Escape" });

    expect(screen.getByDisplayValue("Request change")).toBeTruthy();
    expect(screen.queryByDisplayValue("Use the shared overflow tooltip here.")).toBeNull();
  });
});
