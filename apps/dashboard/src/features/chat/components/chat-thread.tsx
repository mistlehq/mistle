import type {
  CodexCommandApprovalRequestEntry,
  CodexFileChangeApprovalRequestEntry,
  CodexServerRequestEntry,
} from "../../codex-client/codex-server-requests-state.js";
import type { ChatEntry } from "../chat-types.js";
import { buildChatTurnGroups } from "../chat-view-model.js";
import { ChatAssistantMessage } from "./chat-assistant-message.js";
import { ChatCommandBlock } from "./chat-command-block.js";
import { ChatFileChangeBlock } from "./chat-file-change-block.js";
import { ChatPlanEntry } from "./chat-plan-entry.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";
import { ChatUserMessage } from "./chat-user-message.js";

type ChatThreadProps = {
  entries: readonly ChatEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  pendingServerRequests: readonly CodexServerRequestEntry[];
};

function findCommandApprovalRequest(
  requests: readonly CodexServerRequestEntry[],
  itemId: string,
): CodexCommandApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CodexCommandApprovalRequestEntry =>
      entry.kind === "command-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}

function findFileChangeApprovalRequest(
  requests: readonly CodexServerRequestEntry[],
  itemId: string,
): CodexFileChangeApprovalRequestEntry | null {
  const request = requests.find(
    (entry): entry is CodexFileChangeApprovalRequestEntry =>
      entry.kind === "file-change-approval" && entry.itemId === itemId,
  );

  return request ?? null;
}
export function ChatThread({
  entries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  pendingServerRequests,
}: ChatThreadProps): React.JSX.Element {
  const chatTurnGroups = buildChatTurnGroups(entries);

  return (
    <div className="flex flex-col gap-10 pt-2">
      {chatTurnGroups.map((group) => (
        <div className="flex flex-col gap-4" key={group.turnId}>
          {group.userEntry === null ? null : <ChatUserMessage text={group.userEntry.text} />}
          {group.assistantBlocks.length === 0 ? null : (
            <div className="max-w-[72ch] space-y-4">
              {group.assistantBlocks.map((block) => {
                if (block.kind === "semantic-group") {
                  return <ChatSemanticGroup block={block} key={block.id} />;
                }

                if (block.kind === "assistant-message") {
                  return (
                    <div key={block.id}>
                      <ChatAssistantMessage
                        isStreaming={block.status === "streaming"}
                        text={block.text}
                      />
                    </div>
                  );
                }

                if (block.kind === "reasoning") {
                  const normalizedSummary = block.summary.trim();
                  const isSuppressedRawReasoning =
                    block.source === "content" &&
                    (normalizedSummary.length === 0 ||
                      normalizedSummary === "[]" ||
                      normalizedSummary === "{}" ||
                      normalizedSummary === "null");
                  if (isSuppressedRawReasoning) {
                    return null;
                  }

                  return (
                    <div className="space-y-2" key={block.id}>
                      <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                        {block.source === "summary" ? "Thinking" : "Reasoning"}
                      </p>
                      <p className="text-muted-foreground max-w-[65ch] text-sm leading-6 whitespace-pre-wrap">
                        {block.summary}
                      </p>
                    </div>
                  );
                }

                if (block.kind === "plan") {
                  return <ChatPlanEntry block={block} key={block.id} />;
                }

                if (block.kind === "file-change") {
                  const approvalRequest = findFileChangeApprovalRequest(
                    pendingServerRequests,
                    block.id,
                  );
                  return (
                    <ChatFileChangeBlock
                      approvalRequest={approvalRequest}
                      block={block}
                      isRespondingToServerRequest={isRespondingToServerRequest}
                      key={block.id}
                      onRespondToServerRequest={onRespondToServerRequest}
                    />
                  );
                }

                if (block.kind === "generic-item") {
                  return (
                    <div className="space-y-3 rounded-xl border p-3" key={block.id}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-sm">{block.title}</p>
                        <p className="text-muted-foreground text-xs">
                          {block.status === "streaming" ? "Running" : "Completed"}
                        </p>
                      </div>
                      {block.body === null ? null : (
                        <p className="text-sm leading-6 whitespace-pre-wrap">{block.body}</p>
                      )}
                      {block.detailsJson === null ? null : (
                        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
                          {block.detailsJson}
                        </pre>
                      )}
                    </div>
                  );
                }

                const approvalRequest = findCommandApprovalRequest(pendingServerRequests, block.id);
                return (
                  <ChatCommandBlock
                    approvalRequest={approvalRequest}
                    block={block}
                    isRespondingToServerRequest={isRespondingToServerRequest}
                    key={block.id}
                    onRespondToServerRequest={onRespondToServerRequest}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
