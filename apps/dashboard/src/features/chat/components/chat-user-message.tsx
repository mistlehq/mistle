import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type ChatUserMessageProps = {
  attachments?: readonly {
    kind: "image";
    path: string;
    name: string;
  }[];
  text: string;
};

export function ChatUserMessage(props: ChatUserMessageProps): React.JSX.Element {
  const attachments = props.attachments ?? [];

  return (
    <div className="flex justify-end" data-chat-user-message>
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
                Image attached: {attachment.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
