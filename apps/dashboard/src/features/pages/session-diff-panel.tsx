import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Notice,
  OverflowTooltipText,
  Spinner,
  Textarea,
} from "@mistle/ui";
import { CaretDownIcon, PlusIcon } from "@phosphor-icons/react";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  formatPendingSessionDiffCommentLineLabel,
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

type ActiveSessionDiffCommentDraft = PendingSessionDiffCommentInput & {
  fileKey: string;
};

type HoveredSessionDiffLine = {
  lineNumber: number;
  side: PendingSessionDiffCommentInput["side"];
  top: number;
  left: number;
};

type SessionDiffPanelProps = {
  errorNotice?: {
    message: string;
    title: string;
    variant: "alert" | "default";
  } | null;
  isLoading?: boolean;
  onAddComment?: (comment: PendingSessionDiffCommentInput) => void;
  patch: string;
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

export function SessionDiffPanel({
  errorNotice = null,
  isLoading = false,
  onAddComment,
  patch,
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
                  isOpen={isOpen}
                  onAddComment={onAddComment}
                  onOpenChange={(open) => {
                    setOpenFiles((currentOpenFiles) => ({
                      ...currentOpenFiles,
                      [fileKey]: open,
                    }));
                  }}
                  open={isOpen}
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
  isOpen: boolean;
  onAddComment?: ((comment: PendingSessionDiffCommentInput) => void) | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  setActiveCommentDraft: React.Dispatch<React.SetStateAction<ActiveSessionDiffCommentDraft | null>>;
};

function SessionDiffPanelFileSection({
  activeCommentDraft,
  fileDiff,
  fileKey,
  isOpen,
  onAddComment,
  onOpenChange,
  open,
  setActiveCommentDraft,
}: SessionDiffPanelFileSectionProps): React.JSX.Element {
  const filePath = resolveFileDiffPath(fileDiff);
  const stats = getFileDiffLineStats(fileDiff);
  const isCommentingCurrentFile = activeCommentDraft?.fileKey === fileKey;
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const [hoveredLine, setHoveredLine] = useState<HoveredSessionDiffLine | null>(null);

  useEffect(() => {
    if (!open) {
      setHoveredLine(null);
    }
  }, [open]);

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

  return (
    <Collapsible onOpenChange={onOpenChange} open={isOpen}>
      <section className="overflow-hidden">
        <CollapsibleTrigger
          aria-label={`${isOpen ? "Collapse" : "Expand"} ${resolveFileDiffPath(fileDiff)}`}
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
                isOpen ? "rotate-180" : ""
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
            {onAddComment === undefined || hoveredLine === null ? null : (
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
            <FileDiff
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
              {...(onAddComment === undefined
                ? {}
                : {
                    renderAnnotation: () => {
                      if (!isCommentingCurrentFile || activeCommentDraft === null) {
                        return null;
                      }

                      return (
                        <div className="m-1 max-w-2xl overflow-hidden rounded-md border bg-white font-sans shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
                          <div className="border-b p-3">
                            <p className="text-foreground text-sm font-semibold">
                              Add comment on line{" "}
                              {formatPendingSessionDiffCommentLineLabel(activeCommentDraft)}
                            </p>
                          </div>
                          <div className="p-3">
                            <Textarea
                              className="min-h-28 resize-none rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                              onChange={(event) => {
                                setActiveCommentDraft((currentDraft) =>
                                  currentDraft === null
                                    ? null
                                    : {
                                        ...currentDraft,
                                        body: event.target.value,
                                      },
                                );
                              }}
                              placeholder="Add comment"
                              value={activeCommentDraft.body}
                            />
                            <div className="mt-4 flex items-center justify-end gap-2">
                              <Button
                                onClick={() => {
                                  setActiveCommentDraft(null);
                                }}
                                type="button"
                                variant="ghost"
                              >
                                Cancel
                              </Button>
                              <Button
                                disabled={activeCommentDraft.body.trim().length === 0}
                                onClick={() => {
                                  const nextCommentBody = activeCommentDraft.body.trim();
                                  if (nextCommentBody.length === 0) {
                                    return;
                                  }

                                  onAddComment({
                                    body: nextCommentBody,
                                    filePath,
                                    lineNumber: activeCommentDraft.lineNumber,
                                    side: activeCommentDraft.side,
                                  });
                                  setActiveCommentDraft(null);
                                }}
                                type="button"
                              >
                                Add comment
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    },
                    selectedLines:
                      activeCommentDraft === null || !isCommentingCurrentFile
                        ? null
                        : {
                            end: activeCommentDraft.lineNumber,
                            endSide: activeCommentDraft.side,
                            side: activeCommentDraft.side,
                            start: activeCommentDraft.lineNumber,
                          },
                    lineAnnotations:
                      activeCommentDraft === null || !isCommentingCurrentFile
                        ? []
                        : [
                            {
                              lineNumber: activeCommentDraft.lineNumber,
                              side: activeCommentDraft.side,
                            },
                          ],
                  })}
            />
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
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
