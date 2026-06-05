import { Button } from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import type { ChatAttachment } from "../chat-types.js";
import { presentTriggerInput } from "../trigger-input-presentation.js";
import type { StructuredTriggerInputPresentation } from "../trigger-input-presentation.js";
import type { StructuredTriggerInputSegment } from "../trigger-input-presentation.js";
import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type JsonSyntaxToken = {
  kind: "boolean" | "key" | "null" | "number" | "plain" | "string";
  text: string;
};

type ChatUserMessageProps = {
  attachments?: readonly ChatAttachment[];
  formatTriggerInput?: boolean;
  label?: string;
  labelAction?: {
    ariaLabel: string;
    onClick: () => void;
  };
  text: string;
};

export function ChatUserMessage(props: ChatUserMessageProps): React.JSX.Element {
  const attachments = props.attachments ?? [];
  const presentation = props.formatTriggerInput ? presentTriggerInput(props.text) : null;

  return (
    <div className="flex justify-end" data-chat-user-message>
      {props.label === undefined ? null : (
        <div
          className="text-muted-foreground mr-2 mt-[9px] flex h-5 items-center self-start text-xs font-medium uppercase tracking-[0.14em] md:h-6"
          // Match the first message line box (leading-5 / md:leading-6) and offset it by the
          // bubble's top padding, with a small optical nudge, so the label centers against the
          // first row.
        >
          <span>{props.label}</span>
        </div>
      )}
      <div
        className="bg-muted flex flex-col rounded-2xl px-3 py-2"
        data-chat-user-message-bubble
        style={{
          gap: "var(--chat-user-message-content-gap, 0.5rem)",
          maxWidth: "var(--chat-user-message-max-width, 38rem)",
        }}
      >
        {presentation !== null ? (
          <StructuredTriggerInputMessage presentation={presentation} />
        ) : props.text.length === 0 ? null : (
          <ChatMarkdownMessage isStreaming={false} preserveSoftLineBreaks text={props.text} />
        )}
        {attachments.length === 0 ? null : (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                className="bg-background/70 rounded-full px-2.5 py-1 text-xs"
                key={attachment.path}
              >
                {attachment.kind === "image" ? "Image" : "File"}: {attachment.name}
              </div>
            ))}
          </div>
        )}
      </div>
      {props.labelAction === undefined ? null : (
        <Button
          aria-label={props.labelAction.ariaLabel}
          className="ml-2 mt-1 self-start"
          onClick={props.labelAction.onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <TrashIcon aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}

function StructuredTriggerInputMessage(props: {
  presentation: StructuredTriggerInputPresentation;
}): React.JSX.Element {
  return (
    <div className="min-w-0 space-y-2" data-chat-trigger-input-presentation>
      {props.presentation.inlineSegments.map((segment, index) => (
        <StructuredTriggerInputSegmentView key={index} segment={segment} />
      ))}
    </div>
  );
}

function StructuredTriggerInputSegmentView(props: {
  segment: StructuredTriggerInputSegment;
}): React.JSX.Element {
  if (props.segment.kind === "text") {
    return (
      <ChatMarkdownMessage isStreaming={false} preserveSoftLineBreaks text={props.segment.text} />
    );
  }

  return <JsonBlock text={props.segment.text} />;
}

function JsonBlock(props: { text: string }): React.JSX.Element {
  return (
    <pre className="bg-background/90 border-border/70 shadow-xs max-h-72 overflow-auto rounded-md border p-2 text-xs leading-5 whitespace-pre-wrap">
      {tokenizeJson(props.text).map((token, index) => (
        <JsonToken key={index} token={token} />
      ))}
    </pre>
  );
}

function JsonToken(props: { token: JsonSyntaxToken }): React.JSX.Element {
  if (props.token.kind === "plain") {
    return <>{props.token.text}</>;
  }

  const className = getJsonTokenClassName(props.token.kind);
  return (
    <span className={className} data-chat-json-token={props.token.kind}>
      {props.token.text}
    </span>
  );
}

function getJsonTokenClassName(kind: Exclude<JsonSyntaxToken["kind"], "plain">): string {
  if (kind === "key") {
    return "text-sky-700 dark:text-sky-300";
  }
  if (kind === "string") {
    return "text-emerald-700 dark:text-emerald-300";
  }
  if (kind === "number") {
    return "text-violet-700 dark:text-violet-300";
  }
  if (kind === "boolean") {
    return "text-amber-700 dark:text-amber-300";
  }

  return "text-muted-foreground italic";
}

function tokenizeJson(text: string): readonly JsonSyntaxToken[] {
  const tokens: JsonSyntaxToken[] = [];
  const tokenPattern =
    /("(?:\\.|[^"\\])*")(\s*:)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;
  let currentIndex = 0;
  let match = tokenPattern.exec(text);

  while (match !== null) {
    const matchText = match[0];
    if (match.index > currentIndex) {
      tokens.push({ kind: "plain", text: text.slice(currentIndex, match.index) });
    }

    const keySuffix = match[2];
    if (keySuffix === undefined) {
      tokens.push({ kind: getJsonValueTokenKind(matchText), text: matchText });
    } else {
      tokens.push({
        kind: "key",
        text: matchText.slice(0, matchText.length - keySuffix.length),
      });
      tokens.push({ kind: "plain", text: keySuffix });
    }

    currentIndex = match.index + matchText.length;
    match = tokenPattern.exec(text);
  }

  if (currentIndex < text.length) {
    tokens.push({ kind: "plain", text: text.slice(currentIndex) });
  }

  return tokens;
}

function getJsonValueTokenKind(text: string): Exclude<JsonSyntaxToken["kind"], "key" | "plain"> {
  if (text === "true" || text === "false") {
    return "boolean";
  }
  if (text === "null") {
    return "null";
  }
  if (text.startsWith('"')) {
    return "string";
  }

  return "number";
}
