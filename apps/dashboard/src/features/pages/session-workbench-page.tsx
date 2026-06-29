import { useParams, useSearchParams } from "react-router";

import { WorkspaceSidebarTrigger } from "../shared/workspace-sidebar-trigger.js";
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
      leadingControl={<WorkspaceSidebarTrigger />}
      requestedRuntimeConversationId={requestedRuntimeConversationId}
      sandboxInstanceId={sandboxInstanceId}
      searchParams={searchParams}
      secondaryPanel={{ kind: "diff" }}
      setSearchParams={setSearchParams}
    />
  );
}
