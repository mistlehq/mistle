import { SidebarTrigger, useSidebar } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import {
  designerSessionQueryKey,
  getDesignerSession,
  putDesignerSessionCanvasTabs,
  type DesignerSession,
  type DesignerSessionCanvasTab,
} from "../designer/designer-service.js";
import {
  DesignerCanvasTabOpenAction,
  type DashboardControlActionHandler,
  type DashboardControlActionSupport,
  type DesignerCanvasTabOpenInput,
} from "../session-agents/dashboard-control-actions.js";
import { ConversationWorkspaceFrame } from "../shared/conversation-workspace-frame.js";
import { PageFrame } from "../shared/page-frame.js";
import { shouldRenderSidebarTrigger } from "../shared/sidebar-trigger-visibility.js";
import { DesignerCanvasWorkspace } from "./designer-session-page-view.js";
import { SessionWorkbenchFullPage } from "./session-workbench-full-page.js";

function useDesignerSessionId(): string {
  const params = useParams();
  const sessionId = params["sessionId"];
  if (sessionId === undefined) {
    throw new Error("Designer session route is missing sessionId.");
  }

  return sessionId;
}

function upsertDesignerCanvasTab(input: {
  currentTabs: readonly DesignerSessionCanvasTab[];
  requestedTab: DesignerCanvasTabOpenInput;
}): readonly DesignerSessionCanvasTab[] {
  const matchingHrefTab = input.currentTabs.find((tab) => tab.href === input.requestedTab.href);
  if (matchingHrefTab !== undefined) {
    return input.currentTabs.map((tab) =>
      tab.href !== input.requestedTab.href
        ? tab
        : {
            ...tab,
            title: input.requestedTab.title,
          },
    );
  }

  const matchingIdTab = input.currentTabs.find((tab) => tab.id === input.requestedTab.id);
  if (matchingIdTab !== undefined) {
    return input.currentTabs.map((tab) =>
      tab.id !== input.requestedTab.id
        ? tab
        : {
            id: tab.id,
            title: input.requestedTab.title,
            href: input.requestedTab.href,
          },
    );
  }

  return [
    ...input.currentTabs,
    {
      id: input.requestedTab.id,
      title: input.requestedTab.title,
      href: input.requestedTab.href,
    },
  ];
}

function useDesignerCanvasTabs(designerSession: DesignerSession): {
  activeTabHref: string | null;
  canvasTabs: readonly DesignerSessionCanvasTab[];
  dashboardControlActions: DashboardControlActionSupport;
  setActiveTabHref: (href: string) => void;
  updateCanvasTabs: (tabs: readonly DesignerSessionCanvasTab[]) => void;
} {
  const [canvasTabs, setCanvasTabs] = useState<readonly DesignerSessionCanvasTab[]>(
    () => designerSession.canvasTabs,
  );
  const [activeTabHref, setActiveTabHref] = useState<string | null>(null);
  const [isLocallyDirty, setIsLocallyDirty] = useState(false);

  useEffect(() => {
    if (isLocallyDirty) {
      return;
    }

    setCanvasTabs(designerSession.canvasTabs);
  }, [designerSession.canvasTabs, isLocallyDirty]);

  const persistCanvasTabs = useCallback(
    (tabs: readonly DesignerSessionCanvasTab[]): void => {
      void putDesignerSessionCanvasTabs({
        sessionId: designerSession.id,
        tabs,
      });
    },
    [designerSession.id],
  );

  const updateCanvasTabs = useCallback(
    (tabs: readonly DesignerSessionCanvasTab[]): void => {
      setCanvasTabs(tabs);
      setIsLocallyDirty(true);
      persistCanvasTabs(tabs);
    },
    [persistCanvasTabs],
  );

  const handleDashboardControlAction = useCallback<DashboardControlActionHandler>(
    (request) => {
      setCanvasTabs((currentTabs) => {
        const nextTabs = upsertDesignerCanvasTab({
          currentTabs,
          requestedTab: request.input,
        });
        persistCanvasTabs(nextTabs);
        return nextTabs;
      });
      setActiveTabHref(request.input.href);
      setIsLocallyDirty(true);

      return {
        accepted: true,
      };
    },
    [persistCanvasTabs],
  );

  const dashboardControlActions = useMemo<DashboardControlActionSupport>(
    () => ({
      supportedActions: [DesignerCanvasTabOpenAction],
      handleAction: handleDashboardControlAction,
    }),
    [handleDashboardControlAction],
  );

  return {
    activeTabHref,
    canvasTabs,
    dashboardControlActions,
    setActiveTabHref,
    updateCanvasTabs,
  };
}

export function DesignerSessionPage(): React.JSX.Element {
  const sessionId = useDesignerSessionId();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedRuntimeConversationId = searchParams.get("conversationId");
  const designerSessionQuery = useQuery({
    queryKey: designerSessionQueryKey(sessionId),
    queryFn: async ({ signal }) =>
      getDesignerSession({
        sessionId,
        signal,
      }),
  });

  if (designerSessionQuery.isPending) {
    return (
      <ConversationWorkspaceFrame
        title="Designer"
        leadingControl={<DesignerSessionSidebarTrigger />}
      >
        <PageFrame width="normal">
          <div className="py-10 text-sm text-muted-foreground">Loading Designer session...</div>
        </PageFrame>
      </ConversationWorkspaceFrame>
    );
  }

  if (designerSessionQuery.isError) {
    return (
      <ConversationWorkspaceFrame
        title="Designer"
        leadingControl={<DesignerSessionSidebarTrigger />}
      >
        <PageFrame width="normal">
          <div className="grid gap-2 py-10">
            <h1 className="text-base font-medium">Could not load Designer session</h1>
            <p className="text-sm text-muted-foreground">
              {designerSessionQuery.error instanceof Error
                ? designerSessionQuery.error.message
                : "Could not load Designer session."}
            </p>
          </div>
        </PageFrame>
      </ConversationWorkspaceFrame>
    );
  }

  return (
    <LoadedDesignerSessionPage
      designerSession={designerSessionQuery.data}
      requestedRuntimeConversationId={requestedRuntimeConversationId}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
    />
  );
}

function LoadedDesignerSessionPage(input: {
  designerSession: DesignerSession;
  requestedRuntimeConversationId: string | null;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}): React.JSX.Element {
  const { activeTabHref, canvasTabs, dashboardControlActions, setActiveTabHref, updateCanvasTabs } =
    useDesignerCanvasTabs(input.designerSession);

  return (
    <SessionWorkbenchFullPage
      key={`${input.designerSession.id}:${input.designerSession.sandboxInstanceId}`}
      documentTitleFallback="Designer"
      frameTitle="Designer"
      headerControls={{
        cli: false,
        diff: false,
        portAccess: false,
        repository: false,
      }}
      leadingControl={<DesignerSessionSidebarTrigger />}
      requestedRuntimeConversationId={input.requestedRuntimeConversationId}
      sandboxInstanceId={input.designerSession.sandboxInstanceId}
      searchParams={input.searchParams}
      dashboardControlActions={dashboardControlActions}
      secondaryPanel={{
        kind: "custom",
        diffControlTitle: "Changes are not shown in Designer.",
        layoutKey: "designer-canvas",
        minSize: "20rem",
        renderPanel: () => (
          <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
            <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <DesignerCanvasWorkspace
                activeTabHref={activeTabHref}
                onActiveTabHrefChange={setActiveTabHref}
                onTabsChange={updateCanvasTabs}
                tabs={canvasTabs}
              />
            </main>
          </div>
        ),
      }}
      setSearchParams={input.setSearchParams}
    />
  );
}

function DesignerSessionSidebarTrigger(): React.JSX.Element | null {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger = shouldRenderSidebarTrigger({
    isMobile,
    openMobile,
    sidebarState: state,
  });

  return shouldShowSidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null;
}
