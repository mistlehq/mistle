import { ApprovalDecisionButtons } from "../../codex-client/approval-decision-buttons.js";
import type { CodexCommandApprovalRequestEntry } from "../../codex-client/codex-server-requests-state.js";

type ChatCommandApprovalProps = {
  approvalRequest: CodexCommandApprovalRequestEntry;
  command: string | null;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

export function ChatCommandApproval({
  approvalRequest,
  command,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: ChatCommandApprovalProps): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">Approve command</p>
        <p className="text-muted-foreground text-xs">{approvalRequest.method}</p>
      </div>
      {approvalRequest.reason === null ? null : (
        <p className="text-sm leading-6 whitespace-pre-wrap">{approvalRequest.reason}</p>
      )}
      <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
        {approvalRequest.command ?? command ?? "Command unavailable"}
      </pre>
      {approvalRequest.networkHost === null ? null : (
        <p className="text-muted-foreground text-xs">
          network: {approvalRequest.networkProtocol ?? "unknown"}://{approvalRequest.networkHost}
          {approvalRequest.networkPort === null ? null : `:${approvalRequest.networkPort}`}
        </p>
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
