import { Notice, Spinner } from "@mistle/ui";
import { FileDiff, type FileDiffMetadata } from "@pierre/diffs/react";
import { useMemo } from "react";

import { parseSessionDiffPatch } from "./session-diff-panel-model.js";

const SessionDiffPanelOptions = {
  diffStyle: "unified",
  disableFileHeader: true,
  lineDiffType: "none",
  overflow: "scroll",
  themeType: "light",
} as const;

type SessionDiffPanelProps = {
  errorNotice?: {
    message: string;
    title: string;
    variant: "alert" | "default";
  } | null;
  isLoading?: boolean;
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
  patch,
  summaryLabel,
  title = "Diffs",
}: SessionDiffPanelProps): React.JSX.Element {
  const parsedPatch = useMemo(() => parseSessionDiffPatch(patch), [patch]);
  const files = parsedPatch.kind === "parsed" ? parsedPatch.files : [];

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
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <div className="flex flex-col gap-2">
            {files.map((fileDiff) => {
              const stats = getFileDiffLineStats(fileDiff);
              return (
                <section
                  className="overflow-hidden rounded-md border"
                  key={buildFileDiffKey(fileDiff)}
                >
                  <div className="bg-background/95 flex items-center justify-between border-b px-3 py-2 backdrop-blur-sm">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {resolveFileDiffPath(fileDiff)}
                      </p>
                      {fileDiff.prevName === undefined ? null : (
                        <p className="text-muted-foreground truncate text-xs">
                          renamed from {resolveRawDiffPath(fileDiff.prevName)}
                        </p>
                      )}
                    </div>
                    <div className="ml-4 flex flex-none items-center gap-3 text-xs">
                      <span className="text-emerald-700">+{stats.additions}</span>
                      <span className="text-rose-700">-{stats.deletions}</span>
                    </div>
                  </div>
                  <FileDiff
                    className="overflow-hidden"
                    fileDiff={fileDiff}
                    options={SessionDiffPanelOptions}
                  />
                </section>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
