import { Streamdown } from "streamdown";

import { StreamdownPlugins } from "./streamdown-plugins.js";

type ChatMarkdownMessageProps = {
  className?: string;
  contentClassName?: string;
  isStreaming: boolean;
  text: string;
};

export function ChatMarkdownMessage(props: ChatMarkdownMessageProps): React.JSX.Element {
  return (
    <div className={["min-w-0 text-[15px] leading-7", props.className].filter(Boolean).join(" ")}>
      <Streamdown
        animated
        className={[
          "break-words [&_h1]:mb-4 [&_h1]:mt-8 [&_h1]:text-xl [&_h2]:mb-3 [&_h2]:mt-7 [&_h2]:text-lg [&_h3]:mb-3 [&_h3]:mt-6 [&_h3]:text-base [&_ol]:my-4 [&_ol]:pl-6 [&_p]:my-4 [&_pre]:my-4 [&_pre]:font-mono [&_code]:font-mono [&_table]:my-4 [&_ul]:my-4 [&_ul]:pl-6 [&_li]:my-1 first:[&_p:first-child]:mt-0 last:[&_p:last-child]:mb-0",
          props.contentClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        controls={false}
        isAnimating={props.isStreaming}
        mode={props.isStreaming ? "streaming" : "static"}
        plugins={StreamdownPlugins}
      >
        {props.text}
      </Streamdown>
    </div>
  );
}
