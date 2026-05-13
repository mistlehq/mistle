import type { ServerRequestEntry } from "../../session-agents/server-requests/index.js";
import type { ChatEntry } from "../chat-types.js";
import {
  buildChatTurnGroups,
  type ChatAssistantBlock,
  type ChatTurnContentSegment,
} from "../chat-view-model.js";
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
  onUserMessageAction?: (actionId: string) => void;
  pendingServerRequests: readonly ServerRequestEntry[];
};

function getAssistantBlockSpacingClass(input: {
  block: ChatEntry;
  previousBlock: ChatEntry | null;
}): string {
  if (input.previousBlock === null) {
    return "";
  }

  if (input.previousBlock.kind === "semantic-group" && input.block.kind === "semantic-group") {
    return "mt-1.5";
  }

  if (input.previousBlock.kind === "assistant-message" && input.block.kind === "semantic-group") {
    return "mt-1";
  }

  return "mt-2";
}

function getAssistantBlockSpacingStyle(input: {
  block: ChatEntry;
  previousBlock: ChatEntry | null;
}): React.CSSProperties | undefined {
  if (input.previousBlock === null) {
    return undefined;
  }

  if (input.previousBlock.kind === "semantic-group" && input.block.kind === "semantic-group") {
    return {
      marginTop: "var(--chat-thread-semantic-stack-gap, 0.5rem)",
    };
  }

  if (input.previousBlock.kind === "assistant-message" && input.block.kind === "semantic-group") {
    return {
      marginTop: "var(--chat-thread-assistant-to-semantic-gap, 1rem)",
    };
  }

  return {
    marginTop: "var(--chat-thread-assistant-block-gap, 1rem)",
  };
}

export function ChatThread({
  entries,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  onUserMessageAction,
  pendingServerRequests,
}: ChatThreadProps): React.JSX.Element {
  const chatTurnGroups = buildChatTurnGroups(entries);

  function renderUserMessage(
    entry: Extract<ChatEntry, { kind: "user-message" }>,
  ): React.JSX.Element {
    const labelAction = entry.labelAction;

    return (
      <ChatUserMessage
        {...(entry.attachments === undefined ? {} : { attachments: entry.attachments })}
        {...(labelAction === undefined
          ? {}
          : {
              labelAction: {
                ariaLabel: labelAction.ariaLabel,
                onClick: () => {
                  onUserMessageAction?.(labelAction.actionId);
                },
              },
            })}
        {...(entry.label === undefined ? {} : { label: entry.label })}
        text={entry.text}
      />
    );
  }

  function renderAssistantBlocks(blocks: readonly ChatAssistantBlock[]): React.JSX.Element {
    return (
      <div
        data-chat-assistant-blocks
        style={{
          maxWidth: "var(--chat-thread-assistant-max-width, 72ch)",
        }}
      >
        {blocks.map((block, index) => {
          const previousBlock = index === 0 ? null : (blocks[index - 1] ?? null);
          const spacingClassName = getAssistantBlockSpacingClass({
            block,
            previousBlock,
          });
          const spacingStyle = getAssistantBlockSpacingStyle({
            block,
            previousBlock,
          });
          let renderedBlock: React.JSX.Element | null = null;
          if (block.kind === "semantic-group") {
            renderedBlock = (
              <ChatSemanticGroup
                block={block}
                isRespondingToServerRequest={isRespondingToServerRequest}
                key={block.id}
                onRespondToServerRequest={onRespondToServerRequest}
                pendingServerRequests={pendingServerRequests}
              />
            );
          } else if (block.kind === "assistant-message") {
            renderedBlock = (
              <div key={block.id}>
                <ChatAssistantMessage
                  isStreaming={block.status === "streaming"}
                  text={block.text}
                />
              </div>
            );
          } else if (block.kind === "reasoning") {
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

            renderedBlock = (
              <div className="space-y-2" key={block.id}>
                <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
                  {block.source === "summary" ? "Thinking" : "Reasoning"}
                </p>
                <p className="text-muted-foreground max-w-[65ch] text-sm leading-6 whitespace-pre-wrap">
                  {block.summary}
                </p>
              </div>
            );
          } else if (block.kind === "plan") {
            renderedBlock = <ChatPlanEntry block={block} key={block.id} />;
          } else if (block.kind === "file-change") {
            const approvalRequest = findFileChangeApprovalRequest(pendingServerRequests, block.id);
            renderedBlock = (
              <ChatFileChangeBlock
                approvalRequest={approvalRequest}
                block={block}
                isRespondingToServerRequest={isRespondingToServerRequest}
                key={block.id}
                onRespondToServerRequest={onRespondToServerRequest}
              />
            );
          } else if (block.kind === "generic-item") {
            renderedBlock = <ChatGenericItem block={block} key={block.id} />;
          } else {
            const approvalRequest = findCommandApprovalRequest(pendingServerRequests, block.id);
            renderedBlock = (
              <ChatCommandBlock
                approvalRequest={approvalRequest}
                block={block}
                isRespondingToServerRequest={isRespondingToServerRequest}
                key={block.id}
                onRespondToServerRequest={onRespondToServerRequest}
              />
            );
          }

          return (
            <div
              className={spacingClassName}
              data-chat-assistant-block
              data-chat-block-kind={block.kind}
              key={block.id}
              style={spacingStyle}
            >
              {renderedBlock}
            </div>
          );
        })}
      </div>
    );
  }

  function renderContentSegment(segment: ChatTurnContentSegment): React.JSX.Element {
    if (segment.kind === "user-message") {
      return <div key={segment.entry.id}>{renderUserMessage(segment.entry)}</div>;
    }

    const segmentKey = segment.blocks.map((block) => block.id).join(":");
    return <div key={segmentKey}>{renderAssistantBlocks(segment.blocks)}</div>;
  }

  return (
    <div
      className="flex flex-col pt-2"
      data-chat-thread
      style={{
        gap: "var(--chat-thread-turn-gap, 1rem)",
        paddingTop: "var(--chat-thread-padding-top, 0.5rem)",
      }}
    >
      {chatTurnGroups.map((group) => (
        <div
          className="flex flex-col"
          data-chat-turn-group
          data-turn-id={group.turnId}
          key={group.turnId}
          style={{
            gap: "var(--chat-thread-turn-content-gap, 1rem)",
          }}
        >
          {group.userEntry === null ? null : renderUserMessage(group.userEntry)}
          {group.contentSegments.map((segment) => renderContentSegment(segment))}
        </div>
      ))}
    </div>
  );
}
