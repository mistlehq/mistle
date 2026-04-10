import { Button, cn } from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";

import type { HomeChecklistStep, HomeChecklistViewModel } from "./home-page-view-model.js";

type HomePageViewProps = {
  onboarding: HomeChecklistViewModel;
  onNavigate?: (href: string) => void;
};

export function HomePageView({ onboarding, onNavigate }: HomePageViewProps): React.JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-6">
      <div className="w-full max-w-4xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">Get started</h1>
        <div className="space-y-3">
          {onboarding.steps.map((step) => (
            <SetupStepRow
              key={step.id}
              step={step}
              {...(onNavigate === undefined ? {} : { onNavigate })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupStepRow(input: {
  step: HomeChecklistStep;
  onNavigate?: (href: string) => void;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-start sm:justify-between",
        input.step.status === "current" && "border-primary/40 bg-primary/5",
        input.step.status === "complete" && "border-border/60 bg-muted/15",
        input.step.status === "upcoming" && "border-border/70",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center">
          {input.step.status === "complete" ? (
            <CheckCircleIcon aria-hidden className="size-5 text-emerald-600" weight="fill" />
          ) : (
            <div
              aria-hidden
              className={cn(
                "size-2.5 rounded-full",
                input.step.status === "current" && "bg-primary",
                input.step.status === "upcoming" && "bg-muted-foreground/30",
              )}
            />
          )}
        </div>
        <div className="space-y-1">
          <p
            className={cn(
              "text-sm font-medium",
              input.step.status === "complete" && "text-foreground/80",
              input.step.status === "upcoming" && "text-foreground/85",
            )}
          >
            {input.step.title}
          </p>
          <p className="text-muted-foreground text-sm">{input.step.description}</p>
        </div>
      </div>
      {input.step.status === "complete" ? null : (
        <Button
          className="shrink-0"
          disabled={input.step.status !== "current"}
          onClick={() => {
            input.onNavigate?.(input.step.href);
          }}
          type="button"
          variant={input.step.status === "current" ? "default" : "outline"}
        >
          {input.step.actionLabel}
        </Button>
      )}
    </div>
  );
}
