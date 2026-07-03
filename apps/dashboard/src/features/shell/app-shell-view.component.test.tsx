// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShellView } from "./app-shell-view.js";

function renderAppShellView(input: { sidebarDefaultOpen: boolean }): React.JSX.Element {
  return (
    <AppShellView
      contentInsetOwner="app-shell"
      mainContent={<div>Page content</div>}
      renderSidebarTrigger={false}
      sidebarContent={<div>Navigation</div>}
      sidebarDefaultOpen={input.sidebarDefaultOpen}
      sidebarEntryKey="story-route"
      sidebarEntryState={null}
      sidebarFooterContent={null}
      sidebarHeaderContent={null}
      topLoadingBar={null}
      viewportMode="workspace"
    />
  );
}

function getDesktopSidebar(container: HTMLElement): HTMLElement {
  const sidebar = container.querySelector('[data-slot="sidebar"]');
  if (!(sidebar instanceof HTMLElement)) {
    throw new Error("Expected desktop sidebar element.");
  }

  return sidebar;
}

describe("AppShellView", () => {
  it("keeps the mounted sidebar state when route default props change", () => {
    const view = render(renderAppShellView({ sidebarDefaultOpen: true }));

    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("expanded");

    view.rerender(renderAppShellView({ sidebarDefaultOpen: false }));

    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("expanded");
  });

  it("initializes collapsed when directly rendering a collapsed workspace route", () => {
    const view = render(
      <AppShellView
        contentInsetOwner="app-shell"
        mainContent={<div>Page content</div>}
        renderSidebarTrigger={false}
        sidebarContent={<div>Navigation</div>}
        sidebarEntryKey="/dsn_123"
        sidebarEntryState="collapsed"
        sidebarFooterContent={null}
        sidebarHeaderContent={null}
        topLoadingBar={null}
        viewportMode="workspace"
      />,
    );

    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("collapsed");
  });

  it("collapses the mounted sidebar once when entering a collapsed workspace route", async () => {
    const view = render(
      <AppShellView
        contentInsetOwner="app-shell"
        mainContent={<div>Page content</div>}
        renderSidebarTrigger={false}
        sidebarContent={<div>Navigation</div>}
        sidebarEntryKey="/"
        sidebarEntryState={null}
        sidebarFooterContent={null}
        sidebarHeaderContent={null}
        topLoadingBar={null}
        viewportMode="workspace"
      />,
    );

    const originalSidebar = getDesktopSidebar(view.container);
    expect(originalSidebar.getAttribute("data-state")).toBe("expanded");

    await act(async () => {
      view.rerender(
        <AppShellView
          contentInsetOwner="app-shell"
          mainContent={<div>Page content</div>}
          renderSidebarTrigger={false}
          sidebarContent={<div>Navigation</div>}
          sidebarEntryKey="/dsn_123"
          sidebarEntryState="collapsed"
          sidebarFooterContent={null}
          sidebarHeaderContent={null}
          topLoadingBar={null}
          viewportMode="workspace"
        />,
      );
    });

    expect(getDesktopSidebar(view.container)).toBe(originalSidebar);
    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("collapsed");
  });
});
