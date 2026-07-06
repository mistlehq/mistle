import { systemScheduler } from "@mistle/time";
import {
  Button,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { useEffect, useState } from "react";

import { ErrorNotice } from "../auth/error-notice.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import { createDesignerSessionPath } from "../designer/designer-routes.js";
import type { DesignerSessionListItem } from "../designer/designer-service.js";
import { PageFrame } from "../shared/page-frame.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import { resolveSessionUpdatedLabel, SessionTitleCell } from "./sessions-page.js";

const DesignerPromptTitle = "Build an agent workflow";
const DesignerPromptPlaceholderPrefix = "Ask Mistle to build ";
const DesignerPromptPlaceholderSuffixes: readonly [string, string, string, string, string] = [
  "an engineering agent that...",
  "a Chief of Staff that...",
  "a support agent that...",
  "an operations agent that...",
  "a product agent that...",
];
const DefaultDesignerPromptPlaceholderSuffix = DesignerPromptPlaceholderSuffixes[0];
const DefaultDesignerPromptPlaceholder = `${DesignerPromptPlaceholderPrefix}${DefaultDesignerPromptPlaceholderSuffix}`;
const DesignerPromptPlaceholderPauseMs = 1800;
const DesignerPromptPlaceholderDeleteMs = 28;
const DesignerPromptPlaceholderTypeMs = 42;
const DesignerStarterPromptCategories: readonly string[] = [
  "Engineering",
  "Product",
  "Marketing",
  "Sales",
  "Admin",
  "HR",
  "Finance",
  "Support",
];
const DesignerStarterPromptVisibleCount = 6;
export const DesignerPageComposerContainerClassName =
  "mx-auto grid w-full max-w-3xl gap-5 pt-16 md:pt-32";
export const DesignerPageSessionsContainerClassName = "mx-auto mt-8 grid w-full max-w-3xl gap-3";
const DesignerPageGlowAccent = "oklch(0.82 0.12 62)";
const DesignerPageGlowMutedAccent = "oklch(0.9 0.045 62)";
const DesignerPageGlowRootClassName = "relative overflow-hidden bg-background";
const DesignerPageGlowClassName =
  "absolute inset-x-0 top-0 h-[24rem] bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--designer-page-glow-accent)_28%,transparent),color-mix(in_oklch,var(--designer-page-glow-muted-accent)_12%,transparent)_36%,transparent_66%)]";
const DesignerPageGlowStyle: React.CSSProperties & {
  "--designer-page-glow-accent": string;
  "--designer-page-glow-muted-accent": string;
} = {
  "--designer-page-glow-accent": DesignerPageGlowAccent,
  "--designer-page-glow-muted-accent": DesignerPageGlowMutedAccent,
};

const DesignerStarterPrompts: readonly {
  category: string;
  label: string;
  prompt: string;
}[] = [
  {
    category: "Engineering",
    label: "Review pull requests",
    prompt:
      "Create an agent that reviews GitHub pull requests for regressions, missing tests, and risky changes.",
  },
  {
    category: "Engineering",
    label: "Ship Linear issues",
    prompt:
      "Build an agent workflow that turns Linear issues marked ready into GitHub pull requests with review follow-through.",
  },
  {
    category: "Engineering",
    label: "Investigate errors",
    prompt:
      "Create an agent that investigates production errors from Sentry, summarizes likely causes, and proposes next actions.",
  },
  {
    category: "Engineering",
    label: "Maintain dependencies",
    prompt:
      "Create an agent that reviews dependency update pull requests, checks changelogs, and flags risky upgrades.",
  },
  {
    category: "Product",
    label: "Analyze funnel changes",
    prompt:
      "Create an agent that analyzes product funnel changes in PostHog and opens Linear follow-up issues for regressions.",
  },
  {
    category: "Product",
    label: "Summarize feedback",
    prompt:
      "Create an agent that summarizes customer feedback from Slack, Notion, and Linear into product themes.",
  },
  {
    category: "Marketing",
    label: "Review campaigns",
    prompt:
      "Create an agent that reviews campaign performance across Google Ads, Meta Ads, and Google Analytics.",
  },
  {
    category: "Marketing",
    label: "Track SEO",
    prompt:
      "Create an agent that monitors Google Search Console and DataForSEO, then drafts weekly SEO opportunities.",
  },
  {
    category: "Marketing",
    label: "Draft briefs",
    prompt:
      "Create an agent that turns product launch notes into campaign briefs, audience angles, and channel tasks.",
  },
  {
    category: "Sales",
    label: "Prepare accounts",
    prompt:
      "Create an agent that prepares sales account briefs from inbound demo requests, company research, and recent workspace context.",
  },
  {
    category: "Sales",
    label: "Follow up with leads",
    prompt:
      "Build an agent workflow that tracks inbound leads, drafts follow-up emails, and updates the sales handoff.",
  },
  {
    category: "Admin",
    label: "Summarize follow-ups",
    prompt:
      "Create an agent that summarizes Gmail follow-ups and prepares a weekly action list from Google Workspace.",
  },
  {
    category: "Admin",
    label: "Prep meetings",
    prompt:
      "Create an agent that prepares meeting agendas from Calendar, Gmail, Docs, and recent follow-up notes.",
  },
  {
    category: "HR",
    label: "Route feedback",
    prompt:
      "Build an agent workflow that routes candidate feedback, interview notes, and hiring follow-ups.",
  },
  {
    category: "HR",
    label: "Onboard hires",
    prompt:
      "Build an agent workflow that coordinates onboarding tasks, manager reminders, and new-hire document follow-ups.",
  },
  {
    category: "Finance",
    label: "Reconcile billing",
    prompt:
      "Create an agent that reconciles Stripe billing events with customer records and reports exceptions.",
  },
  {
    category: "Finance",
    label: "Report revenue",
    prompt:
      "Create an agent that reviews Stripe revenue changes and prepares a finance reporting summary.",
  },
  {
    category: "Finance",
    label: "Audit invoices",
    prompt:
      "Create an agent that audits unpaid invoices, identifies overdue accounts, and drafts follow-up actions.",
  },
  {
    category: "Support",
    label: "Triage messages",
    prompt:
      "Build an agent workflow that triages Slack or WhatsApp support messages and escalates bugs into Linear.",
  },
  {
    category: "Support",
    label: "Handle email",
    prompt:
      "Build an agent workflow that triages AgentMail or Gmail support threads and drafts customer replies.",
  },
];

const DesignerStarterPromptCategoryStyles: Record<string, string> = {
  Admin:
    "border-slate-200 bg-slate-50 text-slate-950 hover:bg-slate-100 [&_[data-category]]:text-slate-500",
  Engineering:
    "border-sky-200 bg-sky-50 text-sky-950 hover:bg-sky-100 [&_[data-category]]:text-sky-600",
  Finance:
    "border-emerald-200 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 [&_[data-category]]:text-emerald-700",
  HR: "border-rose-200 bg-rose-50 text-rose-950 hover:bg-rose-100 [&_[data-category]]:text-rose-600",
  Marketing:
    "border-amber-200 bg-amber-50 text-amber-950 hover:bg-amber-100 [&_[data-category]]:text-amber-700",
  Product:
    "border-violet-200 bg-violet-50 text-violet-950 hover:bg-violet-100 [&_[data-category]]:text-violet-600",
  Sales:
    "border-cyan-200 bg-cyan-50 text-cyan-950 hover:bg-cyan-100 [&_[data-category]]:text-cyan-700",
  Support:
    "border-lime-200 bg-lime-50 text-lime-950 hover:bg-lime-100 [&_[data-category]]:text-lime-700",
};

type DesignerPromptPlaceholderAnimationState = {
  phase: "deleting" | "typing" | "waiting";
  suffixIndex: number;
  visibleText: string;
};

export type DesignerPageViewProps = {
  createErrorMessage: string | null;
  isCreating: boolean;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  prompt: string;
  sessions: readonly DesignerSessionListItem[];
  sessionsErrorMessage: string | null;
};

function formatDesignerSessionTitle(session: DesignerSessionListItem): string {
  return session.title ?? `Designer session ${session.id.slice(-6)}`;
}

function ignoreDesignerComposerAction(): void {}

function resolveDesignerStarterPromptCategoryStyle(category: string): string {
  const categoryStyle = DesignerStarterPromptCategoryStyles[category];
  if (categoryStyle === undefined) {
    throw new Error(`Designer starter prompt category '${category}' is missing styles.`);
  }

  return categoryStyle;
}

function shuffleDesignerStarterPrompts(
  prompts: readonly (typeof DesignerStarterPrompts)[number][],
): readonly (typeof DesignerStarterPrompts)[number][] {
  const shuffledPrompts: (typeof DesignerStarterPrompts)[number][] = [...prompts];

  for (let index = shuffledPrompts.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const currentPrompt = shuffledPrompts[index];
    const swapPrompt = shuffledPrompts[swapIndex];
    if (currentPrompt === undefined || swapPrompt === undefined) {
      throw new Error("Designer starter prompt shuffle produced an invalid index.");
    }

    shuffledPrompts[index] = swapPrompt;
    shuffledPrompts[swapIndex] = currentPrompt;
  }

  return shuffledPrompts;
}

function shuffleDesignerStarterPromptCategories(categories: readonly string[]): readonly string[] {
  const shuffledCategories = [...categories];

  for (let index = shuffledCategories.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const currentCategory = shuffledCategories[index];
    const swapCategory = shuffledCategories[swapIndex];
    if (currentCategory === undefined || swapCategory === undefined) {
      throw new Error("Designer starter prompt category shuffle produced an invalid index.");
    }

    shuffledCategories[index] = swapCategory;
    shuffledCategories[swapIndex] = currentCategory;
  }

  return shuffledCategories;
}

function pickDesignerStarterPromptForCategory(
  category: string,
): (typeof DesignerStarterPrompts)[number] {
  const categoryPrompts = DesignerStarterPrompts.filter(
    (starterPrompt) => starterPrompt.category === category,
  );
  if (categoryPrompts.length === 0) {
    throw new Error(`Designer starter prompt category '${category}' has no prompts.`);
  }

  const promptIndex = Math.floor(Math.random() * categoryPrompts.length);
  const starterPrompt = categoryPrompts[promptIndex];
  if (starterPrompt === undefined) {
    throw new Error(`Designer starter prompt category '${category}' produced an invalid index.`);
  }

  return starterPrompt;
}

function randomizeDesignerStarterPrompts(): readonly (typeof DesignerStarterPrompts)[number][] {
  const selectedCategories = shuffleDesignerStarterPromptCategories(
    DesignerStarterPromptCategories,
  ).slice(0, DesignerStarterPromptVisibleCount);
  const selectedPrompts = selectedCategories.map((category) => {
    const starterPrompt = pickDesignerStarterPromptForCategory(category);
    if (starterPrompt.category !== category) {
      throw new Error(
        `Designer starter prompt category '${category}' selected a mismatched prompt.`,
      );
    }

    return starterPrompt;
  });

  if (selectedPrompts.length !== DesignerStarterPromptVisibleCount) {
    throw new Error(
      "Designer starter prompt selection does not match the visible starter prompt count.",
    );
  }

  return shuffleDesignerStarterPrompts(selectedPrompts);
}

function DesignerStarterPromptChips(input: {
  onPromptSelect: (prompt: string) => void;
}): React.JSX.Element {
  const [starterPrompts] = useState(() => randomizeDesignerStarterPrompts());

  return (
    <div
      className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2"
      data-testid="designer-starter-prompts"
    >
      {starterPrompts.map((starterPrompt) => (
        <Button
          aria-label={`${starterPrompt.category}: ${starterPrompt.label}`}
          className={cn(
            "h-8 max-w-full justify-start gap-1.5 rounded-full px-3 text-left text-xs font-medium whitespace-nowrap shadow-none",
            resolveDesignerStarterPromptCategoryStyle(starterPrompt.category),
          )}
          key={`${starterPrompt.category}:${starterPrompt.label}`}
          onClick={() => {
            input.onPromptSelect(starterPrompt.prompt);
          }}
          title={starterPrompt.prompt}
          type="button"
          variant="outline"
        >
          <span className="shrink-0" data-category="">
            {starterPrompt.category}
          </span>
          <span className="min-w-0">{starterPrompt.label}</span>
        </Button>
      ))}
    </div>
  );
}

function useDesignerPromptPlaceholder(prompt: string): string {
  const [animationState, setAnimationState] = useState<DesignerPromptPlaceholderAnimationState>({
    phase: "waiting",
    suffixIndex: 0,
    visibleText: DefaultDesignerPromptPlaceholder,
  });

  // Synchronizes placeholder typewriter text with scheduled timer ticks.
  useEffect(() => {
    if (prompt.trim().length > 0) {
      return;
    }

    if (animationState.phase === "waiting") {
      const timeoutId = systemScheduler.schedule(() => {
        setAnimationState((currentState) => ({
          ...currentState,
          phase: "deleting",
        }));
      }, DesignerPromptPlaceholderPauseMs);

      return () => {
        systemScheduler.cancel(timeoutId);
      };
    }

    if (animationState.phase === "deleting") {
      if (animationState.visibleText.length <= DesignerPromptPlaceholderPrefix.length) {
        setAnimationState((currentState) => ({
          phase: "typing",
          suffixIndex: (currentState.suffixIndex + 1) % DesignerPromptPlaceholderSuffixes.length,
          visibleText: DesignerPromptPlaceholderPrefix,
        }));
        return;
      }

      const timeoutId = systemScheduler.schedule(() => {
        setAnimationState((currentState) => ({
          ...currentState,
          visibleText: currentState.visibleText.slice(0, -1),
        }));
      }, DesignerPromptPlaceholderDeleteMs);

      return () => {
        systemScheduler.cancel(timeoutId);
      };
    }

    const nextSuffix =
      DesignerPromptPlaceholderSuffixes[animationState.suffixIndex] ??
      DefaultDesignerPromptPlaceholderSuffix;
    const targetPlaceholder = `${DesignerPromptPlaceholderPrefix}${nextSuffix}`;

    if (animationState.visibleText.length >= targetPlaceholder.length) {
      setAnimationState((currentState) => ({
        ...currentState,
        phase: "waiting",
        visibleText: targetPlaceholder,
      }));
      return;
    }

    const timeoutId = systemScheduler.schedule(() => {
      setAnimationState((currentState) => {
        const currentSuffix =
          DesignerPromptPlaceholderSuffixes[currentState.suffixIndex] ??
          DefaultDesignerPromptPlaceholderSuffix;
        const currentTarget = `${DesignerPromptPlaceholderPrefix}${currentSuffix}`;

        return {
          ...currentState,
          visibleText: `${currentState.visibleText}${currentTarget.charAt(currentState.visibleText.length)}`,
        };
      });
    }, DesignerPromptPlaceholderTypeMs);

    return () => {
      systemScheduler.cancel(timeoutId);
    };
  }, [animationState, prompt]);

  return animationState.visibleText;
}

export function DesignerPageView(input: DesignerPageViewProps): React.JSX.Element {
  const canSubmit = input.prompt.trim().length > 0 && !input.isCreating;
  const showPastSessions = input.sessions.length > 0 || input.sessionsErrorMessage !== null;
  const placeholderText = useDesignerPromptPlaceholder(input.prompt);

  return (
    <PageFrame className={DesignerPageGlowRootClassName} width="normal">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={DesignerPageGlowStyle}
      >
        <div className={DesignerPageGlowClassName} />
      </div>
      <div className="relative z-10 grid gap-6">
        <section className={DesignerPageComposerContainerClassName}>
          <h1 className="text-center text-3xl leading-tight font-semibold tracking-normal text-foreground md:text-4xl">
            {DesignerPromptTitle}
          </h1>
          <DesignerStarterPromptChips onPromptSelect={input.onPromptChange} />
          <ChatComposer
            canUploadAttachments={false}
            composerCapabilities={[]}
            composerDraft={createComposerDraft(input.prompt)}
            configControlsDisabled
            contextUsage={null}
            gitBranchLabel={null}
            isSubmitPending={input.isCreating}
            isUploadingAttachments={false}
            modelOptions={[]}
            onClearPendingComments={ignoreDesignerComposerAction}
            onComposerDraftChange={(draft) => {
              input.onPromptChange(draft.text);
            }}
            onModelChange={ignoreDesignerComposerAction}
            onPendingFilesAdded={ignoreDesignerComposerAction}
            onReasoningEffortChange={ignoreDesignerComposerAction}
            onRemovePendingAttachment={ignoreDesignerComposerAction}
            onRuntimeCommandSubmit={ignoreDesignerComposerAction}
            onSubmit={input.onSubmit}
            pendingAttachments={[]}
            pendingCommentSummary={null}
            placeholderText={placeholderText}
            pullRequest={null}
            reasoningEffortOptions={[]}
            selectedModel={null}
            selectedReasoningEffort={null}
            showAttachmentControl={false}
            showConfigControls={false}
            showReasoningControl={false}
            submitDisabled={!canSubmit}
            submitDisabledReason={canSubmit ? null : "Describe what you want to build first."}
            submitLabel={input.isCreating ? "Starting Designer session" : "Start Designer session"}
            submitMode="start"
          />
          <ErrorNotice message={input.createErrorMessage} />
        </section>

        {showPastSessions ? (
          <section className={DesignerPageSessionsContainerClassName}>
            <ErrorNotice message={input.sessionsErrorMessage} />
            {input.sessions.length > 0 ? (
              <Table className="min-w-[36rem] table-fixed">
                <TableHeader className="bg-muted/60">
                  <TableRow className="h-9 border-b">
                    <TableHead className="text-foreground w-[58%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                      Sessions
                    </TableHead>
                    <TableHead className="text-foreground w-[21%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                      Started by
                    </TableHead>
                    <TableHead className="text-right text-foreground w-[21%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                      Updated
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {input.sessions.map((session) => {
                    const sessionTitle = formatDesignerSessionTitle(session);
                    const sessionHref = createDesignerSessionPath(session.id);

                    return (
                      <TableRow
                        className="group/session-row focus-within:bg-muted/50 hover:bg-muted/50"
                        key={session.id}
                      >
                        <TableCell className="max-w-0 align-top whitespace-normal">
                          <div className="flex min-w-0">
                            <SessionTitleCell href={sessionHref} title={sessionTitle} />
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-sm whitespace-normal">
                          <span className="break-words text-sm text-foreground/80">User</span>
                        </TableCell>
                        <TableCell className="align-top text-right whitespace-nowrap">
                          <div className="flex justify-end">
                            {resolveSessionUpdatedLabel({
                              status: session.status ?? "stopped",
                              updatedAt: session.updatedAt,
                              failureMessage: session.failureMessage,
                            })}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : null}
          </section>
        ) : null}
      </div>
    </PageFrame>
  );
}
