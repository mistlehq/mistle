import { CheckIcon, CircleIcon, SquareIcon } from "@phosphor-icons/react";

import type { ChatPlanEntry } from "../chat-types.js";

type ChatPlanEntryProps = {
  block: ChatPlanEntry;
};

type ChatPlanStepStatus = "pending" | "inProgress" | "completed";

function getPlanStepIndicator(status: ChatPlanStepStatus): React.JSX.Element {
  if (status === "completed") {
    return <CheckIcon aria-hidden className="size-3.5" weight="bold" />;
  }

  if (status === "inProgress") {
    return <CircleIcon aria-hidden className="size-3.5" weight="fill" />;
  }

  return <SquareIcon aria-hidden className="size-3.5" weight="regular" />;
}

export function ChatPlanEntry({ block }: ChatPlanEntryProps): React.JSX.Element {
  const hasStructuredSteps = block.steps !== null && block.steps.length > 0;
  const structuredSteps = block.steps ?? [];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium text-sm">{hasStructuredSteps ? "Updated Plan" : "Plan"}</p>
      </div>
      {block.explanation === null ? null : (
        <p className="text-muted-foreground text-sm leading-6 italic">{block.explanation}</p>
      )}
      {hasStructuredSteps ? (
        <ul className="border-border/70 space-y-0.5 border-l pl-4">
          {structuredSteps.map((step) => (
            <li
              className="flex items-center gap-2.5 text-sm leading-6"
              key={`${step.status}:${step.step}`}
            >
              <span
                className={[
                  "flex size-4 shrink-0 items-center justify-center leading-none",
                  step.status === "completed"
                    ? "text-muted-foreground"
                    : step.status === "inProgress"
                      ? "text-foreground"
                      : "text-muted-foreground",
                ].join(" ")}
              >
                {getPlanStepIndicator(step.status)}
              </span>
              <span
                className={
                  step.status === "completed"
                    ? "text-muted-foreground line-through"
                    : step.status === "inProgress"
                      ? "font-medium"
                      : "text-muted-foreground"
                }
              >
                {step.step}
              </span>
            </li>
          ))}
        </ul>
      ) : block.text === null ? null : (
        <div className="border-border/70 border-l pl-4">
          <p className="text-sm leading-6 whitespace-pre-wrap">{block.text}</p>
        </div>
      )}
    </div>
  );
}
