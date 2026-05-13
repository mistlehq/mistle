import { AnimatedStatusText } from "@mistle/ui";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import type { ServerRequestEntry } from "../../session-agents/server-requests/index.js";
import type {
  ChatSemanticGroupDetailKind,
  ChatSemanticGroupEntry,
  ChatSemanticGroupKind,
} from "../chat-types.js";
import {
  findCommandApprovalRequest,
  findFileChangeApprovalRequest,
} from "./chat-approval-requests.js";
import { ChatCommandApproval } from "./chat-command-approval.js";
import { ChatFileChangeApproval } from "./chat-file-change-approval.js";
import { ChatSemanticGroupItemOutput } from "./chat-semantic-group-item-output.js";

type ChatSemanticGroupProps = {
  block: ChatSemanticGroupEntry;
  isRespondingToServerRequest: boolean;
  onRespondToServerRequest: (requestId: string | number, result: unknown) => void;
  pendingServerRequests: readonly ServerRequestEntry[];
};

const SemanticGroupDisplayKeyLabels = {
  "exploring.active": "Exploring",
  "exploring.done": "Explored",
  "running-commands.active": "Running commands",
  "running-commands.done": "Ran commands",
  "making-edits.active": "Making edits",
  "making-edits.done": "Updated files",
  "thinking.active": "Thinking",
  "thinking.done": "Thoughts",
  "searching-web.active": "Searching the web",
  "searching-web.done": "Searched the web",
  "tool-call.active": "Using tools",
  "tool-call.done": "Used tools",
  "generic.active": "Activity",
  "generic.done": "Activity",
} as const;

function isSemanticGroupDisplayKey(
  value: string,
): value is keyof typeof SemanticGroupDisplayKeyLabels {
  return value in SemanticGroupDisplayKeyLabels;
}

function getSemanticGroupTitle(input: { block: ChatSemanticGroupEntry }): string {
  const singleItem = input.block.items[0];
  if (
    input.block.semanticKind === "generic" &&
    input.block.items.length === 1 &&
    singleItem !== undefined
  ) {
    return singleItem.label;
  }

  const key =
    input.block.status === "streaming"
      ? input.block.displayKeys.active
      : input.block.displayKeys.completed;
  if (key === null) {
    throw new Error("Missing semantic group display key.");
  }

  if (!isSemanticGroupDisplayKey(key)) {
    throw new Error(`Unsupported semantic group display key '${key}'.`);
  }

  return SemanticGroupDisplayKeyLabels[key];
}

function getSemanticGroupSummary(input: {
  semanticKind: ChatSemanticGroupKind;
  counts: { reads: number; searches: number; lists: number } | null;
  itemCount: number;
}): string | null {
  if (input.semanticKind === "generic" && input.itemCount === 1) {
    return null;
  }

  if (input.semanticKind === "exploring" && input.counts !== null) {
    const summary = [
      input.counts.reads > 0
        ? `${String(input.counts.reads)} read${input.counts.reads === 1 ? "" : "s"}`
        : null,
      input.counts.searches > 0
        ? `${String(input.counts.searches)} search${input.counts.searches === 1 ? "" : "es"}`
        : null,
      input.counts.lists > 0
        ? `${String(input.counts.lists)} list${input.counts.lists === 1 ? "" : "s"}`
        : null,
    ]
      .filter((value) => value !== null)
      .join(", ");
    return summary.length === 0 ? null : summary;
  }

  return `${String(input.itemCount)} item${input.itemCount === 1 ? "" : "s"}`;
}

function getSemanticGroupDetailClassName(input: {
  detailKind: ChatSemanticGroupDetailKind;
}): string {
  if (input.detailKind === "code") {
    return "text-muted-foreground font-mono text-xs";
  }

  return "text-muted-foreground text-xs";
}

function shouldAutoOpenSemanticGroup(input: {
  block: ChatSemanticGroupEntry;
  pendingServerRequests: readonly ServerRequestEntry[];
}): boolean {
  if (input.block.status === "streaming") {
    return true;
  }

  return input.block.items.some((item) => {
    if (item.status === "streaming") {
      return true;
    }

    return (
      (item.sourceKind === "command-execution" &&
        findCommandApprovalRequest(input.pendingServerRequests, item.id) !== null) ||
      (item.sourceKind === "file-change" &&
        findFileChangeApprovalRequest(input.pendingServerRequests, item.id) !== null)
    );
  });
}

export function ChatSemanticGroup({
  block,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  pendingServerRequests,
}: ChatSemanticGroupProps): React.JSX.Element {
  const autoOpen = shouldAutoOpenSemanticGroup({
    block,
    pendingServerRequests,
  });
  const [isOpen, setIsOpen] = useState(autoOpen);

  useEffect(() => {
    setIsOpen(autoOpen);
  }, [autoOpen]);

  const groupSummary = getSemanticGroupSummary({
    semanticKind: block.semanticKind,
    counts: block.counts,
    itemCount: block.items.length,
  });

  return (
    <details
      className="group/semantic flex flex-col open:pb-2"
      data-chat-semantic-group
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
      }}
      open={isOpen}
      style={{
        gap: "var(--chat-semantic-group-gap, 0.25rem)",
      }}
    >
      <summary
        className="flex cursor-default list-none items-center justify-between"
        data-chat-semantic-group-summary
        style={{
          gap: "var(--chat-semantic-group-header-gap, 0.75rem)",
        }}
      >
        <div
          className="flex min-w-0 items-center"
          data-chat-semantic-group-summary-cluster
          style={{
            gap: "var(--chat-semantic-group-summary-gap, 0.5rem)",
          }}
        >
          <div
            className="flex items-center"
            data-chat-semantic-group-title-cluster
            style={{
              gap: "var(--chat-semantic-group-title-gap, 0.375rem)",
            }}
          >
            <AnimatedStatusText
              active={block.status === "streaming"}
              className="font-medium text-sm"
            >
              {getSemanticGroupTitle({ block })}
            </AnimatedStatusText>
            <span className="text-muted-foreground flex size-4 items-center justify-center">
              <span className="sr-only">Toggle group</span>
              <CaretRightIcon
                aria-hidden
                className="size-4 shrink-0 opacity-25 transition-[transform,opacity] duration-150 ease-out group-hover/semantic:opacity-100 group-open/semantic:rotate-90"
              />
            </span>
          </div>
          {groupSummary === null ? null : (
            <p className="text-muted-foreground text-xs" data-chat-semantic-group-summary-text>
              {groupSummary}
            </p>
          )}
        </div>
      </summary>
      <div
        className="border-border/70 flex flex-col border-l"
        data-chat-semantic-group-items
        style={{
          gap: "var(--chat-semantic-group-item-gap, 0px)",
          marginTop: "var(--chat-semantic-group-content-gap, 0.75rem)",
          paddingLeft: "var(--chat-semantic-group-indent, 1rem)",
        }}
      >
        {block.items.map((item) => {
          const commandApprovalRequest =
            item.sourceKind === "command-execution"
              ? findCommandApprovalRequest(pendingServerRequests, item.id)
              : null;
          const fileChangeApprovalRequest =
            item.sourceKind === "file-change"
              ? findFileChangeApprovalRequest(pendingServerRequests, item.id)
              : null;
          const hasExpandableOutput =
            (item.output !== null && item.output.length > 0) ||
            (block.semanticKind === "generic" && item.detail !== null && item.detail.length > 0);

          return (
            <details
              className={["group/item flex flex-col", hasExpandableOutput ? "open:pb-2" : ""].join(
                " ",
              )}
              data-chat-semantic-group-item
              data-chat-semantic-group-item-has-output={hasExpandableOutput ? "true" : "false"}
              key={item.id}
              open={
                item.status === "streaming" ||
                commandApprovalRequest !== null ||
                fileChangeApprovalRequest !== null
              }
              style={{
                gap: "var(--chat-semantic-group-item-detail-gap, 0.25rem)",
              }}
            >
              <summary
                className="flex cursor-default list-none items-start justify-between gap-3"
                data-chat-semantic-group-item-summary
              >
                <div
                  className="min-w-0 flex items-baseline text-sm"
                  data-chat-semantic-group-item-row
                  style={{
                    gap: "var(--chat-semantic-group-row-gap, 0.5rem)",
                    lineHeight: "var(--chat-semantic-group-row-leading, 1.5rem)",
                  }}
                >
                  <span
                    className="inline-flex shrink-0 items-center"
                    style={{
                      gap: "var(--chat-semantic-group-title-gap, 0.375rem)",
                    }}
                  >
                    <span className="font-medium">{item.label}</span>
                    {hasExpandableOutput ? (
                      <span className="text-muted-foreground flex size-3.5 items-center justify-center">
                        <span className="sr-only">Toggle results</span>
                        <CaretRightIcon
                          aria-hidden
                          className="size-3.5 shrink-0 opacity-25 transition-[transform,opacity] duration-150 ease-out group-hover/item:opacity-100 group-open/item:rotate-90"
                        />
                      </span>
                    ) : null}
                  </span>
                  {item.detail === null ? null : (
                    <span
                      className={[
                        "min-w-0 truncate",
                        getSemanticGroupDetailClassName({
                          detailKind: item.detailKind,
                        }),
                      ].join(" ")}
                      data-chat-semantic-group-item-detail
                      style={{
                        lineHeight: "var(--chat-semantic-group-detail-leading, 1.25rem)",
                      }}
                    >
                      {item.detail}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground flex items-center gap-1.5 self-start pt-0.5">
                  <p
                    className="text-xs"
                    data-chat-semantic-group-item-status
                    style={{
                      lineHeight: "var(--chat-semantic-group-detail-leading, 1.25rem)",
                    }}
                  >
                    {item.status === "streaming" ? "Running" : "Done"}
                  </p>
                </div>
              </summary>
              <ChatSemanticGroupItemOutput item={item} semanticKind={block.semanticKind} />
              {commandApprovalRequest === null ? null : (
                <div className="mt-2">
                  <ChatCommandApproval
                    approvalRequest={commandApprovalRequest}
                    command={item.command}
                    isRespondingToServerRequest={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                  />
                </div>
              )}
              {fileChangeApprovalRequest === null ? null : (
                <div className="mt-2">
                  <ChatFileChangeApproval
                    approvalRequest={fileChangeApprovalRequest}
                    isRespondingToServerRequest={isRespondingToServerRequest}
                    onRespondToServerRequest={onRespondToServerRequest}
                  />
                </div>
              )}
            </details>
          );
        })}
      </div>
    </details>
  );
}
