import { CaretRightIcon } from "@phosphor-icons/react";

import type { ChatGenericItemEntry } from "../chat-types.js";

type ChatGenericItemProps = {
  block: ChatGenericItemEntry;
};

export function ChatGenericItem({ block }: ChatGenericItemProps): React.JSX.Element {
  const hasExpandableContent =
    (block.body !== null && block.body.length > 0) ||
    (block.detailsJson !== null && block.detailsJson.length > 0);

  return (
    <details className="space-y-1" open={!hasExpandableContent}>
      <summary className="group list-none cursor-default">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="font-medium text-sm">{block.title}</p>
            {hasExpandableContent ? (
              <CaretRightIcon
                aria-hidden="true"
                className="text-muted-foreground size-4 shrink-0 opacity-25 transition duration-200 group-hover:opacity-100 group-open:rotate-90 group-open:opacity-100"
                weight="bold"
              />
            ) : null}
          </div>
          <p className="text-muted-foreground shrink-0 text-xs">
            {block.status === "streaming" ? "Running" : "Completed"}
          </p>
        </div>
      </summary>
      {!hasExpandableContent ? null : (
        <div className="border-border/60 space-y-2 border-l pl-4">
          {block.body === null ? null : (
            <p className="text-muted-foreground text-sm leading-6 whitespace-pre-wrap">
              {block.body}
            </p>
          )}
          {block.detailsJson === null ? null : (
            <pre className="bg-muted overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
              {block.detailsJson}
            </pre>
          )}
        </div>
      )}
    </details>
  );
}
