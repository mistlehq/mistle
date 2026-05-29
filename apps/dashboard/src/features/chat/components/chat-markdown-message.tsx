import type { ComponentProps, JSX } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";

import { ChatExternalLinkDialog } from "./chat-external-link-dialog.js";
import { StreamdownPlugins } from "./streamdown-plugins.js";

type ChatMarkdownMessageProps = {
  className?: string;
  contentClassName?: string;
  isStreaming: boolean;
  preserveSoftLineBreaks?: boolean;
  text: string;
};

type MarkdownTreeNode = {
  children?: MarkdownTreeNode[];
  type: string;
  value?: string;
};

function preserveSoftBreaksRemarkPlugin(): (tree: MarkdownTreeNode) => void {
  return function preserveSoftBreaks(tree: MarkdownTreeNode): void {
    rewriteSoftBreaks(tree);
  };
}

function rewriteSoftBreaks(node: MarkdownTreeNode): void {
  const children = node.children;
  if (children === undefined) {
    return;
  }

  node.children = children.flatMap((child) => {
    if (child.type !== "text" || child.value === undefined || !child.value.includes("\n")) {
      rewriteSoftBreaks(child);
      return [child];
    }

    const segments = child.value.split("\n");
    const rewrittenNodes: MarkdownTreeNode[] = [];

    for (const [index, segment] of segments.entries()) {
      if (index > 0) {
        rewrittenNodes.push({ type: "break" });
      }
      if (segment.length > 0) {
        rewrittenNodes.push({ type: "text", value: segment });
      }
    }

    return rewrittenNodes;
  });
}

const RemarkPluginsPreservingSoftBreaks = [
  ...Object.values(defaultRemarkPlugins),
  preserveSoftBreaksRemarkPlugin,
];

export function ChatMarkdownMessage(props: ChatMarkdownMessageProps): JSX.Element {
  return (
    <div
      className={[
        "chat-markdown-message min-w-0 text-sm leading-5 md:text-[15px] md:leading-6",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Streamdown
        animated
        className={[
          "chat-markdown-content max-md:[&_[data-streamdown=list-item]]:leading-6 max-md:[&_[data-streamdown=list-item]>p]:leading-6 max-md:[&_p]:leading-6",
          props.contentClassName,
        ]
          .filter(Boolean)
          .join(" ")}
        isAnimating={props.isStreaming}
        linkSafety={{
          enabled: true,
          renderModal: (modalProps: ComponentProps<typeof ChatExternalLinkDialog>) => (
            <ChatExternalLinkDialog {...modalProps} />
          ),
        }}
        mode={props.isStreaming ? "streaming" : "static"}
        plugins={StreamdownPlugins}
        {...(props.preserveSoftLineBreaks === true
          ? { remarkPlugins: RemarkPluginsPreservingSoftBreaks }
          : {})}
      >
        {props.text}
      </Streamdown>
    </div>
  );
}
