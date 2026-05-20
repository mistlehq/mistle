export type ContextMentionSearchResult = {
  kind: "file" | "directory";
  path: string;
};

export type ContextMentionSearchMenuStatus = "idle" | "loading" | "ready" | "unavailable";

export type ContextMentionSearchMenuProps = {
  activePath: string | null;
  id: string;
  query: string;
  results: readonly ContextMentionSearchResult[];
  status: ContextMentionSearchMenuStatus;
  onResultMouseEnter: (resultIndex: number) => void;
  onResultSelect: (result: ContextMentionSearchResult) => void;
};

export function ContextMentionSearchMenu({
  activePath,
  id,
  query,
  results,
  status,
  onResultMouseEnter,
  onResultSelect,
}: ContextMentionSearchMenuProps): React.JSX.Element {
  return (
    <div
      aria-label="Search files"
      className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      id={id}
      role="listbox"
    >
      {status === "unavailable" ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">File search is unavailable</div>
      ) : query.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">Search files</div>
      ) : results.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {status === "loading" ? "Searching..." : "No matching paths"}
        </div>
      ) : (
        results.map((result, resultIndex) => {
          const isActiveResult = result.path === activePath;

          return (
            <button
              aria-label={result.path}
              aria-selected={isActiveResult}
              className={[
                "flex w-full rounded-sm px-3 py-2 text-left font-mono text-xs leading-5 outline-none",
                isActiveResult ? "bg-muted text-foreground" : "hover:bg-muted/70",
              ].join(" ")}
              id={`${id}-${String(resultIndex)}`}
              key={result.path}
              onMouseDown={(event) => {
                event.preventDefault();
                onResultSelect(result);
              }}
              onMouseEnter={() => {
                onResultMouseEnter(resultIndex);
              }}
              role="option"
              type="button"
            >
              <span className="min-w-0 whitespace-normal break-all">{result.path}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
