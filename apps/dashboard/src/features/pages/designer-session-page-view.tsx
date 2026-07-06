import "dockview-react/dist/styles/dockview.css";
import "@xyflow/react/dist/style.css";
import "./session-terminal-workspace.css";
import { Button, cn, DialogShortcut, Textarea } from "@mistle/ui";
import {
  ArrowRightIcon,
  ArrowsSplitIcon,
  AtomIcon,
  ChatCircleTextIcon,
  LightningIcon,
  RobotIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeToolbar,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeMarker,
  type EdgeProps,
  type EdgeTypes,
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
} from "dockview-react";
import ELK, {
  type ELK as ElkInstance,
  type ElkExtendedEdge,
  type ElkNode,
} from "elkjs/lib/elk.bundled.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FunctionComponent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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
import { EmbeddedIntegrationConnectionCreatePage } from "./integration-connection-create-page.js";
import { resolveIntegrationConnectionReturnPath } from "./integration-connection-return-path.js";
import { EmbeddedIntegrationConnectionSetupPage } from "./integration-connection-setup-page.js";
import { OrganizationIntegrationsSettingsPage } from "./organization-integrations-settings-page.js";
import { EmbeddedSandboxProfileEditorPage } from "./sandbox-profile-editor-page.js";
import {
  createPendingSessionBlueprintCommentInput,
  type PendingSessionBlueprintComment,
  type PendingSessionBlueprintCommentInput,
} from "./session-blueprint-comment.js";
import { TriggerCreatePage } from "./trigger-create-page.js";
import { TriggersPage } from "./triggers-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type DesignerCanvasTab = DesignerSession["canvasTabs"][number];

type DesignerCanvasDockviewParams = {
  designerSessionId: string;
  id: string;
  href: string;
  title: string;
  blueprint?: DesignerBlueprintDocument;
  onNavigate: (input: { id: string; href: string; title: string }) => void;
};

type DesignerBlueprintCommentContextValue = {
  onAddBlueprintComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onDeleteBlueprintComment: (commentId: string) => void;
  onUpdateBlueprintComment: (commentId: string, body: string) => void;
  pendingBlueprintComments: readonly PendingSessionBlueprintComment[];
};

type DesignerCanvasDockviewPanelProps = IDockviewPanelProps<DesignerCanvasDockviewParams>;

type DesignerCanvasEmbeddedNavigateOptions = {
  state?: unknown;
};

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
      kind: "integration-create";
      returnPath?: string;
      targetKey: string;
    }
  | {
      connectionId: string;
      kind: "integration-setup";
      searchParams: URLSearchParams;
      setupRouteSegment: string;
      targetKey: string;
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
const DesignerBlueprintCommentContext = createContext<DesignerBlueprintCommentContextValue | null>(
  null,
);

function useDesignerBlueprintCommentContext(): DesignerBlueprintCommentContextValue {
  const contextValue = useContext(DesignerBlueprintCommentContext);
  if (contextValue === null) {
    throw new Error("Designer blueprint comment context is missing.");
  }

  return contextValue;
}

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

  if (input.route.kind === "integration-create" || input.route.kind === "integration-setup") {
    return input.fallbackTitle;
  }

  return resolveDesignerCanvasStaticTitle({
    currentTitle: input.fallbackTitle,
    href: input.href,
  });
}

function DesignerCanvasEmbeddedSurface(input: {
  children: React.ReactNode;
  onInternalNavigate?: () => void;
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
        input.onInternalNavigate?.();
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
  const [embeddedLocationState, setEmbeddedLocationState] = useState<unknown>(undefined);
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

  const navigateEmbeddedCanvasRoute = (
    nextHref: string,
    options?: DesignerCanvasEmbeddedNavigateOptions,
  ): void => {
    setEmbeddedLocationState(options?.state);
    navigateDesignerCanvasTab({
      href: nextHref,
      params,
    });
  };

  if (route.kind === "blueprint") {
    if (params.blueprint === undefined) {
      throw new Error("Designer blueprint canvas tab is missing blueprint data.");
    }

    return <DesignerBlueprintDockviewPanelContent blueprint={params.blueprint} />;
  }

  if (route.kind === "integrations") {
    return (
      <DesignerCanvasEmbeddedSurface
        onInternalNavigate={() => {
          setEmbeddedLocationState(undefined);
        }}
        params={params}
      >
        <OrganizationIntegrationsSettingsPage
          embeddedRoute={{
            detailTargetKey: route.targetKey,
            locationState: embeddedLocationState,
            navigate: navigateEmbeddedCanvasRoute,
            redirectReturnContext: {
              kind: "designer-canvas",
              designerSessionId: params.designerSessionId,
              canvasTabId: params.id,
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
              navigateEmbeddedCanvasRoute(nextHref);
            },
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  if (route.kind === "integration-create") {
    return (
      <DesignerCanvasEmbeddedSurface params={params}>
        <EmbeddedIntegrationConnectionCreatePage
          embeddedRoute={{
            targetKey: route.targetKey,
            navigate: navigateEmbeddedCanvasRoute,
            redirectReturnContext: {
              kind: "designer-canvas",
              designerSessionId: params.designerSessionId,
              canvasTabId: params.id,
            },
            ...(route.returnPath === undefined ? {} : { returnPath: route.returnPath }),
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  if (route.kind === "integration-setup") {
    return (
      <DesignerCanvasEmbeddedSurface params={params}>
        <EmbeddedIntegrationConnectionSetupPage
          embeddedRoute={{
            connectionId: route.connectionId,
            redirectReturnContext: {
              kind: "designer-canvas",
              designerSessionId: params.designerSessionId,
              canvasTabId: params.id,
            },
            searchParams: route.searchParams,
            setupRouteSegment: route.setupRouteSegment,
            targetKey: route.targetKey,
            navigate: navigateEmbeddedCanvasRoute,
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
            navigate: navigateEmbeddedCanvasRoute,
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
              navigateEmbeddedCanvasRoute(nextHref);
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
            navigate: navigateEmbeddedCanvasRoute,
          }}
        />
      </DesignerCanvasEmbeddedSurface>
    );
  }

  return <UnsupportedDesignerCanvasRoute />;
}

function DesignerBlueprintDockviewPanelContent(input: {
  blueprint: DesignerBlueprintDocument;
}): React.JSX.Element {
  const blueprintCommentContext = useDesignerBlueprintCommentContext();

  return (
    <DesignerBlueprintCanvasPanel
      blueprint={input.blueprint}
      onAddComment={blueprintCommentContext.onAddBlueprintComment}
      onDeleteComment={blueprintCommentContext.onDeleteBlueprintComment}
      onUpdateComment={blueprintCommentContext.onUpdateBlueprintComment}
      pendingComments={blueprintCommentContext.pendingBlueprintComments}
    />
  );
}

function readRequiredDesignerCanvasParams(parameters: unknown): DesignerCanvasDockviewParams {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Designer canvas panel parameters are required.");
  }

  const id = Reflect.get(parameters, "id");
  const designerSessionId = Reflect.get(parameters, "designerSessionId");
  const href = Reflect.get(parameters, "href");
  const title = Reflect.get(parameters, "title");
  const blueprint = Reflect.get(parameters, "blueprint");
  const onNavigate = Reflect.get(parameters, "onNavigate");
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof designerSessionId !== "string" ||
    designerSessionId.length === 0 ||
    typeof href !== "string" ||
    href.length === 0 ||
    typeof title !== "string" ||
    title.length === 0 ||
    !isDesignerCanvasNavigate(onNavigate)
  ) {
    throw new Error("Designer canvas panel parameters are invalid.");
  }

  return {
    designerSessionId,
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
  designerSessionId: string;
  mountDockviewWhenEmpty?: boolean;
  onAddBlueprintComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onApiReady?: (api: DockviewApi) => void;
  onActiveTabHrefChange: (href: string) => void;
  onDeleteBlueprintComment: (commentId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabsChange: (tabs: readonly DesignerCanvasTab[]) => void;
  onUpdateBlueprintComment: (commentId: string, body: string) => void;
  pendingBlueprintComments: readonly PendingSessionBlueprintComment[];
  tabs: readonly DesignerCanvasTab[];
}): React.JSX.Element {
  const {
    activeTabHref,
    designerSessionId,
    mountDockviewWhenEmpty = false,
    onAddBlueprintComment,
    onActiveTabHrefChange,
    onApiReady,
    onDeleteBlueprintComment,
    onTabClose,
    onTabsChange,
    onUpdateBlueprintComment,
    pendingBlueprintComments,
    tabs,
  } = input;
  const resolvedAppearance = useResolvedAppearance();
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
  const tabById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const blueprintCommentContextValue = useMemo(
    () => ({
      onAddBlueprintComment,
      onDeleteBlueprintComment,
      onUpdateBlueprintComment,
      pendingBlueprintComments,
    }),
    [
      onAddBlueprintComment,
      onDeleteBlueprintComment,
      onUpdateBlueprintComment,
      pendingBlueprintComments,
    ],
  );
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
      designerSessionId,
      onNavigate: handleNavigate,
      tabs,
    });
  }, [activeTabHref, designerSessionId, dockviewApi, handleNavigate, tabs]);

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

  if (tabs.length === 0 && !mountDockviewWhenEmpty) {
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
      <DesignerBlueprintCommentContext.Provider value={blueprintCommentContextValue}>
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
              designerSessionId,
              onNavigate: handleNavigate,
              tabs,
            });
          }}
          onWillDrop={preventDesignerCanvasLayoutDrop}
        />
      </DesignerBlueprintCommentContext.Provider>
    </div>
  );
}

function syncDesignerCanvasPanels(input: {
  activeTabHref: string | null;
  dockviewApi: DockviewApi;
  designerSessionId: string;
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
          designerSessionId: input.designerSessionId,
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
      designerSessionId: input.designerSessionId,
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

  if (pathSegments[0] !== "integrations") {
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

  if (targetKey !== null && pathSegments[2] === "add" && pathSegments.length === 3) {
    const returnPath = resolveIntegrationConnectionReturnPath(url.searchParams.get("returnTo"));
    return {
      kind: "integration-create",
      ...(returnPath === null ? {} : { returnPath }),
      targetKey,
    };
  }

  if (targetKey !== null && pathSegments[4] === "setup" && pathSegments.length === 5) {
    const connectionId = decodeDesignerCanvasPathSegment(pathSegments[2] ?? "");
    const setupRouteSegment = decodeDesignerCanvasPathSegment(pathSegments[3] ?? "");
    if (
      connectionId === null ||
      connectionId.length === 0 ||
      setupRouteSegment === null ||
      setupRouteSegment.length === 0
    ) {
      return { kind: "unsupported" };
    }

    return {
      connectionId,
      kind: "integration-setup",
      searchParams: url.searchParams,
      setupRouteSegment,
      targetKey,
    };
  }

  if (targetKey !== null && pathSegments.length === 3) {
    const connectionId = decodeDesignerCanvasPathSegment(pathSegments[2] ?? "");
    if (connectionId === null || connectionId.length === 0) {
      return { kind: "unsupported" };
    }

    const searchParams = new URLSearchParams(url.searchParams);
    searchParams.set("connectionId", connectionId);
    return {
      kind: "integrations",
      searchParams,
      targetKey,
    };
  }

  if (pathSegments.length > 2) {
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
const DesignerBlueprintRoutingNodeWidth = 440;
const DesignerBlueprintNodeVerticalPadding = 20;
const DesignerBlueprintNodeRowOnlyVerticalPadding = 12;
const DesignerBlueprintNodeIconHeight = 28;
const DesignerBlueprintNodeTitleLineHeight = 20;
const DesignerBlueprintNodeDescriptionMarginTop = 2;
const DesignerBlueprintNodeDescriptionLineHeight = 20;
const DesignerBlueprintNodeDescriptionCharsPerLine = 31;
const DesignerBlueprintNodeRoutingSummaryGap = 6;
const DesignerBlueprintNodeRoutingSummaryRowBaseHeight = 36;
const DesignerBlueprintNodeRoutingSummaryTextLineHeight = 20;
const DesignerBlueprintNodeRoutingSummaryNextStepCharsPerLine = 28;
const DesignerBlueprintNodeRoutingSummaryOutcomeCharsPerLine = 28;
const DesignerBlueprintNodeTriggerConditionGap = 6;
const DesignerBlueprintNodeTriggerConditionRowBaseHeight = 32;
const DesignerBlueprintNodeTriggerConditionTextLineHeight = 20;
const DesignerBlueprintNodeTriggerConditionCharsPerLine = 31;
const DesignerBlueprintInitialViewport = { x: 48, y: 32, zoom: 0.95 };
const DesignerBlueprintInitialFocusTopPadding = 24;
const DesignerBlueprintOutcomeGap = 48;
const DesignerBlueprintLayoutLayerSpacing = 104;
const DesignerBlueprintLayoutNodeSpacing = 96;
const DesignerBlueprintProcessLaneInitialZoom = DesignerBlueprintInitialViewport.zoom;
const DesignerBlueprintLoopbackEdgeOffset = 96;
const DesignerBlueprintProcessLaneInitialFocusRightPadding =
  DesignerBlueprintLoopbackEdgeOffset + 48;
const DesignerBlueprintSideReturnNodeGap = 56;
const DesignerBlueprintBottomTargetHandle = "bottom-target";
const DesignerBlueprintLeftSourceHandle = "left-source";
const DesignerBlueprintRightSourceHandle = "right-source";
const DesignerBlueprintRightTargetHandle = "right-target";
const DesignerBlueprintOutcomeNodeId = "__designer_blueprint_outcome";
const DesignerBlueprintEdgeMarker: EdgeMarker = {
  height: 16,
  type: MarkerType.ArrowClosed,
  width: 16,
};
let designerBlueprintElk: ElkInstance | null = null;

export type DesignerBlueprintRoutingSummaryRow = {
  nextStepLabel: string | undefined;
  outcomeLabel: string;
};

export type DesignerBlueprintTriggerConditionRow = {
  integrationLogo?: {
    displayName: string;
    logoKey: string;
  };
  label: string;
};

type DesignerBlueprintLayoutNodeData = {
  description?: string;
  kind: DesignerBlueprintItem["kind"] | "outcome";
  kindLabel: string;
  label: string;
  routingSummaryRows?: readonly DesignerBlueprintRoutingSummaryRow[];
  triggerConditionRows?: readonly DesignerBlueprintTriggerConditionRow[];
};

type DesignerBlueprintItemLayoutNodeData = DesignerBlueprintLayoutNodeData & {
  integrationLogo?: {
    displayName: string;
    logoKey: string;
  };
  item: DesignerBlueprintItem;
  routingSummaryRows?: readonly DesignerBlueprintRoutingSummaryRow[];
};

type DesignerBlueprintOutcomeLayoutNodeData = DesignerBlueprintLayoutNodeData & {
  kind: "outcome";
  kindLabel: "Outcome";
};

type DesignerBlueprintNodeData =
  | DesignerBlueprintItemLayoutNodeData
  | DesignerBlueprintOutcomeLayoutNodeData;

type DesignerBlueprintItemVisualNodeCommentData = {
  isAddCommentSuppressed: boolean;
  onAddComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onClearAddCommentSuppression: (itemId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onOpenComment: (comment: DesignerBlueprintOpenComment) => void;
  onSuppressAddComment: (itemId: string) => void;
  onUpdateComment: (commentId: string, body: string) => void;
  openComment: DesignerBlueprintOpenComment;
  pendingComment?: PendingSessionBlueprintComment | undefined;
};

type DesignerBlueprintItemVisualNodeData = DesignerBlueprintItemLayoutNodeData &
  DesignerBlueprintItemVisualNodeCommentData;

type DesignerBlueprintOutcomeVisualNodeData = DesignerBlueprintOutcomeLayoutNodeData;

type DesignerBlueprintNodeVisualData =
  | DesignerBlueprintItemVisualNodeData
  | DesignerBlueprintOutcomeVisualNodeData;

type DesignerBlueprintOpenComment = {
  itemId: string;
  kind: "draft" | "pending";
} | null;

type DesignerBlueprintLayoutNode = Node<DesignerBlueprintNodeData, "blueprint">;
type DesignerBlueprintVisualNode = Node<DesignerBlueprintNodeVisualData, "blueprint">;
type DesignerBlueprintGraphEdge = Edge;

type DesignerBlueprintGraph = {
  edges: DesignerBlueprintGraphEdge[];
  nodes: DesignerBlueprintLayoutNode[];
};

const DesignerBlueprintNodeTypes = {
  blueprint: DesignerBlueprintVisualNodeComponent,
} satisfies NodeTypes;

const DesignerBlueprintEdgeTypes = {
  curved: DesignerBlueprintCurvedEdgeComponent,
  straight: DesignerBlueprintStraightEdgeComponent,
  loopback: DesignerBlueprintLoopbackEdgeComponent,
} satisfies EdgeTypes;

function DesignerBlueprintCurvedEdgeComponent(input: EdgeProps): React.JSX.Element {
  const [path] = getBezierPath({
    sourceX: input.sourceX,
    sourceY: input.sourceY,
    sourcePosition: input.sourcePosition,
    targetX: input.targetX,
    targetY: input.targetY,
    targetPosition: input.targetPosition,
  });

  return (
    <BaseEdge
      path={path}
      {...(input.markerEnd === undefined ? {} : { markerEnd: input.markerEnd })}
      {...(input.style === undefined ? {} : { style: input.style })}
    />
  );
}

function DesignerBlueprintStraightEdgeComponent(input: EdgeProps): React.JSX.Element {
  const path = [`M ${input.sourceX} ${input.sourceY}`, `L ${input.targetX} ${input.targetY}`].join(
    " ",
  );

  return (
    <BaseEdge
      path={path}
      {...(input.markerEnd === undefined ? {} : { markerEnd: input.markerEnd })}
      {...(input.style === undefined ? {} : { style: input.style })}
    />
  );
}

function DesignerBlueprintLoopbackEdgeComponent(input: EdgeProps): React.JSX.Element {
  const loopbackX = Math.max(input.sourceX, input.targetX) + DesignerBlueprintLoopbackEdgeOffset;
  const path = [
    `M ${input.sourceX} ${input.sourceY}`,
    `C ${loopbackX} ${input.sourceY}`,
    `${loopbackX} ${input.targetY}`,
    `${input.targetX} ${input.targetY}`,
  ].join(" ");

  return (
    <BaseEdge
      path={path}
      {...(input.markerEnd === undefined ? {} : { markerEnd: input.markerEnd })}
      {...(input.style === undefined ? {} : { style: input.style })}
    />
  );
}

export function DesignerBlueprintCanvasPanel(input: {
  blueprint: DesignerBlueprintDocument;
  onAddComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, body: string) => void;
  pendingComments: readonly PendingSessionBlueprintComment[];
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
  const blueprintLayoutInputKey = createDesignerBlueprintLayoutInputKey({
    blueprint: input.blueprint,
    integrationMetadataByTargetKey,
  });
  const [graph, setGraph] = useState<DesignerBlueprintGraph | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [suppressedAddCommentItemIds, setSuppressedAddCommentItemIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [openComment, setOpenComment] = useState<DesignerBlueprintOpenComment>(null);

  const suppressAddCommentForItem = useCallback((itemId: string) => {
    setSuppressedAddCommentItemIds((currentItemIds) => {
      const nextItemIds = new Set(currentItemIds);
      nextItemIds.add(itemId);
      return nextItemIds;
    });
  }, []);

  const clearAddCommentSuppressionForItem = useCallback((itemId: string) => {
    setSuppressedAddCommentItemIds((currentItemIds) => {
      if (!currentItemIds.has(itemId)) {
        return currentItemIds;
      }

      const nextItemIds = new Set(currentItemIds);
      nextItemIds.delete(itemId);
      return nextItemIds;
    });
  }, []);

  function closeOpenCommentWhenPointerStartsOutside(event: ReactPointerEvent<HTMLElement>): void {
    if (openComment === null) {
      return;
    }

    if (!(event.target instanceof Element)) {
      setOpenComment(null);
      return;
    }

    if (event.target.closest("[data-designer-blueprint-floating-comment]") !== null) {
      return;
    }

    setOpenComment(null);
  }

  useEffect(() => {
    let cancelled = false;
    setLayoutError(null);
    setGraph(null);

    try {
      void buildDesignerBlueprintGraph({
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
    } catch (error: unknown) {
      if (cancelled) {
        return;
      }
      setLayoutError(
        error instanceof Error ? error.message : "Designer blueprint graph layout failed.",
      );
    }

    return () => {
      cancelled = true;
    };
  }, [blueprintLayoutInputKey]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <section
        className="min-h-0 flex-1 overflow-hidden bg-muted/20"
        aria-label="Designer blueprint graph"
        onPointerDownCapture={closeOpenCommentWhenPointerStartsOutside}
      >
        {layoutError === null ? null : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
            {layoutError}
          </div>
        )}
        {layoutError !== null || graph === null ? null : (
          <ReactFlow
            nodes={mapDesignerBlueprintGraphNodesForComments({
              graph,
              onAddComment: input.onAddComment,
              onClearAddCommentSuppression: clearAddCommentSuppressionForItem,
              onDeleteComment: input.onDeleteComment,
              onOpenComment: setOpenComment,
              onSuppressAddComment: suppressAddCommentForItem,
              onUpdateComment: input.onUpdateComment,
              openComment,
              pendingComments: input.pendingComments,
              suppressedAddCommentItemIds,
            })}
            edges={graph.edges}
            edgeTypes={DesignerBlueprintEdgeTypes}
            nodeTypes={DesignerBlueprintNodeTypes}
            defaultViewport={{
              ...DesignerBlueprintInitialViewport,
              zoom: DesignerBlueprintProcessLaneInitialZoom,
            }}
            minZoom={0.45}
            maxZoom={1.4}
            elementsSelectable={false}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <DesignerBlueprintInitialFocus
              graph={graph}
              rightPadding={DesignerBlueprintProcessLaneInitialFocusRightPadding}
              zoom={DesignerBlueprintProcessLaneInitialZoom}
            />
            <DesignerBlueprintMeasuredGraphLayout
              graph={graph}
              onGraphChange={setGraph}
              onLayoutError={setLayoutError}
            />
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
  rightPadding: number;
  zoom: number;
}): React.JSX.Element | null {
  const reactFlow = useReactFlow<DesignerBlueprintVisualNode, DesignerBlueprintGraphEdge>();
  const width = useStore((state) => state.width);
  const viewport = useMemo(
    () =>
      resolveDesignerBlueprintInitialFocusViewportForNodes({
        nodes: input.graph.nodes,
        rightPadding: input.rightPadding,
        width,
        zoom: input.zoom,
      }),
    [input.graph.nodes, input.rightPadding, input.zoom, width],
  );

  // ReactFlow owns the viewport imperatively; render props and remounting cannot
  // focus the measured canvas once its store reports a usable width.
  useEffect(() => {
    if (viewport === null) {
      return;
    }

    void reactFlow.setViewport(viewport, { duration: 0 });
  }, [reactFlow, viewport]);

  return null;
}

function DesignerBlueprintMeasuredGraphLayout(input: {
  graph: DesignerBlueprintGraph;
  onGraphChange: (graph: DesignerBlueprintGraph) => void;
  onLayoutError: (error: string) => void;
}): React.JSX.Element | null {
  const { graph, onGraphChange, onLayoutError } = input;
  const measuredNodeHeights = useStore(
    useCallback(
      (state) =>
        graph.nodes.map((node) => ({
          height: state.nodeLookup.get(node.id)?.measured?.height,
          id: node.id,
        })),
      [graph.nodes],
    ),
  );

  useEffect(() => {
    let cancelled = false;
    const measuredHeightByNodeId = new Map<string, number>();
    for (const measuredNode of measuredNodeHeights) {
      if (measuredNode.height === undefined || measuredNode.height <= 0) {
        return;
      }

      measuredHeightByNodeId.set(measuredNode.id, measuredNode.height);
    }

    void buildDesignerBlueprintLayoutGraph({
      edges: graph.edges,
      measuredHeightByNodeId,
      nodes: graph.nodes,
    })
      .then((measuredGraph) => {
        if (cancelled) {
          return;
        }

        if (areDesignerBlueprintGraphNodePositionsEqual(graph, measuredGraph)) {
          return;
        }

        onGraphChange(measuredGraph);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        onLayoutError(
          error instanceof Error ? error.message : "Designer blueprint graph layout failed.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [graph, measuredNodeHeights, onGraphChange, onLayoutError]);

  return null;
}

function DesignerBlueprintVisualNodeComponent(
  input: NodeProps<DesignerBlueprintVisualNode>,
): React.JSX.Element {
  const [draftBody, setDraftBody] = useState("");
  const itemData = isDesignerBlueprintItemNodeData(input.data) ? input.data : null;
  const pendingComment = itemData?.pendingComment;
  const isDraftingComment =
    itemData !== null &&
    itemData.openComment?.itemId === itemData.item.id &&
    itemData.openComment.kind === "draft";
  const isPendingCommentExpanded =
    itemData !== null &&
    pendingComment !== undefined &&
    itemData.openComment?.itemId === itemData.item.id &&
    itemData.openComment.kind === "pending";
  const canStartDraftingComment =
    itemData !== null &&
    pendingComment === undefined &&
    !isDraftingComment &&
    !itemData.isAddCommentSuppressed;
  const isRoutingSummaryNode = input.data.routingSummaryRows !== undefined;
  const isTriggerConditionNode = input.data.triggerConditionRows !== undefined;
  const isOutcomeNode = input.data.kind === "outcome";
  const shouldRenderTitle =
    input.data.routingSummaryRows === undefined && input.data.triggerConditionRows === undefined;
  const shouldRenderDescription =
    input.data.description !== undefined &&
    input.data.routingSummaryRows === undefined &&
    input.data.triggerConditionRows === undefined;

  function cancelDraft(): void {
    setDraftBody("");
    if (itemData === null) {
      return;
    }
    itemData.onOpenComment(null);
  }

  function startDraftingComment(): void {
    if (itemData === null) {
      return;
    }
    itemData.onClearAddCommentSuppression(itemData.item.id);
    setDraftBody("");
    itemData.onOpenComment({
      itemId: itemData.item.id,
      kind: "draft",
    });
  }

  function submitDraft(): void {
    if (itemData === null) {
      return;
    }

    const trimmedDraftBody = draftBody.trim();
    if (trimmedDraftBody.length === 0) {
      return;
    }

    itemData.onAddComment(
      createPendingSessionBlueprintCommentInput({
        body: trimmedDraftBody,
        item: itemData.item,
        itemKindLabel: itemData.kindLabel,
        itemLabel: itemData.label,
      }),
    );
    setDraftBody("");
    itemData.onOpenComment(null);
  }

  return (
    <div
      aria-label={canStartDraftingComment ? `Add comment to ${input.data.label}` : undefined}
      className={cn(
        "group relative text-foreground",
        input.data.routingSummaryRows === undefined && !isOutcomeNode && !isTriggerConditionNode
          ? "w-[280px]"
          : "w-[440px]",
      )}
      data-testid={`designer-blueprint-node-${itemData?.item.id ?? DesignerBlueprintOutcomeNodeId}`}
      onClick={canStartDraftingComment ? startDraftingComment : undefined}
      onKeyDown={
        canStartDraftingComment
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              startDraftingComment();
            }
          : undefined
      }
      onPointerLeave={() => {
        if (itemData === null) {
          return;
        }
        itemData.onClearAddCommentSuppression(itemData.item.id);
      }}
      role={canStartDraftingComment ? "button" : undefined}
      tabIndex={canStartDraftingComment ? 0 : undefined}
    >
      {isOutcomeNode ? null : (
        <>
          <Handle
            className="opacity-0"
            isConnectable={false}
            position={Position.Top}
            type="target"
          />
          <Handle
            className="opacity-0"
            id={DesignerBlueprintRightTargetHandle}
            isConnectable={false}
            position={Position.Right}
            type="target"
          />
          <Handle
            className="opacity-0"
            id={DesignerBlueprintBottomTargetHandle}
            isConnectable={false}
            position={Position.Bottom}
            type="target"
          />
        </>
      )}
      <div
        className={cn(
          "relative rounded-md border shadow-sm transition-[border-color,box-shadow]",
          isRoutingSummaryNode || isTriggerConditionNode ? "p-1.5" : "p-2.5",
          isOutcomeNode
            ? "border-blue-200/70 border-l-4 border-l-blue-500/70 bg-blue-50/55 dark:border-blue-900/60 dark:border-l-blue-400/70 dark:bg-blue-950/25"
            : "border-border bg-background group-hover:border-blue-500/70 group-hover:ring-2 group-hover:ring-blue-500/15 group-focus-within:border-blue-500/70 group-focus-within:ring-2 group-focus-within:ring-blue-500/15",
        )}
      >
        <div className="flex items-start gap-2.5">
          {isRoutingSummaryNode || isOutcomeNode || isTriggerConditionNode ? null : (
            <span
              aria-label={input.data.kindLabel}
              className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground"
            >
              {itemData === null ? null : <DesignerBlueprintNodeKindIcon data={itemData} />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {!isOutcomeNode ? null : (
              <div className="mb-1.5 text-xs font-medium uppercase text-muted-foreground">
                Outcome
              </div>
            )}
            {!shouldRenderTitle ? null : (
              <h3 className="break-words text-sm font-medium leading-snug">{input.data.label}</h3>
            )}
            {!shouldRenderDescription ? null : (
              <p className="mt-0.5 break-words text-sm leading-snug text-muted-foreground">
                {input.data.description}
              </p>
            )}
            {input.data.routingSummaryRows === undefined ? null : (
              <DesignerBlueprintRoutingSummaryRows rows={input.data.routingSummaryRows} />
            )}
            {input.data.triggerConditionRows === undefined ? null : (
              <DesignerBlueprintTriggerConditionRows rows={input.data.triggerConditionRows} />
            )}
          </div>
        </div>
      </div>
      {canStartDraftingComment ? (
        <div
          className="pointer-events-none absolute right-0 top-0 z-20 flex -translate-y-[calc(100%+0.5rem)] items-center gap-1.5 text-xs font-medium text-blue-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:text-blue-300"
          data-testid={`designer-blueprint-add-comment-hint-${itemData?.item.id ?? DesignerBlueprintOutcomeNodeId}`}
        >
          <ChatCircleTextIcon aria-hidden="true" className="size-3.5" />
          Click to add comment
        </div>
      ) : null}
      {pendingComment === undefined || isPendingCommentExpanded ? null : (
        <DesignerBlueprintCollapsedCommentButton
          label={`Open blueprint comment for ${input.data.label}`}
          onOpen={() => {
            if (itemData === null) {
              return;
            }
            itemData.onOpenComment({
              itemId: itemData.item.id,
              kind: "pending",
            });
          }}
          testId={`designer-blueprint-collapsed-comment-${itemData?.item.id ?? DesignerBlueprintOutcomeNodeId}`}
        />
      )}
      {pendingComment === undefined || !isPendingCommentExpanded ? null : (
        <DesignerBlueprintFloatingNodeComment nodeId={input.id}>
          <DesignerBlueprintPendingCommentEditor
            body={pendingComment.body}
            title="Pending comment"
            onCollapse={() => {
              itemData?.onOpenComment(null);
            }}
            onBodyChange={(body) => {
              itemData?.onUpdateComment(pendingComment.id, body);
            }}
            onDelete={() => {
              if (itemData === null) {
                return;
              }
              itemData.onSuppressAddComment(itemData.item.id);
              itemData.onDeleteComment(pendingComment.id);
              itemData.onOpenComment(null);
            }}
          />
        </DesignerBlueprintFloatingNodeComment>
      )}
      {pendingComment !== undefined || !isDraftingComment ? null : (
        <DesignerBlueprintFloatingNodeComment nodeId={input.id}>
          <DesignerBlueprintDraftCommentEditor
            body={draftBody}
            onBodyChange={setDraftBody}
            onCancel={cancelDraft}
            onSubmit={submitDraft}
          />
        </DesignerBlueprintFloatingNodeComment>
      )}
      {isOutcomeNode ? null : (
        <Handle
          className="opacity-0"
          isConnectable={false}
          position={Position.Bottom}
          type="source"
        />
      )}
      {isOutcomeNode ? null : (
        <Handle
          className="opacity-0"
          id={DesignerBlueprintRightSourceHandle}
          isConnectable={false}
          position={Position.Right}
          type="source"
        />
      )}
      {isOutcomeNode ? null : (
        <Handle
          className="opacity-0"
          id={DesignerBlueprintLeftSourceHandle}
          isConnectable={false}
          position={Position.Left}
          type="source"
        />
      )}
    </div>
  );
}

function DesignerBlueprintTriggerConditionRows(input: {
  rows: readonly DesignerBlueprintTriggerConditionRow[];
}): React.JSX.Element {
  return (
    <div className="space-y-1.5 text-sm" data-testid="designer-blueprint-trigger-conditions">
      {input.rows.map((row, rowIndex) => (
        <div
          className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2.5 rounded-sm bg-muted/45 px-2.5 py-1.5"
          data-testid="designer-blueprint-trigger-condition-row"
          key={`${row.label}-${rowIndex}`}
        >
          <span className="shrink-0 rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5 text-xs font-medium uppercase text-muted-foreground">
            When
          </span>
          <span
            aria-label={row.integrationLogo?.displayName ?? "Trigger"}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-border/70 bg-background/70 text-muted-foreground"
          >
            {row.integrationLogo === undefined ? (
              <LightningIcon aria-hidden="true" className="size-3.5" weight="fill" />
            ) : (
              <IntegrationLogo alt="" className="size-3.5" logoKey={row.integrationLogo.logoKey} />
            )}
          </span>
          <div className="min-w-0 break-words font-medium leading-snug text-foreground">
            {row.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function DesignerBlueprintRoutingSummaryRows(input: {
  rows: readonly DesignerBlueprintRoutingSummaryRow[];
}): React.JSX.Element {
  return (
    <div className="space-y-1.5 text-sm" data-testid="designer-blueprint-routing-summary">
      {input.rows.map((row, rowIndex) => (
        <div
          className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-sm bg-muted/45 px-2.5 py-1.5"
          data-testid="designer-blueprint-routing-summary-row"
          key={`${row.outcomeLabel}-${row.nextStepLabel ?? "untargeted"}-${rowIndex}`}
        >
          <span className="shrink-0 rounded-sm border border-border/70 bg-background/70 px-1.5 py-0.5 text-xs font-medium uppercase text-muted-foreground">
            If
          </span>
          <div className="min-w-0 break-words font-medium leading-snug text-foreground">
            {row.outcomeLabel}
          </div>
          <ArrowRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 break-words leading-snug text-muted-foreground">
            {row.nextStepLabel ?? "No route"}
          </div>
        </div>
      ))}
    </div>
  );
}

function DesignerBlueprintFloatingNodeComment(input: {
  children: ReactNode;
  nodeId: string;
}): React.JSX.Element {
  return (
    <NodeToolbar
      align="start"
      isVisible
      nodeId={input.nodeId}
      offset={12}
      position={Position.Right}
    >
      <DesignerBlueprintFloatingComment>{input.children}</DesignerBlueprintFloatingComment>
    </NodeToolbar>
  );
}

export function DesignerBlueprintFloatingComment(input: {
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "nodrag nopan w-72 rounded-md border border-border bg-background p-2 shadow-lg",
        input.className,
      )}
      data-designer-blueprint-floating-comment=""
      data-testid="designer-blueprint-floating-comment"
    >
      {input.children}
    </div>
  );
}

export function DesignerBlueprintCollapsedCommentButton(input: {
  label: string;
  onOpen: () => void;
  testId?: string | undefined;
}): React.JSX.Element {
  return (
    <Button
      aria-label={input.label}
      className="nodrag nopan absolute right-0 top-0 z-20 size-8 -translate-y-[calc(100%+0.5rem)] rounded-sm border border-blue-500/30 bg-background p-0 text-blue-700 shadow-md hover:border-blue-500/50 hover:bg-blue-50 hover:text-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30 dark:hover:text-blue-200"
      data-testid={input.testId}
      onClick={input.onOpen}
      type="button"
      variant="outline"
    >
      <ChatCircleTextIcon aria-hidden="true" className="size-4" />
    </Button>
  );
}

export function DesignerBlueprintPendingCommentEditor(input: {
  body: string;
  onBodyChange: (body: string) => void;
  onCollapse: () => void;
  onDelete: () => void;
  title: string;
}): React.JSX.Element {
  const [draftBody, setDraftBody] = useState(input.body);

  function submitDraft(): void {
    const trimmedDraftBody = draftBody.trim();
    if (trimmedDraftBody.length === 0) {
      setDraftBody(input.body);
      return;
    }

    setDraftBody(trimmedDraftBody);
    input.onBodyChange(trimmedDraftBody);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
          <ChatCircleTextIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{input.title}</span>
        </div>
        <div className="-mr-1 flex shrink-0 items-center gap-1">
          <Button
            aria-label="Collapse blueprint comment"
            className="size-6 rounded-sm"
            data-testid="designer-blueprint-collapse-comment"
            onClick={input.onCollapse}
            type="button"
            variant="ghost"
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </Button>
          <Button
            aria-label="Delete blueprint comment"
            className="size-6 rounded-sm"
            data-testid="designer-blueprint-delete-comment"
            onClick={input.onDelete}
            type="button"
            variant="ghost"
          >
            <TrashIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </div>
      <DesignerBlueprintCommentTextarea
        aria-label="Blueprint comment"
        data-testid="designer-blueprint-comment"
        onBlur={submitDraft}
        onChange={(event) => {
          setDraftBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submitDraft();
            event.currentTarget.blur();
          }
        }}
        value={draftBody}
      />
    </div>
  );
}

export function DesignerBlueprintDraftCommentEditor(input: {
  body: string;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  return (
    <div>
      <DesignerBlueprintCommentTextarea
        autoFocus
        aria-label="New blueprint comment"
        data-testid="designer-blueprint-new-comment"
        onChange={(event) => {
          input.onBodyChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            input.onCancel();
            return;
          }

          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            input.onSubmit();
          }
        }}
        placeholder="Add comment"
        value={input.body}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button onClick={input.onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={input.body.trim().length === 0}
          onClick={input.onSubmit}
          size="sm"
          type="button"
        >
          <>
            Add
            <DialogShortcut aria-label="Enter" />
          </>
        </Button>
      </div>
    </div>
  );
}

function DesignerBlueprintCommentTextarea(
  props: React.ComponentProps<typeof Textarea>,
): React.JSX.Element {
  return (
    <Textarea
      {...props}
      className={`min-h-20 resize-none rounded-sm border-border bg-background p-2 text-xs shadow-none focus-visible:ring-1 ${
        props.className ?? ""
      }`}
    />
  );
}

function DesignerBlueprintNodeKindIcon(input: {
  data: DesignerBlueprintItemVisualNodeData;
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
    case "outcome":
      return <AtomIcon aria-hidden="true" className={className} />;
  }
}

export async function buildDesignerBlueprintGraph(input: {
  blueprint: DesignerBlueprintDocument;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): Promise<DesignerBlueprintGraph> {
  const unresolvedNodes = buildDesignerBlueprintUnresolvedNodes(input);
  const displayEdges = buildDesignerBlueprintDisplayEdges(input.blueprint);
  return await buildDesignerBlueprintLayoutGraph({
    edges: displayEdges,
    nodes: unresolvedNodes,
  });
}

async function buildDesignerBlueprintLayoutGraph(input: {
  edges: DesignerBlueprintGraphEdge[];
  measuredHeightByNodeId?: ReadonlyMap<string, number> | undefined;
  nodes: readonly DesignerBlueprintLayoutNode[];
}): Promise<DesignerBlueprintGraph> {
  const outcomeNode = input.nodes.find((node) => node.id === DesignerBlueprintOutcomeNodeId);
  const workflowNodes = input.nodes.filter((node) => node.id !== DesignerBlueprintOutcomeNodeId);
  const workflowNodeIds = new Set(workflowNodes.map((node) => node.id));
  const layoutEdgeAnalysis = analyzeDesignerBlueprintLayoutEdges({
    edges: input.edges,
    nodes: workflowNodes,
  });
  const elkGraph: ElkNode = {
    id: "designer-blueprint-layout",
    children: workflowNodes.map((node) => ({
      id: node.id,
      width: getDesignerBlueprintPositionedNodeWidth(node),
      height:
        input.measuredHeightByNodeId?.get(node.id) ??
        resolveDesignerBlueprintProcessLaneSlotHeight({
          description: node.data.description,
          routingSummaryRows: node.data.routingSummaryRows,
          triggerConditionRows: node.data.triggerConditionRows,
        }),
    })),
    edges: input.edges
      .filter(
        (edge) =>
          workflowNodeIds.has(edge.source) &&
          workflowNodeIds.has(edge.target) &&
          !layoutEdgeAnalysis.returnEdgeIds.has(edge.id),
      )
      .map(
        (edge): ElkExtendedEdge => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target],
        }),
      ),
  };

  const layoutedGraph = await getDesignerBlueprintElk().layout(elkGraph);
  const layoutedChildren = layoutedGraph.children;
  if (layoutedChildren === undefined && workflowNodes.length > 0) {
    throw new Error("Designer blueprint graph layout did not return positioned nodes.");
  }

  const positionByNodeId = new Map<string, { x: number; y: number }>();
  let workflowMinX = Number.POSITIVE_INFINITY;
  let workflowMaxX = Number.NEGATIVE_INFINITY;

  for (const child of layoutedChildren ?? []) {
    if (child.x === undefined || child.y === undefined || child.width === undefined) {
      throw new Error(`Designer blueprint graph layout did not position node '${child.id}'.`);
    }

    workflowMinX = Math.min(workflowMinX, child.x);
    workflowMaxX = Math.max(workflowMaxX, child.x + child.width);
    positionByNodeId.set(child.id, {
      x: child.x,
      y: child.y,
    });
  }

  const hasWorkflowNodes = Number.isFinite(workflowMinX) && Number.isFinite(workflowMaxX);
  const workflowCenterX = hasWorkflowNodes ? workflowMinX + (workflowMaxX - workflowMinX) / 2 : 0;
  if (hasWorkflowNodes) {
    centerDesignerBlueprintLayers({
      centerX: workflowCenterX,
      nodes: workflowNodes,
      positionByNodeId,
    });
  }

  if (outcomeNode !== undefined) {
    const outcomeWidth = getDesignerBlueprintPositionedNodeWidth(outcomeNode);
    const outcomeHeight =
      input.measuredHeightByNodeId?.get(outcomeNode.id) ??
      resolveDesignerBlueprintProcessLaneSlotHeight({
        description: outcomeNode.data.description,
        routingSummaryRows: outcomeNode.data.routingSummaryRows,
        triggerConditionRows: outcomeNode.data.triggerConditionRows,
      });
    positionByNodeId.set(outcomeNode.id, {
      x: workflowCenterX - outcomeWidth / 2,
      y: 0,
    });

    for (const [nodeId, position] of positionByNodeId) {
      if (nodeId === outcomeNode.id) {
        continue;
      }
      positionByNodeId.set(nodeId, {
        x: position.x,
        y: position.y + outcomeHeight + DesignerBlueprintOutcomeGap,
      });
    }
  }

  placeDesignerBlueprintSideReturnNodes({
    measuredHeightByNodeId: input.measuredHeightByNodeId,
    nodes: workflowNodes,
    positionByNodeId,
    sideReturnEdges: layoutEdgeAnalysis.sideReturnEdges,
  });

  const positionedNodes = input.nodes.map((node) => ({
    ...node,
    position: positionByNodeId.get(node.id) ?? node.position,
  }));

  const positionedNodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const fanOutCountByNodeId = createDesignerBlueprintFanCountByNodeId({
    edges: input.edges,
    field: "source",
  });
  const fanInCountByNodeId = createDesignerBlueprintFanCountByNodeId({
    edges: input.edges,
    field: "target",
  });

  return {
    edges: input.edges.map((edge) => {
      if (layoutEdgeAnalysis.sideReturnEdgeIds.has(edge.id)) {
        return {
          ...edge,
          animated: true,
          sourceHandle: DesignerBlueprintLeftSourceHandle,
          style: {
            ...edge.style,
            strokeDasharray: "6 4",
          },
          targetHandle: DesignerBlueprintRightTargetHandle,
          type: "straight",
        };
      }

      if (layoutEdgeAnalysis.returnEdgeIds.has(edge.id)) {
        return {
          ...edge,
          animated: true,
          sourceHandle: DesignerBlueprintRightSourceHandle,
          style: {
            ...edge.style,
            strokeDasharray: "6 4",
          },
          targetHandle: DesignerBlueprintRightTargetHandle,
          type: "loopback",
        };
      }

      if (
        (fanOutCountByNodeId.get(edge.source) ?? 0) > 1 ||
        (fanInCountByNodeId.get(edge.target) ?? 0) > 1
      ) {
        const sourceHandle = resolveDesignerBlueprintSourceHandle({
          edge,
          nodeById: positionedNodeById,
        });
        const targetHandle = resolveDesignerBlueprintTargetHandle({
          edge,
          nodeById: positionedNodeById,
        });
        return {
          ...edge,
          ...(sourceHandle === undefined ? {} : { sourceHandle }),
          ...(targetHandle === undefined ? {} : { targetHandle }),
          type: "curved",
        };
      }

      const sourceHandle = resolveDesignerBlueprintSourceHandle({
        edge,
        nodeById: positionedNodeById,
      });
      const targetHandle = resolveDesignerBlueprintTargetHandle({
        edge,
        nodeById: positionedNodeById,
      });
      return {
        ...edge,
        ...(sourceHandle === undefined ? {} : { sourceHandle }),
        ...(targetHandle === undefined ? {} : { targetHandle }),
      };
    }),
    nodes: positionedNodes,
  };
}

function resolveDesignerBlueprintSourceHandle(input: {
  edge: DesignerBlueprintGraphEdge;
  nodeById: ReadonlyMap<string, DesignerBlueprintLayoutNode>;
}): string | undefined {
  const sourceNode = input.nodeById.get(input.edge.source);
  const targetNode = input.nodeById.get(input.edge.target);
  if (sourceNode === undefined || targetNode === undefined) {
    return undefined;
  }

  const sourceCenterX =
    sourceNode.position.x + getDesignerBlueprintPositionedNodeWidth(sourceNode) / 2;
  const targetCenterX =
    targetNode.position.x + getDesignerBlueprintPositionedNodeWidth(targetNode) / 2;

  if (targetNode.position.y <= sourceNode.position.y) {
    return targetCenterX >= sourceCenterX
      ? DesignerBlueprintRightSourceHandle
      : DesignerBlueprintLeftSourceHandle;
  }

  return undefined;
}

function resolveDesignerBlueprintTargetHandle(input: {
  edge: DesignerBlueprintGraphEdge;
  nodeById: ReadonlyMap<string, DesignerBlueprintLayoutNode>;
}): string | undefined {
  const sourceNode = input.nodeById.get(input.edge.source);
  const targetNode = input.nodeById.get(input.edge.target);
  if (sourceNode === undefined || targetNode === undefined) {
    return undefined;
  }

  const sourceCenterX =
    sourceNode.position.x + getDesignerBlueprintPositionedNodeWidth(sourceNode) / 2;
  const targetCenterX =
    targetNode.position.x + getDesignerBlueprintPositionedNodeWidth(targetNode) / 2;
  const verticalOffset = targetNode.position.y - sourceNode.position.y;
  const horizontalOffset = targetCenterX - sourceCenterX;

  if (verticalOffset < 0 && Math.abs(verticalOffset) > Math.abs(horizontalOffset)) {
    return DesignerBlueprintBottomTargetHandle;
  }

  return undefined;
}

type DesignerBlueprintLayoutEdgeAnalysis = {
  returnEdgeIds: ReadonlySet<string>;
  sideReturnEdgeIds: ReadonlySet<string>;
  sideReturnEdges: readonly DesignerBlueprintGraphEdge[];
};

function analyzeDesignerBlueprintLayoutEdges(input: {
  edges: readonly DesignerBlueprintGraphEdge[];
  nodes: readonly DesignerBlueprintLayoutNode[];
}): DesignerBlueprintLayoutEdgeAnalysis {
  const itemById = new Map(
    input.nodes
      .filter(
        (
          node,
        ): node is DesignerBlueprintLayoutNode & { data: DesignerBlueprintItemLayoutNodeData } =>
          isDesignerBlueprintItemNodeData(node.data),
      )
      .map((node) => [node.id, node.data.item]),
  );
  const itemIndexById = new Map(input.nodes.map((node, index) => [node.id, index]));
  const incomingEdgesByTarget = new Map<string, DesignerBlueprintGraphEdge[]>();

  for (const edge of input.edges) {
    const incomingEdges = incomingEdgesByTarget.get(edge.target) ?? [];
    incomingEdges.push(edge);
    incomingEdgesByTarget.set(edge.target, incomingEdges);
  }

  const returnEdgeIds = new Set<string>();
  const sideReturnEdgeIds = new Set<string>();
  const sideReturnEdges: DesignerBlueprintGraphEdge[] = [];
  const sideReturnSourceIds = new Set<string>();

  for (const edge of input.edges) {
    const sourceItem = itemById.get(edge.source);
    const targetItem = itemById.get(edge.target);
    if (sourceItem === undefined || targetItem === undefined) {
      continue;
    }

    if (sourceItem.kind === "routing_policy") {
      continue;
    }

    if (
      hasDesignerBlueprintExistingEntry({
        edge,
        incomingEdgesByTarget,
      }) &&
      hasDesignerBlueprintPath({
        edges: input.edges,
        excludedEdgeId: edge.id,
        from: edge.target,
        to: edge.source,
      }) &&
      hasDesignerBlueprintIncomingRoutingPolicyEdge({
        incomingEdgesByTarget,
        itemById,
        nodeId: edge.source,
      })
    ) {
      sideReturnSourceIds.add(edge.source);
    }
  }

  for (const edge of input.edges) {
    const sourceItem = itemById.get(edge.source);
    const targetItem = itemById.get(edge.target);
    const sourceIndex = itemIndexById.get(edge.source);
    const targetIndex = itemIndexById.get(edge.target);
    if (sourceItem === undefined || targetItem === undefined) {
      continue;
    }

    const targetReturnsToSource = hasDesignerBlueprintPath({
      edges: input.edges,
      excludedEdgeId: edge.id,
      from: edge.target,
      to: edge.source,
    });
    if (!targetReturnsToSource) {
      continue;
    }

    if (sourceItem.kind === "routing_policy") {
      if (sideReturnSourceIds.has(edge.target)) {
        continue;
      }

      returnEdgeIds.add(edge.id);
      continue;
    }

    if (
      hasDesignerBlueprintExistingEntry({
        edge,
        incomingEdgesByTarget,
      }) &&
      hasDesignerBlueprintIncomingRoutingPolicyEdge({
        incomingEdgesByTarget,
        itemById,
        nodeId: edge.source,
      })
    ) {
      returnEdgeIds.add(edge.id);
      sideReturnEdgeIds.add(edge.id);
      sideReturnEdges.push(edge);
      continue;
    }

    if (sourceIndex !== undefined && targetIndex !== undefined && sourceIndex > targetIndex) {
      returnEdgeIds.add(edge.id);
    }
  }

  return {
    returnEdgeIds,
    sideReturnEdgeIds,
    sideReturnEdges,
  };
}

function hasDesignerBlueprintPath(input: {
  edges: readonly DesignerBlueprintGraphEdge[];
  excludedEdgeId: string;
  from: string;
  to: string;
}): boolean {
  const outgoingTargetsBySource = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (edge.id === input.excludedEdgeId) {
      continue;
    }

    const outgoingTargets = outgoingTargetsBySource.get(edge.source) ?? [];
    outgoingTargets.push(edge.target);
    outgoingTargetsBySource.set(edge.source, outgoingTargets);
  }

  const visited = new Set<string>();
  const pending = [input.from];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) {
      continue;
    }

    if (nodeId === input.to) {
      return true;
    }

    visited.add(nodeId);
    pending.push(...(outgoingTargetsBySource.get(nodeId) ?? []));
  }

  return false;
}

function hasDesignerBlueprintExistingEntry(input: {
  edge: DesignerBlueprintGraphEdge;
  incomingEdgesByTarget: ReadonlyMap<string, readonly DesignerBlueprintGraphEdge[]>;
}): boolean {
  return (
    input.incomingEdgesByTarget
      .get(input.edge.target)
      ?.some((incomingEdge) => incomingEdge.source !== input.edge.source) ?? false
  );
}

function hasDesignerBlueprintIncomingRoutingPolicyEdge(input: {
  incomingEdgesByTarget: ReadonlyMap<string, readonly DesignerBlueprintGraphEdge[]>;
  itemById: ReadonlyMap<string, DesignerBlueprintItem>;
  nodeId: string;
}): boolean {
  return (
    input.incomingEdgesByTarget
      .get(input.nodeId)
      ?.some(
        (incomingEdge) => input.itemById.get(incomingEdge.source)?.kind === "routing_policy",
      ) ?? false
  );
}

function placeDesignerBlueprintSideReturnNodes(input: {
  measuredHeightByNodeId?: ReadonlyMap<string, number> | undefined;
  nodes: readonly DesignerBlueprintLayoutNode[];
  positionByNodeId: Map<string, { x: number; y: number }>;
  sideReturnEdges: readonly DesignerBlueprintGraphEdge[];
}): void {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const placedCountByTargetId = new Map<string, number>();

  for (const edge of input.sideReturnEdges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const targetPosition = input.positionByNodeId.get(edge.target);
    if (sourceNode === undefined || targetNode === undefined || targetPosition === undefined) {
      continue;
    }

    const placedCount = placedCountByTargetId.get(edge.target) ?? 0;
    placedCountByTargetId.set(edge.target, placedCount + 1);

    const sourceHeight =
      input.measuredHeightByNodeId?.get(sourceNode.id) ??
      resolveDesignerBlueprintProcessLaneSlotHeight({
        description: sourceNode.data.description,
        routingSummaryRows: sourceNode.data.routingSummaryRows,
        triggerConditionRows: sourceNode.data.triggerConditionRows,
      });
    const targetHeight =
      input.measuredHeightByNodeId?.get(targetNode.id) ??
      resolveDesignerBlueprintProcessLaneSlotHeight({
        description: targetNode.data.description,
        routingSummaryRows: targetNode.data.routingSummaryRows,
        triggerConditionRows: targetNode.data.triggerConditionRows,
      });

    input.positionByNodeId.set(edge.source, {
      x:
        targetPosition.x +
        getDesignerBlueprintPositionedNodeWidth(targetNode) +
        DesignerBlueprintSideReturnNodeGap,
      y:
        targetPosition.y +
        targetHeight / 2 -
        sourceHeight / 2 +
        placedCount * (sourceHeight + DesignerBlueprintLayoutNodeSpacing / 2),
    });
  }
}

function centerDesignerBlueprintLayers(input: {
  centerX: number;
  nodes: readonly DesignerBlueprintLayoutNode[];
  positionByNodeId: Map<string, { x: number; y: number }>;
}): void {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const nodeIdsByY = new Map<number, string[]>();
  for (const node of input.nodes) {
    const position = input.positionByNodeId.get(node.id);
    if (position === undefined) {
      continue;
    }

    const nodeIds = nodeIdsByY.get(position.y) ?? [];
    nodeIds.push(node.id);
    nodeIdsByY.set(position.y, nodeIds);
  }

  for (const nodeIds of nodeIdsByY.values()) {
    let layerMinX = Number.POSITIVE_INFINITY;
    let layerMaxX = Number.NEGATIVE_INFINITY;

    for (const nodeId of nodeIds) {
      const node = nodeById.get(nodeId);
      const position = input.positionByNodeId.get(nodeId);
      if (node === undefined || position === undefined) {
        continue;
      }

      layerMinX = Math.min(layerMinX, position.x);
      layerMaxX = Math.max(layerMaxX, position.x + getDesignerBlueprintPositionedNodeWidth(node));
    }

    if (!Number.isFinite(layerMinX) || !Number.isFinite(layerMaxX)) {
      continue;
    }

    const layerCenterX = layerMinX + (layerMaxX - layerMinX) / 2;
    const offsetX = input.centerX - layerCenterX;

    for (const nodeId of nodeIds) {
      const position = input.positionByNodeId.get(nodeId);
      if (position === undefined) {
        continue;
      }

      input.positionByNodeId.set(nodeId, {
        x: position.x + offsetX,
        y: position.y,
      });
    }
  }
}

function createDesignerBlueprintFanCountByNodeId(input: {
  edges: readonly DesignerBlueprintGraphEdge[];
  field: "source" | "target";
}): ReadonlyMap<string, number> {
  const countByNodeId = new Map<string, number>();
  for (const edge of input.edges) {
    const nodeId = edge[input.field];
    countByNodeId.set(nodeId, (countByNodeId.get(nodeId) ?? 0) + 1);
  }

  return countByNodeId;
}

function getDesignerBlueprintElk(): ElkInstance {
  if (designerBlueprintElk === null) {
    designerBlueprintElk = new ELK({
      defaultLayoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.spacing.nodeNodeBetweenLayers": String(DesignerBlueprintLayoutLayerSpacing),
        "elk.spacing.nodeNode": String(DesignerBlueprintLayoutNodeSpacing),
      },
    });
  }

  return designerBlueprintElk;
}

function areDesignerBlueprintGraphNodePositionsEqual(
  currentGraph: DesignerBlueprintGraph,
  nextGraph: DesignerBlueprintGraph,
): boolean {
  if (currentGraph.nodes.length !== nextGraph.nodes.length) {
    return false;
  }

  return currentGraph.nodes.every((currentNode, index) => {
    const nextNode = nextGraph.nodes[index];
    return (
      nextNode !== undefined &&
      currentNode.id === nextNode.id &&
      currentNode.position.x === nextNode.position.x &&
      currentNode.position.y === nextNode.position.y
    );
  });
}

export function resolveDesignerBlueprintProcessLaneSlotHeight(input: {
  description?: string | undefined;
  routingSummaryRows?: readonly DesignerBlueprintRoutingSummaryRow[] | undefined;
  triggerConditionRows?: readonly DesignerBlueprintTriggerConditionRow[] | undefined;
}): number {
  return getDesignerBlueprintNodeContentHeight(input);
}

export function resolveDesignerBlueprintInitialFocusViewport(input: {
  graphBounds: DesignerBlueprintGraphBounds;
  rightPadding?: number | undefined;
  width: number;
  zoom?: number | undefined;
}): Viewport {
  const zoom = input.zoom ?? DesignerBlueprintInitialViewport.zoom;
  const graphWidth = input.graphBounds.width + (input.rightPadding ?? 0);
  return {
    x: input.width / 2 - (input.graphBounds.x + graphWidth / 2) * zoom,
    y: DesignerBlueprintInitialFocusTopPadding - input.graphBounds.y * zoom,
    zoom,
  };
}

export function resolveDesignerBlueprintInitialFocusViewportForNodes(input: {
  nodes: readonly DesignerBlueprintPositionedNode[];
  rightPadding?: number | undefined;
  width: number;
  zoom?: number | undefined;
}): Viewport | null {
  if (input.width <= 0) {
    return null;
  }

  const graphBounds = getDesignerBlueprintGraphBounds(input.nodes);
  if (graphBounds === null) {
    return null;
  }

  return resolveDesignerBlueprintInitialFocusViewport({
    graphBounds,
    rightPadding: input.rightPadding,
    width: input.width,
    zoom: input.zoom,
  });
}

type DesignerBlueprintGraphBounds = {
  width: number;
  x: number;
  y: number;
};

type DesignerBlueprintPositionedNode = {
  data?:
    | {
        kind?: DesignerBlueprintNodeData["kind"] | undefined;
        routingSummaryRows?: readonly DesignerBlueprintRoutingSummaryRow[] | undefined;
        triggerConditionRows?: readonly DesignerBlueprintTriggerConditionRow[] | undefined;
      }
    | undefined;
  position: {
    x: number;
    y: number;
  };
};

function getDesignerBlueprintGraphBounds(
  nodes: readonly DesignerBlueprintPositionedNode[],
): DesignerBlueprintGraphBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(node.position.x + getDesignerBlueprintPositionedNodeWidth(node), maxX);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    width: maxX - minX,
    x: minX,
    y: minY,
  };
}

function getDesignerBlueprintPositionedNodeWidth(node: DesignerBlueprintPositionedNode): number {
  return node.data?.kind === "outcome" ||
    node.data?.routingSummaryRows !== undefined ||
    node.data?.triggerConditionRows !== undefined
    ? DesignerBlueprintRoutingNodeWidth
    : DesignerBlueprintNodeWidth;
}

function isDesignerBlueprintItemNodeData(
  data: DesignerBlueprintNodeData,
): data is DesignerBlueprintItemLayoutNodeData;
function isDesignerBlueprintItemNodeData(
  data: DesignerBlueprintNodeVisualData,
): data is DesignerBlueprintItemVisualNodeData;
function isDesignerBlueprintItemNodeData(
  data: DesignerBlueprintNodeData | DesignerBlueprintNodeVisualData,
): data is DesignerBlueprintItemLayoutNodeData | DesignerBlueprintItemVisualNodeData {
  return data.kind !== "outcome";
}

function buildDesignerBlueprintUnresolvedNodes(input: {
  blueprint: DesignerBlueprintDocument;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): DesignerBlueprintLayoutNode[] {
  const itemLabelById = new Map(
    input.blueprint.items.map((item) => [item.id, formatDesignerBlueprintNodeLabel(item)]),
  );

  return [
    createDesignerBlueprintOutcomeLayoutNode(input.blueprint),
    ...input.blueprint.items.map((item) =>
      createDesignerBlueprintLayoutNode({
        id: item.id,
        data: {
          ...createDesignerBlueprintItemDescriptionData(item),
          ...createDesignerBlueprintIntegrationLogoData({
            item,
            integrationMetadataByTargetKey: input.integrationMetadataByTargetKey,
          }),
          kind: item.kind,
          kindLabel: formatDesignerBlueprintKindLabel({
            item,
            integrationMetadataByTargetKey: input.integrationMetadataByTargetKey,
          }),
          item,
          label: formatDesignerBlueprintNodeLabel(item),
          ...createDesignerBlueprintTriggerConditionData({
            item,
            integrationMetadataByTargetKey: input.integrationMetadataByTargetKey,
          }),
          ...createDesignerBlueprintRoutingSummaryData({
            item,
            itemLabelById,
          }),
        },
      }),
    ),
  ];
}

function createDesignerBlueprintOutcomeLayoutNode(
  blueprint: DesignerBlueprintDocument,
): DesignerBlueprintLayoutNode {
  return createDesignerBlueprintLayoutNode({
    id: DesignerBlueprintOutcomeNodeId,
    data: {
      ...(blueprint.outcome.description === undefined
        ? {}
        : { description: blueprint.outcome.description }),
      kind: "outcome",
      kindLabel: "Outcome",
      label: blueprint.outcome.label,
    },
  });
}

function createDesignerBlueprintLayoutNode(input: {
  data: DesignerBlueprintNodeData;
  id: string;
}): DesignerBlueprintLayoutNode {
  return {
    id: input.id,
    type: "blueprint",
    data: input.data,
    position: { x: 0, y: 0 },
  };
}

function createDesignerBlueprintItemDescriptionData(
  item: DesignerBlueprintItem,
): Pick<DesignerBlueprintLayoutNodeData, "description"> | Record<string, never> {
  if (item.kind === "trigger" || item.kind === "routing_policy" || item.description === undefined) {
    return {};
  }

  return { description: item.description };
}

function createDesignerBlueprintPendingCommentData(input: {
  item: DesignerBlueprintItem;
  pendingComments: readonly PendingSessionBlueprintComment[];
}): Pick<DesignerBlueprintItemVisualNodeData, "pendingComment"> | Record<string, never> {
  const pendingComment = input.pendingComments.find((comment) => comment.itemId === input.item.id);
  return pendingComment === undefined ? {} : { pendingComment };
}

function mapDesignerBlueprintGraphNodesForComments(input: {
  graph: DesignerBlueprintGraph;
  onAddComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onClearAddCommentSuppression: (itemId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onOpenComment: (comment: DesignerBlueprintOpenComment) => void;
  onSuppressAddComment: (itemId: string) => void;
  onUpdateComment: (commentId: string, body: string) => void;
  openComment: DesignerBlueprintOpenComment;
  pendingComments: readonly PendingSessionBlueprintComment[];
  suppressedAddCommentItemIds: ReadonlySet<string>;
}): DesignerBlueprintVisualNode[] {
  return input.graph.nodes.map((node) => {
    if (!isDesignerBlueprintItemNodeData(node.data)) {
      return {
        ...node,
        style: {
          ...node.style,
          pointerEvents: "all",
        },
        data: node.data,
      };
    }

    return {
      ...node,
      style: {
        ...node.style,
        pointerEvents: "all",
      },
      data: {
        ...node.data,
        isAddCommentSuppressed: input.suppressedAddCommentItemIds.has(node.data.item.id),
        onAddComment: input.onAddComment,
        onClearAddCommentSuppression: input.onClearAddCommentSuppression,
        onDeleteComment: input.onDeleteComment,
        onOpenComment: input.onOpenComment,
        onSuppressAddComment: input.onSuppressAddComment,
        onUpdateComment: input.onUpdateComment,
        openComment: input.openComment,
        ...createDesignerBlueprintPendingCommentData({
          item: node.data.item,
          pendingComments: input.pendingComments,
        }),
      },
    };
  });
}

function buildDesignerBlueprintDisplayEdges(
  input: DesignerBlueprintDocument,
): DesignerBlueprintGraphEdge[] {
  validateDesignerBlueprintRoutingLinks(input);
  return [
    ...input.links.map((link) => ({
      id: `${link.from}:${link.kind}:${link.to}`,
      source: link.from,
      target: link.to,
      animated: false,
      markerEnd: DesignerBlueprintEdgeMarker,
      type: "straight",
    })),
  ];
}

function validateDesignerBlueprintRoutingLinks(input: DesignerBlueprintDocument): void {
  const routingPolicyIds = new Set(
    input.items.filter((item) => item.kind === "routing_policy").map((item) => item.id),
  );
  const routingRuleTargetKeys = new Set<string>();
  const routeLinkKeys = new Set(
    input.links
      .filter((link) => link.kind === "routes_to")
      .map((link) => `${link.from}:${link.to}`),
  );

  for (const item of input.items) {
    if (item.kind !== "routing_policy") {
      continue;
    }

    for (const rule of item.rules) {
      if (rule.routeTo === undefined) {
        continue;
      }

      const linkKey = `${item.id}:${rule.routeTo}`;
      routingRuleTargetKeys.add(linkKey);
      if (!routeLinkKeys.has(linkKey)) {
        throw new Error(
          `Designer blueprint routing rule '${item.id}' routes to '${rule.routeTo}' but the matching routes_to link is missing.`,
        );
      }
    }
  }

  for (const link of input.links) {
    if (link.kind !== "routes_to" || !routingPolicyIds.has(link.from)) {
      continue;
    }

    const linkKey = `${link.from}:${link.to}`;
    if (!routingRuleTargetKeys.has(linkKey)) {
      throw new Error(
        `Designer blueprint routes_to link '${link.from}' to '${link.to}' is missing a matching routing rule target.`,
      );
    }
  }
}

function getDesignerBlueprintNodeContentHeight(input: {
  description?: string | undefined;
  routingSummaryRows?: readonly DesignerBlueprintRoutingSummaryRow[] | undefined;
  triggerConditionRows?: readonly DesignerBlueprintTriggerConditionRow[] | undefined;
}): number {
  if (input.routingSummaryRows !== undefined) {
    return (
      DesignerBlueprintNodeRowOnlyVerticalPadding +
      getDesignerBlueprintRoutingSummaryHeight(input.routingSummaryRows)
    );
  }

  if (input.triggerConditionRows !== undefined) {
    return (
      DesignerBlueprintNodeRowOnlyVerticalPadding +
      getDesignerBlueprintTriggerConditionHeight(input.triggerConditionRows)
    );
  }

  const textHeight =
    DesignerBlueprintNodeTitleLineHeight + getDesignerBlueprintDescriptionHeight(input.description);
  return (
    DesignerBlueprintNodeVerticalPadding + Math.max(DesignerBlueprintNodeIconHeight, textHeight)
  );
}

function getDesignerBlueprintDescriptionHeight(description: string | undefined): number {
  if (description === undefined) {
    return 0;
  }

  const lineCount = Math.ceil(description.length / DesignerBlueprintNodeDescriptionCharsPerLine);
  return (
    DesignerBlueprintNodeDescriptionMarginTop +
    Math.max(lineCount, 1) * DesignerBlueprintNodeDescriptionLineHeight
  );
}

function getDesignerBlueprintRoutingSummaryHeight(
  routingSummaryRows: readonly DesignerBlueprintRoutingSummaryRow[] | undefined,
): number {
  if (routingSummaryRows === undefined) {
    return 0;
  }

  return (
    routingSummaryRows.reduce(
      (height, row) =>
        height +
        Math.max(
          DesignerBlueprintNodeRoutingSummaryRowBaseHeight,
          (getDesignerBlueprintTextLineCount({
            charsPerLine: DesignerBlueprintNodeRoutingSummaryOutcomeCharsPerLine,
            text: row.outcomeLabel,
          }) +
            getDesignerBlueprintTextLineCount({
              charsPerLine: DesignerBlueprintNodeRoutingSummaryNextStepCharsPerLine,
              text: row.nextStepLabel ?? "No route",
            })) *
            DesignerBlueprintNodeRoutingSummaryTextLineHeight,
        ) +
        DesignerBlueprintNodeRoutingSummaryGap,
      0,
    ) - DesignerBlueprintNodeRoutingSummaryGap
  );
}

function getDesignerBlueprintTriggerConditionHeight(
  triggerConditionRows: readonly DesignerBlueprintTriggerConditionRow[] | undefined,
): number {
  if (triggerConditionRows === undefined) {
    return 0;
  }

  return (
    triggerConditionRows.reduce(
      (height, row) =>
        height +
        Math.max(
          DesignerBlueprintNodeTriggerConditionRowBaseHeight,
          getDesignerBlueprintTextLineCount({
            charsPerLine: DesignerBlueprintNodeTriggerConditionCharsPerLine,
            text: row.label,
          }) * DesignerBlueprintNodeTriggerConditionTextLineHeight,
        ) +
        DesignerBlueprintNodeTriggerConditionGap,
      0,
    ) - DesignerBlueprintNodeTriggerConditionGap
  );
}

function getDesignerBlueprintTextLineCount(input: { charsPerLine: number; text: string }): number {
  return Math.max(Math.ceil(input.text.length / input.charsPerLine), 1);
}

type DesignerBlueprintIntegrationMetadata = {
  displayName: string;
  logoKey?: string | undefined;
};

const EmptyDesignerBlueprintIntegrationMetadataByTargetKey: ReadonlyMap<
  string,
  DesignerBlueprintIntegrationMetadata
> = new Map();

function buildDesignerBlueprintIntegrationMetadataByTargetKey(
  targets: Awaited<ReturnType<typeof listIntegrationDirectory>>["targets"] | undefined,
): ReadonlyMap<string, DesignerBlueprintIntegrationMetadata> {
  if (targets === undefined || targets.length === 0) {
    return EmptyDesignerBlueprintIntegrationMetadataByTargetKey;
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

function createDesignerBlueprintLayoutInputKey(input: {
  blueprint: DesignerBlueprintDocument;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): string {
  return JSON.stringify({
    blueprint: input.blueprint,
    integrationMetadata: [...input.integrationMetadataByTargetKey.entries()].sort(
      ([leftTargetKey], [rightTargetKey]) => leftTargetKey.localeCompare(rightTargetKey),
    ),
  });
}

function createDesignerBlueprintIntegrationLogoData(input: {
  item: DesignerBlueprintItem;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): Pick<DesignerBlueprintItemLayoutNodeData, "integrationLogo"> | Record<string, never> {
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
    const triggerSourceLabel =
      item.integrationTargetKey === undefined
        ? undefined
        : input.integrationMetadataByTargetKey.get(item.integrationTargetKey)?.displayName;
    return triggerSourceLabel === undefined ? "Trigger" : `${triggerSourceLabel} · Trigger`;
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
  if (item.kind === "trigger") {
    const firstCondition = getRequiredDesignerBlueprintFirstTriggerCondition(item);
    return item.when.length === 1
      ? `Trigger: ${firstCondition.label}`
      : `Trigger: ${firstCondition.label} + ${String(item.when.length - 1)}`;
  }

  if (item.kind === "routing_policy") {
    const firstRule = getRequiredDesignerBlueprintFirstRoutingRule(item);
    return item.rules.length === 1
      ? `Routing: ${firstRule.conditionLabel}`
      : `Routing: ${firstRule.conditionLabel} + ${String(item.rules.length - 1)}`;
  }

  return item.label;
}

function getRequiredDesignerBlueprintFirstTriggerCondition(
  item: Extract<DesignerBlueprintItem, { kind: "trigger" }>,
): Extract<DesignerBlueprintItem, { kind: "trigger" }>["when"][number] {
  const [condition] = item.when;
  if (condition === undefined) {
    throw new Error(`Designer blueprint trigger '${item.id}' must include at least one when row.`);
  }

  return condition;
}

function getRequiredDesignerBlueprintFirstRoutingRule(
  item: Extract<DesignerBlueprintItem, { kind: "routing_policy" }>,
): Extract<DesignerBlueprintItem, { kind: "routing_policy" }>["rules"][number] {
  const [rule] = item.rules;
  if (rule === undefined) {
    throw new Error(
      `Designer blueprint routing policy '${item.id}' must include at least one rule.`,
    );
  }

  return rule;
}

function formatDesignerBlueprintRoutingRuleBranch(
  rule: Extract<DesignerBlueprintItem, { kind: "routing_policy" }>["rules"][number],
): string {
  return rule.conditionLabel;
}

function createDesignerBlueprintItemLabelCounts(
  itemLabelById: ReadonlyMap<string, string>,
): ReadonlyMap<string, number> {
  const labelCounts = new Map<string, number>();
  for (const label of itemLabelById.values()) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return labelCounts;
}

function formatDesignerBlueprintRoutingDestination(
  rule: Extract<DesignerBlueprintItem, { kind: "routing_policy" }>["rules"][number],
  itemLabelById: ReadonlyMap<string, string>,
  itemLabelCounts: ReadonlyMap<string, number>,
): { id: string; label: string } | undefined {
  const routeTo = rule.routeTo;
  if (routeTo === undefined) {
    return undefined;
  }

  const label = itemLabelById.get(routeTo) ?? routeTo;
  return {
    id: routeTo,
    label: (itemLabelCounts.get(label) ?? 0) > 1 ? `${label} (${routeTo})` : label,
  };
}

function formatDesignerBlueprintRoutingSummaryRows(input: {
  item: DesignerBlueprintItem;
  itemLabelById: ReadonlyMap<string, string>;
}): readonly DesignerBlueprintRoutingSummaryRow[] | undefined {
  const item = input.item;
  if (item.kind !== "routing_policy") {
    return undefined;
  }

  const itemLabelCounts = createDesignerBlueprintItemLabelCounts(input.itemLabelById);

  return item.rules.map((rule) => ({
    nextStepLabel: formatDesignerBlueprintRoutingDestination(
      rule,
      input.itemLabelById,
      itemLabelCounts,
    )?.label,
    outcomeLabel: formatDesignerBlueprintRoutingRuleBranch(rule),
  }));
}

function createDesignerBlueprintTriggerConditionData(input: {
  item: DesignerBlueprintItem;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): Pick<DesignerBlueprintLayoutNodeData, "triggerConditionRows"> | Record<string, never> {
  const item = input.item;
  if (item.kind !== "trigger") {
    return {};
  }

  const integrationLogoData = createDesignerBlueprintIntegrationLogoData({
    item,
    integrationMetadataByTargetKey: input.integrationMetadataByTargetKey,
  });
  const integrationLogo =
    "integrationLogo" in integrationLogoData ? integrationLogoData.integrationLogo : undefined;

  return {
    triggerConditionRows: item.when.map((condition) => ({
      ...(integrationLogo === undefined ? {} : { integrationLogo }),
      label: condition.label,
    })),
  };
}

function createDesignerBlueprintRoutingSummaryData(input: {
  item: DesignerBlueprintItem;
  itemLabelById: ReadonlyMap<string, string>;
}): Pick<DesignerBlueprintLayoutNodeData, "routingSummaryRows"> | Record<string, never> {
  const routingSummaryRows = formatDesignerBlueprintRoutingSummaryRows(input);
  return routingSummaryRows === undefined ? {} : { routingSummaryRows };
}

function UnsupportedDesignerCanvasRoute(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      This route is not available in the Designer canvas.
    </div>
  );
}
