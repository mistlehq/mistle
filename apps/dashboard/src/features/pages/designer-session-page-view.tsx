import "dockview/dist/styles/dockview.css";
import "@xyflow/react/dist/style.css";
import "./session-terminal-workspace.css";
import { ArrowsSplitIcon, AtomIcon, LightningIcon, RobotIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type Viewport,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewWillDropEvent,
  type DockviewWillShowOverlayLocationEvent,
  type IDockviewPanelProps,
} from "dockview";
import ELK from "elkjs/lib/elk.bundled.js";
import { useEffect, useMemo, useState, type FunctionComponent } from "react";

import { useResolvedAppearance } from "../appearance/appearance-provider.js";
import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintDocumentSchema,
  type DesignerBlueprintDocument,
  type DesignerBlueprintItem,
} from "../designer/designer-blueprint-schema.js";
import type { DesignerSession } from "../designer/designer-service.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { IntegrationLogo } from "../integrations/integration-logo.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { sandboxProfileDetailQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import { OrganizationIntegrationsSettingsPage } from "./organization-integrations-settings-page.js";
import { EmbeddedSandboxProfileEditorPage } from "./sandbox-profile-editor-page.js";
import { TriggerCreatePage } from "./trigger-create-page.js";
import { TriggersPage } from "./triggers-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type DesignerCanvasTab = DesignerSession["canvasTabs"][number];

type DesignerCanvasDockviewParams = {
  id: string;
  href: string;
  title: string;
  blueprint?: DesignerBlueprintDocument;
  onNavigate: (input: { id: string; href: string; title: string }) => void;
};

type DesignerCanvasDockviewPanelProps = IDockviewPanelProps<DesignerCanvasDockviewParams>;

type DesignerCanvasEmbeddedRoute =
  | {
      kind: "blueprint";
    }
  | {
      kind: "integrations";
      searchParams: URLSearchParams;
      targetKey: string | null;
    }
  | {
      href: string;
      kind: "sandbox-profile";
      profileId: string;
    }
  | {
      kind: "triggers";
      searchParams: URLSearchParams;
    }
  | {
      kind: "trigger-create";
      searchParams: URLSearchParams;
    }
  | {
      kind: "unsupported";
    };

const DesignerCanvasUrlOrigin = "http://designer-canvas.local";

function isDesignerCanvasNavigate(
  value: unknown,
): value is DesignerCanvasDockviewParams["onNavigate"] {
  return typeof value === "function";
}

function findDesignerCanvasAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (target instanceof HTMLAnchorElement) {
    return target;
  }

  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest("a[href]");
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

function resolveDesignerCanvasInternalHref(rawHref: string): string | null {
  const appOrigin =
    typeof window === "undefined" ? DesignerCanvasUrlOrigin : window.location.origin;
  const url = new URL(rawHref, appOrigin);
  if (url.origin !== appOrigin) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function shouldHandleDesignerCanvasLinkClick(input: {
  anchor: HTMLAnchorElement;
  event: React.MouseEvent<HTMLDivElement>;
}): boolean {
  return (
    !input.event.defaultPrevented &&
    input.event.button === 0 &&
    !input.event.metaKey &&
    !input.event.altKey &&
    !input.event.ctrlKey &&
    !input.event.shiftKey &&
    !input.anchor.hasAttribute("download") &&
    (input.anchor.target === "" || input.anchor.target === "_self")
  );
}

function navigateDesignerCanvasTab(input: {
  href: string;
  params: DesignerCanvasDockviewParams;
  title?: string;
}): void {
  input.params.onNavigate({
    id: input.params.id,
    href: input.href,
    title:
      input.title ??
      resolveDesignerCanvasStaticTitle({
        currentTitle: input.params.title,
        href: input.href,
      }),
  });
}

function resolveDesignerCanvasStaticTitle(input: { currentTitle: string; href: string }): string {
  const url = new URL(input.href, DesignerCanvasUrlOrigin);
  const pathSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (input.href === DesignerBlueprintCurrentTabHref) {
    return "Blueprint";
  }

  if (pathSegments[0] === "integrations") {
    return "Integrations";
  }

  if (pathSegments[0] === "triggers") {
    if (pathSegments[1] === "new") {
      return "Create trigger";
    }

    if (pathSegments[1] !== undefined) {
      return "Trigger";
    }

    return "Triggers";
  }

  return input.currentTitle;
}

function resolveDesignerCanvasSandboxProfileTitle(input: {
  href: string;
  profileDisplayName: string | undefined;
}): string {
  const profileDisplayName = input.profileDisplayName ?? "Profile";
  const url = new URL(input.href, DesignerCanvasUrlOrigin);
  const pathSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const sectionPathSegment = pathSegments[2];

  if (sectionPathSegment === "triggers") {
    return `${profileDisplayName} Triggers`;
  }

  if (sectionPathSegment === "snapshots") {
    return `${profileDisplayName} Snapshots`;
  }

  return `${profileDisplayName} Profile`;
}

function useDesignerCanvasResolvedTitle(input: {
  fallbackTitle: string;
  href: string;
  route: DesignerCanvasEmbeddedRoute;
}): string {
  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    enabled: input.route.kind === "integrations",
    retry: false,
  });

  const profileQuery = useQuery({
    queryKey:
      input.route.kind === "sandbox-profile"
        ? sandboxProfileDetailQueryKey(input.route.profileId)
        : ["designer", "canvas", "profile-title", "inactive"],
    queryFn: async ({ signal }) => {
      if (input.route.kind !== "sandbox-profile") {
        throw new Error("A sandbox profile route is required to load the tab title.");
      }

      return getSandboxProfile({
        profileId: input.route.profileId,
        signal,
      });
    },
    enabled: input.route.kind === "sandbox-profile",
    retry: false,
  });

  if (input.route.kind === "integrations") {
    const targetKey = input.route.targetKey;
    if (targetKey === null || integrationsQuery.data === undefined) {
      return "Integrations";
    }

    const selectedCard = buildIntegrationCards(integrationsQuery.data).find(
      (card) => card.target.targetKey === targetKey,
    );

    return selectedCard?.displayName ?? "Integrations";
  }

  if (input.route.kind === "sandbox-profile") {
    return resolveDesignerCanvasSandboxProfileTitle({
      href: input.href,
      profileDisplayName: profileQuery.data?.displayName,
    });
  }

  return resolveDesignerCanvasStaticTitle({
    currentTitle: input.fallbackTitle,
    href: input.href,
  });
}

function DesignerCanvasEmbeddedSurface(input: {
  children: React.ReactNode;
  params: DesignerCanvasDockviewParams;
}): React.JSX.Element {
  return (
    <div
      className="h-full min-h-0 overflow-auto bg-background text-foreground"
      onClickCapture={(event) => {
        const anchor = findDesignerCanvasAnchor(event.target);
        if (anchor === null || !shouldHandleDesignerCanvasLinkClick({ anchor, event })) {
          return;
        }

        const rawHref = anchor.getAttribute("href");
        if (rawHref === null || rawHref.length === 0) {
          return;
        }

        const nextHref = resolveDesignerCanvasInternalHref(rawHref);
        if (nextHref === null) {
          return;
        }

        event.preventDefault();
        navigateDesignerCanvasTab({
          href: nextHref,
          params: input.params,
        });
      }}
    >
      {input.children}
    </div>
  );
}

function readRequiredDesignerCanvasHref(parameters: unknown): string {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Designer canvas panel parameters must include href.");
  }

  const href = Reflect.get(parameters, "href");
  if (typeof href !== "string" || href.length === 0) {
    throw new Error("Designer canvas panel href must be a non-empty string.");
  }

  return href;
}

function DesignerCanvasDockviewPanel(input: DesignerCanvasDockviewPanelProps): React.JSX.Element {
  const href = readRequiredDesignerCanvasHref(input.params);
  const params = readRequiredDesignerCanvasParams(input.params);
  const route = useMemo(() => resolveDesignerCanvasEmbeddedRoute(href), [href]);
  const title = useDesignerCanvasResolvedTitle({
    fallbackTitle: params.title,
    href,
    route,
  });

  useEffect(() => {
    navigateDesignerCanvasTab({
      href,
      params,
      title,
    });
  }, [href, params, title]);

  if (route.kind === "blueprint") {
    if (params.blueprint === undefined) {
      throw new Error("Designer blueprint canvas tab is missing blueprint data.");
    }

    return <DesignerBlueprintCanvasPanel blueprint={params.blueprint} params={params} />;
  }

  if (route.kind === "integrations") {
    return (
      <DesignerCanvasEmbeddedSurface params={params}>
        <OrganizationIntegrationsSettingsPage
          embeddedRoute={{
            detailTargetKey: route.targetKey,
            navigate: (nextHref) => {
              navigateDesignerCanvasTab({
                href: nextHref,
                params,
              });
            },
            searchParams: route.searchParams,
            setSearchParams: (nextSearchParams) => {
              const nextHref = buildDesignerCanvasHref({
                pathname:
                  route.targetKey === null
                    ? "/integrations"
                    : `/integrations/${encodeURIComponent(route.targetKey)}`,
                searchParams: nextSearchParams,
              });
              navigateDesignerCanvasTab({
                href: nextHref,
                params,
              });
            },
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  if (route.kind === "sandbox-profile") {
    return (
      <DesignerCanvasEmbeddedSurface params={params}>
        <EmbeddedSandboxProfileEditorPage
          embeddedRoute={{
            href: route.href,
            navigate: (nextHref) => {
              navigateDesignerCanvasTab({
                href: nextHref,
                params,
              });
            },
            profileId: route.profileId,
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  if (route.kind === "triggers") {
    return (
      <DesignerCanvasEmbeddedSurface params={params}>
        <TriggersPage
          embeddedRoute={{
            searchParams: route.searchParams,
            setSearchParams: (nextSearchParams) => {
              const nextHref = buildDesignerCanvasHref({
                pathname: "/triggers",
                searchParams: nextSearchParams,
              });
              navigateDesignerCanvasTab({
                href: nextHref,
                params,
              });
            },
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  if (route.kind === "trigger-create") {
    return (
      <DesignerCanvasEmbeddedSurface params={params}>
        <TriggerCreatePage
          embeddedRoute={{
            searchParams: route.searchParams,
            navigate: (nextHref) => {
              navigateDesignerCanvasTab({
                href: nextHref,
                params,
              });
            },
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  return <UnsupportedDesignerCanvasRoute />;
}

function readRequiredDesignerCanvasParams(parameters: unknown): DesignerCanvasDockviewParams {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Designer canvas panel parameters are required.");
  }

  const id = Reflect.get(parameters, "id");
  const href = Reflect.get(parameters, "href");
  const title = Reflect.get(parameters, "title");
  const blueprint = Reflect.get(parameters, "blueprint");
  const onNavigate = Reflect.get(parameters, "onNavigate");
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof href !== "string" ||
    href.length === 0 ||
    typeof title !== "string" ||
    title.length === 0 ||
    !isDesignerCanvasNavigate(onNavigate)
  ) {
    throw new Error("Designer canvas panel parameters are invalid.");
  }

  return {
    id,
    href,
    title,
    ...(blueprint === undefined
      ? {}
      : { blueprint: DesignerBlueprintDocumentSchema.parse(blueprint) }),
    onNavigate,
  };
}

const DesignerCanvasDockviewComponents = {
  canvas: DesignerCanvasDockviewPanel,
} satisfies Record<string, FunctionComponent<DesignerCanvasDockviewPanelProps>>;

function preventDesignerCanvasLayoutDrop(event: DockviewWillDropEvent): void {
  if (event.kind === "tab" || event.kind === "header_space") {
    return;
  }

  event.preventDefault();
}

function preventDesignerCanvasLayoutOverlay(event: DockviewWillShowOverlayLocationEvent): void {
  if (event.kind === "tab" || event.kind === "header_space") {
    return;
  }

  event.preventDefault();
}

export function DesignerCanvasWorkspace(input: {
  activeTabHref: string | null;
  onApiReady?: (api: DockviewApi) => void;
  onActiveTabHrefChange: (href: string) => void;
  onTabClose: (tabId: string) => void;
  onTabsChange: (tabs: readonly DesignerCanvasTab[]) => void;
  tabs: readonly DesignerCanvasTab[];
}): React.JSX.Element {
  const { activeTabHref, onActiveTabHrefChange, onApiReady, onTabClose, onTabsChange, tabs } =
    input;
  const resolvedAppearance = useResolvedAppearance();
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const handleNavigate = useMemo(
    () =>
      (navigation: { id: string; href: string; title: string }): void => {
        const currentTab = tabById.get(navigation.id);
        if (
          currentTab === undefined ||
          (currentTab.href === navigation.href && currentTab.title === navigation.title)
        ) {
          return;
        }

        const hrefChanged = currentTab.href !== navigation.href;
        const nextTabs = tabs.map((tab) =>
          tab.id === navigation.id
            ? buildDesignerCanvasTabFromNavigation({
                currentTab: tab,
                navigation,
              })
            : tab,
        );
        if (hrefChanged) {
          onActiveTabHrefChange(navigation.href);
        }
        onTabsChange(nextTabs);
      },
    [onActiveTabHrefChange, onTabsChange, tabById, tabs],
  );

  useEffect(() => {
    if (dockviewApi === null) {
      return;
    }

    syncDesignerCanvasPanels({
      activeTabHref,
      dockviewApi,
      onNavigate: handleNavigate,
      tabs,
    });
  }, [activeTabHref, dockviewApi, handleNavigate, tabs]);

  useEffect(() => {
    if (dockviewApi === null) {
      return;
    }

    const disposable = dockviewApi.onDidRemovePanel((panel) => {
      const removedTab = tabs.find((tab) => tab.id === panel.id);
      if (removedTab === undefined) {
        return;
      }

      const nextTabs = tabs.filter((tab) => tab.id !== panel.id);
      onTabClose(panel.id);
      if (activeTabHref === removedTab.href) {
        const nextActivePanel = dockviewApi.activePanel;
        const nextActiveTab =
          nextActivePanel === undefined
            ? nextTabs[0]
            : nextTabs.find((tab) => tab.id === nextActivePanel.id);
        if (nextActiveTab !== undefined) {
          onActiveTabHrefChange(nextActiveTab.href);
        }
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [activeTabHref, dockviewApi, onActiveTabHrefChange, onTabClose, tabs]);

  useEffect(() => {
    if (dockviewApi === null) {
      return;
    }

    onApiReady?.(dockviewApi);
  }, [dockviewApi, onApiReady]);

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
        Canvas
      </div>
    );
  }

  return (
    <div
      className={`session-terminal-dockview ${
        resolvedAppearance === "dark" ? "dockview-theme-dark" : "dockview-theme-light"
      } min-h-0 min-w-0 flex-1 overflow-hidden`}
    >
      <DockviewReact
        className="h-full"
        components={DesignerCanvasDockviewComponents}
        disableTabsOverflowList
        disableFloatingGroups
        dndEdges={false}
        onReady={(event: { api: DockviewApi }) => {
          setDockviewApi(event.api);
          event.api.onWillShowOverlay(preventDesignerCanvasLayoutOverlay);

          syncDesignerCanvasPanels({
            activeTabHref,
            dockviewApi: event.api,
            onNavigate: handleNavigate,
            tabs,
          });
        }}
        onWillDrop={preventDesignerCanvasLayoutDrop}
      />
    </div>
  );
}

function syncDesignerCanvasPanels(input: {
  activeTabHref: string | null;
  dockviewApi: DockviewApi;
  onNavigate: (navigation: { id: string; href: string; title: string }) => void;
  tabs: readonly DesignerCanvasTab[];
}): void {
  const tabIds = new Set(input.tabs.map((tab) => tab.id));
  for (const panel of input.dockviewApi.panels) {
    if (!tabIds.has(panel.id)) {
      input.dockviewApi.removePanel(panel);
    }
  }

  for (const tab of input.tabs) {
    const existingPanel = input.dockviewApi.getPanel(tab.id);
    if (existingPanel === undefined) {
      input.dockviewApi.addPanel({
        id: tab.id,
        title: tab.title,
        component: "canvas",
        params: {
          id: tab.id,
          href: tab.href,
          title: tab.title,
          ...(tab.kind === "blueprint" ? { blueprint: tab.blueprint } : {}),
          onNavigate: input.onNavigate,
        },
        renderer: "always",
      });
      continue;
    }

    existingPanel.api.setTitle(tab.title);
    existingPanel.api.updateParameters({
      id: tab.id,
      href: tab.href,
      title: tab.title,
      ...(tab.kind === "blueprint" ? { blueprint: tab.blueprint } : {}),
      onNavigate: input.onNavigate,
    });
  }

  if (input.activeTabHref === null) {
    return;
  }

  const activeTab = input.tabs.find((tab) => tab.href === input.activeTabHref);
  if (activeTab === undefined) {
    return;
  }

  input.dockviewApi.getPanel(activeTab.id)?.api.setActive();
}

function buildDesignerCanvasHref(input: {
  pathname: string;
  searchParams: URLSearchParams;
}): string {
  const search = input.searchParams.toString();
  return search.length === 0 ? input.pathname : `${input.pathname}?${search}`;
}

function decodeDesignerCanvasPathSegment(pathSegment: string): string | null {
  try {
    return decodeURIComponent(pathSegment);
  } catch {
    return null;
  }
}

function resolveDesignerCanvasEmbeddedRoute(href: string): DesignerCanvasEmbeddedRoute {
  if (href === DesignerBlueprintCurrentTabHref) {
    return { kind: "blueprint" };
  }

  const url = new URL(href, DesignerCanvasUrlOrigin);
  const pathSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (pathSegments[0] === "sandbox-profiles") {
    const profileId = pathSegments[1];
    if (profileId === undefined || profileId.length === 0) {
      return { kind: "unsupported" };
    }

    return {
      href,
      kind: "sandbox-profile",
      profileId,
    };
  }

  if (pathSegments[0] === "triggers" && pathSegments.length === 1) {
    return {
      kind: "triggers",
      searchParams: url.searchParams,
    };
  }

  if (pathSegments[0] === "triggers" && pathSegments[1] === "new" && pathSegments.length === 2) {
    return {
      kind: "trigger-create",
      searchParams: url.searchParams,
    };
  }

  if (pathSegments[0] !== "integrations" || pathSegments.length > 2) {
    return { kind: "unsupported" };
  }

  const encodedTargetKey = pathSegments[1];
  const targetKey =
    encodedTargetKey === undefined ? null : decodeDesignerCanvasPathSegment(encodedTargetKey);
  if (targetKey === null && encodedTargetKey !== undefined) {
    return { kind: "unsupported" };
  }

  if (targetKey === "") {
    return { kind: "unsupported" };
  }

  return {
    kind: "integrations",
    searchParams: url.searchParams,
    targetKey,
  };
}

function buildDesignerCanvasTabFromNavigation(input: {
  currentTab: DesignerCanvasTab;
  navigation: { id: string; href: string; title: string };
}): DesignerCanvasTab {
  if (
    input.currentTab.kind === "blueprint" &&
    input.navigation.href === DesignerBlueprintCurrentTabHref
  ) {
    return {
      ...input.currentTab,
      title: input.navigation.title,
    };
  }

  return {
    kind: "route",
    id: input.currentTab.id,
    title: input.navigation.title,
    href: input.navigation.href,
  };
}

const DesignerBlueprintNodeWidth = 280;
const DesignerBlueprintNodeBaseHeight = 126;
const DesignerBlueprintNodeDescriptionLineHeight = 16;
const DesignerBlueprintNodeDescriptionCharsPerLine = 34;
const DesignerBlueprintNodeRoutingSummaryHeight = 28;
const DesignerBlueprintInitialViewport = { x: 48, y: 32, zoom: 0.95 };
const DesignerBlueprintInitialFocusTopPadding = 56;
let designerBlueprintElk: InstanceType<typeof ELK> | null = null;

type DesignerBlueprintVisualNodeData = {
  description?: string;
  integrationLogo?: {
    displayName: string;
    logoKey: string;
  };
  kind: DesignerBlueprintItem["kind"];
  kindLabel: string;
  label: string;
  routingSummary?: string;
};

type DesignerBlueprintVisualNode = Node<DesignerBlueprintVisualNodeData, "blueprint">;
type DesignerBlueprintGraphEdge = Edge;

type DesignerBlueprintGraph = {
  edges: DesignerBlueprintGraphEdge[];
  initialFocusNodeId?: string;
  nodes: DesignerBlueprintVisualNode[];
};

const DesignerBlueprintNodeTypes = {
  blueprint: DesignerBlueprintVisualNodeComponent,
} satisfies NodeTypes;

function DesignerBlueprintCanvasPanel(input: {
  blueprint: DesignerBlueprintDocument;
  params: DesignerCanvasDockviewParams;
}): React.JSX.Element {
  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });
  const integrationMetadataByTargetKey = useMemo(
    () => buildDesignerBlueprintIntegrationMetadataByTargetKey(integrationsQuery.data?.targets),
    [integrationsQuery.data?.targets],
  );
  const [graph, setGraph] = useState<DesignerBlueprintGraph | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGraph(null);
    setLayoutError(null);

    buildDesignerBlueprintGraph({
      blueprint: input.blueprint,
      integrationMetadataByTargetKey,
    })
      .then((nextGraph) => {
        if (!cancelled) {
          setGraph(nextGraph);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLayoutError(
          error instanceof Error ? error.message : "Designer blueprint graph layout failed.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [input.blueprint, integrationMetadataByTargetKey]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <section
        className="min-h-0 flex-1 overflow-hidden bg-muted/20"
        aria-label="Designer blueprint graph"
      >
        {layoutError === null ? null : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
            {layoutError}
          </div>
        )}
        {layoutError !== null || graph === null ? null : (
          <ReactFlow
            nodes={graph.nodes}
            edges={graph.edges}
            nodeTypes={DesignerBlueprintNodeTypes}
            defaultViewport={DesignerBlueprintInitialViewport}
            minZoom={0.45}
            maxZoom={1.4}
            elementsSelectable={false}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <DesignerBlueprintInitialFocus graph={graph} />
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        {layoutError === null && graph === null ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Laying out blueprint.
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DesignerBlueprintInitialFocus(input: {
  graph: DesignerBlueprintGraph;
}): React.JSX.Element | null {
  const reactFlow = useReactFlow<DesignerBlueprintVisualNode, DesignerBlueprintGraphEdge>();
  const width = useStore((state) => state.width);
  const initialFocusNode =
    input.graph.initialFocusNodeId === undefined
      ? undefined
      : input.graph.nodes.find((node) => node.id === input.graph.initialFocusNodeId);

  // ReactFlow owns the viewport imperatively; render props and remounting cannot
  // focus the measured canvas once its store reports a usable width.
  useEffect(() => {
    if (initialFocusNode === undefined || width <= 0) {
      return;
    }

    void reactFlow.setViewport(
      resolveDesignerBlueprintInitialFocusViewport({
        nodePosition: initialFocusNode.position,
        width,
      }),
      { duration: 0 },
    );
  }, [initialFocusNode, reactFlow, width]);

  return null;
}

function DesignerBlueprintVisualNodeComponent(
  input: NodeProps<DesignerBlueprintVisualNode>,
): React.JSX.Element {
  return (
    <div className="relative w-[280px] rounded-md border border-border bg-background p-2.5 text-foreground shadow-sm">
      <Handle className="opacity-0" isConnectable={false} position={Position.Top} type="target" />
      <div className="flex items-start gap-2.5">
        <span
          aria-label={input.data.kindLabel}
          className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground"
        >
          <DesignerBlueprintNodeKindIcon data={input.data} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium leading-snug">{input.data.label}</h3>
          {input.data.description === undefined ? null : (
            <p className="mt-1 break-words text-xs leading-snug text-muted-foreground">
              {input.data.description}
            </p>
          )}
          {input.data.routingSummary === undefined ? null : (
            <p className="mt-2 rounded-sm bg-muted px-2 py-1 text-xs leading-relaxed text-muted-foreground">
              {input.data.routingSummary}
            </p>
          )}
        </div>
      </div>
      <Handle
        className="opacity-0"
        isConnectable={false}
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
}

function DesignerBlueprintNodeKindIcon(input: {
  data: DesignerBlueprintVisualNodeData;
}): React.JSX.Element {
  const className = "size-4";

  if (input.data.kind === "trigger" && input.data.integrationLogo !== undefined) {
    return (
      <IntegrationLogo alt="" className={className} logoKey={input.data.integrationLogo.logoKey} />
    );
  }

  switch (input.data.kind) {
    case "trigger":
      return <LightningIcon aria-hidden="true" className={className} weight="fill" />;
    case "agent_step":
      return <RobotIcon aria-hidden="true" className={className} />;
    case "routing_policy":
      return <ArrowsSplitIcon aria-hidden="true" className={className} />;
    case "workflow_output":
      return <AtomIcon aria-hidden="true" className={className} />;
  }
}

async function buildDesignerBlueprintGraph(input: {
  blueprint: DesignerBlueprintDocument;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): Promise<DesignerBlueprintGraph> {
  const unresolvedNodes = buildDesignerBlueprintUnresolvedNodes(input);
  const displayEdges = buildDesignerBlueprintDisplayEdges(input.blueprint);
  const layout = await getDesignerBlueprintElk().layout({
    id: "designer-blueprint",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "12",
      "elk.spacing.nodeNode": "24",
      "elk.edgeRouting": "SPLINES",
    },
    children: unresolvedNodes.map((node) => ({
      id: node.id,
      width: DesignerBlueprintNodeWidth,
      height: getDesignerBlueprintNodeHeight(node.data),
    })),
    edges: displayEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });

  const positionByNodeId = new Map(
    (layout.children ?? []).map((node) => [
      node.id,
      {
        x: node.x ?? 0,
        y: node.y ?? 0,
      },
    ]),
  );

  return {
    nodes: unresolvedNodes.map((node) => ({
      ...node,
      position: positionByNodeId.get(node.id) ?? node.position,
    })),
    edges: displayEdges,
    ...(input.blueprint.items[0] === undefined
      ? {}
      : { initialFocusNodeId: input.blueprint.items[0].id }),
  };
}

export function resolveDesignerBlueprintInitialFocusViewport(input: {
  nodePosition: { x: number; y: number };
  width: number;
}): Viewport {
  return {
    x:
      input.width / 2 -
      (input.nodePosition.x + DesignerBlueprintNodeWidth / 2) *
        DesignerBlueprintInitialViewport.zoom,
    y:
      DesignerBlueprintInitialFocusTopPadding -
      input.nodePosition.y * DesignerBlueprintInitialViewport.zoom,
    zoom: DesignerBlueprintInitialViewport.zoom,
  };
}

function getDesignerBlueprintElk(): InstanceType<typeof ELK> {
  designerBlueprintElk ??= new ELK();
  return designerBlueprintElk;
}

function buildDesignerBlueprintUnresolvedNodes(input: {
  blueprint: DesignerBlueprintDocument;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): DesignerBlueprintVisualNode[] {
  return input.blueprint.items.map((item) =>
    createDesignerBlueprintVisualNode({
      id: item.id,
      data: createDesignerBlueprintVisualNodeData({
        ...(item.description === undefined ? {} : { description: item.description }),
        ...createDesignerBlueprintIntegrationLogoData({
          item,
          integrationMetadataByTargetKey: input.integrationMetadataByTargetKey,
        }),
        kind: item.kind,
        kindLabel: formatDesignerBlueprintKindLabel({
          item,
          integrationMetadataByTargetKey: input.integrationMetadataByTargetKey,
        }),
        label: formatDesignerBlueprintNodeLabel(item),
        ...createDesignerBlueprintRoutingSummaryData(item),
      }),
    }),
  );
}

function createDesignerBlueprintVisualNode(input: {
  data: DesignerBlueprintVisualNodeData;
  id: string;
}): DesignerBlueprintVisualNode {
  return {
    id: input.id,
    type: "blueprint",
    data: input.data,
    position: { x: 0, y: 0 },
  };
}

function createDesignerBlueprintVisualNodeData(
  input: DesignerBlueprintVisualNodeData,
): DesignerBlueprintVisualNodeData {
  return input;
}

function buildDesignerBlueprintDisplayEdges(
  input: DesignerBlueprintDocument,
): DesignerBlueprintGraphEdge[] {
  return [
    ...input.links.map((link) => ({
      id: `${link.from}:${link.kind}:${link.to}`,
      source: link.from,
      target: link.to,
      animated: false,
    })),
  ];
}

function getDesignerBlueprintNodeHeight(data: DesignerBlueprintVisualNodeData): number {
  return (
    DesignerBlueprintNodeBaseHeight +
    getDesignerBlueprintDescriptionHeight(data.description) +
    (data.routingSummary === undefined ? 0 : DesignerBlueprintNodeRoutingSummaryHeight)
  );
}

function getDesignerBlueprintDescriptionHeight(description: string | undefined): number {
  if (description === undefined) {
    return 0;
  }

  const lineCount = Math.ceil(description.length / DesignerBlueprintNodeDescriptionCharsPerLine);
  return Math.max(lineCount, 1) * DesignerBlueprintNodeDescriptionLineHeight;
}

type DesignerBlueprintIntegrationMetadata = {
  displayName: string;
  logoKey?: string | undefined;
};

function buildDesignerBlueprintIntegrationMetadataByTargetKey(
  targets: Awaited<ReturnType<typeof listIntegrationDirectory>>["targets"] | undefined,
): ReadonlyMap<string, DesignerBlueprintIntegrationMetadata> {
  if (targets === undefined) {
    return new Map();
  }

  return new Map(
    targets.map((target) => [
      target.targetKey,
      {
        displayName: target.displayName,
        ...(target.logoKey === undefined ? {} : { logoKey: target.logoKey }),
      },
    ]),
  );
}

function createDesignerBlueprintIntegrationLogoData(input: {
  item: DesignerBlueprintItem;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): Pick<DesignerBlueprintVisualNodeData, "integrationLogo"> | Record<string, never> {
  if (input.item.kind !== "trigger" || input.item.integrationTargetKey === undefined) {
    return {};
  }

  const integrationMetadata = input.integrationMetadataByTargetKey.get(
    input.item.integrationTargetKey,
  );
  if (integrationMetadata?.logoKey === undefined) {
    return {};
  }

  return {
    integrationLogo: {
      displayName: integrationMetadata.displayName,
      logoKey: integrationMetadata.logoKey,
    },
  };
}

function formatDesignerBlueprintKindLabel(input: {
  item: DesignerBlueprintItem;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): string {
  const item = input.item;
  if (item.kind === "trigger") {
    const integrationLabel =
      item.integrationLabel ??
      (item.integrationTargetKey === undefined
        ? undefined
        : input.integrationMetadataByTargetKey.get(item.integrationTargetKey)?.displayName);
    return integrationLabel === undefined ? "Trigger" : `${integrationLabel} · Trigger`;
  }

  return formatDesignerBlueprintKind(item.kind);
}

function formatDesignerBlueprintKind(kind: DesignerBlueprintItem["kind"]): string {
  return kind
    .split("_")
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function formatDesignerBlueprintNodeLabel(item: DesignerBlueprintItem): string {
  if (item.kind !== "trigger") {
    return item.label;
  }

  return item.eventLabel ?? "Trigger";
}

function formatDesignerBlueprintRoutingRule(
  rule: Extract<DesignerBlueprintItem, { kind: "routing_policy" }>["rules"][number],
): string {
  const conditions = rule.when
    .map((condition) => {
      const value = condition.value;
      const formattedValue =
        value === undefined ? "" : ` ${Array.isArray(value) ? value.join(", ") : String(value)}`;
      return `${condition.field} ${condition.operator.replaceAll("_", " ")}${formattedValue}`;
    })
    .join("; ");
  const routeTo = rule.routeTo === undefined ? "" : ` -> ${rule.routeTo}`;
  return `${rule.label ?? "When"}: ${conditions}${routeTo}`;
}

function formatDesignerBlueprintRoutingSummary(item: DesignerBlueprintItem): string | undefined {
  if (item.kind !== "routing_policy") {
    return undefined;
  }

  if (item.rules.length === 1) {
    const rule = item.rules[0];
    if (rule !== undefined) {
      return formatDesignerBlueprintRoutingRule(rule);
    }
  }

  return `${item.rules.length} routing rules`;
}

function createDesignerBlueprintRoutingSummaryData(
  item: DesignerBlueprintItem,
): Pick<DesignerBlueprintVisualNodeData, "routingSummary"> | Record<string, never> {
  const routingSummary = formatDesignerBlueprintRoutingSummary(item);
  return routingSummary === undefined ? {} : { routingSummary };
}

function UnsupportedDesignerCanvasRoute(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      This route is not available in the Designer canvas.
    </div>
  );
}
