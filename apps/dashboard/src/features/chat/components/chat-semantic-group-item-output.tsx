import type { ChatSemanticGroupEntry, ChatSemanticGroupKind } from "../chat-types.js";
import { getCodeFenceLanguage, isMarkdownPath } from "../code-fence-language.js";
import { ChatDiffView } from "./chat-diff-view.js";
import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type ChatSemanticGroupItemOutputProps = {
  item: ChatSemanticGroupEntry["items"][number];
  semanticKind: ChatSemanticGroupKind;
};

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string | null;
};

function getReadRenderMarkdown(input: { path: string; output: string }): string | null {
  if (isMarkdownPath(input.path)) {
    return input.output;
  }

  const codeFenceLanguage = getCodeFenceLanguage(input.path);
  if (codeFenceLanguage === null) {
    return null;
  }

  return ["```" + codeFenceLanguage, input.output, "```"].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWebSearchResults(output: string): readonly WebSearchResult[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const results = parsed["results"];
  if (!Array.isArray(results)) {
    return null;
  }

  return results.flatMap((result): readonly WebSearchResult[] => {
    if (!isRecord(result)) {
      return [];
    }

    const title = result["title"];
    const url = result["url"];
    const snippet = result["snippet"];
    if (typeof title !== "string" || typeof url !== "string") {
      return [];
    }

    return [
      {
        title,
        url,
        snippet: typeof snippet === "string" ? snippet : null,
      },
    ];
  });
}

export function ChatSemanticGroupItemOutput({
  item,
  semanticKind,
}: ChatSemanticGroupItemOutputProps): React.JSX.Element | null {
  if (item.output === null || item.output.length === 0) {
    return null;
  }

  const readRenderMarkdown =
    semanticKind === "exploring" && item.label === "Read" && item.sourcePath !== undefined
      ? getReadRenderMarkdown({
          path: item.sourcePath,
          output: item.output,
        })
      : null;

  if (readRenderMarkdown !== null) {
    return (
      <div className="mt-1">
        <ChatMarkdownMessage
          className="text-xs leading-5"
          contentClassName="[&_[data-streamdown=code-block]]:my-0 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block]]:opacity-85 [&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-body]]:rounded-md [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-muted/25 [&_[data-streamdown=code-block-body]]:shadow-none [&_[data-streamdown=code-block-body]]:px-0 [&_[data-streamdown=code-block-body]]:py-2 [&_[data-streamdown=code-block-body]>pre]:my-0 [&_[data-streamdown=code-block-body]>pre]:border-0 [&_[data-streamdown=code-block-body]>pre]:px-2 [&_[data-streamdown=code-block-body]>pre]:text-[13px] [&_[data-streamdown=code-block-body]>pre]:leading-5"
          isStreaming={item.status === "streaming"}
          text={readRenderMarkdown}
        />
      </div>
    );
  }

  if (semanticKind === "searching-web") {
    const results = parseWebSearchResults(item.output);
    if (results !== null) {
      return (
        <div className="mt-1 space-y-1.5">
          {results.map((result) => (
            <div className="border-l-border/50 border-l pl-3" key={result.url}>
              <a
                className="block truncate text-sm leading-5 hover:underline"
                href={result.url}
                rel="noreferrer"
                target="_blank"
              >
                {result.title}
              </a>
              <p className="text-muted-foreground truncate text-xs leading-5">{result.url}</p>
              {result.snippet === null ? null : (
                <p className="text-muted-foreground/85 mt-0.5 text-xs leading-5">
                  {result.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      );
    }
  }

  if (semanticKind === "making-edits" && item.detail !== null && !item.detail.includes(", ")) {
    return <ChatDiffView diff={item.output} path={item.detail} />;
  }

  if (semanticKind === "running-commands") {
    return (
      <pre
        className="bg-muted/25 mt-1 max-h-64 overflow-auto rounded-md px-2 py-2 text-[13px] leading-5 whitespace-pre-wrap opacity-85"
        data-semantic-output="command-log"
      >
        {item.output}
      </pre>
    );
  }

  return (
    <pre className="bg-muted mt-1 overflow-x-auto rounded-md p-3 text-xs leading-5 whitespace-pre-wrap">
      {item.output}
    </pre>
  );
}
