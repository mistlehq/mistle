import { CaretRightIcon } from "@phosphor-icons/react";

import type { CodexApprovalRequestEntry } from "../../session-agents/codex/approvals/index.js";
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
  pendingServerRequests: readonly CodexApprovalRequestEntry[];
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
} as const;

function isSemanticGroupDisplayKey(
  value: string,
): value is keyof typeof SemanticGroupDisplayKeyLabels {
  return value in SemanticGroupDisplayKeyLabels;
}

function getSemanticGroupTitle(input: {
  displayKeys: {
    active: string | null;
    completed: string | null;
  };
  status: "streaming" | "completed";
}): string {
  const key = input.status === "streaming" ? input.displayKeys.active : input.displayKeys.completed;
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
    return "text-muted-foreground font-mono text-xs leading-5";
  }

  return "text-muted-foreground text-xs leading-5";
}

export function ChatSemanticGroup({
  block,
  isRespondingToServerRequest,
  onRespondToServerRequest,
  pendingServerRequests,
}: ChatSemanticGroupProps): React.JSX.Element {
  const groupSummary = getSemanticGroupSummary({
    semanticKind: block.semanticKind,
    counts: block.counts,
    itemCount: block.items.length,
  });

  return (
    <details className="group/semantic space-y-3" open>
      <summary className="flex cursor-default list-none items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm">
              {getSemanticGroupTitle({
                displayKeys: block.displayKeys,
                status: block.status,
              })}
            </p>
            <span className="text-muted-foreground flex size-4 items-center justify-center">
              <span className="sr-only">Toggle group</span>
              <CaretRightIcon
                aria-hidden
                className="size-4 shrink-0 opacity-25 transition-[transform,opacity] duration-150 ease-out group-hover/semantic:opacity-100 group-open/semantic:rotate-90"
              />
            </span>
          </div>
          {groupSummary === null ? null : (
            <p className="text-muted-foreground text-xs">{groupSummary}</p>
          )}
        </div>
      </summary>
      <div className="border-border/70 mt-3 space-y-1.5 border-l pl-4">
        {block.items.map((item) => {
          const commandApprovalRequest =
            item.sourceKind === "command-execution"
              ? findCommandApprovalRequest(pendingServerRequests, item.id)
              : null;
          const fileChangeApprovalRequest =
            item.sourceKind === "file-change"
              ? findFileChangeApprovalRequest(pendingServerRequests, item.id)
              : null;
          const hasExpandableOutput = item.output !== null && item.output.length > 0;

          return (
            <details
              className="group/item space-y-1"
              key={item.id}
              open={
                item.status === "streaming" ||
                commandApprovalRequest !== null ||
                fileChangeApprovalRequest !== null
              }
            >
              <summary className="flex cursor-default list-none items-start justify-between gap-3">
                <div className="min-w-0 flex items-baseline gap-2.5 text-sm leading-6">
                  <span className="inline-flex shrink-0 items-center gap-1.5">
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
                    >
                      {item.detail}
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground flex items-center gap-1.5 self-start pt-0.5">
                  <p className="text-xs leading-5">
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
