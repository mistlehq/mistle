// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DockviewApi } from "dockview";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { ResolvedAppearanceProvider } from "../appearance/appearance-provider.js";
import { DesignerBlueprintCurrentTabHref } from "../designer/designer-blueprint-schema.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import {
  DesignerCanvasWorkspace,
  resolveDesignerBlueprintInitialFocusViewport,
} from "./designer-session-page-view.js";
import { OrganizationIntegrationsSettingsPage } from "./organization-integrations-settings-page.js";
import type {
  PendingSessionBlueprintComment,
  PendingSessionBlueprintCommentInput,
} from "./session-blueprint-comment.js";
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

const ApiKeyIntegrationTarget: IntegrationTarget = {
  targetKey: "openai-default",
  familyId: "openai",
  variantId: "openai-default",
  kind: "connector",
  enabled: true,
  config: {},
  displayName: "OpenAI",
  description: "Connect OpenAI.",
  connectionMethods: [
    {
      id: "api-key",
      label: "API key",
      kind: "form",
      createBehavior: "single-step",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const ProviderSetupIntegrationTarget: IntegrationTarget = {
  targetKey: "wasenderapi-mcp",
  familyId: "wasenderapi",
  variantId: "wasenderapi-mcp",
  kind: "connector",
  enabled: true,
  config: {},
  displayName: "WasenderAPI",
  description: "Connect WasenderAPI.",
  connectionMethods: [
    {
      id: "api-key",
      label: "Personal access token",
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        routeSegment: "provider-configuration",
        setupPane: {
          kind: "provider-configuration",
        },
        completionRequirements: {
          kind: "config-field",
          field: "provider_configuration_setup_completed",
        },
      },
      secretFields: [
        {
          name: "personalAccessToken",
          label: "Personal access token",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const CompletedProviderSetupConnection: IntegrationConnection = {
  id: "icn_wasenderapi_complete",
  targetKey: "wasenderapi-mcp",
  displayName: "WasenderAPI production",
  status: "active",
  connectionMethodId: "api-key",
  connectionMethodLabel: "Personal access token",
  config: {
    connection_method: "api-key",
    provider_configuration_setup_completed: "true",
  },
  configuredSecretNames: ["personalAccessToken"],
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
};

const ProviderAppSetupIntegrationTarget: IntegrationTarget = {
  targetKey: "github-cloud",
  familyId: "github",
  variantId: "github-cloud",
  kind: "git",
  enabled: true,
  config: {},
  displayName: "GitHub",
  description: "Connect GitHub.",
  connectionMethods: [
    {
      id: "github-app-installation",
      label: "GitHub App installation",
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        routeSegment: "github-app",
        setupPane: {
          kind: "provider-app",
        },
        completionRequirements: {
          kind: "any-of",
          anyOf: [
            {
              kind: "config-field",
              field: "installation_id",
            },
            {
              kind: "connection-external-subject",
            },
          ],
        },
      },
      secretFields: [
        {
          name: "webhookSecret",
          label: "Webhook secret",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const ProviderAppSetupConnection: IntegrationConnection = {
  id: "icn_github_provider_app_setup",
  targetKey: "github-cloud",
  displayName: "GitHub provider app",
  status: "active",
  connectionMethodId: "github-app-installation",
  connectionMethodLabel: "GitHub App installation",
  config: {
    connection_method: "github-app-installation",
    app_id: "12345",
    app_slug: "acme-mistle-agent",
    client_id: "Iv1.created",
  },
  configuredSecretNames: ["appPrivateKeyPem", "clientSecret", "webhookSecret"],
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
};

const ProviderAppSetupWebhookSource: IntegrationWebhookSource = {
  id: "iws_github_provider_app_setup",
  targetKey: "github-cloud",
  integrationConnectionId: ProviderAppSetupConnection.id,
  displayName: "GitHub App webhook",
  endpointKey: "eps_github_provider_app_setup",
  callbackUrl:
    "https://control-plane.example.com/p/integration/webhooks/github-cloud/eps_github_provider_app_setup",
  status: "active",
  providerMetadata: {},
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
};

const ManagedWebhookIntegrationTarget: IntegrationTarget = {
  targetKey: "linear-default",
  familyId: "linear",
  variantId: "linear-default",
  kind: "connector",
  enabled: true,
  config: {},
  displayName: "Linear",
  description: "Connect Linear.",
  connectionMethods: [
    {
      id: "api-key",
      label: "API key",
      kind: "form",
      createBehavior: "single-step",
      postCreate: {
        managedWebhookSource: {
          autoCreate: true,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Linear connection and webhook created successfully",
        },
      },
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
        },
      ],
    },
  ],
  targetHealth: {
    configStatus: "valid",
  },
};

const ManagedWebhookConnection: IntegrationConnection = {
  id: "icn_linear_managed_webhook",
  targetKey: "linear-default",
  displayName: "Linear production",
  status: "active",
  connectionMethodId: "api-key",
  connectionMethodLabel: "API key",
  config: {
    connection_method: "api-key",
  },
  configuredSecretNames: ["apiKey"],
  createdAt: "2026-06-25T00:00:00.000Z",
  updatedAt: "2026-06-25T00:00:00.000Z",
};

function renderDesignerCanvasRoute(input: {
  element: React.ReactNode;
  configureQueryClient?: (queryClient: QueryClient) => void;
}): void {
  cleanup();

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
        element: input.element,
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

function renderDesignerCanvasWorkspace(input: RenderDesignerCanvasWorkspaceInput): void {
  renderDesignerCanvasRoute({
    element: (
      <DesignerCanvasWorkspace
        activeTabHref={input.activeTabHref ?? null}
        {...(input.mountDockviewWhenEmpty === undefined
          ? {}
          : { mountDockviewWhenEmpty: input.mountDockviewWhenEmpty })}
        onAddBlueprintComment={input.onAddBlueprintComment ?? function onAddBlueprintComment() {}}
        {...(input.onApiReady === undefined ? {} : { onApiReady: input.onApiReady })}
        onActiveTabHrefChange={input.onActiveTabHrefChange ?? (() => {})}
        onDeleteBlueprintComment={
          input.onDeleteBlueprintComment ?? function onDeleteBlueprintComment() {}
        }
        onTabClose={input.onTabClose ?? (() => {})}
        onTabsChange={input.onTabsChange ?? (() => {})}
        onUpdateBlueprintComment={
          input.onUpdateBlueprintComment ?? function onUpdateBlueprintComment() {}
        }
        pendingBlueprintComments={input.pendingBlueprintComments ?? []}
        tabs={input.tabs}
      />
    ),
    ...(input.configureQueryClient === undefined
      ? {}
      : { configureQueryClient: input.configureQueryClient }),
  });
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
      onAddBlueprintComment={function onAddBlueprintComment() {}}
      onActiveTabHrefChange={setActiveTabHref}
      onDeleteBlueprintComment={function onDeleteBlueprintComment() {}}
      onTabClose={(tabId) => {
        setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
      }}
      onTabsChange={setTabs}
      onUpdateBlueprintComment={function onUpdateBlueprintComment() {}}
      pendingBlueprintComments={[]}
      tabs={tabs}
    />
  );
}

function UpdatingDesignerCanvasWorkspace(input: {
  onApiReady: (api: DockviewApi) => void;
}): React.JSX.Element {
  const [tabs, setTabs] = useState<DesignerCanvasWorkspaceProps["tabs"]>([
    {
      kind: "route",
      id: "integrations",
      title: "Integrations",
      href: "/integrations",
    },
  ]);

  return (
    <>
      <button
        onClick={() => {
          setTabs([
            {
              kind: "route",
              id: "integrations",
              title: "Slack",
              href: "/integrations/slack",
            },
          ]);
        }}
        type="button"
      >
        Refresh tab
      </button>
      <DesignerCanvasWorkspace
        activeTabHref="/integrations/slack"
        onAddBlueprintComment={function onAddBlueprintComment() {}}
        onActiveTabHrefChange={() => {}}
        onDeleteBlueprintComment={function onDeleteBlueprintComment() {}}
        onApiReady={input.onApiReady}
        onTabClose={() => {}}
        onTabsChange={setTabs}
        onUpdateBlueprintComment={function onUpdateBlueprintComment() {}}
        pendingBlueprintComments={[]}
        tabs={tabs}
      />
    </>
  );
}

function StatefulDesignerBlueprintCommentWorkspace(): React.JSX.Element {
  const [pendingComments, setPendingComments] = useState<readonly PendingSessionBlueprintComment[]>(
    [],
  );

  function addComment(comment: PendingSessionBlueprintCommentInput): void {
    setPendingComments((currentComments) => {
      const existingComment = currentComments.find(
        (currentComment) => currentComment.itemId === comment.itemId,
      );
      if (existingComment === undefined) {
        return [
          ...currentComments,
          {
            ...comment,
            id: `comment-${comment.itemId}`,
          },
        ];
      }

      return currentComments.map((currentComment) =>
        currentComment.id === existingComment.id
          ? {
              ...currentComment,
              ...comment,
            }
          : currentComment,
      );
    });
  }

  return (
    <DesignerCanvasWorkspace
      activeTabHref={DesignerBlueprintCurrentTabHref}
      onAddBlueprintComment={addComment}
      onActiveTabHrefChange={() => {}}
      onDeleteBlueprintComment={(commentId) => {
        setPendingComments((currentComments) =>
          currentComments.filter((comment) => comment.id !== commentId),
        );
      }}
      onTabClose={() => {}}
      onTabsChange={() => {}}
      onUpdateBlueprintComment={(commentId, body) => {
        setPendingComments((currentComments) =>
          currentComments.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  body,
                }
              : comment,
          ),
        );
      }}
      pendingBlueprintComments={pendingComments}
      tabs={[
        {
          kind: "blueprint",
          id: "designer-blueprint-current",
          title: "Blueprint",
          href: DesignerBlueprintCurrentTabHref,
          blueprint: {
            version: 1,
            title: "Issue triage blueprint",
            outcome: {
              label: "Route incoming issues into the right queue",
            },
            items: [
              {
                id: "classify-issue",
                kind: "agent_step",
                label: "Classify issue",
                description: "Determine type, priority, owner, and missing information.",
                state: "needs_setup",
              },
            ],
            links: [],
            actions: [],
          },
        },
      ]}
    />
  );
}

function renderStatefulDesignerCanvasWorkspace(input: {
  activeTabHref: string | null;
  tabs: DesignerCanvasWorkspaceProps["tabs"];
}): void {
  renderDesignerCanvasRoute({
    element: (
      <StatefulDesignerCanvasWorkspace
        initialActiveTabHref={input.activeTabHref}
        initialTabs={input.tabs}
      />
    ),
  });
}

function renderUpdatingDesignerCanvasWorkspace(input: {
  onApiReady: (api: DockviewApi) => void;
}): void {
  renderDesignerCanvasRoute({
    element: <UpdatingDesignerCanvasWorkspace onApiReady={input.onApiReady} />,
  });
}

describe("DesignerCanvasWorkspace", () => {
  it("renders the empty canvas state when Designer has no tabs", () => {
    renderDesignerCanvasWorkspace({ tabs: [] });

    expect(screen.getByText("Canvas")).toBeDefined();
  });

  it("can mount the Designer canvas workspace while it has no tabs", async () => {
    let resolveApi: ((api: DockviewApi) => void) | null = null;
    const dockviewApiPromise = new Promise<DockviewApi>((resolve) => {
      resolveApi = resolve;
    });

    renderDesignerCanvasWorkspace({
      mountDockviewWhenEmpty: true,
      onApiReady: (api) => {
        resolveApi?.(api);
      },
      tabs: [],
    });

    const dockviewApi = await dockviewApiPromise;
    expect(dockviewApi.panels).toHaveLength(0);
    expect(screen.queryByText("Canvas")).toBeNull();
  });

  it("renders Designer canvas tab titles from metadata", async () => {
    renderDesignerCanvasWorkspace({
      tabs: [
        {
          kind: "route",
          id: "first-panel",
          title: "First Panel",
          href: "/designer-canvas-test-one",
        },
        {
          kind: "route",
          id: "second-panel",
          title: "Second Panel",
          href: "/designer-canvas-test-two",
        },
      ],
    });

    expect(await screen.findByText("First Panel")).toBeDefined();
    expect(await screen.findByText("Second Panel")).toBeDefined();
  });

  it("renders an integration connection create route inside the Designer canvas", async () => {
    renderDesignerCanvasWorkspace({
      activeTabHref: "/integrations/openai-default/add",
      configureQueryClient: (queryClient) => {
        queryClient.setQueryDefaults(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          staleTime: Infinity,
        });
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [ApiKeyIntegrationTarget],
          connections: [],
        });
      },
      tabs: [
        {
          kind: "route",
          id: "openai-setup",
          title: "Set up OpenAI",
          href: "/integrations/openai-default/add",
        },
      ],
    });

    expect(await screen.findByLabelText("Name")).toBeDefined();
    expect(await screen.findByText("API key")).toBeDefined();
    expect(screen.getByText("Set up OpenAI")).toBeDefined();
    expect(screen.queryByText("Integrations")).toBeNull();
  });

  it("keeps completed integration setup visible in a Designer canvas tab", async () => {
    renderDesignerCanvasWorkspace({
      activeTabHref:
        "/integrations/wasenderapi-mcp/icn_wasenderapi_complete/provider-configuration/setup",
      configureQueryClient: (queryClient) => {
        queryClient.setQueryDefaults(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          staleTime: Infinity,
        });
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [ProviderSetupIntegrationTarget],
          connections: [CompletedProviderSetupConnection],
        });
        queryClient.setQueryData(organizationSummaryQueryKey("org_123"), {
          name: "Acme",
        });
      },
      tabs: [
        {
          kind: "route",
          id: "wasenderapi-setup",
          title: "Set up WasenderAPI",
          href: "/integrations/wasenderapi-mcp/icn_wasenderapi_complete/provider-configuration/setup",
        },
      ],
    });

    expect(await screen.findByText("Integration setup complete")).toBeDefined();
    expect(await screen.findByRole("button", { name: "View connection" })).toBeDefined();
    expect(screen.getByText("Set up WasenderAPI")).toBeDefined();
    expect(screen.queryByText("Integrations")).toBeNull();
  });

  it("renders embedded provider app setup in a Designer canvas tab", async () => {
    const setupHref =
      "/integrations/github-cloud/icn_github_provider_app_setup/github-app/setup?githubAppManifest=created";

    renderDesignerCanvasWorkspace({
      activeTabHref: setupHref,
      configureQueryClient: (queryClient) => {
        queryClient.setQueryDefaults(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          staleTime: Infinity,
        });
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [ProviderAppSetupIntegrationTarget],
          connections: [ProviderAppSetupConnection],
        });
        queryClient.setQueryData(
          ["integration-webhook-sources", ProviderAppSetupConnection.id],
          [ProviderAppSetupWebhookSource],
        );
      },
      tabs: [
        {
          kind: "route",
          id: "github-app-setup",
          title: "Set up GitHub",
          href: setupHref,
        },
      ],
    });

    expect(await screen.findByText("GitHub App created")).toBeDefined();
    expect(await screen.findByRole("button", { name: "Install GitHub App" })).toBeDefined();
    expect(screen.getByText("Set up GitHub")).toBeDefined();
    expect(screen.queryByText("Open setup in the full dashboard")).toBeNull();
  });

  it("renders embedded managed-webhook setup notices from route state", async () => {
    renderDesignerCanvasRoute({
      configureQueryClient: (queryClient) => {
        queryClient.setQueryDefaults(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          staleTime: Infinity,
        });
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [ManagedWebhookIntegrationTarget],
          connections: [ManagedWebhookConnection],
        });
      },
      element: (
        <OrganizationIntegrationsSettingsPage
          embeddedRoute={{
            detailTargetKey: "linear-default",
            locationState: {
              managedWebhookSetup: {
                status: "created",
                webhookSourceId: "iws_linear_managed_webhook",
              },
            },
            navigate: () => {},
            searchParams: new URLSearchParams({
              connectionId: ManagedWebhookConnection.id,
            }),
            setSearchParams: () => {},
          }}
        />
      ),
    });

    expect(
      await screen.findByText("Linear connection and webhook created successfully"),
    ).toBeDefined();
  });

  it("renders blueprint tabs as a visual-only React Flow graph", async () => {
    renderDesignerCanvasWorkspace({
      activeTabHref: DesignerBlueprintCurrentTabHref,
      configureQueryClient: (queryClient) => {
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [
            {
              targetKey: "github-cloud",
              familyId: "github",
              variantId: "github-cloud",
              kind: "git",
              enabled: true,
              config: {},
              displayName: "GitHub",
              description: "Connect GitHub.",
              logoKey: "github",
              targetHealth: {
                configStatus: "valid",
              },
            },
          ],
          connections: [],
        });
      },
      tabs: [
        {
          kind: "blueprint",
          id: "designer-blueprint-current",
          title: "Blueprint",
          href: DesignerBlueprintCurrentTabHref,
          blueprint: {
            version: 1,
            title: "Issue triage blueprint",
            outcome: {
              label: "Route incoming issues into the right queue",
            },
            items: [
              {
                id: "issue-opened",
                kind: "trigger",
                label: "GitHub issue trigger",
                integrationTargetKey: "github-cloud",
                integrationLabel: "GitHub",
                eventLabel: "Issue opened",
                state: "proposed",
              },
              {
                id: "classify-issue",
                kind: "agent_step",
                label: "Classify issue",
                description: "Determine type, priority, owner, and missing information.",
                state: "needs_setup",
              },
              {
                id: "triage-summary",
                kind: "workflow_output",
                label: "Triage summary",
                state: "proposed",
              },
            ],
            links: [
              {
                from: "issue-opened",
                to: "classify-issue",
                kind: "triggers",
              },
              {
                from: "classify-issue",
                to: "triage-summary",
                kind: "produces",
              },
            ],
            actions: [
              {
                id: "create-trigger",
                itemId: "issue-opened",
                kind: "open_trigger_create",
                label: "Create trigger",
                href: "/triggers/new",
              },
            ],
          },
        },
      ],
    });

    expect(await screen.findByText("Issue opened")).toBeDefined();
    expect(await screen.findByLabelText("GitHub · Trigger")).toBeDefined();
    await waitFor(() => {
      expect(
        document.querySelector(`img[src="${resolveIntegrationLogoPath({ logoKey: "github" })}"]`),
      ).toBeDefined();
    });
    expect(await screen.findByText("Classify issue")).toBeDefined();
    expect(await screen.findByText("Triage summary")).toBeDefined();
    expect(screen.getByRole("region", { name: "Designer blueprint graph" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Create trigger" })).toBeNull();
  });

  it("adds, edits, and deletes pending comments on blueprint nodes", async () => {
    renderDesignerCanvasRoute({
      element: <StatefulDesignerBlueprintCommentWorkspace />,
    });

    expect(await screen.findByText("Classify issue")).toBeDefined();
    const addCommentNode = await screen.findByTestId("designer-blueprint-node-classify-issue");
    const addCommentHint = await screen.findByTestId(
      "designer-blueprint-add-comment-hint-classify-issue",
    );
    expect(addCommentHint.textContent).toContain("Click to add comment");
    fireEvent.click(addCommentNode);
    fireEvent.change(screen.getByTestId("designer-blueprint-new-comment"), {
      target: { value: "Ask for missing severity before assigning an owner." },
    });
    fireEvent.keyDown(screen.getByTestId("designer-blueprint-new-comment"), {
      key: "Enter",
    });

    expect(screen.queryByText("Pending comment")).toBeNull();
    fireEvent.click(
      await screen.findByTestId("designer-blueprint-collapsed-comment-classify-issue"),
    );
    expect(await screen.findByText("Pending comment")).toBeDefined();
    expect(screen.getByTestId("designer-blueprint-comment")).toHaveProperty(
      "value",
      "Ask for missing severity before assigning an owner.",
    );

    fireEvent.click(screen.getByTestId("designer-blueprint-collapse-comment"));
    expect(screen.queryByText("Pending comment")).toBeNull();
    fireEvent.click(screen.getByTestId("designer-blueprint-collapsed-comment-classify-issue"));

    fireEvent.change(screen.getByTestId("designer-blueprint-comment"), {
      target: { value: "Ask for severity first." },
    });
    fireEvent.keyDown(screen.getByTestId("designer-blueprint-comment"), {
      key: "Enter",
    });
    expect(screen.getByTestId("designer-blueprint-comment")).toHaveProperty(
      "value",
      "Ask for severity first.",
    );

    fireEvent.change(screen.getByTestId("designer-blueprint-comment"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByTestId("designer-blueprint-comment"), {
      key: "Enter",
    });
    expect(screen.getByTestId("designer-blueprint-comment")).toHaveProperty(
      "value",
      "Ask for severity first.",
    );

    fireEvent.click(screen.getByTestId("designer-blueprint-delete-comment"));
    expect(screen.queryByText("Pending comment")).toBeNull();
    expect(screen.queryByTestId("designer-blueprint-add-comment-hint-classify-issue")).toBeNull();
  });

  it("centers the blueprint graph horizontally near the top of the canvas viewport", () => {
    expect(
      resolveDesignerBlueprintInitialFocusViewport({
        graphBounds: { x: 120, y: 24, width: 760, height: 520 },
        width: 1000,
      }),
    ).toEqual({
      x: 25,
      y: 33.2,
      zoom: 0.95,
    });
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
          kind: "route",
          id: "integrations",
          title: "Integrations",
          href: "/integrations/slack",
        },
      ],
    });

    await waitFor(() => {
      expect(nextTabs.at(-1)).toEqual([
        {
          kind: "route",
          id: "integrations",
          title: "Slack",
          href: "/integrations/slack",
        },
      ]);
    });
  });

  it("updates refreshed tab parameters without recreating the Dockview panel", async () => {
    let resolveApi: ((api: DockviewApi) => void) | null = null;
    const dockviewApiPromise = new Promise<DockviewApi>((resolve) => {
      resolveApi = resolve;
    });

    renderUpdatingDesignerCanvasWorkspace({
      onApiReady: (api) => {
        resolveApi?.(api);
      },
    });

    const dockviewApi = await dockviewApiPromise;
    const originalPanel = dockviewApi.getPanel("integrations");
    if (originalPanel === undefined) {
      throw new Error("Expected integrations panel to exist.");
    }

    fireEvent.click(screen.getByRole("button", { name: "Refresh tab" }));

    await waitFor(() => {
      expect(dockviewApi.getPanel("integrations")).toBe(originalPanel);
      expect(dockviewApi.panels).toHaveLength(1);
    });
  });

  it("renders malformed integration tab hrefs as unsupported canvas routes", async () => {
    renderDesignerCanvasWorkspace({
      tabs: [
        {
          kind: "route",
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
          kind: "route",
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
        kind: "route",
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
          kind: "route",
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
          kind: "route",
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
          kind: "route",
          id: "integrations",
          title: "Integrations",
          href: "/integrations",
        },
        {
          kind: "route",
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
