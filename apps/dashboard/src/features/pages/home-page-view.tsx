import { Button, buttonVariants, cn, TextLink } from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";

import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { ActionTile } from "../shared/action-tile.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import type { HomeChecklistStep, HomeChecklistViewModel } from "./home-page-view-model.js";

type HomePageViewProps = {
  createSessionForm: ReactNode;
  onboarding: HomeChecklistViewModel;
  recentSessions: readonly SandboxInstanceListItem[];
};

export function HomePageView({
  createSessionForm,
  onboarding,
  recentSessions,
}: HomePageViewProps): React.JSX.Element {
  if (onboarding.state === "completed") {
    return (
      <CompletedHomeView createSessionForm={createSessionForm} recentSessions={recentSessions} />
    );
  }

  return (
    <div className="space-y-3">
      {onboarding.steps.map((step) => (
        <SetupStepRow key={step.id} step={step} />
      ))}
    </div>
  );
}

function CompletedHomeView(input: {
  createSessionForm: ReactNode;
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
          <RecentSessionsList recentSessions={input.recentSessions} />
        </div>
      </section>
    </div>
  );
}

function RecentSessionsList(input: {
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
          <div
            className={cn(
              "group/session-row flex w-full min-w-0 items-center justify-between gap-4 rounded-md px-0 py-2 text-left",
              isNavigable ? null : "cursor-default",
            )}
            key={session.id}
          >
            {isNavigable ? (
              <TextLink
                className="min-w-0 truncate text-sm font-medium"
                render={<RouterLink to={sessionHref} />}
                variant="listItem"
              >
                {sessionTitle}
              </TextLink>
            ) : (
              <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
                {sessionTitle}
              </span>
            )}
            <span className="text-muted-foreground flex shrink-0 items-center gap-2 text-sm">
              <span className="hidden max-w-64 truncate sm:inline">
                {session.sandboxProfileDisplayName ?? session.sandboxProfileId}
              </span>
              <span>{formatCompactRelativeOrDate(session.createdAt)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SetupStepRow(input: { step: HomeChecklistStep }): React.JSX.Element {
  const action =
    input.step.status === "complete" ? null : input.step.status === "current" ? (
      <RouterLink
        className={buttonVariants({ className: "my-auto shrink-0" })}
        to={input.step.href}
      >
        {input.step.actionLabel}
      </RouterLink>
    ) : (
      <Button className="my-auto shrink-0" disabled type="button" variant="outline">
        {input.step.actionLabel}
      </Button>
    );

  return (
    <ActionTile
      action={action}
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
