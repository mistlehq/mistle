import "dockview/dist/styles/dockview.css";
import "@xyflow/react/dist/style.css";
import "./session-terminal-workspace.css";
import { Button, DialogShortcut, Textarea } from "@mistle/ui";
import {
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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FunctionComponent,
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
            searchParams: route.searchParams,
            setSearchParams: (nextSearchParams) => {
              setEmbeddedLocationState(undefined);
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
            searchParams: route.searchParams,
            setupRouteSegment: route.setupRouteSegment,
            targetKey: route.targetKey,
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
const DesignerBlueprintNodeBaseHeight = 126;
const DesignerBlueprintNodeDescriptionLineHeight = 16;
const DesignerBlueprintNodeDescriptionCharsPerLine = 34;
const DesignerBlueprintNodeRoutingSummaryHeight = 28;
const DesignerBlueprintInitialViewport = { x: 48, y: 32, zoom: 0.95 };
const DesignerBlueprintInitialFocusTopPadding = 56;
let designerBlueprintElk: InstanceType<typeof ELK> | null = null;

type DesignerBlueprintLayoutNodeData = {
  description?: string;
  integrationLogo?: {
    displayName: string;
    logoKey: string;
  };
  item: DesignerBlueprintItem;
  kind: DesignerBlueprintItem["kind"];
  kindLabel: string;
  label: string;
  routingSummary?: string;
};

type DesignerBlueprintVisualNodeData = DesignerBlueprintLayoutNodeData & {
  isAddCommentSuppressed: boolean;
  onAddComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onClearAddCommentSuppression: (itemId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onSuppressAddComment: (itemId: string) => void;
  onUpdateComment: (commentId: string, body: string) => void;
  pendingComment?: PendingSessionBlueprintComment | undefined;
};

type DesignerBlueprintLayoutNode = Node<DesignerBlueprintLayoutNodeData, "blueprint">;
type DesignerBlueprintVisualNode = Node<DesignerBlueprintVisualNodeData, "blueprint">;
type DesignerBlueprintGraphEdge = Edge;

type DesignerBlueprintGraph = {
  edges: DesignerBlueprintGraphEdge[];
  nodes: DesignerBlueprintLayoutNode[];
};

const DesignerBlueprintNodeTypes = {
  blueprint: DesignerBlueprintVisualNodeComponent,
} satisfies NodeTypes;

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
  const [graph, setGraph] = useState<DesignerBlueprintGraph | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [suppressedAddCommentItemIds, setSuppressedAddCommentItemIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

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

  useEffect(() => {
    let cancelled = false;
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
            nodes={mapDesignerBlueprintGraphNodesForComments({
              graph,
              onAddComment: input.onAddComment,
              onClearAddCommentSuppression: clearAddCommentSuppressionForItem,
              onDeleteComment: input.onDeleteComment,
              onSuppressAddComment: suppressAddCommentForItem,
              onUpdateComment: input.onUpdateComment,
              pendingComments: input.pendingComments,
              suppressedAddCommentItemIds,
            })}
            edges={graph.edges}
            nodeTypes={DesignerBlueprintNodeTypes}
            defaultViewport={DesignerBlueprintInitialViewport}
            minZoom={0.45}
            maxZoom={1.4}
            elementsSelectable={false}
            nodesDraggable={false}
            nodesConnectable={false}
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
  const graphBounds = useMemo(
    () => getDesignerBlueprintGraphBounds(input.graph.nodes),
    [input.graph.nodes],
  );

  // ReactFlow owns the viewport imperatively; render props and remounting cannot
  // focus the measured canvas once its store reports a usable width.
  useEffect(() => {
    if (graphBounds === null || width <= 0) {
      return;
    }

    void reactFlow.setViewport(
      resolveDesignerBlueprintInitialFocusViewport({
        graphBounds,
        width,
      }),
      { duration: 0 },
    );
  }, [graphBounds, reactFlow, width]);

  return null;
}

function DesignerBlueprintVisualNodeComponent(
  input: NodeProps<DesignerBlueprintVisualNode>,
): React.JSX.Element {
  const [draftBody, setDraftBody] = useState("");
  const [isDraftingComment, setIsDraftingComment] = useState(false);
  const [expandedPendingCommentId, setExpandedPendingCommentId] = useState<string | null>(null);
  const pendingComment = input.data.pendingComment;
  const isPendingCommentExpanded =
    pendingComment !== undefined && expandedPendingCommentId === pendingComment.id;
  const canStartDraftingComment =
    pendingComment === undefined && !isDraftingComment && !input.data.isAddCommentSuppressed;

  function cancelDraft(): void {
    setDraftBody("");
    setIsDraftingComment(false);
  }

  function startDraftingComment(): void {
    input.data.onClearAddCommentSuppression(input.data.item.id);
    setIsDraftingComment(true);
  }

  function submitDraft(): void {
    const trimmedDraftBody = draftBody.trim();
    if (trimmedDraftBody.length === 0) {
      return;
    }

    input.data.onAddComment(
      createPendingSessionBlueprintCommentInput({
        body: trimmedDraftBody,
        item: input.data.item,
        itemKindLabel: input.data.kindLabel,
        itemLabel: input.data.label,
      }),
    );
    setDraftBody("");
    setIsDraftingComment(false);
  }

  return (
    <div
      aria-label={canStartDraftingComment ? `Add comment to ${input.data.label}` : undefined}
      className="group relative w-[280px] text-foreground"
      data-testid={`designer-blueprint-node-${input.data.item.id}`}
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
        input.data.onClearAddCommentSuppression(input.data.item.id);
      }}
      role={canStartDraftingComment ? "button" : undefined}
      tabIndex={canStartDraftingComment ? 0 : undefined}
    >
      <Handle className="opacity-0" isConnectable={false} position={Position.Top} type="target" />
      <div className="relative rounded-md border border-border bg-background p-2.5 shadow-sm transition-[border-color,box-shadow] group-hover:border-blue-500/70 group-hover:ring-2 group-hover:ring-blue-500/15 group-focus-within:border-blue-500/70 group-focus-within:ring-2 group-focus-within:ring-blue-500/15">
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
      </div>
      {canStartDraftingComment ? (
        <div
          className="pointer-events-none absolute right-0 top-0 z-20 flex -translate-y-[calc(100%+0.5rem)] items-center gap-1.5 text-xs font-medium text-blue-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 dark:text-blue-300"
          data-testid={`designer-blueprint-add-comment-hint-${input.data.item.id}`}
        >
          <ChatCircleTextIcon aria-hidden="true" className="size-3.5" />
          Click to add comment
        </div>
      ) : null}
      {pendingComment === undefined || isPendingCommentExpanded ? null : (
        <DesignerBlueprintCollapsedCommentButton
          label={`Open blueprint comment for ${input.data.label}`}
          onOpen={() => {
            setExpandedPendingCommentId(pendingComment.id);
          }}
          testId={`designer-blueprint-collapsed-comment-${input.data.item.id}`}
        />
      )}
      {pendingComment === undefined || !isPendingCommentExpanded ? null : (
        <DesignerBlueprintFloatingComment>
          <DesignerBlueprintPendingCommentEditor
            body={pendingComment.body}
            title="Pending comment"
            onCollapse={() => {
              setExpandedPendingCommentId(null);
            }}
            onBodyChange={(body) => {
              input.data.onUpdateComment(pendingComment.id, body);
            }}
            onDelete={() => {
              input.data.onSuppressAddComment(input.data.item.id);
              input.data.onDeleteComment(pendingComment.id);
              setExpandedPendingCommentId(null);
            }}
          />
        </DesignerBlueprintFloatingComment>
      )}
      {pendingComment !== undefined || !isDraftingComment ? null : (
        <DesignerBlueprintFloatingComment>
          <DesignerBlueprintDraftCommentEditor
            body={draftBody}
            onBodyChange={setDraftBody}
            onCancel={cancelDraft}
            onSubmit={submitDraft}
          />
        </DesignerBlueprintFloatingComment>
      )}
      <Handle
        className="opacity-0"
        isConnectable={false}
        position={Position.Bottom}
        type="source"
      />
    </div>
  );
}

export function DesignerBlueprintFloatingComment(input: {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="nodrag nopan absolute left-[calc(100%+0.75rem)] top-0 z-20 w-72 rounded-md border border-border bg-background p-2 shadow-lg"
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
  };
}

export function resolveDesignerBlueprintInitialFocusViewport(input: {
  graphBounds: DesignerBlueprintGraphBounds;
  width: number;
}): Viewport {
  return {
    x:
      input.width / 2 -
      (input.graphBounds.x + input.graphBounds.width / 2) * DesignerBlueprintInitialViewport.zoom,
    y:
      DesignerBlueprintInitialFocusTopPadding -
      input.graphBounds.y * DesignerBlueprintInitialViewport.zoom,
    zoom: DesignerBlueprintInitialViewport.zoom,
  };
}

type DesignerBlueprintGraphBounds = {
  width: number;
  x: number;
  y: number;
};

function getDesignerBlueprintGraphBounds(
  nodes: readonly DesignerBlueprintLayoutNode[],
): DesignerBlueprintGraphBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + DesignerBlueprintNodeWidth);
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

function getDesignerBlueprintElk(): InstanceType<typeof ELK> {
  designerBlueprintElk ??= new ELK();
  return designerBlueprintElk;
}

function buildDesignerBlueprintUnresolvedNodes(input: {
  blueprint: DesignerBlueprintDocument;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): DesignerBlueprintLayoutNode[] {
  return input.blueprint.items.map((item) =>
    createDesignerBlueprintLayoutNode({
      id: item.id,
      data: createDesignerBlueprintLayoutNodeData({
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
        item,
        label: formatDesignerBlueprintNodeLabel(item),
        ...createDesignerBlueprintRoutingSummaryData(item),
      }),
    }),
  );
}

function createDesignerBlueprintLayoutNode(input: {
  data: DesignerBlueprintLayoutNodeData;
  id: string;
}): DesignerBlueprintLayoutNode {
  return {
    id: input.id,
    type: "blueprint",
    data: input.data,
    position: { x: 0, y: 0 },
  };
}

function createDesignerBlueprintLayoutNodeData(
  input: DesignerBlueprintLayoutNodeData,
): DesignerBlueprintLayoutNodeData {
  return input;
}

function createDesignerBlueprintPendingCommentData(input: {
  item: DesignerBlueprintItem;
  pendingComments: readonly PendingSessionBlueprintComment[];
}): Pick<DesignerBlueprintVisualNodeData, "pendingComment"> | Record<string, never> {
  const pendingComment = input.pendingComments.find((comment) => comment.itemId === input.item.id);
  return pendingComment === undefined ? {} : { pendingComment };
}

function mapDesignerBlueprintGraphNodesForComments(input: {
  graph: DesignerBlueprintGraph;
  onAddComment: (comment: PendingSessionBlueprintCommentInput) => void;
  onClearAddCommentSuppression: (itemId: string) => void;
  onDeleteComment: (commentId: string) => void;
  onSuppressAddComment: (itemId: string) => void;
  onUpdateComment: (commentId: string, body: string) => void;
  pendingComments: readonly PendingSessionBlueprintComment[];
  suppressedAddCommentItemIds: ReadonlySet<string>;
}): DesignerBlueprintVisualNode[] {
  return input.graph.nodes.map((node) => ({
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
      onSuppressAddComment: input.onSuppressAddComment,
      onUpdateComment: input.onUpdateComment,
      ...createDesignerBlueprintPendingCommentData({
        item: node.data.item,
        pendingComments: input.pendingComments,
      }),
    },
  }));
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

function getDesignerBlueprintNodeHeight(data: DesignerBlueprintLayoutNodeData): number {
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

function createDesignerBlueprintIntegrationLogoData(input: {
  item: DesignerBlueprintItem;
  integrationMetadataByTargetKey: ReadonlyMap<string, DesignerBlueprintIntegrationMetadata>;
}): Pick<DesignerBlueprintLayoutNodeData, "integrationLogo"> | Record<string, never> {
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
): Pick<DesignerBlueprintLayoutNodeData, "routingSummary"> | Record<string, never> {
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
