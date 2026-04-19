// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

describe("SessionDiffPanel", () => {
  it("collapses and expands individual file diffs", () => {
    render(
      <SessionDiffPanel
        patch={TestPatch}
        summaryLabel="Compared with main"
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
});
