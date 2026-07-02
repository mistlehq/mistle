// @vitest-environment jsdom

import { Button, useSidebar } from "@mistle/ui";
import { act, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider, useLocation, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";

import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { AppShellView } from "./app-shell-view.js";

function RouteAwareShell(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const location = useLocation();

  return (
    <AppShellView
      contentInsetOwner={pageMeta.appShellInsetOwner}
      mainContent={<Outlet />}
      renderSidebarTrigger={false}
      sidebarContent={<div>Navigation</div>}
      sidebarEntryKey={location.pathname}
      sidebarEntryState={pageMeta.sidebarEntryState}
      sidebarFooterContent={null}
      sidebarHeaderContent={null}
      topLoadingBar={null}
      viewportMode={pageMeta.appShellViewportMode}
    />
  );
}

function DesignerEntryRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { openMobile, setOpenMobile } = useSidebar();

  return (
    <div>
      <p>{openMobile ? "Mobile navigation open" : "Mobile navigation closed"}</p>
      <Button
        onClick={() => {
          setOpenMobile(true);
        }}
        type="button"
      >
        Open mobile navigation
      </Button>
      <Button
        onClick={() => {
          void navigate("/dsn_story");
        }}
        type="button"
      >
        Start Designer session
      </Button>
    </div>
  );
}

function DesignerSessionRoute(): React.JSX.Element {
  const navigate = useNavigate();
  const { openMobile, toggleSidebar } = useSidebar();

  return (
    <div>
      <p>Designer workspace</p>
      <p>{openMobile ? "Mobile navigation open" : "Mobile navigation closed"}</p>
      <Button onClick={toggleSidebar} type="button">
        Toggle navigation
      </Button>
      <Button
        onClick={() => {
          void navigate("/");
        }}
        type="button"
      >
        Back to Designer entry
      </Button>
    </div>
  );
}

function getDesktopSidebar(container: HTMLElement): HTMLElement {
  const sidebar = container.querySelector('[data-slot="sidebar"]');
  if (!(sidebar instanceof HTMLElement)) {
    throw new Error("Expected desktop sidebar element.");
  }

  return sidebar;
}

describe("App shell route transitions", () => {
  it("collapses the mounted sidebar when entering the Designer session workspace route", async () => {
    const router = createMemoryRouter(
      [
        {
          element: <RouteAwareShell />,
          children: [
            {
              element: <DesignerEntryRoute />,
              handle: ROUTE_HANDLES.home,
              path: "/",
            },
            {
              element: <DesignerSessionRoute />,
              handle: ROUTE_HANDLES.homeDetail,
              path: "/:sessionId",
            },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );

    const view = render(<RouterProvider router={router} />);
    const originalSidebar = getDesktopSidebar(view.container);

    expect(originalSidebar.getAttribute("data-state")).toBe("expanded");

    await act(async () => {
      screen.getByRole("button", { name: "Open mobile navigation" }).click();
    });

    expect(screen.getByText("Mobile navigation open")).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Start Designer session" }).click();
    });

    expect(await screen.findByText("Designer workspace")).toBeTruthy();
    expect(getDesktopSidebar(view.container)).toBe(originalSidebar);
    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("collapsed");
    expect(screen.getByText("Mobile navigation closed")).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Toggle navigation" }).click();
    });

    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("expanded");

    await act(async () => {
      screen.getByRole("button", { name: "Back to Designer entry" }).click();
    });

    expect(await screen.findByRole("button", { name: "Start Designer session" })).toBeTruthy();

    await act(async () => {
      screen.getByRole("button", { name: "Start Designer session" }).click();
    });

    expect(await screen.findByText("Designer workspace")).toBeTruthy();
    expect(getDesktopSidebar(view.container).getAttribute("data-state")).toBe("collapsed");
  });
});
