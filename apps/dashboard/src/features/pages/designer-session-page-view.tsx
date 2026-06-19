import "dockview/dist/styles/dockview.css";
import "./session-terminal-workspace.css";
import { useQuery } from "@tanstack/react-query";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewWillDropEvent,
  type DockviewWillShowOverlayLocationEvent,
  type IDockviewPanelProps,
} from "dockview";
import { useEffect, useMemo, useState, type FunctionComponent } from "react";

import { useResolvedAppearance } from "../appearance/appearance-provider.js";
import type { DesignerSession } from "../designer/designer-service.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { sandboxProfileDetailQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { getSandboxProfile } from "../sandbox-profiles/sandbox-profiles-service.js";
import { OrganizationIntegrationsSettingsPage } from "./organization-integrations-settings-page.js";
import { EmbeddedSandboxProfileEditorPage } from "./sandbox-profile-editor-page.js";
import { TriggersPage } from "./triggers-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type DesignerCanvasTab = DesignerSession["canvasTabs"][number];

type DesignerCanvasDockviewParams = {
  id: string;
  href: string;
  title: string;
  onNavigate: (input: { id: string; href: string; title: string }) => void;
};

type DesignerCanvasDockviewPanelProps = IDockviewPanelProps<DesignerCanvasDockviewParams>;

type DesignerCanvasEmbeddedRoute =
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

  return <UnsupportedDesignerCanvasRoute />;
}

function readRequiredDesignerCanvasParams(parameters: unknown): DesignerCanvasDockviewParams {
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    throw new Error("Designer canvas panel parameters are required.");
  }

  const id = Reflect.get(parameters, "id");
  const href = Reflect.get(parameters, "href");
  const title = Reflect.get(parameters, "title");
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
            ? {
                ...tab,
                href: navigation.href,
                title: navigation.title,
              }
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

function UnsupportedDesignerCanvasRoute(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-4 text-sm text-muted-foreground">
      This route is not available in the Designer canvas.
    </div>
  );
}
