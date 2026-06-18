import { SidebarTrigger, useSidebar } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";

import { designerSessionQueryKey, getDesignerSession } from "../designer/designer-service.js";
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

  const designerSession = designerSessionQuery.data;

  return (
    <SessionWorkbenchFullPage
      key={`${designerSession.id}:${designerSession.sandboxInstanceId}`}
      documentTitleFallback="Designer"
      frameTitle="Designer"
      leadingControl={<DesignerSessionSidebarTrigger />}
      requestedRuntimeConversationId={requestedRuntimeConversationId}
      sandboxInstanceId={designerSession.sandboxInstanceId}
      searchParams={searchParams}
      secondaryPanel={{
        kind: "custom",
        diffControlTitle: "Changes are not shown in Designer.",
        layoutKey: "designer-canvas",
        minSize: "20rem",
        renderPanel: () => (
          <div className="h-full min-h-0 min-w-0 overflow-hidden bg-background">
            <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
              <DesignerCanvasWorkspace tabs={designerSession.canvasTabs} />
            </main>
          </div>
        ),
      }}
      setSearchParams={setSearchParams}
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
