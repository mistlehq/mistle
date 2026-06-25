import {
  DropdownMenuItem,
  MoreActionsMenu,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link as RouterLink } from "react-router";

import { ErrorNotice } from "../auth/error-notice.js";
import { ChatComposer } from "../chat/components/chat-composer.js";
import type { DesignerSessionListItem } from "../designer/designer-service.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import { PageFrame } from "../shared/page-frame.js";
import { createComposerDraft } from "./session-composer/session-composer-draft.js";
import { resolveSessionUpdatedLabel, SessionTitleCell } from "./sessions-page.js";

export type DesignerPageViewProps = {
  createErrorMessage: string | null;
  isCreating: boolean;
  onOpenSession: () => void;
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

function DesignerSessionRowActions(input: {
  href: string;
  onOpenSession: () => void;
  sessionTitle: string;
}): React.JSX.Element {
  return (
    <MoreActionsMenu
      triggerLabel={`Designer session actions for ${input.sessionTitle}`}
      triggerSize="icon-xs"
    >
      <DropdownMenuItem render={<RouterLink to={input.href} onClick={input.onOpenSession} />}>
        <ArrowRightIcon aria-hidden className="size-4" />
        Open session
      </DropdownMenuItem>
    </MoreActionsMenu>
  );
}

export function DesignerPageView(input: DesignerPageViewProps): React.JSX.Element {
  const canSubmit = input.prompt.trim().length > 0 && !input.isCreating;
  const showPastSessions = input.sessions.length > 0 || input.sessionsErrorMessage !== null;

  return (
    <PageFrame title="Designer" width="normal">
      <div className="grid gap-5">
        <section className="grid gap-3">
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
            onClearPendingDiffComments={ignoreDesignerComposerAction}
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
            pendingDiffCommentSummary={null}
            placeholderText="Build a triaging agent for incoming GitHub issues and Linear bugs."
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
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium">Past sessions</h2>
            </div>
            <ErrorNotice message={input.sessionsErrorMessage} />
            {input.sessions.length > 0 ? (
              <Table className="min-w-[36rem] table-fixed">
                <TableHeader className="bg-muted/60">
                  <TableRow className="h-9 border-b">
                    <TableHead className="text-foreground w-[48%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                      Sessions
                    </TableHead>
                    <TableHead className="text-foreground w-[18%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                      Started by
                    </TableHead>
                    <TableHead className="text-foreground w-[14%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                      Created
                    </TableHead>
                    <TableHead className="text-right text-foreground w-[14%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                      Updated
                    </TableHead>
                    <TableHead className="w-[6%] py-2">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {input.sessions.map((session) => {
                    const sessionTitle = formatDesignerSessionTitle(session);
                    const sessionHref = `/designer/${encodeURIComponent(session.id)}`;

                    return (
                      <TableRow
                        className="group/session-row focus-within:bg-muted/50 hover:bg-muted/50"
                        onClickCapture={(event) => {
                          if (!(event.target instanceof Element)) {
                            return;
                          }

                          const link = event.target.closest("a[href]");
                          if (
                            link === null ||
                            !event.currentTarget.contains(link) ||
                            link.getAttribute("href") !== sessionHref
                          ) {
                            return;
                          }

                          input.onOpenSession();
                        }}
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
                        <TableCell className="align-top whitespace-nowrap">
                          <span className="text-muted-foreground text-sm">
                            {formatCompactRelativeOrDate(session.createdAt)}
                          </span>
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
                        <TableCell className="align-middle text-right">
                          <div className="flex justify-end">
                            <DesignerSessionRowActions
                              href={sessionHref}
                              onOpenSession={input.onOpenSession}
                              sessionTitle={sessionTitle}
                            />
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
