import { Button } from "@mistle/ui";
import { TrashIcon } from "@phosphor-icons/react";

import type { ChatAttachment } from "../chat-types.js";
import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type ChatUserMessageProps = {
  attachments?: readonly ChatAttachment[];
  label?: string;
  labelAction?: {
    ariaLabel: string;
    onClick: () => void;
  };
  text: string;
};

export function ChatUserMessage(props: ChatUserMessageProps): React.JSX.Element {
  const attachments = props.attachments ?? [];

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
        {props.text.length === 0 ? null : (
          <ChatMarkdownMessage isStreaming={false} text={props.text} />
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
