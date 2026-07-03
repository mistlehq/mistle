import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintCurrentTabId,
} from "../designer/designer-blueprint-schema.js";
import {
  designerSessionQueryKey,
  getDesignerSession,
  mintDesignerSessionConnectionToken,
  putDesignerSessionCanvasTabs,
  type DesignerSession,
  type DesignerSessionCanvasTab,
} from "../designer/designer-service.js";
import {
  DesignerBlueprintTabUpsertAction,
  DesignerCanvasTabOpenAction,
  type DashboardControlActionHandler,
  type DashboardControlActionSupport,
  type DesignerBlueprintTabShowInput,
  type DesignerCanvasRouteTabShowInput,
} from "../session-agents/dashboard-control-actions.js";
import type { SandboxInstanceStatusResult } from "../sessions/sessions-service.js";
import { ConversationWorkspaceFrame } from "../shared/conversation-workspace-frame.js";
import { PageFrame } from "../shared/page-frame.js";
import { WorkspaceSidebarTrigger } from "../shared/workspace-sidebar-trigger.js";
import {
  mergeDesignerCanvasTabSnapshotIntoLatestTabs,
  removeDesignerCanvasTabFromLatestTabs,
} from "./designer-canvas-tabs.js";
import { DesignerCanvasWorkspace } from "./designer-session-page-view.js";
import { resolveIntegrationConnectionReturnPath } from "./integration-connection-return-path.js";
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
  requestedTab: DesignerCanvasRouteTabShowInput;
}): readonly DesignerSessionCanvasTab[] {
  const hasMatchingRouteTab = input.currentTabs.some(
    (tab) => tab.kind === "route" && tab.id === input.requestedTab.id,
  );
  if (hasMatchingRouteTab) {
    return input.currentTabs.map((tab) =>
      tab.kind !== "route" || tab.id !== input.requestedTab.id
        ? tab
        : {
            kind: "route",
            id: input.requestedTab.id,
            title: input.requestedTab.title,
            href: input.requestedTab.href,
          },
    );
  }

  return [
    ...input.currentTabs,
    {
      kind: "route",
      id: input.requestedTab.id,
      title: input.requestedTab.title,
      href: input.requestedTab.href,
    },
  ];
}

function upsertDesignerBlueprintCanvasTab(input: {
  currentTabs: readonly DesignerSessionCanvasTab[];
  requestedTab: DesignerBlueprintTabShowInput;
}): readonly DesignerSessionCanvasTab[] {
  const blueprintTab: DesignerSessionCanvasTab = {
    kind: "blueprint",
    id: DesignerBlueprintCurrentTabId,
    title: input.requestedTab.title,
    href: DesignerBlueprintCurrentTabHref,
    blueprint: input.requestedTab.blueprint,
  };
  const hasExistingBlueprintTab = input.currentTabs.some(
    (tab) => tab.id === DesignerBlueprintCurrentTabId,
  );

  if (!hasExistingBlueprintTab) {
    return [...input.currentTabs, blueprintTab];
  }

  return input.currentTabs.map((tab) =>
    tab.id === DesignerBlueprintCurrentTabId ? blueprintTab : tab,
  );
}

function mapDesignerSessionToSandboxStatus(
  designerSession: DesignerSession,
): SandboxInstanceStatusResult {
  if (designerSession.status === null) {
    throw new Error(`Designer session '${designerSession.id}' is missing sandbox status.`);
  }

  return {
    id: designerSession.sandboxInstanceId,
    sandboxProfileId: designerSession.sandboxProfileId,
    sandboxProfileVersion: designerSession.sandboxProfileVersion,
    title: designerSession.title,
    status: designerSession.status,
    connectable: designerSession.connectable,
    failureCode: designerSession.failureCode,
    failureMessage: designerSession.failureMessage,
    runtimeContext: designerSession.runtimeContext,
    triggerConversation: null,
    startupOperation: designerSession.startupOperation,
  };
}

export function resolveDesignerCanvasReturnTabRequest(input: {
  openCanvasHref: string | null;
  openCanvasTabId: string | null;
}): DesignerCanvasRouteTabShowInput | null {
  const openCanvasHref = resolveIntegrationConnectionReturnPath(input.openCanvasHref);
  if (
    openCanvasHref === null ||
    input.openCanvasTabId === null ||
    input.openCanvasTabId.length === 0
  ) {
    return null;
  }

  return {
    kind: "route",
    id: input.openCanvasTabId,
    title: "Integrations",
    href: openCanvasHref,
  };
}

function useDesignerCanvasTabs(designerSession: DesignerSession): {
  activeTabHref: string | null;
  canvasTabs: readonly DesignerSessionCanvasTab[];
  dashboardControlActions: DashboardControlActionSupport;
  openCanvasRouteTab: (requestedTab: DesignerCanvasRouteTabShowInput) => void;
  removeCanvasTab: (tabId: string) => void;
  setActiveTabHref: (href: string) => void;
  updateCanvasTabs: (tabs: readonly DesignerSessionCanvasTab[]) => void;
} {
  const [canvasTabs, setCanvasTabs] = useState<readonly DesignerSessionCanvasTab[]>(
    () => designerSession.canvasTabs,
  );
  const latestPersistedCanvasTabsRef = useRef<readonly DesignerSessionCanvasTab[]>(
    designerSession.canvasTabs,
  );
  const canvasTabSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [activeTabHref, setActiveTabHref] = useState<string | null>(null);

  const persistCanvasTabs = useCallback(
    async (tabs: readonly DesignerSessionCanvasTab[]): Promise<void> => {
      await putDesignerSessionCanvasTabs({
        sessionId: designerSession.id,
        tabs,
      });
    },
    [designerSession.id],
  );

  const updateCanvasTabs = useCallback(
    (tabs: readonly DesignerSessionCanvasTab[]): void => {
      const nextSave = canvasTabSaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          const nextTabs = mergeDesignerCanvasTabSnapshotIntoLatestTabs({
            latestTabs: latestPersistedCanvasTabsRef.current,
            snapshotTabs: tabs,
          });
          await persistCanvasTabs(nextTabs);
          latestPersistedCanvasTabsRef.current = nextTabs;
          setCanvasTabs(nextTabs);
        });
      canvasTabSaveQueueRef.current = nextSave;
      void nextSave.catch(() => {});
    },
    [persistCanvasTabs],
  );

  const removeCanvasTab = useCallback(
    (tabId: string): void => {
      const nextSave = canvasTabSaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          const nextTabs = removeDesignerCanvasTabFromLatestTabs({
            latestTabs: latestPersistedCanvasTabsRef.current,
            tabId,
          });
          await persistCanvasTabs(nextTabs);
          latestPersistedCanvasTabsRef.current = nextTabs;
          setCanvasTabs(nextTabs);
        });
      canvasTabSaveQueueRef.current = nextSave;
      void nextSave.catch(() => {});
    },
    [persistCanvasTabs],
  );

  const handleDashboardControlAction = useCallback<DashboardControlActionHandler>(
    async (request) => {
      const nextSave = canvasTabSaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          let nextTabs: readonly DesignerSessionCanvasTab[];
          let activeHref: string;
          if (request.action === DesignerCanvasTabOpenAction) {
            nextTabs = upsertDesignerCanvasTab({
              currentTabs: latestPersistedCanvasTabsRef.current,
              requestedTab: request.input,
            });
            activeHref = request.input.href;
          } else {
            nextTabs = upsertDesignerBlueprintCanvasTab({
              currentTabs: latestPersistedCanvasTabsRef.current,
              requestedTab: request.input,
            });
            activeHref = DesignerBlueprintCurrentTabHref;
          }
          await persistCanvasTabs(nextTabs);
          latestPersistedCanvasTabsRef.current = nextTabs;
          setCanvasTabs(nextTabs);
          setActiveTabHref(activeHref);
        });
      canvasTabSaveQueueRef.current = nextSave;
      await nextSave;
    },
    [persistCanvasTabs],
  );

  const openCanvasRouteTab = useCallback(
    (requestedTab: DesignerCanvasRouteTabShowInput): void => {
      const nextSave = canvasTabSaveQueueRef.current
        .catch(() => {})
        .then(async () => {
          const nextTabs = upsertDesignerCanvasTab({
            currentTabs: latestPersistedCanvasTabsRef.current,
            requestedTab,
          });
          await persistCanvasTabs(nextTabs);
          latestPersistedCanvasTabsRef.current = nextTabs;
          setCanvasTabs(nextTabs);
          setActiveTabHref(requestedTab.href);
        });
      canvasTabSaveQueueRef.current = nextSave;
      void nextSave.catch(() => {});
    },
    [persistCanvasTabs],
  );

  const dashboardControlActions = useMemo<DashboardControlActionSupport>(
    () => ({
      supportedActions: [DesignerCanvasTabOpenAction, DesignerBlueprintTabUpsertAction],
      handleAction: handleDashboardControlAction,
      runtimeMcpServersInstallAction: {
        designerSessionId: designerSession.id,
      },
      userInputSubmitAction: {
        designerSessionId: designerSession.id,
      },
    }),
    [designerSession.id, handleDashboardControlAction],
  );

  return {
    activeTabHref,
    canvasTabs,
    dashboardControlActions,
    openCanvasRouteTab,
    removeCanvasTab,
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
    return <DesignerSessionPendingPage />;
  }

  if (designerSessionQuery.isError) {
    return (
      <ConversationWorkspaceFrame title="Designer" leadingControl={<WorkspaceSidebarTrigger />}>
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
    <LoadedDesignerSessionPageStateBoundary
      key={`${designerSessionQuery.data.id}:${designerSessionQuery.data.sandboxInstanceId}`}
      designerSession={designerSessionQuery.data}
      requestedRuntimeConversationId={requestedRuntimeConversationId}
      searchParams={searchParams}
      setSearchParams={setSearchParams}
    />
  );
}

export function DesignerSessionPendingPage(): React.JSX.Element {
  return (
    <ConversationWorkspaceFrame title="Designer" leadingControl={<WorkspaceSidebarTrigger />}>
      <div className="min-h-0 flex-1" />
    </ConversationWorkspaceFrame>
  );
}

function LoadedDesignerSessionPageStateBoundary(input: {
  designerSession: DesignerSession;
  requestedRuntimeConversationId: string | null;
  searchParams: URLSearchParams;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
}): React.JSX.Element {
  const {
    activeTabHref,
    canvasTabs,
    dashboardControlActions,
    openCanvasRouteTab,
    removeCanvasTab,
    setActiveTabHref,
    updateCanvasTabs,
  } = useDesignerCanvasTabs(input.designerSession);

  return (
    <LoadedDesignerSessionPage
      activeTabHref={activeTabHref}
      canvasTabs={canvasTabs}
      dashboardControlActions={dashboardControlActions}
      designerSession={input.designerSession}
      openCanvasRouteTab={openCanvasRouteTab}
      removeCanvasTab={removeCanvasTab}
      requestedRuntimeConversationId={input.requestedRuntimeConversationId}
      searchParams={input.searchParams}
      setActiveTabHref={setActiveTabHref}
      setSearchParams={input.setSearchParams}
      updateCanvasTabs={updateCanvasTabs}
    />
  );
}

function LoadedDesignerSessionPage(input: {
  activeTabHref: string | null;
  canvasTabs: readonly DesignerSessionCanvasTab[];
  dashboardControlActions: DashboardControlActionSupport;
  designerSession: DesignerSession;
  openCanvasRouteTab: (requestedTab: DesignerCanvasRouteTabShowInput) => void;
  removeCanvasTab: (tabId: string) => void;
  requestedRuntimeConversationId: string | null;
  searchParams: URLSearchParams;
  setActiveTabHref: (href: string) => void;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  updateCanvasTabs: (tabs: readonly DesignerSessionCanvasTab[]) => void;
}): React.JSX.Element {
  const readDesignerSandboxStatus = useCallback(
    async ({ sandboxInstanceId, signal }: { sandboxInstanceId: string; signal?: AbortSignal }) => {
      if (sandboxInstanceId !== input.designerSession.sandboxInstanceId) {
        throw new Error("Designer session sandbox instance changed.");
      }

      const designerSession = await getDesignerSession({
        sessionId: input.designerSession.id,
        ...(signal === undefined ? {} : { signal }),
      });

      return mapDesignerSessionToSandboxStatus(designerSession);
    },
    [input.designerSession.id, input.designerSession.sandboxInstanceId],
  );
  const mintConnectionToken = useCallback(
    async ({ instanceId }: { instanceId: string }) => {
      if (instanceId !== input.designerSession.sandboxInstanceId) {
        throw new Error("Designer session sandbox instance changed.");
      }

      return await mintDesignerSessionConnectionToken({
        sessionId: input.designerSession.id,
      });
    },
    [input.designerSession.id, input.designerSession.sandboxInstanceId],
  );
  const autoStartTurn = useMemo(
    () =>
      input.designerSession.initialPrompt === null
        ? undefined
        : {
            key: `designer:${input.designerSession.id}:initial-prompt`,
            prompt: input.designerSession.initialPrompt,
          },
    [input.designerSession.id, input.designerSession.initialPrompt],
  );
  const openCanvasHrefParam = input.searchParams.get("openCanvasHref");
  const openCanvasTabId = input.searchParams.get("openCanvasTabId");

  // Synchronize one-shot browser history return params from integration setup into canvas tab state.
  // Render logic, event handlers, React Query, and remounting cannot consume then replace URL params
  // after cross-route navigation without repeating the open request or leaving stale history state.
  useEffect(() => {
    const returnTabRequest = resolveDesignerCanvasReturnTabRequest({
      openCanvasHref: openCanvasHrefParam,
      openCanvasTabId,
    });
    if (returnTabRequest === null) {
      return;
    }

    input.openCanvasRouteTab(returnTabRequest);

    input.setSearchParams(
      (currentSearchParams) => {
        const nextSearchParams = new URLSearchParams(currentSearchParams);
        nextSearchParams.delete("openCanvasHref");
        nextSearchParams.delete("openCanvasTabId");
        return nextSearchParams;
      },
      { replace: true },
    );
  }, [input.openCanvasRouteTab, input.setSearchParams, openCanvasHrefParam, openCanvasTabId]);

  return (
    <SessionWorkbenchFullPage
      key={`${input.designerSession.id}:${input.designerSession.sandboxInstanceId}`}
      documentTitleFallback="Designer"
      {...(autoStartTurn === undefined ? {} : { autoStartTurn })}
      frameTitle="Designer"
      headerControls={{
        cli: false,
        diff: false,
        portAccess: false,
        repository: false,
      }}
      leadingControl={<WorkspaceSidebarTrigger />}
      requestedRuntimeConversationId={input.requestedRuntimeConversationId}
      sandboxInstanceId={input.designerSession.sandboxInstanceId}
      mintConnectionToken={mintConnectionToken}
      sandboxStatusReader={readDesignerSandboxStatus}
      searchParams={input.searchParams}
      dashboardControlActions={input.dashboardControlActions}
      secondaryPanel={{
        kind: "custom",
        defaultSize: 60,
        diffControlTitle: "Changes are not shown in Designer.",
        firstOpenTransitionMode: "slow",
        isVisible: input.canvasTabs.length > 0,
        layoutKey: "designer-canvas-60",
        mountMode: "persistent-collapsible",
        minSize: "20rem",
        resizeKey: input.canvasTabs.length === 0 ? null : "designer-canvas-open",
        renderPanel: ({
          onAddBlueprintComment,
          onDeleteBlueprintComment,
          onUpdateBlueprintComment,
          pendingBlueprintComments,
        }) => (
          <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
            <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <DesignerCanvasWorkspace
                activeTabHref={input.activeTabHref}
                designerSessionId={input.designerSession.id}
                mountDockviewWhenEmpty
                onAddBlueprintComment={onAddBlueprintComment}
                onActiveTabHrefChange={input.setActiveTabHref}
                onDeleteBlueprintComment={onDeleteBlueprintComment}
                onTabClose={input.removeCanvasTab}
                onTabsChange={input.updateCanvasTabs}
                onUpdateBlueprintComment={onUpdateBlueprintComment}
                pendingBlueprintComments={pendingBlueprintComments}
                tabs={input.canvasTabs}
              />
            </main>
          </div>
        ),
      }}
      setSearchParams={input.setSearchParams}
    />
  );
}
