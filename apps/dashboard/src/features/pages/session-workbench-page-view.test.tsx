// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  resolveBottomPanelDefaultSizes,
  SessionWorkbenchPageView,
} from "./session-workbench-page-view.js";
import { DEFAULT_TERMINAL_PANEL_SIZE } from "./use-session-terminal-workbench-state.js";

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
        bottomPanelSize={DEFAULT_TERMINAL_PANEL_SIZE}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        onBottomPanelResize={function onBottomPanelResize() {}}
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
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal</div>}
        bottomPanelSize={DEFAULT_TERMINAL_PANEL_SIZE}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        mainContentLayout={{ scroll: "contained", width: "full" }}
        onBottomPanelResize={function onBottomPanelResize() {}}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
        secondaryPanelSize={40}
      />,
    );

    expect(
      within(container).getByRole("region", { name: "Conversation chat" }).className,
    ).not.toContain("scrollbar-gutter");
  });

  it("uses pixel sizing only for the terminal panel when visible", () => {
    expect(
      resolveBottomPanelDefaultSizes({
        bottomPanelSize: DEFAULT_TERMINAL_PANEL_SIZE,
        isBottomPanelVisible: true,
      }),
    ).toEqual({
      bottomPanelDefaultSize: `${String(DEFAULT_TERMINAL_PANEL_SIZE)}px`,
    });
  });

  it("keeps the main panel at full height while the terminal panel is hidden", () => {
    expect(
      resolveBottomPanelDefaultSizes({
        bottomPanelSize: DEFAULT_TERMINAL_PANEL_SIZE,
        isBottomPanelVisible: false,
      }),
    ).toEqual({
      bottomPanelDefaultSize: "0px",
      mainPanelDefaultSize: "100%",
    });
  });

  it("keeps the bottom panel mounted while hidden", () => {
    render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        bottomPanelSize={DEFAULT_TERMINAL_PANEL_SIZE}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        onBottomPanelResize={function onBottomPanelResize() {}}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
        secondaryPanelSize={40}
      />,
    );

    expect(screen.getByText("Terminal workspace")).toBeDefined();
  });

  it("keeps the outer horizontal group mounted when the secondary panel is hidden", () => {
    const { container } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<div>Terminal workspace</div>}
        bottomPanelSize={DEFAULT_TERMINAL_PANEL_SIZE}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        onBottomPanelResize={function onBottomPanelResize() {}}
        onSecondaryPanelResize={function onSecondaryPanelResize() {}}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary panel</div>}
        secondaryPanelSize={40}
      />,
    );

    expect(container.querySelector("#session-workbench-main-group")).not.toBeNull();
    expect(container.querySelector("#session-workbench-secondary-panel")).toBeNull();
  });
});
