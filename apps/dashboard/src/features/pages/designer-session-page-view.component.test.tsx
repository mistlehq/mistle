// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
            onActiveTabHrefChange={input.onActiveTabHrefChange ?? (() => {})}
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
});
