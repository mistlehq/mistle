// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DockviewApi } from "dockview";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { ResolvedAppearanceProvider } from "../appearance/appearance-provider.js";
import { DesignerCanvasWorkspace } from "./designer-session-page-view.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type DesignerCanvasWorkspaceProps = React.ComponentProps<typeof DesignerCanvasWorkspace>;
type RenderDesignerCanvasWorkspaceInput = Pick<DesignerCanvasWorkspaceProps, "tabs"> &
  Partial<Omit<DesignerCanvasWorkspaceProps, "tabs">> & {
    configureQueryClient?: (queryClient: QueryClient) => void;
  };

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class ResizeObserver {
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    };
  }
});

function renderDesignerCanvasWorkspace(input: RenderDesignerCanvasWorkspaceInput): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  seedAuthenticatedSession(queryClient);
  input.configureQueryClient?.(queryClient);

  const router = createMemoryRouter(
    [
      {
        path: "/designer/session_story",
        element: (
          <DesignerCanvasWorkspace
            activeTabHref={input.activeTabHref ?? null}
            {...(input.onApiReady === undefined ? {} : { onApiReady: input.onApiReady })}
            onActiveTabHrefChange={input.onActiveTabHrefChange ?? (() => {})}
            onTabClose={input.onTabClose ?? (() => {})}
            onTabsChange={input.onTabsChange ?? (() => {})}
            tabs={input.tabs}
          />
        ),
      },
    ],
    {
      initialEntries: ["/designer/session_story"],
    },
  );

  render(
    <ResolvedAppearanceProvider resolvedAppearance="light">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ResolvedAppearanceProvider>,
  );
}

function StatefulDesignerCanvasWorkspace(input: {
  initialActiveTabHref: string | null;
  initialTabs: DesignerCanvasWorkspaceProps["tabs"];
}): React.JSX.Element {
  const [activeTabHref, setActiveTabHref] = useState(input.initialActiveTabHref);
  const [tabs, setTabs] = useState(input.initialTabs);

  return (
    <DesignerCanvasWorkspace
      activeTabHref={activeTabHref}
      onActiveTabHrefChange={setActiveTabHref}
      onTabClose={(tabId) => {
        setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
      }}
      onTabsChange={setTabs}
      tabs={tabs}
    />
  );
}

function renderStatefulDesignerCanvasWorkspace(input: {
  activeTabHref: string | null;
  tabs: DesignerCanvasWorkspaceProps["tabs"];
}): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  seedAuthenticatedSession(queryClient);

  const router = createMemoryRouter(
    [
      {
        path: "/designer/session_story",
        element: (
          <StatefulDesignerCanvasWorkspace
            initialActiveTabHref={input.activeTabHref}
            initialTabs={input.tabs}
          />
        ),
      },
    ],
    {
      initialEntries: ["/designer/session_story"],
    },
  );

  render(
    <ResolvedAppearanceProvider resolvedAppearance="light">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ResolvedAppearanceProvider>,
  );
}

describe("DesignerCanvasWorkspace", () => {
  it("renders the empty canvas state when Designer has no tabs", () => {
    renderDesignerCanvasWorkspace({ tabs: [] });

    expect(screen.getByText("Canvas")).toBeDefined();
  });

  it("renders Designer canvas tab titles from metadata", async () => {
    renderDesignerCanvasWorkspace({
      tabs: [
        {
          id: "first-panel",
          title: "First Panel",
          href: "/designer-canvas-test-one",
        },
        {
          id: "second-panel",
          title: "Second Panel",
          href: "/designer-canvas-test-two",
        },
      ],
    });

    expect(await screen.findByText("First Panel")).toBeDefined();
    expect(await screen.findByText("Second Panel")).toBeDefined();
  });

  it("resolves integration detail tab titles from the integration directory data", async () => {
    const nextTabs: DesignerCanvasWorkspaceProps["tabs"][] = [];
    renderDesignerCanvasWorkspace({
      configureQueryClient: (queryClient) => {
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [
            {
              targetKey: "slack",
              familyId: "slack",
              variantId: "default",
              kind: "connector",
              enabled: true,
              config: {},
              displayName: "Slack",
              description: "Connect Slack.",
              targetHealth: {
                configStatus: "valid",
              },
            },
          ],
          connections: [],
        });
      },
      onTabsChange: (tabs) => {
        nextTabs.push(tabs);
      },
      tabs: [
        {
          id: "integrations",
          title: "Integrations",
          href: "/integrations/slack",
        },
      ],
    });

    await waitFor(() => {
      expect(nextTabs.at(-1)).toEqual([
        {
          id: "integrations",
          title: "Slack",
          href: "/integrations/slack",
        },
      ]);
    });
  });

  it("renders malformed integration tab hrefs as unsupported canvas routes", async () => {
    renderDesignerCanvasWorkspace({
      tabs: [
        {
          id: "malformed-integration",
          title: "Malformed integration",
          href: "/integrations/%E0%A4%A",
        },
      ],
    });

    expect(
      await screen.findByText("This route is not available in the Designer canvas."),
    ).toBeDefined();
  });

  it("keeps internal links inside the active Designer canvas tab", async () => {
    const nextTabs: DesignerCanvasWorkspaceProps["tabs"][] = [];
    renderDesignerCanvasWorkspace({
      activeTabHref: "/triggers",
      onTabsChange: (tabs) => {
        nextTabs.push(tabs);
      },
      tabs: [
        {
          id: "triggers",
          title: "Triggers",
          href: "/triggers",
        },
      ],
    });

    const createTriggerLink = await screen.findByRole("link", { name: "Create trigger" });
    fireEvent.click(createTriggerLink);

    expect(nextTabs.at(-1)).toEqual([
      {
        id: "triggers",
        title: "Create trigger",
        href: "/triggers/new",
      },
    ]);
  });

  it("renders trigger create tab hrefs in the Designer canvas", async () => {
    renderDesignerCanvasWorkspace({
      activeTabHref: "/triggers/new",
      tabs: [
        {
          id: "create-trigger",
          title: "Create trigger",
          href: "/triggers/new",
        },
      ],
    });

    expect(await screen.findByRole("region", { name: "Create trigger page" })).toBeDefined();
  });

  it("opens the trigger create route from the embedded triggers list", async () => {
    renderStatefulDesignerCanvasWorkspace({
      activeTabHref: "/triggers",
      tabs: [
        {
          id: "triggers",
          title: "Triggers",
          href: "/triggers",
        },
      ],
    });

    const createTriggerLink = await screen.findByRole("link", { name: "Create trigger" });
    fireEvent.click(createTriggerLink);

    expect(await screen.findByRole("region", { name: "Create trigger page" })).toBeDefined();
  });

  it("reports the closed Designer canvas tab id when Dockview closes a panel", async () => {
    const closedTabIds: string[] = [];
    let resolveApi: ((api: DockviewApi) => void) | null = null;
    const dockviewApiPromise = new Promise<DockviewApi>((resolve) => {
      resolveApi = resolve;
    });

    renderDesignerCanvasWorkspace({
      activeTabHref: "/integrations",
      onApiReady: (api) => {
        resolveApi?.(api);
      },
      onTabClose: (tabId) => {
        closedTabIds.push(tabId);
      },
      tabs: [
        {
          id: "integrations",
          title: "Integrations",
          href: "/integrations",
        },
        {
          id: "triggers",
          title: "Triggers",
          href: "/triggers",
        },
      ],
    });

    const dockviewApi = await dockviewApiPromise;
    const panel = dockviewApi.getPanel("integrations");
    if (panel === undefined) {
      throw new Error("Expected integrations panel to exist.");
    }
    dockviewApi.removePanel(panel);

    await waitFor(() => {
      expect(closedTabIds).toEqual(["integrations"]);
    });
  });
});
