// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

describe("SessionWorkbenchPageView", () => {
  it("retains scrollbar gutter and removes chat-width side padding until the desktop breakpoint", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alerts={[]}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
        secondaryPanelSize={40}
      />,
    );

    expect(screen.getByRole("region", { name: "Conversation chat" }).getAttribute("style")).toBe(
      "scrollbar-gutter: stable both-edges;",
    );
    const chatWidthContainers = container.querySelectorAll(".max-w-3xl");

    expect(chatWidthContainers[0]?.className).toContain("pr-2");
    expect(chatWidthContainers[0]?.className).toContain("md:px-4");
    expect(chatWidthContainers[0]?.className).not.toContain("px-4 pb-4");
    expect(chatWidthContainers[1]?.className).toContain("px-4");
  });

  it("does not reserve scrollbar gutter for full-width layouts", () => {
    render(
      <SessionWorkbenchPageView
        alerts={[]}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        mainContentLayout={{ scroll: "contained", width: "full" }}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
        secondaryPanelSize={40}
      />,
    );

    expect(screen.getByRole("region", { name: "Conversation chat" }).className).not.toContain(
      "scrollbar-gutter",
    );
  });
});
