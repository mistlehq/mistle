import type { CodexCommandApprovalRequestEntry } from "../../session-agents/codex/approvals/index.js";
import type { ChatCommandEntry } from "../chat-types.js";
import { ChatCommandApproval } from "./chat-command-approval.js";

type ChatCommandBlockProps = {
  approvalRequest: CodexCommandApprovalRequestEntry | null;
  block: ChatCommandEntry;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
};

function shouldRenderCommandAsCodeBlock(command: string | null): boolean {
  if (command === null) {
    return false;
  }

  return command.includes("\n") || command.length > 120;
}

export function ChatCommandBlock({
  approvalRequest,
  block,
  isRespondingToServerRequest,
  onRespondToServerRequest,
}: ChatCommandBlockProps): React.JSX.Element {
  const displayCommand = block.command ?? "Command unavailable";
  const renderCommandAsCodeBlock = shouldRenderCommandAsCodeBlock(displayCommand);

  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">Command</p>
        <p className="text-muted-foreground text-xs">
          {block.status === "streaming" ? "Running" : "Completed"}
        </p>
      </div>
      {renderCommandAsCodeBlock ? (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
          {displayCommand}
        </pre>
      ) : (
        <p className="font-mono text-sm whitespace-pre-wrap break-all">{displayCommand}</p>
      )}
      {block.cwd === null ? null : (
        <p className="text-muted-foreground text-xs">cwd: {block.cwd}</p>
      )}
      {block.reason === null ? null : (
        <p className="text-muted-foreground text-xs">{block.reason}</p>
      )}
      {block.output === null || block.output.trim().length === 0 ? null : (
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
          {block.output}
        </pre>
      )}
      {approvalRequest === null ? null : (
        <ChatCommandApproval
          approvalRequest={approvalRequest}
          command={block.command}
          isRespondingToServerRequest={isRespondingToServerRequest}
          onRespondToServerRequest={onRespondToServerRequest}
        />
      )}
    </div>
  );
}
