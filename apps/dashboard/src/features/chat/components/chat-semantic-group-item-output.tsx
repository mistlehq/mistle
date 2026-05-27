import type { ChatSemanticGroupEntry, ChatSemanticGroupKind } from "../chat-types.js";
import { getCodeFenceLanguage, isMarkdownPath } from "../code-fence-language.js";
import { ChatDiffView } from "./chat-diff-view.js";
import { ChatExternalLink } from "./chat-external-link.js";
import { canDisplaySingleFilePatch } from "./chat-file-change-diff.js";
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

function ChatSemanticGroupProseOutput({
  isRootOutput,
  text,
}: {
  isRootOutput: boolean;
  text: string;
}): React.JSX.Element {
  return (
    <p
      className="text-muted-foreground text-sm whitespace-pre-wrap"
      {...(isRootOutput ? { "data-chat-semantic-group-output": true } : {})}
      style={{
        lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
        ...(isRootOutput ? { marginTop: "0px" } : {}),
      }}
    >
      {text}
    </p>
  );
}

export function ChatSemanticGroupItemOutput({
  item,
  semanticKind,
}: ChatSemanticGroupItemOutputProps): React.JSX.Element | null {
  if (
    (item.output === null || item.output.length === 0) &&
    (semanticKind !== "generic" || item.detail === null || item.detail.length === 0)
  ) {
    return null;
  }

  if (semanticKind === "generic") {
    return (
      <div
        className="space-y-2"
        data-chat-semantic-group-output
        style={{
          marginTop: "0px",
        }}
      >
        {item.detail === null ? null : (
          <ChatSemanticGroupProseOutput isRootOutput={false} text={item.detail} />
        )}
        {item.output === null || item.output.length === 0 ? null : (
          <pre
            className="bg-muted overflow-x-auto rounded-md text-xs whitespace-pre-wrap"
            style={{
              lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
              padding: "var(--chat-semantic-group-output-padding, 0.75rem)",
            }}
          >
            {item.output}
          </pre>
        )}
      </div>
    );
  }

  const output = item.output;
  if (output === null) {
    return null;
  }

  const readRenderMarkdown =
    semanticKind === "exploring" && item.label === "Read" && item.sourcePath !== undefined
      ? getReadRenderMarkdown({
          path: item.sourcePath,
          output,
        })
      : null;

  if (readRenderMarkdown !== null) {
    return (
      <div
        data-chat-semantic-group-output
        style={{
          marginTop: "0px",
          lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
        }}
      >
        <ChatMarkdownMessage
          className="text-xs"
          contentClassName="[&_[data-streamdown=code-block]]:my-0 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block]]:opacity-85 [&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-body]]:rounded-md [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-muted/25 [&_[data-streamdown=code-block-body]]:shadow-none [&_[data-streamdown=code-block-body]]:px-0 [&_[data-streamdown=code-block-body]]:py-2 [&_[data-streamdown=code-block-body]>pre]:my-0 [&_[data-streamdown=code-block-body]>pre]:border-0 [&_[data-streamdown=code-block-body]>pre]:px-2 [&_[data-streamdown=code-block-body]>pre]:text-[13px] [&_[data-streamdown=code-block-body]>pre]:leading-5"
          isStreaming={item.status === "streaming"}
          text={readRenderMarkdown}
        />
      </div>
    );
  }

  if (semanticKind === "searching-web") {
    const results = parseWebSearchResults(output);
    if (results !== null) {
      return (
        <div
          data-chat-semantic-group-output
          style={{
            marginTop: "0px",
          }}
        >
          {results.map((result) => (
            <div
              className="border-l-border/50 border-l"
              data-chat-semantic-group-output-result
              key={result.url}
              style={{
                marginTop: "var(--chat-semantic-group-output-stack-gap, 0.375rem)",
                paddingLeft: "var(--chat-semantic-group-output-padding, 0.75rem)",
              }}
            >
              <ChatExternalLink
                className="block w-full truncate text-left text-sm"
                href={result.url}
                style={{
                  lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
                }}
              >
                {result.title}
              </ChatExternalLink>
              <p
                className="text-muted-foreground truncate text-xs"
                style={{
                  lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
                }}
              >
                {result.url}
              </p>
              {result.snippet === null ? null : (
                <p
                  className="text-muted-foreground/85 mt-0.5 text-xs"
                  style={{
                    lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
                  }}
                >
                  {result.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      );
    }
  }

  if (semanticKind === "thinking") {
    return <ChatSemanticGroupProseOutput isRootOutput text={output} />;
  }

  if (
    semanticKind === "making-edits" &&
    item.detail !== null &&
    !item.detail.includes(", ") &&
    canDisplaySingleFilePatch({ diff: output, path: item.detail })
  ) {
    return <ChatDiffView diff={output} path={item.detail} />;
  }

  if (semanticKind === "running-commands") {
    return (
      <pre
        className="bg-muted/25 max-h-64 overflow-auto rounded-md text-[13px] whitespace-pre-wrap opacity-85"
        data-chat-semantic-group-output
        data-semantic-output="command-log"
        style={{
          lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
          marginTop: "0px",
          padding: "var(--chat-semantic-group-output-padding, 0.75rem)",
        }}
      >
        {item.output}
      </pre>
    );
  }

  return (
    <pre
      className="bg-muted overflow-x-auto rounded-md text-xs whitespace-pre-wrap"
      data-chat-semantic-group-output
      style={{
        lineHeight: "var(--chat-semantic-group-output-leading, 1.25rem)",
        marginTop: "0px",
        padding: "var(--chat-semantic-group-output-padding, 0.75rem)",
      }}
    >
      {output}
    </pre>
  );
}
