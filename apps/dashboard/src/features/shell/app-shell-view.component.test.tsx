// @vitest-environment jsdom

import { render } from "@testing-library/react";
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
  it("applies route sidebar defaults when the mounted shell rerenders for a Designer session route", () => {
    const view = render(renderAppShellView({ sidebarDefaultOpen: true }));

    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("expanded");

    view.rerender(renderAppShellView({ sidebarDefaultOpen: false }));

    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("collapsed");
  });
});
