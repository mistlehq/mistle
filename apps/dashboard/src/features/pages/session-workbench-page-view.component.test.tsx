// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

describe("SessionWorkbenchPageView", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
  });

  it("retains scrollbar gutter and removes chat-width side padding until the desktop breakpoint", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
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
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        mainContentLayout={{ scroll: "contained", width: "full" }}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    expect(
      within(container).getByRole("region", { name: "Conversation chat" }).className,
    ).not.toContain("scrollbar-gutter");
  });

  it("keeps the bottom panel mounted while hidden", () => {
    render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    expect(screen.getByText("Terminal workspace")).toBeDefined();
  });

  it("keeps the outer horizontal group mounted when the secondary panel is hidden", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary panel</div>}
      />,
    );

    expect(within(container).queryAllByTestId("session-workbench-main-group")).toHaveLength(1);
    expect(within(container).queryByTestId("session-workbench-secondary-panel")).toBeNull();
  });
});
