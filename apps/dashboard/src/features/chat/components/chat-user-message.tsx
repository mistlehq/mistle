import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type ChatUserMessageProps = {
  text: string;
};

export function ChatUserMessage(props: ChatUserMessageProps): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="bg-muted max-w-[38rem] rounded-2xl px-3 py-1">
        <ChatMarkdownMessage isStreaming={false} text={props.text} />
      </div>
    </div>
  );
}
