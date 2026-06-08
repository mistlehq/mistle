// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { useState } from "react";
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

  it("retains scrollbar gutter and keeps chat-width side padding on mobile", () => {
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

    expect(chatWidthContainers[0]?.className).toContain("px-4 pb-4");
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

  it("opens the terminal panel with a pixel-based default height", () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(): number {
        return 400;
      },
    });

    try {
      render(
        <SessionWorkbenchPageView
          alert={null}
          bottomPanel={<div>Terminal workspace</div>}
          isBottomPanelVisible
          isSecondaryPanelVisible={false}
          mainContent={<div>Conversation body</div>}
          primaryBottomPanel={<div>Composer</div>}
          sandboxInstanceId="sbi_test"
          secondaryPanel={<div>Secondary</div>}
        />,
      );

      expect(screen.getByTestId("session-workbench-bottom-panel").getAttribute("style")).toContain(
        "flex: 40 1 0px;",
      );
    } finally {
      if (originalOffsetHeight === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      } else {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
    }
  });

  it("renders neutral reconnect alerts as polite status updates", () => {
    render(
      <SessionWorkbenchPageView
        alert={{
          title: "Reconnecting session",
          description: "Waiting for the sandbox to become ready again.",
          variant: "default",
        }}
        bottomPanel={<div>Terminal workspace</div>}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Secondary</div>}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(within(status).getByText("Reconnecting session")).toBeTruthy();
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

  it("does not remount the bottom panel when the shared right panel opens", () => {
    let nextMountId = 1;

    function BottomPanelContent(): React.JSX.Element {
      const [mountId] = useState(() => nextMountId++);

      return <div>Terminal mount {mountId}</div>;
    }

    const { rerender } = render(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<BottomPanelContent />}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible={false}
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Threads panel</div>}
        secondaryPanelLayoutKey="right-panel"
      />,
    );

    expect(screen.getByText("Terminal mount 1")).toBeTruthy();

    rerender(
      <SessionWorkbenchPageView
        alert={null}
        bottomPanel={<BottomPanelContent />}
        isBottomPanelVisible={false}
        isSecondaryPanelVisible
        mainContent={<div>Conversation body</div>}
        primaryBottomPanel={<div>Composer</div>}
        sandboxInstanceId="sbi_test"
        secondaryPanel={<div>Threads panel</div>}
        secondaryPanelDefaultSize="20%"
        secondaryPanelLayoutKey="right-panel"
        secondaryPanelMinSize="16rem"
      />,
    );

    expect(screen.getByText("Terminal mount 1")).toBeTruthy();
    expect(screen.getByText("Threads panel")).toBeTruthy();
  });
});
