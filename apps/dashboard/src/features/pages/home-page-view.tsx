import { Button, cn } from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";
import * as React from "react";

import { ActionTile } from "../shared/action-tile.js";
import type { HomeChecklistStep, HomeChecklistViewModel } from "./home-page-view-model.js";

type HomePageViewProps = {
  onboarding: HomeChecklistViewModel;
  onNavigate?: (href: string) => void;
};

export function HomePageView({ onboarding, onNavigate }: HomePageViewProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      {onboarding.steps.map((step) => (
        <SetupStepRow
          key={step.id}
          step={step}
          {...(onNavigate === undefined ? {} : { onNavigate })}
        />
      ))}
    </div>
  );
}

export function HomePageShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-4 py-6">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">Get started</h1>
        {children}
      </div>
    </div>
  );
}

function SetupStepRow(input: {
  step: HomeChecklistStep;
  onNavigate?: (href: string) => void;
}): React.JSX.Element {
  return (
    <ActionTile
      action={
        input.step.status === "complete" ? null : (
          <Button
            className="my-auto shrink-0"
            disabled={input.step.status !== "current"}
            onClick={() => {
              input.onNavigate?.(input.step.href);
            }}
            type="button"
            variant={input.step.status === "current" ? "default" : "outline"}
          >
            {input.step.actionLabel}
          </Button>
        )
      }
      className={cn(
        input.step.status === "current" && "border-primary/40 bg-primary/5",
        input.step.status === "complete" && "border-border/60 bg-muted/15",
        input.step.status === "upcoming" && "border-border/70",
      )}
      description={input.step.description}
      leading={<StepStatusMark status={input.step.status} />}
      leadingPlacement="detached"
      padding="comfortable"
      title={input.step.title}
      titleClassName={cn(
        input.step.status === "complete" && "text-foreground/80",
        input.step.status === "upcoming" && "text-foreground/85",
      )}
    />
  );
}

function StepStatusMark(input: { status: HomeChecklistStep["status"] }): React.JSX.Element {
  if (input.status === "complete") {
    return <CheckCircleIcon aria-hidden className="size-5 text-emerald-600" weight="fill" />;
  }

  return (
    <div
      aria-hidden
      className={cn(
        "size-2.5 rounded-full",
        input.status === "current" && "bg-primary",
        input.status === "upcoming" && "bg-muted-foreground/30",
      )}
    />
  );
}
