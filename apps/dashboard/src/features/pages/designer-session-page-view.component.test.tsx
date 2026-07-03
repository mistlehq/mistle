// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DockviewApi } from "dockview-react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { ResolvedAppearanceProvider } from "../appearance/appearance-provider.js";
import {
  DesignerBlueprintCurrentTabHref,
  type DesignerBlueprintDocument,
} from "../designer/designer-blueprint-schema.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
  IntegrationWebhookSource,
} from "../integrations/integrations-service.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { organizationSummaryQueryKey } from "../shell/organization-summary.js";
import {
  buildDesignerBlueprintGraph,
  DesignerCanvasWorkspace,
  resolveDesignerBlueprintProcessLaneSlotHeight,
  resolveDesignerBlueprintInitialFocusViewportForNodes,
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
        path: "/session_story",
        element: input.element,
      },
    ],
    {
      initialEntries: ["/session_story"],
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
        designerSessionId={input.designerSessionId ?? "designer_session_test"}
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
      designerSessionId="designer_session_test"
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
        designerSessionId="designer_session_test"
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
      designerSessionId="designer_session_test"
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
              {
                id: "triage-summary",
                kind: "workflow_output",
                label: "Triage summary",
                description: "Summarize the issue routing decision.",
                state: "applied",
              },
            ],
            links: [
              {
                from: "classify-issue",
                to: "triage-summary",
                kind: "produces",
              },
            ],
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

async function findDesignerBlueprintGraphForNode(nodeTestId: string): Promise<HTMLElement> {
  const node = await screen.findByTestId(nodeTestId);
  const graph = node.closest<HTMLElement>('section[aria-label="Designer blueprint graph"]');
  if (graph === null) {
    throw new Error(`Designer blueprint graph was not mounted for ${nodeTestId}.`);
  }

  return graph;
}

function getRequiredDesignerBlueprintGraphNode(
  graph: Awaited<ReturnType<typeof buildDesignerBlueprintGraph>>,
  nodeId: string,
): Awaited<ReturnType<typeof buildDesignerBlueprintGraph>>["nodes"][number] {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new Error(`Expected Designer blueprint graph node '${nodeId}'.`);
  }

  return node;
}

function getDesignerBlueprintGraphNodeCenterX(
  node: Awaited<ReturnType<typeof buildDesignerBlueprintGraph>>["nodes"][number],
): number {
  return node.position.x + resolveDesignerBlueprintGraphNodeWidth(node) / 2;
}

function getDesignerBlueprintGraphNodeGroupCenterX(
  nodes: readonly Awaited<ReturnType<typeof buildDesignerBlueprintGraph>>["nodes"][number][],
): number {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + resolveDesignerBlueprintGraphNodeWidth(node));
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    throw new Error("Expected at least one Designer blueprint graph node.");
  }

  return minX + (maxX - minX) / 2;
}

function resolveDesignerBlueprintGraphNodeWidth(
  node: Awaited<ReturnType<typeof buildDesignerBlueprintGraph>>["nodes"][number],
): number {
  return node.data.kind === "outcome" ||
    node.data.routingSummaryRows !== undefined ||
    node.data.triggerConditionRows !== undefined
    ? 440
    : 280;
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
    const setupHref =
      "/integrations/wasenderapi-mcp/icn_wasenderapi_complete/provider-configuration/setup";

    renderDesignerCanvasRoute({
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
      element: (
        <StatefulDesignerCanvasWorkspace
          initialActiveTabHref={setupHref}
          initialTabs={[
            {
              kind: "route",
              id: "wasenderapi-setup",
              title: "Set up WasenderAPI",
              href: setupHref,
            },
          ]}
        />
      ),
    });

    expect(await screen.findByText("Integration setup complete")).toBeDefined();
    expect(screen.getByText("Set up WasenderAPI")).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "View connection" }));

    expect(await screen.findAllByText("WasenderAPI production")).not.toHaveLength(0);
    expect(screen.getAllByText("Personal access token")).not.toHaveLength(0);
    expect(screen.queryByText("Integrations")).toBeNull();
  });

  it("renders an integration connection detail route inside the Designer canvas", async () => {
    const connectionHref = "/integrations/wasenderapi-mcp/icn_wasenderapi_complete";

    renderDesignerCanvasWorkspace({
      activeTabHref: connectionHref,
      configureQueryClient: (queryClient) => {
        queryClient.setQueryDefaults(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          staleTime: Infinity,
        });
        queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
          targets: [ProviderSetupIntegrationTarget],
          connections: [CompletedProviderSetupConnection],
        });
      },
      tabs: [
        {
          kind: "route",
          id: "wasenderapi-connection",
          title: "WasenderAPI connection",
          href: connectionHref,
        },
      ],
    });

    expect(await screen.findAllByText("WasenderAPI production")).not.toHaveLength(0);
    expect(screen.getAllByText("Personal access token")).not.toHaveLength(0);
    expect(screen.queryByText("This route is not available in the Designer canvas.")).toBeNull();
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
                integrationTargetKey: "github-cloud",
                state: "proposed",
                when: [
                  {
                    label: "GitHub issue opened",
                  },
                  {
                    label: "Ready label is present",
                  },
                ],
              },
              {
                id: "classify-issue",
                kind: "agent_step",
                label: "Classify issue",
                description: "Determine type, priority, owner, and missing information.",
                state: "needs_setup",
              },
              {
                id: "readiness-route",
                kind: "routing_policy",
                state: "proposed",
                rules: [
                  {
                    conditionLabel: "Ready to implement",
                    when: [
                      {
                        field: "issue.ready",
                        operator: "equals",
                        value: true,
                      },
                    ],
                    routeTo: "triage-summary",
                  },
                  {
                    conditionLabel: "Needs manual escalation",
                    when: [
                      {
                        field: "issue.priority",
                        operator: "equals",
                        value: "urgent",
                      },
                    ],
                    routeTo: "urgent-queue",
                  },
                  {
                    conditionLabel: "Needs clarification",
                    when: [
                      {
                        field: "issue.ready",
                        operator: "equals",
                        value: false,
                      },
                    ],
                    routeTo: "triage-summary",
                  },
                  {
                    conditionLabel: "Needs backlog review",
                    when: [
                      {
                        field: "issue.priority",
                        operator: "equals",
                        value: "low",
                      },
                    ],
                    routeTo: "backlog-queue",
                  },
                ],
              },
              {
                id: "triage-summary",
                kind: "workflow_output",
                label: "Triage summary",
                state: "proposed",
              },
              {
                id: "urgent-queue",
                kind: "workflow_output",
                label: "Queue",
                state: "proposed",
              },
              {
                id: "backlog-queue",
                kind: "workflow_output",
                label: "Queue",
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
                to: "readiness-route",
                kind: "routes_to",
              },
              {
                from: "readiness-route",
                to: "triage-summary",
                kind: "routes_to",
              },
              {
                from: "readiness-route",
                to: "urgent-queue",
                kind: "routes_to",
              },
              {
                from: "readiness-route",
                to: "backlog-queue",
                kind: "routes_to",
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

    expect(await screen.findByText("Route incoming issues into the right queue")).toBeDefined();
    expect(screen.getByText("Outcome")).toBeDefined();
    expect(
      screen.getByTestId("designer-blueprint-node-__designer_blueprint_outcome"),
    ).toBeDefined();
    expect(
      screen.queryByRole("button", {
        name: "Add comment to Route incoming issues into the right queue",
      }),
    ).toBeNull();
    const triggerRows = await screen.findAllByTestId("designer-blueprint-trigger-condition-row");
    expect(triggerRows).toHaveLength(2);
    expect(triggerRows.every((row) => row.textContent?.startsWith("When") ?? false)).toBe(true);
    expect(triggerRows[0]?.textContent).toContain("GitHub issue opened");
    expect(triggerRows[1]?.textContent).toContain("Ready label is present");
    expect(screen.queryByText("Issue opened")).toBeNull();
    expect(screen.queryByLabelText("GitHub · Trigger")).toBeNull();
    await waitFor(() => {
      expect(
        triggerRows[0]?.querySelector(
          `img[src="${resolveIntegrationLogoPath({ logoKey: "github" })}"]`,
        ),
      ).toBeDefined();
    });
    expect(await screen.findByText("Classify issue")).toBeDefined();
    expect(screen.queryByText("Route readiness outcome")).toBeNull();
    expect(screen.queryByLabelText("Routing Policy")).toBeNull();
    expect(
      screen.queryByText(
        "Send ready work to implementation and unclear work back for clarification.",
      ),
    ).toBeNull();
    const routingRows = await screen.findAllByTestId("designer-blueprint-routing-summary-row");
    expect(routingRows).toHaveLength(4);
    expect(routingRows.every((row) => row.textContent?.startsWith("If") ?? false)).toBe(true);
    expect(routingRows[0]?.textContent).toContain("Ready to implement");
    expect(routingRows[0]?.textContent).toContain("Triage summary");
    expect(routingRows[0]?.textContent).not.toContain("Triage summary:");
    expect(routingRows[1]?.textContent).toContain("Needs manual escalation");
    expect(routingRows[1]?.textContent).toContain("Queue (urgent-queue)");
    expect(routingRows[2]?.textContent).toContain("Needs clarification");
    expect(routingRows[2]?.textContent).toContain("Triage summary");
    expect(routingRows[3]?.textContent).toContain("Needs backlog review");
    expect(routingRows[3]?.textContent).toContain("Queue (backlog-queue)");
    expect(screen.queryByText("2 routing rules")).toBeNull();
    expect(
      await findDesignerBlueprintGraphForNode("designer-blueprint-node-classify-issue"),
    ).toBeDefined();
    expect(screen.getAllByText("Triage summary")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Create trigger" })).toBeNull();
  });

  it("adds, edits, and deletes pending comments on blueprint nodes", async () => {
    renderDesignerCanvasRoute({
      element: <StatefulDesignerBlueprintCommentWorkspace />,
    });

    expect(
      await findDesignerBlueprintGraphForNode("designer-blueprint-node-classify-issue"),
    ).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("Laying out blueprint.")).toBeNull();
    });
    const addCommentNode = await screen.findByTestId("designer-blueprint-node-classify-issue");
    const addCommentHint = await screen.findByTestId(
      "designer-blueprint-add-comment-hint-classify-issue",
    );
    expect(addCommentHint.textContent).toContain("Click to add comment");
    fireEvent.click(addCommentNode);
    await waitFor(() => {
      expect(
        addCommentNode.contains(screen.getByTestId("designer-blueprint-floating-comment")),
      ).toBe(false);
    });
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
    expect(addCommentNode.contains(screen.getByTestId("designer-blueprint-floating-comment"))).toBe(
      false,
    );
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

  it("keeps only one blueprint comment editor open at a time", async () => {
    renderDesignerCanvasRoute({
      element: <StatefulDesignerBlueprintCommentWorkspace />,
    });

    expect(
      await findDesignerBlueprintGraphForNode("designer-blueprint-node-classify-issue"),
    ).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("Laying out blueprint.")).toBeNull();
    });
    const classifyIssueNode = await screen.findByTestId("designer-blueprint-node-classify-issue");
    const triageSummaryNode = await screen.findByTestId("designer-blueprint-node-triage-summary");

    fireEvent.click(classifyIssueNode);
    expect(await screen.findByTestId("designer-blueprint-new-comment")).toBeDefined();
    await waitFor(() => {
      expect(screen.getAllByTestId("designer-blueprint-floating-comment")).toHaveLength(1);
    });

    fireEvent.click(triageSummaryNode);
    expect(await screen.findByTestId("designer-blueprint-new-comment")).toBeDefined();
    expect(screen.getAllByTestId("designer-blueprint-floating-comment")).toHaveLength(1);

    fireEvent.change(screen.getByTestId("designer-blueprint-new-comment"), {
      target: { value: "Include the final routing reason." },
    });
    fireEvent.keyDown(screen.getByTestId("designer-blueprint-new-comment"), {
      key: "Enter",
    });

    fireEvent.click(
      await screen.findByTestId("designer-blueprint-collapsed-comment-triage-summary"),
    );
    expect(screen.getAllByTestId("designer-blueprint-floating-comment")).toHaveLength(1);
    expect(screen.getByTestId("designer-blueprint-comment")).toHaveProperty(
      "value",
      "Include the final routing reason.",
    );

    fireEvent.click(classifyIssueNode);
    expect(await screen.findByTestId("designer-blueprint-new-comment")).toBeDefined();
    expect(screen.getAllByTestId("designer-blueprint-floating-comment")).toHaveLength(1);
  });

  it("closes an open blueprint comment when the pointer starts outside the comment box", async () => {
    renderDesignerCanvasRoute({
      element: <StatefulDesignerBlueprintCommentWorkspace />,
    });

    const graph = await findDesignerBlueprintGraphForNode("designer-blueprint-node-classify-issue");
    const classifyIssueNode = await screen.findByTestId("designer-blueprint-node-classify-issue");

    fireEvent.click(classifyIssueNode);
    const draftComment = await screen.findByTestId("designer-blueprint-floating-comment");
    expect(await screen.findByTestId("designer-blueprint-new-comment")).toBeDefined();

    fireEvent.pointerDown(draftComment);
    expect(screen.getByTestId("designer-blueprint-new-comment")).toBeDefined();

    fireEvent.pointerDown(graph);
    await waitFor(() => {
      expect(screen.queryByTestId("designer-blueprint-new-comment")).toBeNull();
      expect(screen.queryByTestId("designer-blueprint-floating-comment")).toBeNull();
    });
  });

  it("centers the blueprint graph horizontally near the top of the canvas viewport", () => {
    const viewport = resolveDesignerBlueprintInitialFocusViewportForNodes({
      nodes: [
        {
          position: { x: 120, y: 24 },
        },
        {
          position: { x: 600, y: 180 },
        },
      ],
      width: 1000,
    });
    expect(viewport?.x).toBe(25);
    expect(viewport?.y).toBeCloseTo(1.2);
    expect(viewport?.zoom).toBe(0.95);
  });

  it("reserves right-side viewport room for blueprint loopback edges", () => {
    expect(
      resolveDesignerBlueprintInitialFocusViewportForNodes({
        nodes: [
          {
            position: { x: 0, y: 0 },
          },
          {
            position: { x: 260, y: 360 },
          },
        ],
        rightPadding: 260,
        width: 1000,
        zoom: 0.82,
      }),
    ).toEqual({
      x: 172,
      y: 24,
      zoom: 0.82,
    });
  });

  it("accounts for wider routing nodes when centering the blueprint graph", () => {
    expect(
      resolveDesignerBlueprintInitialFocusViewportForNodes({
        nodes: [
          {
            data: {
              routingSummaryRows: [
                {
                  nextStepLabel: "Plan, edit, and test",
                  outcomeLabel: "Changes requested",
                },
              ],
            },
            position: { x: 0, y: 0 },
          },
          {
            position: { x: 600, y: 180 },
          },
        ],
        width: 1000,
      }),
    ).toEqual({
      x: 82,
      y: 24,
      zoom: 0.95,
    });
  });

  it("reserves process-lane space for compact blueprint routing summaries", () => {
    expect(
      resolveDesignerBlueprintProcessLaneSlotHeight({
        description:
          "Send accepted work toward human merge; send requested changes back to implementation; mark unclear or blocked work appropriately.",
        routingSummaryRows: [
          {
            nextStepLabel: "Plan, edit, and test",
            outcomeLabel: "Changes requested",
          },
          {
            nextStepLabel: "Update issue status",
            outcomeLabel: "Accepted",
          },
          {
            nextStepLabel: "Update issue status",
            outcomeLabel: "Blocked or unclear",
          },
        ],
      }),
    ).toBe(144);
  });

  it("lays multiple triggers as sibling sources into the first workflow node", async () => {
    const graph = await buildDesignerBlueprintGraph({
      blueprint: {
        version: 1,
        title: "Multi-trigger blueprint",
        outcome: {
          label: "Start from either intake source",
        },
        items: [
          {
            id: "slack-trigger",
            kind: "trigger",
            state: "proposed",
            when: [{ label: "Slack message received" }],
          },
          {
            id: "linear-trigger",
            kind: "trigger",
            state: "proposed",
            when: [{ label: "Linear issue ready" }],
          },
          {
            id: "normalize-context",
            kind: "agent_step",
            label: "Normalize context",
            state: "proposed",
          },
        ],
        links: [
          {
            from: "slack-trigger",
            to: "normalize-context",
            kind: "triggers",
          },
          {
            from: "linear-trigger",
            to: "normalize-context",
            kind: "triggers",
          },
        ],
        actions: [],
      } satisfies DesignerBlueprintDocument,
      integrationMetadataByTargetKey: new Map<string, never>(),
    });

    const slackTrigger = getRequiredDesignerBlueprintGraphNode(graph, "slack-trigger");
    const linearTrigger = getRequiredDesignerBlueprintGraphNode(graph, "linear-trigger");
    const normalizeContext = getRequiredDesignerBlueprintGraphNode(graph, "normalize-context");
    const outcome = getRequiredDesignerBlueprintGraphNode(graph, "__designer_blueprint_outcome");
    const triggerEdges = graph.edges.filter((edge) => edge.target === "normalize-context");

    expect(slackTrigger.position.y).toBe(linearTrigger.position.y);
    expect(slackTrigger.position.x).not.toBe(linearTrigger.position.x);
    expect(normalizeContext.position.y).toBeGreaterThan(slackTrigger.position.y);
    expect(getDesignerBlueprintGraphNodeCenterX(normalizeContext)).toBe(
      getDesignerBlueprintGraphNodeCenterX(outcome),
    );
    expect(triggerEdges).toHaveLength(2);
    expect(triggerEdges.every((edge) => edge.type === "curved")).toBe(true);
  });

  it("lays routing destinations as sibling branches that converge downstream", async () => {
    const graph = await buildDesignerBlueprintGraph({
      blueprint: {
        version: 1,
        title: "Routing blueprint",
        outcome: {
          label: "Route inbound work",
        },
        items: [
          {
            id: "incoming-item",
            kind: "trigger",
            state: "proposed",
            when: [{ label: "Inbound item received" }],
          },
          {
            id: "classify",
            kind: "agent_step",
            label: "Classify item",
            state: "proposed",
          },
          {
            id: "route-triage",
            kind: "routing_policy",
            state: "proposed",
            rules: [
              {
                conditionLabel: "Urgent",
                when: [{ field: "severity", operator: "equals", value: "urgent" }],
                routeTo: "escalate",
              },
              {
                conditionLabel: "Missing context",
                when: [{ field: "required_context", operator: "empty" }],
                routeTo: "request-info",
              },
              {
                conditionLabel: "Ready",
                when: [{ field: "routing_ready", operator: "equals", value: true }],
                routeTo: "route-owner",
              },
            ],
          },
          {
            id: "escalate",
            kind: "agent_step",
            label: "Escalate priority work",
            state: "proposed",
          },
          {
            id: "request-info",
            kind: "agent_step",
            label: "Ask for missing context",
            state: "proposed",
          },
          {
            id: "route-owner",
            kind: "agent_step",
            label: "Route to owner or queue",
            state: "proposed",
          },
          {
            id: "triage-update",
            kind: "workflow_output",
            label: "Triage update",
            state: "proposed",
          },
        ],
        links: [
          {
            from: "incoming-item",
            to: "classify",
            kind: "triggers",
          },
          {
            from: "classify",
            to: "route-triage",
            kind: "requires",
          },
          {
            from: "route-triage",
            to: "escalate",
            kind: "routes_to",
          },
          {
            from: "route-triage",
            to: "request-info",
            kind: "routes_to",
          },
          {
            from: "route-triage",
            to: "route-owner",
            kind: "routes_to",
          },
          {
            from: "escalate",
            to: "triage-update",
            kind: "produces",
          },
          {
            from: "request-info",
            to: "triage-update",
            kind: "produces",
          },
          {
            from: "route-owner",
            to: "triage-update",
            kind: "produces",
          },
        ],
        actions: [],
      } satisfies DesignerBlueprintDocument,
      integrationMetadataByTargetKey: new Map<string, never>(),
    });

    const routeTriage = getRequiredDesignerBlueprintGraphNode(graph, "route-triage");
    const escalate = getRequiredDesignerBlueprintGraphNode(graph, "escalate");
    const requestInfo = getRequiredDesignerBlueprintGraphNode(graph, "request-info");
    const routeOwner = getRequiredDesignerBlueprintGraphNode(graph, "route-owner");
    const triageUpdate = getRequiredDesignerBlueprintGraphNode(graph, "triage-update");
    const outcome = getRequiredDesignerBlueprintGraphNode(graph, "__designer_blueprint_outcome");
    const routingEdges = graph.edges.filter((edge) => edge.source === "route-triage");
    const convergenceEdges = graph.edges.filter((edge) => edge.target === "triage-update");

    expect(escalate.position.y).toBe(requestInfo.position.y);
    expect(requestInfo.position.y).toBe(routeOwner.position.y);
    expect(new Set([escalate.position.x, requestInfo.position.x, routeOwner.position.x]).size).toBe(
      3,
    );
    expect(escalate.position.y).toBeGreaterThan(routeTriage.position.y);
    expect(triageUpdate.position.y).toBeGreaterThan(escalate.position.y);
    expect(getDesignerBlueprintGraphNodeCenterX(routeTriage)).toBe(
      getDesignerBlueprintGraphNodeCenterX(outcome),
    );
    expect(getDesignerBlueprintGraphNodeGroupCenterX([escalate, requestInfo, routeOwner])).toBe(
      getDesignerBlueprintGraphNodeCenterX(outcome),
    );
    expect(getDesignerBlueprintGraphNodeCenterX(triageUpdate)).toBe(
      getDesignerBlueprintGraphNodeCenterX(outcome),
    );
    expect(routingEdges).toHaveLength(3);
    expect(routingEdges.every((edge) => edge.type === "curved")).toBe(true);
    expect(convergenceEdges).toHaveLength(3);
    expect(convergenceEdges.every((edge) => edge.type === "curved")).toBe(true);
  });

  it("keeps return-to-earlier-node routes out of the top-down layout rank", async () => {
    const graph = await buildDesignerBlueprintGraph({
      blueprint: {
        version: 1,
        title: "Issue-to-PR factory",
        outcome: {
          label: "Issue-to-PR software factory",
        },
        items: [
          {
            id: "issue-ready",
            kind: "trigger",
            state: "proposed",
            when: [{ label: "Readiness signal received" }],
          },
          {
            id: "readiness-check",
            kind: "agent_step",
            label: "Check readiness and scope",
            state: "proposed",
          },
          {
            id: "implement-change",
            kind: "agent_step",
            label: "Plan, edit, and test",
            state: "proposed",
          },
          {
            id: "pr-output",
            kind: "workflow_output",
            label: "Pull request opened or updated",
            state: "proposed",
          },
          {
            id: "review-step",
            kind: "agent_step",
            label: "Review change quality",
            state: "proposed",
          },
          {
            id: "review-route",
            kind: "routing_policy",
            state: "proposed",
            rules: [
              {
                conditionLabel: "Changes requested",
                when: [{ field: "review_outcome", operator: "equals", value: "changes_requested" }],
                routeTo: "implement-change",
              },
              {
                conditionLabel: "Accepted",
                when: [{ field: "review_outcome", operator: "equals", value: "accepted" }],
                routeTo: "issue-update",
              },
            ],
          },
          {
            id: "issue-update",
            kind: "agent_step",
            label: "Update issue status",
            state: "proposed",
          },
          {
            id: "improvement-output",
            kind: "workflow_output",
            label: "Factory improvement notes",
            state: "proposed",
          },
        ],
        links: [
          {
            from: "issue-ready",
            to: "readiness-check",
            kind: "triggers",
          },
          {
            from: "readiness-check",
            to: "implement-change",
            kind: "hands_off_to",
          },
          {
            from: "implement-change",
            to: "pr-output",
            kind: "produces",
          },
          {
            from: "pr-output",
            to: "review-step",
            kind: "triggers",
          },
          {
            from: "review-step",
            to: "review-route",
            kind: "routes_to",
          },
          {
            from: "review-route",
            to: "implement-change",
            kind: "routes_to",
          },
          {
            from: "review-route",
            to: "issue-update",
            kind: "routes_to",
          },
          {
            from: "issue-update",
            to: "improvement-output",
            kind: "produces",
          },
        ],
        actions: [],
      } satisfies DesignerBlueprintDocument,
      integrationMetadataByTargetKey: new Map<string, never>(),
    });

    const issueReady = getRequiredDesignerBlueprintGraphNode(graph, "issue-ready");
    const readinessCheck = getRequiredDesignerBlueprintGraphNode(graph, "readiness-check");
    const implementChange = getRequiredDesignerBlueprintGraphNode(graph, "implement-change");
    const prOutput = getRequiredDesignerBlueprintGraphNode(graph, "pr-output");
    const reviewStep = getRequiredDesignerBlueprintGraphNode(graph, "review-step");
    const reviewRoute = getRequiredDesignerBlueprintGraphNode(graph, "review-route");
    const issueUpdate = getRequiredDesignerBlueprintGraphNode(graph, "issue-update");
    const improvementOutput = getRequiredDesignerBlueprintGraphNode(graph, "improvement-output");
    const changesRequestedEdge = graph.edges.find(
      (edge) => edge.source === "review-route" && edge.target === "implement-change",
    );

    expect(readinessCheck.position.y).toBeGreaterThan(issueReady.position.y);
    expect(implementChange.position.y).toBeGreaterThan(readinessCheck.position.y);
    expect(prOutput.position.y).toBeGreaterThan(implementChange.position.y);
    expect(reviewStep.position.y).toBeGreaterThan(prOutput.position.y);
    expect(reviewRoute.position.y).toBeGreaterThan(reviewStep.position.y);
    expect(issueUpdate.position.y).toBeGreaterThan(reviewRoute.position.y);
    expect(improvementOutput.position.y).toBeGreaterThan(issueUpdate.position.y);
    expect(changesRequestedEdge?.type).toBe("loopback");
  });

  it("fails when a routing rule target is missing its routes_to link", async () => {
    await expect(
      buildDesignerBlueprintGraph({
        blueprint: {
          version: 1,
          title: "Invalid routing blueprint",
          outcome: {
            label: "Route inbound work",
          },
          items: [
            {
              id: "route-triage",
              kind: "routing_policy",
              state: "proposed",
              rules: [
                {
                  conditionLabel: "Urgent",
                  when: [{ field: "severity", operator: "equals", value: "urgent" }],
                  routeTo: "escalate",
                },
              ],
            },
            {
              id: "escalate",
              kind: "agent_step",
              label: "Escalate priority work",
              state: "proposed",
            },
          ],
          links: [],
          actions: [],
        } satisfies DesignerBlueprintDocument,
        integrationMetadataByTargetKey: new Map<string, never>(),
      }),
    ).rejects.toThrow(
      "Designer blueprint routing rule 'route-triage' routes to 'escalate' but the matching routes_to link is missing.",
    );
  });

  it("fails when a routes_to link from a routing node is missing its routing rule target", async () => {
    await expect(
      buildDesignerBlueprintGraph({
        blueprint: {
          version: 1,
          title: "Invalid routing link blueprint",
          outcome: {
            label: "Route inbound work",
          },
          items: [
            {
              id: "route-triage",
              kind: "routing_policy",
              state: "proposed",
              rules: [
                {
                  conditionLabel: "Urgent",
                  when: [{ field: "severity", operator: "equals", value: "urgent" }],
                },
              ],
            },
            {
              id: "escalate",
              kind: "agent_step",
              label: "Escalate priority work",
              state: "proposed",
            },
          ],
          links: [
            {
              from: "route-triage",
              to: "escalate",
              kind: "routes_to",
            },
          ],
          actions: [],
        } satisfies DesignerBlueprintDocument,
        integrationMetadataByTargetKey: new Map<string, never>(),
      }),
    ).rejects.toThrow(
      "Designer blueprint routes_to link 'route-triage' to 'escalate' is missing a matching routing rule target.",
    );
  });

  it("returns no blueprint viewport before the canvas has a measured width", () => {
    expect(
      resolveDesignerBlueprintInitialFocusViewportForNodes({
        nodes: [
          {
            position: { x: 120, y: 24 },
          },
        ],
        width: 0,
      }),
    ).toBeNull();
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
