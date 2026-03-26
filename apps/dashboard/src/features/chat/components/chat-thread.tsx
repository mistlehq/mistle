import type { CodexApprovalRequestEntry } from "../../session-agents/codex/approvals/index.js";
import type { ChatEntry } from "../chat-types.js";
import { buildChatTurnGroups } from "../chat-view-model.js";
import {
  findCommandApprovalRequest,
  findFileChangeApprovalRequest,
} from "./chat-approval-requests.js";
import { ChatAssistantMessage } from "./chat-assistant-message.js";
import { ChatCommandBlock } from "./chat-command-block.js";
import { ChatFileChangeBlock } from "./chat-file-change-block.js";
import { ChatGenericItem } from "./chat-generic-item.js";
import { ChatPlanEntry } from "./chat-plan-entry.js";
import { ChatSemanticGroup } from "./chat-semantic-group.js";
import { ChatUserMessage } from "./chat-user-message.js";

type ChatThreadProps = {
  entries: readonly ChatEntry[];
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  pendingServerRequests: readonly CodexApprovalRequestEntry[];
};
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
          {group.userEntry === null ? null : (
            <ChatUserMessage
              {...(group.userEntry.attachments === undefined
                ? {}
                : { attachments: group.userEntry.attachments })}
              text={group.userEntry.text}
            />
          )}
          {group.assistantBlocks.length === 0 ? null : (
            <div className="max-w-[72ch] space-y-4">
              {group.assistantBlocks.map((block) => {
                if (block.kind === "semantic-group") {
                  return (
                    <ChatSemanticGroup
                      block={block}
                      isRespondingToServerRequest={isRespondingToServerRequest}
                      key={block.id}
                      onRespondToServerRequest={onRespondToServerRequest}
                      pendingServerRequests={pendingServerRequests}
                    />
                  );
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
                  return <ChatGenericItem block={block} key={block.id} />;
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
