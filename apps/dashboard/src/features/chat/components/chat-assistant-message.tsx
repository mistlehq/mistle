import { ChatMarkdownMessage } from "./chat-markdown-message.js";

type ChatAssistantMessageProps = {
  isStreaming: boolean;
  text: string;
};

export function ChatAssistantMessage(props: ChatAssistantMessageProps): React.JSX.Element {
  return <ChatMarkdownMessage isStreaming={props.isStreaming} text={props.text} />;
}
