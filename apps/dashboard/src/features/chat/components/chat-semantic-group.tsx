import { CaretRightIcon } from "@phosphor-icons/react";

import type {
  ChatSemanticGroupDetailKind,
  ChatSemanticGroupEntry,
  ChatSemanticGroupKind,
} from "../chat-types.js";
import { ChatDiffView } from "./chat-diff-view.js";
import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type ChatSemanticGroupProps = {
  block: ChatSemanticGroupEntry;
};

function getSemanticGroupTitle(input: {
  semanticKind: ChatSemanticGroupKind;
  status: "streaming" | "completed";
}): string {
  switch (input.semanticKind) {
    case "exploring":
      return input.status === "streaming" ? "Exploring" : "Explored";
    case "running-commands":
      return input.status === "streaming" ? "Running commands" : "Ran commands";
    case "making-edits":
      return input.status === "streaming" ? "Making edits" : "Updated files";
    case "thinking":
      return input.status === "streaming" ? "Thinking" : "Thoughts";
    case "searching-web":
      return input.status === "streaming" ? "Searching the web" : "Searched the web";
    case "tool-call":
      return input.status === "streaming" ? "Using tools" : "Used tools";
  }
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

function getPathExtension(path: string): string | null {
  const lastDotIndex = path.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === path.length - 1) {
    return null;
  }

  return path.slice(lastDotIndex + 1).toLowerCase();
}

function isMarkdownPath(path: string): boolean {
  const extension = getPathExtension(path);
  return extension === "md" || extension === "mdx";
}

function getCodeFenceLanguage(path: string): string | null {
  const extension = getPathExtension(path);
  if (extension === null) {
    return null;
  }

  switch (extension) {
    case "cjs":
    case "js":
    case "mjs":
      return "js";
    case "cts":
    case "mts":
    case "ts":
      return "ts";
    case "jsx":
      return "jsx";
    case "tsx":
      return "tsx";
    case "css":
    case "diff":
    case "go":
    case "html":
    case "java":
    case "json":
    case "py":
    case "rb":
    case "rs":
    case "sh":
    case "sql":
    case "xml":
    case "yaml":
    case "yml":
      return extension;
    default:
      return null;
  }
}

function getReadRenderMarkdown(input: { path: string; output: string }): string | null {
  if (isMarkdownPath(input.path)) {
    return input.output;
  }

  const codeFenceLanguage = getCodeFenceLanguage(input.path);
  if (codeFenceLanguage === null) {
    return null;
  }

  return ["```" + codeFenceLanguage, input.output, "```"].join("\n");
}

function renderSemanticGroupItemOutput(input: {
  item: ChatSemanticGroupEntry["items"][number];
  semanticKind: ChatSemanticGroupKind;
}): React.JSX.Element | null {
  if (input.item.output === null || input.item.output.length === 0) {
    return null;
  }

  const readRenderMarkdown =
    input.semanticKind === "exploring" && input.item.label === "Read" && input.item.detail !== null
      ? getReadRenderMarkdown({
          path: input.item.detail,
          output: input.item.output,
        })
      : null;

  if (readRenderMarkdown !== null) {
    return (
      <div className="mt-1">
        <ChatMarkdownMessage
          className="text-xs leading-5"
          contentClassName="[&_[data-streamdown=code-block]]:my-0 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block]]:opacity-85 [&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-body]]:rounded-md [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-muted/25 [&_[data-streamdown=code-block-body]]:shadow-none [&_[data-streamdown=code-block-body]]:px-0 [&_[data-streamdown=code-block-body]]:py-2 [&_[data-streamdown=code-block-body]>pre]:my-0 [&_[data-streamdown=code-block-body]>pre]:border-0 [&_[data-streamdown=code-block-body]>pre]:px-2 [&_[data-streamdown=code-block-body]>pre]:text-[13px] [&_[data-streamdown=code-block-body]>pre]:leading-5"
          isStreaming={input.item.status === "streaming"}
          text={readRenderMarkdown}
        />
      </div>
    );
  }

  if (
    input.semanticKind === "making-edits" &&
    input.item.detail !== null &&
    !input.item.detail.includes(", ")
  ) {
    return <ChatDiffView diff={input.item.output} path={input.item.detail} />;
  }

  return (
    <pre className="bg-muted mt-1 overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
      {input.item.output}
    </pre>
  );
}

export function ChatSemanticGroup({ block }: ChatSemanticGroupProps): React.JSX.Element {
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
                semanticKind: block.semanticKind,
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
        {block.items.map((item) => (
          <details
            className="group/item space-y-1"
            key={item.id}
            open={item.status === "streaming"}
          >
            <summary className="flex cursor-default list-none items-start justify-between gap-3">
              <div className="min-w-0 flex items-baseline gap-2.5 text-sm leading-6">
                <span className="inline-flex shrink-0 items-center gap-1.5">
                  <span className="font-medium">{item.label}</span>
                  {item.output === null || item.output.length === 0 ? null : (
                    <span className="text-muted-foreground flex size-3.5 items-center justify-center">
                      <span className="sr-only">Toggle results</span>
                      <CaretRightIcon
                        aria-hidden
                        className="size-3.5 shrink-0 opacity-25 transition-[transform,opacity] duration-150 ease-out group-hover/item:opacity-100 group-open/item:rotate-90"
                      />
                    </span>
                  )}
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
            {renderSemanticGroupItemOutput({
              item,
              semanticKind: block.semanticKind,
            })}
          </details>
        ))}
      </div>
    </details>
  );
}
