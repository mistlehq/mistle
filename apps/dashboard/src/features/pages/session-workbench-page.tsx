import { SidebarTrigger, useSidebar } from "@mistle/ui";
import { useParams, useSearchParams } from "react-router";

import { shouldRenderSidebarTrigger } from "../shared/sidebar-trigger-visibility.js";
import { SessionWorkbenchFullPage } from "./session-workbench-full-page.js";

export function shouldResetConversationScopedComposerStateForActiveConversationChange(input: {
  lastActiveConversationId: string | null;
  nextActiveConversationId: string | null;
}): boolean {
  if (input.nextActiveConversationId === null) {
    return false;
  }

  if (input.lastActiveConversationId === null) {
    return false;
  }

  return input.lastActiveConversationId !== input.nextActiveConversationId;
}

export function SessionWorkbenchPage(): React.JSX.Element {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const sandboxInstanceId = params["sandboxInstanceId"] ?? null;
  const requestedRuntimeConversationId = searchParams.get("conversationId");

  return (
    <SessionWorkbenchFullPage
      key={sandboxInstanceId ?? "missing-session"}
      documentTitleFallback="Session"
      frameTitle="Session"
      leadingControl={<SessionWorkspaceSidebarTrigger />}
      requestedRuntimeConversationId={requestedRuntimeConversationId}
      sandboxInstanceId={sandboxInstanceId}
      searchParams={searchParams}
      secondaryPanel={{ kind: "diff" }}
      setSearchParams={setSearchParams}
    />
  );
}

function SessionWorkspaceSidebarTrigger(): React.JSX.Element | null {
  const { isMobile, openMobile, state } = useSidebar();
  const shouldShowSidebarTrigger = shouldRenderSidebarTrigger({
    isMobile,
    openMobile,
    sidebarState: state,
  });

  return shouldShowSidebarTrigger ? <SidebarTrigger className="-ml-1" /> : null;
}
