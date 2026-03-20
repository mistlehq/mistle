import { ApprovalDecisionButtons } from "../../session-agents/codex/approvals/approval-decision-buttons.js";
import type { CodexFileChangeApprovalRequestEntry } from "../../session-agents/codex/approvals/index.js";

type ChatFileChangeApprovalProps = {
  approvalRequest: CodexFileChangeApprovalRequestEntry;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

export function ChatFileChangeApproval({
  approvalRequest,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: ChatFileChangeApprovalProps): React.JSX.Element {
  return (
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
  );
}
