import { Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
import { WarningCircleIcon } from "@phosphor-icons/react";

type TriggerIssue = {
  message: string;
};

export function TriggerStatusDot(input: { enabled: boolean }): React.JSX.Element {
  return (
    <>
      <span
        aria-hidden
        className={`inline-block size-2 shrink-0 rounded-full ${
          input.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"
        }`}
      />
      <span className="sr-only">{input.enabled ? "Enabled" : "Disabled"}</span>
    </>
  );
}

export function TriggerIssueIndicator(input: {
  issue: TriggerIssue | undefined;
  enabled: boolean;
}): React.JSX.Element {
  if (input.issue === undefined) {
    return <TriggerStatusDot enabled={input.enabled} />;
  }

  return (
    <Tooltip delay={0}>
      <TooltipTrigger
        aria-label="View trigger issue details"
        className="inline-flex shrink-0 items-center justify-center rounded-full text-destructive outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <WarningCircleIcon aria-hidden className="size-4 fill-current" weight="fill" />
      </TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-pre-wrap text-left" side="top">
        {input.issue.message}
      </TooltipContent>
    </Tooltip>
  );
}
