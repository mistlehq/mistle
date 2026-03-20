import type { CodexFileChangeApprovalRequestEntry } from "../../session-agents/codex/approvals/index.js";
import type { ChatFileChangeEntry } from "../chat-types.js";
import { ChatDiffView } from "./chat-diff-view.js";
import { ChatFileChangeApproval } from "./chat-file-change-approval.js";

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
        <ChatFileChangeApproval
          approvalRequest={approvalRequest}
          isRespondingToServerRequest={isRespondingToServerRequest}
          onRespondToServerRequest={onRespondToServerRequest}
        />
      )}
    </div>
  );
}
