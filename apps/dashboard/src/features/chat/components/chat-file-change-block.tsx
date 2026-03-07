import { ApprovalDecisionButtons } from "../../codex-client/approval-decision-buttons.js";
import type { CodexFileChangeApprovalRequestEntry } from "../../codex-client/codex-server-requests-state.js";
import type { ChatFileChangeEntry } from "../chat-types.js";
import { ChatDiffView } from "./chat-diff-view.js";

type ChatFileChangeBlockProps = {
  approvalRequest: CodexFileChangeApprovalRequestEntry | null;
  block: ChatFileChangeEntry;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

export function ChatFileChangeBlock({
  approvalRequest,
  block,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: ChatFileChangeBlockProps): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">File changes</p>
        <p className="text-muted-foreground text-xs">
          {block.status === "streaming" ? "Updating" : "Completed"}
        </p>
      </div>
      {block.changes.length === 0 ? null : (
        <div className="space-y-2">
          {block.changes.map((change) => (
            <div className="rounded-md border px-3 py-2" key={change.path}>
              <p className="font-mono text-sm break-all">{change.path}</p>
              {change.kind === null ? null : (
                <p className="text-muted-foreground text-xs">{change.kind}</p>
              )}
              {change.diff === null || change.diff.trim().length === 0 ? null : (
                <ChatDiffView diff={change.diff} path={change.path} />
              )}
            </div>
          ))}
        </div>
      )}
      {block.output === null || block.output.trim().length === 0 ? null : (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
          {block.output}
        </pre>
      )}
      {approvalRequest === null ? null : (
        <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-sm">Approve file changes</p>
            <p className="text-muted-foreground text-xs">{approvalRequest.method}</p>
          </div>
          {approvalRequest.reason === null ? null : (
            <p className="text-sm leading-6 whitespace-pre-wrap">{approvalRequest.reason}</p>
          )}
          {approvalRequest.grantRoot === null ? null : (
            <p className="text-muted-foreground text-xs">grant root: {approvalRequest.grantRoot}</p>
          )}
          <ApprovalDecisionButtons
            appearance="compact"
            availableDecisions={approvalRequest.availableDecisions}
            disabled={isRespondingToServerRequest}
            onRespondToServerRequest={onRespondToServerRequest}
            requestId={approvalRequest.requestId}
          />
          {approvalRequest.responseErrorMessage === null ? null : (
            <p className="text-destructive text-sm">{approvalRequest.responseErrorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
