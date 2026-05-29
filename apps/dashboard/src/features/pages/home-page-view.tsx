import { Button, cn } from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { ActionTile } from "../shared/action-tile.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import type { HomeChecklistStep, HomeChecklistViewModel } from "./home-page-view-model.js";

type HomePageViewProps = {
  createSessionForm: ReactNode;
  onboarding: HomeChecklistViewModel;
  onNavigate?: (href: string) => void;
  recentSessions: readonly SandboxInstanceListItem[];
};

export function HomePageView({
  createSessionForm,
  onboarding,
  onNavigate,
  recentSessions,
}: HomePageViewProps): React.JSX.Element {
  if (onboarding.state === "completed") {
    return (
      <CompletedHomeView
        createSessionForm={createSessionForm}
        recentSessions={recentSessions}
        {...(onNavigate === undefined ? {} : { onNavigate })}
      />
    );
  }

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

function CompletedHomeView(input: {
  createSessionForm: ReactNode;
  onNavigate?: (href: string) => void;
  recentSessions: readonly SandboxInstanceListItem[];
}): React.JSX.Element {
  return (
    <div className="flex w-full flex-col gap-8">
      <section className="min-w-0 space-y-3">
        <h2 className="truncate text-xl font-semibold">Start new session</h2>
        {input.createSessionForm}
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="truncate text-xl font-semibold">Recent sessions</h2>
        <div className="rounded-lg border bg-background p-4">
          <RecentSessionsList
            recentSessions={input.recentSessions}
            {...(input.onNavigate === undefined ? {} : { onNavigate: input.onNavigate })}
          />
        </div>
      </section>
    </div>
  );
}

function RecentSessionsList(input: {
  onNavigate?: (href: string) => void;
  recentSessions: readonly SandboxInstanceListItem[];
}): React.JSX.Element {
  if (input.recentSessions.length === 0) {
    return <p className="text-muted-foreground text-sm">No sessions yet.</p>;
  }

  return (
    <div className="divide-y divide-border/70">
      {input.recentSessions.map((session) => {
        const isNavigable = isSessionPageNavigableSandboxStatus(session.status);
        const sessionHref = `/sessions/${encodeURIComponent(session.id)}`;
        const sessionTitle = resolveSessionTitleLabel(session.title);

        return (
          <button
            aria-label={sessionTitle}
            className={cn(
              "group/session-row flex w-full min-w-0 items-center justify-between gap-4 rounded-md px-0 py-2 text-left",
              isNavigable
                ? "cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                : "cursor-default",
            )}
            disabled={!isNavigable}
            key={session.id}
            onClick={() => {
              input.onNavigate?.(sessionHref);
            }}
            type="button"
          >
            <span
              className={cn(
                "min-w-0 truncate text-sm font-medium",
                isNavigable
                  ? "group-hover/session-row:underline group-focus-visible/session-row:underline"
                  : "text-muted-foreground",
              )}
            >
              {sessionTitle}
            </span>
            <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-sm">
              <span className="hidden max-w-64 truncate sm:inline">
                {session.sandboxProfileDisplayName ?? session.sandboxProfileId}
              </span>
              <span>{formatCompactRelativeOrDate(session.createdAt)}</span>
            </span>
          </button>
        );
      })}
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
