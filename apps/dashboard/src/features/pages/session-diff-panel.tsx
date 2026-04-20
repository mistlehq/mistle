import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DialogShortcut,
  Notice,
  OverflowTooltipText,
  Spinner,
  Textarea,
} from "@mistle/ui";
import { CaretDownIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { FileDiff, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  capturePendingSessionDiffCommentAnchor,
  formatPendingSessionDiffCommentLineLabel,
  type PendingSessionDiffComment,
  type PendingSessionDiffCommentInput,
} from "./session-diff-comment.js";
import { parseSessionDiffPatch } from "./session-diff-panel-model.js";

const SessionDiffPanelOptions = {
  diffStyle: "unified",
  disableFileHeader: true,
  lineDiffType: "none",
  overflow: "scroll",
  themeType: "light",
} as const;

type ActiveSessionDiffCommentDraft = {
  body: string;
  fileKey: string;
  filePath: string;
  lineNumber: number;
  side: PendingSessionDiffCommentInput["side"];
};

type HoveredSessionDiffLine = {
  lineNumber: number;
  side: PendingSessionDiffCommentInput["side"];
  top: number;
  left: number;
};

type SessionDiffPanelAnnotationMetadata =
  | {
      kind: "draft";
    }
  | {
      comment: PendingSessionDiffComment;
      kind: "saved-comment";
    };

type SessionDiffPanelAnnotation = DiffLineAnnotation<SessionDiffPanelAnnotationMetadata>;

type SessionDiffPanelProps = {
  errorNotice?: {
    message: string;
    title: string;
    variant: "alert" | "default";
  } | null;
  isLoading?: boolean;
  onAddComment?: (comment: PendingSessionDiffCommentInput) => void;
  onDeleteComment?: ((commentId: string) => void) | undefined;
  onUpdateComment?: ((commentId: string, body: string) => void) | undefined;
  pendingComments?: readonly PendingSessionDiffComment[];
  patch: string;
  repositoryPath?: string | null;
  summaryLabel: string;
  title?: string;
};

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  return resolveRawDiffPath(fileDiff.name || fileDiff.prevName || "");
}

function resolveRawDiffPath(rawPath: string): string {
  if (rawPath.startsWith("a/") || rawPath.startsWith("b/")) {
    return rawPath.slice(2);
  }
  return rawPath;
}

function buildFileDiffKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function getFileDiffLineStats(fileDiff: FileDiffMetadata): {
  additions: number;
  deletions: number;
} {
  return fileDiff.hunks.reduce(
    (totals, hunk) => {
      return {
        additions: totals.additions + hunk.additionLines,
        deletions: totals.deletions + hunk.deletionLines,
      };
    },
    { additions: 0, deletions: 0 },
  );
}

function buildSessionDiffPanelLineAnnotations(input: {
  activeCommentDraft: ActiveSessionDiffCommentDraft | null;
  isCommentingCurrentFile: boolean;
  pendingComments: readonly PendingSessionDiffComment[];
}): SessionDiffPanelAnnotation[] {
  const savedAnnotations: SessionDiffPanelAnnotation[] = input.pendingComments.map((comment) => ({
    lineNumber: comment.lineNumber,
    metadata: {
      comment,
      kind: "saved-comment",
    },
    side: comment.side,
  }));

  if (input.activeCommentDraft === null || !input.isCommentingCurrentFile) {
    return savedAnnotations;
  }

  return [
    ...savedAnnotations,
    {
      lineNumber: input.activeCommentDraft.lineNumber,
      metadata: {
        kind: "draft",
      },
      side: input.activeCommentDraft.side,
    },
  ];
}

function reconcileSessionDiffCommentDrafts(input: {
  currentDrafts: Readonly<Record<string, string>>;
  pendingComments: readonly PendingSessionDiffComment[];
}): Record<string, string> {
  return Object.fromEntries(
    input.pendingComments.map((comment) => [
      comment.id,
      input.currentDrafts[comment.id] ?? comment.body,
    ]),
  );
}

export function SessionDiffPanel({
  errorNotice = null,
  isLoading = false,
  onAddComment,
  onDeleteComment,
  onUpdateComment,
  pendingComments = [],
  patch,
  repositoryPath = null,
  summaryLabel,
  title = "Diffs",
}: SessionDiffPanelProps): React.JSX.Element {
  const parsedPatch = useMemo(() => parseSessionDiffPatch(patch), [patch]);
  const files = parsedPatch.kind === "parsed" ? parsedPatch.files : [];
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [activeCommentDraft, setActiveCommentDraft] =
    useState<ActiveSessionDiffCommentDraft | null>(null);

  useEffect(() => {
    setOpenFiles(Object.fromEntries(files.map((fileDiff) => [buildFileDiffKey(fileDiff), true])));
  }, [files]);

  useEffect(() => {
    setActiveCommentDraft(null);
  }, [patch]);

  return (
    <section className="bg-background flex h-full min-h-0 flex-col">
      <header className="bg-background/95 flex flex-none items-center justify-between border-b px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0 flex items-baseline gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground truncate text-xs">{summaryLabel}</p>
        </div>
        {files.length === 0 || parsedPatch.kind !== "parsed" ? null : (
          <div className="text-muted-foreground text-xs">{files.length} files changed</div>
        )}
      </header>

      {isLoading ? (
        <div className="text-muted-foreground flex min-h-0 flex-1 items-center gap-2 p-3 text-sm">
          <Spinner aria-label="Loading changes" className="size-4" />
          <span>Loading changes compared with main.</span>
        </div>
      ) : errorNotice !== null ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <Notice title={errorNotice.title} variant={errorNotice.variant}>
            {errorNotice.message}
          </Notice>
        </div>
      ) : parsedPatch.kind === "raw" ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <Notice title="Diff parsing failed" variant="alert">
            {parsedPatch.reason}
          </Notice>
          <pre className="bg-muted mt-4 overflow-x-auto rounded-md border p-3 text-xs leading-5 whitespace-pre-wrap">
            {parsedPatch.patch}
          </pre>
        </div>
      ) : files.length === 0 ? (
        <div className="text-muted-foreground p-3 text-sm">No changes detected.</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex flex-col divide-y">
            {files.map((fileDiff) => {
              const fileKey = buildFileDiffKey(fileDiff);
              const isOpen = openFiles[fileKey] ?? true;
              return (
                <SessionDiffPanelFileSection
                  key={fileKey}
                  activeCommentDraft={activeCommentDraft}
                  fileDiff={fileDiff}
                  fileKey={fileKey}
                  onAddComment={onAddComment}
                  onDeleteComment={onDeleteComment}
                  onUpdateComment={onUpdateComment}
                  onOpenChange={(open) => {
                    setOpenFiles((currentOpenFiles) => ({
                      ...currentOpenFiles,
                      [fileKey]: open,
                    }));
                  }}
                  open={isOpen}
                  pendingComments={pendingComments.filter(
                    (comment) => comment.filePath === resolveFileDiffPath(fileDiff),
                  )}
                  repositoryPath={repositoryPath}
                  setActiveCommentDraft={setActiveCommentDraft}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

type SessionDiffPanelFileSectionProps = {
  activeCommentDraft: ActiveSessionDiffCommentDraft | null;
  fileDiff: FileDiffMetadata;
  fileKey: string;
  onAddComment?: ((comment: PendingSessionDiffCommentInput) => void) | undefined;
  onDeleteComment?: ((commentId: string) => void) | undefined;
  onUpdateComment?: ((commentId: string, body: string) => void) | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pendingComments: readonly PendingSessionDiffComment[];
  repositoryPath: string | null;
  setActiveCommentDraft: React.Dispatch<React.SetStateAction<ActiveSessionDiffCommentDraft | null>>;
};

function SessionDiffPanelFileSection({
  activeCommentDraft,
  fileDiff,
  fileKey,
  onAddComment,
  onDeleteComment,
  onUpdateComment,
  onOpenChange,
  open,
  pendingComments,
  repositoryPath,
  setActiveCommentDraft,
}: SessionDiffPanelFileSectionProps): React.JSX.Element {
  const filePath = resolveFileDiffPath(fileDiff);
  const stats = getFileDiffLineStats(fileDiff);
  const isCommentingCurrentFile = activeCommentDraft?.fileKey === fileKey;
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const [hoveredLine, setHoveredLine] = useState<HoveredSessionDiffLine | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setHoveredLine(null);
    }
  }, [open]);

  useEffect(() => {
    setCommentDrafts((currentDrafts) => {
      const nextDrafts = reconcileSessionDiffCommentDrafts({
        currentDrafts,
        pendingComments,
      });
      const currentKeys = Object.keys(currentDrafts);
      const nextKeys = Object.keys(nextDrafts);
      const keysChanged =
        currentKeys.length !== nextKeys.length ||
        currentKeys.some((key) => currentDrafts[key] !== nextDrafts[key]);

      return keysChanged ? nextDrafts : currentDrafts;
    });
  }, [pendingComments]);

  useEffect(() => {
    if (pendingComments.some((comment) => comment.id === focusedCommentId)) {
      return;
    }

    setFocusedCommentId(null);
  }, [focusedCommentId, pendingComments]);

  const lineAnnotations = useMemo<SessionDiffPanelAnnotation[]>(() => {
    return buildSessionDiffPanelLineAnnotations({
      activeCommentDraft,
      isCommentingCurrentFile,
      pendingComments,
    });
  }, [activeCommentDraft, isCommentingCurrentFile, pendingComments]);
  const supportsCommentAnnotations = onAddComment !== undefined || lineAnnotations.length > 0;

  const selectedLine = useMemo(() => {
    if (activeCommentDraft !== null && isCommentingCurrentFile) {
      return {
        end: activeCommentDraft.lineNumber,
        endSide: activeCommentDraft.side,
        side: activeCommentDraft.side,
        start: activeCommentDraft.lineNumber,
      };
    }

    const focusedComment = pendingComments.find((comment) => comment.id === focusedCommentId);
    if (focusedComment === undefined) {
      return null;
    }

    return {
      end: focusedComment.lineNumber,
      endSide: focusedComment.side,
      side: focusedComment.side,
      start: focusedComment.lineNumber,
    };
  }, [activeCommentDraft, focusedCommentId, isCommentingCurrentFile, pendingComments]);

  function handleHoverLine(input: {
    event: PointerEvent;
    lineNumber: number;
    side: PendingSessionDiffCommentInput["side"];
  }): void {
    const overlayRoot = overlayRootRef.current;
    if (overlayRoot === null) {
      return;
    }

    const anchor = resolveHoveredLineAnchor({
      event: input.event,
      lineNumber: input.lineNumber,
      overlayRoot,
    });
    if (anchor === null) {
      return;
    }

    setHoveredLine({
      left: Math.max(0, anchor.left + anchor.width - 6),
      lineNumber: input.lineNumber,
      side: input.side,
      top: anchor.top + anchor.height / 2 - 10,
    });
  }

  function submitActiveCommentDraft(): void {
    if (activeCommentDraft === null || onAddComment === undefined) {
      return;
    }

    const nextCommentBody = activeCommentDraft.body.trim();
    if (nextCommentBody.length === 0) {
      return;
    }

    const anchor = capturePendingSessionDiffCommentAnchor({
      fileDiff,
      lineNumber: activeCommentDraft.lineNumber,
      side: activeCommentDraft.side,
    });
    if (anchor === null) {
      throw new Error("Could not resolve diff comment anchor.");
    }

    onAddComment({
      anchor,
      body: nextCommentBody,
      filePath,
      lineNumber: activeCommentDraft.lineNumber,
      repositoryPath,
      side: activeCommentDraft.side,
    });
    setActiveCommentDraft(null);
  }

  function submitExistingComment(comment: PendingSessionDiffComment): void {
    const nextCommentBody = (commentDrafts[comment.id] ?? comment.body).trim();
    setFocusedCommentId((currentFocusedCommentId) =>
      currentFocusedCommentId === comment.id ? null : currentFocusedCommentId,
    );

    if (
      onUpdateComment === undefined ||
      nextCommentBody.length === 0 ||
      nextCommentBody === comment.body
    ) {
      setCommentDrafts((currentDrafts) => ({
        ...currentDrafts,
        [comment.id]: comment.body,
      }));
      return;
    }

    onUpdateComment(comment.id, nextCommentBody);
  }

  return (
    <Collapsible onOpenChange={onOpenChange} open={open}>
      <section className="overflow-hidden">
        <CollapsibleTrigger
          aria-label={`${open ? "Collapse" : "Expand"} ${resolveFileDiffPath(fileDiff)}`}
          render={
            <button
              className="group bg-background/95 flex w-full items-center justify-between gap-3 px-3 py-2 text-left backdrop-blur-sm"
              type="button"
            />
          }
        >
          <div className="min-w-0">
            <OverflowTooltipText
              className="text-sm font-medium decoration-current/15 underline-offset-2 group-hover:underline"
              containerClassName="block"
              text={resolveFileDiffPath(fileDiff)}
              tooltipClassName="max-w-96 whitespace-pre-wrap text-left"
              truncatePosition="start"
            />
            {fileDiff.prevName === undefined ? null : (
              <p className="text-muted-foreground truncate text-xs">
                renamed from {resolveRawDiffPath(fileDiff.prevName)}
              </p>
            )}
          </div>
          <div className="ml-3 flex flex-none items-center gap-2">
            <div className="flex items-center gap-1.5 text-sm tabular-nums">
              <span className="text-emerald-700">+{stats.additions}</span>
              <span className="text-rose-700">-{stats.deletions}</span>
            </div>
            <CaretDownIcon
              aria-hidden
              className={`size-4 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            className="relative"
            onPointerLeave={() => {
              setHoveredLine(null);
            }}
            ref={overlayRootRef}
          >
            {onAddComment === undefined ||
            hoveredLine === null ||
            activeCommentDraft !== null ||
            focusedCommentId !== null ? null : (
              <button
                aria-label="Add comment"
                className="absolute z-10 flex size-5 items-center justify-center rounded-md bg-stone-900 text-white shadow-sm ring-1 ring-black/5"
                onClick={() => {
                  setActiveCommentDraft({
                    body: "",
                    fileKey,
                    filePath,
                    lineNumber: hoveredLine.lineNumber,
                    side: hoveredLine.side,
                  });
                  setHoveredLine(null);
                }}
                style={{
                  left: `${hoveredLine.left}px`,
                  top: `${hoveredLine.top}px`,
                }}
                type="button"
              >
                <PlusIcon aria-hidden="true" className="size-3.5" />
              </button>
            )}
            <FileDiff<SessionDiffPanelAnnotationMetadata>
              className="overflow-hidden"
              fileDiff={fileDiff}
              options={
                onAddComment === undefined
                  ? SessionDiffPanelOptions
                  : {
                      ...SessionDiffPanelOptions,
                      lineHoverHighlight: "both" as const,
                      onLineEnter: (props) => {
                        handleHoverLine({
                          event: props.event,
                          lineNumber: props.lineNumber,
                          side: props.annotationSide,
                        });
                      },
                    }
              }
              {...(!supportsCommentAnnotations
                ? {}
                : {
                    renderAnnotation: (annotation: SessionDiffPanelAnnotation) => {
                      if (annotation.metadata.kind === "saved-comment") {
                        const comment = annotation.metadata.comment;
                        return (
                          <SavedSessionDiffCommentCard
                            comment={comment}
                            draftBody={commentDrafts[comment.id] ?? comment.body}
                            onBodyChange={(body) => {
                              setCommentDrafts((currentDrafts) => ({
                                ...currentDrafts,
                                [comment.id]: body,
                              }));
                            }}
                            onDelete={
                              onDeleteComment === undefined
                                ? undefined
                                : () => {
                                    onDeleteComment(comment.id);
                                  }
                            }
                            onFocus={() => {
                              setFocusedCommentId(comment.id);
                              setActiveCommentDraft(null);
                            }}
                            onReset={() => {
                              setCommentDrafts((currentDrafts) => ({
                                ...currentDrafts,
                                [comment.id]: comment.body,
                              }));
                              setFocusedCommentId(null);
                            }}
                            onSubmit={() => {
                              submitExistingComment(comment);
                            }}
                          />
                        );
                      }

                      if (!isCommentingCurrentFile || activeCommentDraft === null) {
                        return null;
                      }

                      return (
                        <DraftSessionDiffCommentCard
                          draft={activeCommentDraft}
                          onCancel={() => {
                            setActiveCommentDraft(null);
                          }}
                          onChangeBody={(body) => {
                            setActiveCommentDraft((currentDraft) =>
                              currentDraft === null
                                ? null
                                : {
                                    ...currentDraft,
                                    body,
                                  },
                            );
                          }}
                          onSubmit={submitActiveCommentDraft}
                        />
                      );
                    },
                    selectedLines: selectedLine,
                    lineAnnotations,
                  })}
            />
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function SavedSessionDiffCommentCard(input: {
  comment: PendingSessionDiffComment;
  draftBody: string;
  onBodyChange: (body: string) => void;
  onDelete?: (() => void) | undefined;
  onFocus: () => void;
  onReset: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const title =
    input.comment.status.kind === "stale"
      ? `Comment needs review on line ${formatPendingSessionDiffCommentLineLabel(input.comment)}`
      : `Comment on line ${formatPendingSessionDiffCommentLineLabel(input.comment)}`;
  const notice =
    input.comment.status.kind === "stale" ? (
      <Notice appearance="boxed" className="mb-3 text-sm" variant="warning">
        This comment no longer matches the current diff. Review or remove it before sending.
      </Notice>
    ) : null;

  return (
    <SessionDiffPanelCommentCard
      tone={input.comment.status.kind === "stale" ? "warning" : "default"}
      headerAction={
        input.onDelete === undefined ? undefined : (
          <Button
            aria-label={`Delete comment on line ${formatPendingSessionDiffCommentLineLabel(input.comment)}`}
            className="-mr-1 size-7 rounded-sm"
            onClick={input.onDelete}
            type="button"
            variant="ghost"
          >
            <TrashIcon aria-hidden="true" className="size-4" />
          </Button>
        )
      }
      body={
        <>
          {notice}
          <SessionDiffCommentTextarea
            onBlur={input.onSubmit}
            onChange={(event) => {
              input.onBodyChange(event.target.value);
            }}
            onFocus={input.onFocus}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                input.onReset();
                event.currentTarget.blur();
                return;
              }

              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                input.onSubmit();
                event.currentTarget.blur();
              }
            }}
            value={input.draftBody}
          />
        </>
      }
      title={title}
    />
  );
}

function DraftSessionDiffCommentCard(input: {
  draft: ActiveSessionDiffCommentDraft;
  onCancel: () => void;
  onChangeBody: (body: string) => void;
  onSubmit: () => void;
}): React.JSX.Element {
  return (
    <SessionDiffPanelCommentCard
      actionRow={
        <>
          <Button onClick={input.onCancel} type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={input.draft.body.trim().length === 0}
            onClick={input.onSubmit}
            type="button"
          >
            <>
              Add
              <DialogShortcut aria-label="Enter" />
            </>
          </Button>
        </>
      }
      body={
        <SessionDiffCommentTextarea
          onChange={(event) => {
            input.onChangeBody(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              input.onCancel();
              return;
            }

            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              input.onSubmit();
            }
          }}
          placeholder="Add comment"
          value={input.draft.body}
        />
      }
      title={`Add comment on line ${formatPendingSessionDiffCommentLineLabel(input.draft)}`}
    />
  );
}

function SessionDiffCommentTextarea(
  props: React.ComponentProps<typeof Textarea>,
): React.JSX.Element {
  return (
    <Textarea
      {...props}
      className={`min-h-28 resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 ${
        props.className ?? ""
      }`}
    />
  );
}

function SessionDiffPanelCommentCard(input: {
  body: React.JSX.Element;
  title: string;
  actionRow?: React.JSX.Element | undefined;
  headerAction?: React.JSX.Element | undefined;
  tone?: "default" | "warning";
}): React.JSX.Element {
  return (
    <div
      className={`m-1 max-w-2xl overflow-hidden rounded-md border font-sans shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
        input.tone === "warning" ? "border-amber-300 bg-amber-50/40" : "bg-white"
      }`}
    >
      <div
        className={`border-b relative px-3 py-2 ${input.headerAction === undefined ? "" : "pr-10"}`}
      >
        <p className="text-foreground min-w-0 text-sm font-semibold">{input.title}</p>
        {input.headerAction === undefined ? null : (
          <div className="absolute top-1/2 right-1.5 -translate-y-1/2">{input.headerAction}</div>
        )}
      </div>
      <div className="p-3">
        {input.body}
        {input.actionRow === undefined ? null : (
          <div className="mt-4 flex items-center justify-end gap-2">{input.actionRow}</div>
        )}
      </div>
    </div>
  );
}

function resolveHoveredLineAnchor(input: {
  event: PointerEvent;
  lineNumber: number;
  overlayRoot: HTMLDivElement;
}): DOMRect | null {
  const composedPath = input.event.composedPath();
  const lineElement = composedPath.find((node): node is HTMLElement => {
    return node instanceof HTMLElement && node.dataset.lineIndex !== undefined;
  });
  const lineIndex = lineElement?.dataset.lineIndex;
  const shadowRoot = lineElement?.getRootNode();
  if (!(shadowRoot instanceof ShadowRoot)) {
    return null;
  }

  const numberElement =
    (lineIndex === undefined
      ? null
      : shadowRoot.querySelector<HTMLElement>(
          `[data-column-number][data-line-index="${lineIndex}"]`,
        )) ??
    composedPath.find((node): node is HTMLElement => {
      return node instanceof HTMLElement && node.dataset.columnNumber !== undefined;
    });
  if (numberElement === undefined || numberElement === null) {
    return null;
  }

  const overlayRootRect = input.overlayRoot.getBoundingClientRect();
  const numberRect = numberElement.getBoundingClientRect();
  return new DOMRect(
    numberRect.left - overlayRootRect.left,
    numberRect.top - overlayRootRect.top,
    numberRect.width,
    numberRect.height,
  );
}
