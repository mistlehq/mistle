import { systemScheduler } from "@mistle/time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mistle/ui";
import { useEffect, useState } from "react";

import { ErrorNotice } from "../auth/error-notice.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
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
export const DesignerPageComposerContainerClassName =
  "mx-auto grid w-full max-w-3xl gap-4 pt-8 md:pt-16";
export const DesignerPageSessionsContainerClassName = "mx-auto grid w-full max-w-3xl gap-3";

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

function useDesignerPromptPlaceholder(prompt: string): string {
  const [animationState, setAnimationState] = useState<DesignerPromptPlaceholderAnimationState>({
    phase: "waiting",
    suffixIndex: 0,
    visibleText: DefaultDesignerPromptPlaceholder,
  });

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
    <PageFrame width="normal">
      <div className="grid gap-6">
        <section className={DesignerPageComposerContainerClassName}>
          <h1 className="text-center text-3xl leading-tight font-semibold tracking-normal text-foreground md:text-4xl">
            {DesignerPromptTitle}
          </h1>
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
                    const sessionHref = `/${encodeURIComponent(session.id)}`;

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
