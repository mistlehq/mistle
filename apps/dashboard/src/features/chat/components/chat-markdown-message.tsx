import type { JSX } from "react";
import { Streamdown } from "streamdown";

import { StreamdownPlugins } from "./streamdown-plugins.js";

type ChatMarkdownMessageProps = {
  className?: string;
  contentClassName?: string;
  isStreaming: boolean;
  text: string;
};

export function ChatMarkdownMessage(props: ChatMarkdownMessageProps): JSX.Element {
  return (
    <div
      className={[
        "chat-markdown-message min-w-0 text-sm leading-5 md:text-[15px] md:leading-7",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Streamdown
        animated
        className={["chat-markdown-content", props.contentClassName].filter(Boolean).join(" ")}
        isAnimating={props.isStreaming}
        mode={props.isStreaming ? "streaming" : "static"}
        plugins={StreamdownPlugins}
      >
        {props.text}
      </Streamdown>
    </div>
  );
}
