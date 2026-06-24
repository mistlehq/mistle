import { useMemo, useState } from "react";
import type { ComponentProps, JSX } from "react";
import { Block, defaultRehypePlugins, defaultRemarkPlugins, Streamdown } from "streamdown";
import type { BlockProps, StreamdownProps } from "streamdown";

import { ChatExternalLinkDialog } from "./chat-external-link-dialog.js";
import { isTrustedChatLink } from "./chat-link-safety.js";
import { StreamdownPlugins } from "./streamdown-plugins.js";

type ChatMarkdownMessageProps = {
  className?: string;
  contentClassName?: string;
  isStreaming: boolean;
  preserveSoftLineBreaks?: boolean;
  text: string;
};

type ChatMarkdownContentProps = {
  contentClassName: string | undefined;
  preserveSoftLineBreaks: boolean | undefined;
  text: string;
};

type StreamingChatMarkdownContentProps = ChatMarkdownContentProps;

type BaseChatMarkdownContentProps = ChatMarkdownContentProps & {
  isStreaming: boolean;
  SerializedStreamingBlock?: NonNullable<StreamdownProps["BlockComponent"]>;
};

type MarkdownTreeNode = {
  children?: MarkdownTreeNode[];
  type: string;
  value?: string;
};

type RehypePlugin = Exclude<StreamdownProps["rehypePlugins"], undefined>[number];

type MarkdownHtmlNode = {
  children?: MarkdownHtmlNode[];
  properties?: Record<string, boolean | number | string>;
  tagName?: string;
  type: string;
  value?: string;
};

type SerializedStreamingAnimationState = {
  animatedChunkIndex: number;
  previousBlockTextLengths: Map<number, number>;
  visibleChunkKeys: Set<string>;
};

type AnimatedTextReplacement = {
  firstNewDelayMs: number | null;
  nodes: MarkdownHtmlNode[];
};

type SerializedStreamingAnimationBlockState = {
  blockIndex: number;
  previousTextLength: number;
  textLength: number;
};

type SerializedStreamingAnimationPlugin = {
  prepareBlock: (blockIndex: number) => SerializedStreamingAnimationBlockPlugin;
};

type SerializedStreamingAnimationBlockPlugin = {
  rehypePlugin: RehypePlugin;
};

const SerializedStreamingAnimationExcludedTags = new Set([
  "annotation",
  "code",
  "math",
  "pre",
  "svg",
]);
const SerializedStreamingAnimationDurationMs = 150;
const SerializedStreamingAnimationStaggerMs = 40;
const FirstMarkdownBlockIndex = 0;
let nextSerializedStreamingAnimationPluginId = 0;

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

function createSerializedStreamingAnimationPlugin(): SerializedStreamingAnimationPlugin {
  const state: SerializedStreamingAnimationState = {
    animatedChunkIndex: 0,
    previousBlockTextLengths: new Map(),
    visibleChunkKeys: new Set(),
  };

  return {
    prepareBlock: (blockIndex: number) => {
      if (blockIndex === FirstMarkdownBlockIndex) {
        state.animatedChunkIndex = 0;
      }

      const blockState: SerializedStreamingAnimationBlockState = {
        blockIndex,
        previousTextLength: state.previousBlockTextLengths.get(blockIndex) ?? 0,
        textLength: 0,
      };

      const pluginId = nextSerializedStreamingAnimationPluginId;
      nextSerializedStreamingAnimationPluginId += 1;
      function serializedStreamingAnimationPlugin(): (tree: MarkdownHtmlNode) => void {
        return function transformSerializedStreamingAnimation(tree: MarkdownHtmlNode): void {
          animateMarkdownHtmlNodeChildren(tree, state, blockState);
        };
      }
      Object.defineProperty(serializedStreamingAnimationPlugin, "name", {
        value: `serializedStreamingAnimation$${String(pluginId)}`,
      });

      return {
        rehypePlugin: serializedStreamingAnimationPlugin,
      };
    },
  };
}

function animateMarkdownHtmlNodeChildren(
  node: MarkdownHtmlNode,
  state: SerializedStreamingAnimationState,
  blockState: SerializedStreamingAnimationBlockState,
): number | null {
  const children = node.children;
  if (children === undefined) {
    return null;
  }

  let firstNewDelayMs: number | null = null;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) {
      continue;
    }

    if (child.type === "text" && child.value !== undefined) {
      const replacement = createAnimatedTextNodes(child.value, state, blockState);
      children.splice(index, 1, ...replacement.nodes);
      index += replacement.nodes.length - 1;
      firstNewDelayMs = getEarlierDelay(firstNewDelayMs, replacement.firstNewDelayMs);
      continue;
    }

    if (
      child.type === "element" &&
      child.tagName !== undefined &&
      SerializedStreamingAnimationExcludedTags.has(child.tagName)
    ) {
      continue;
    }

    const childFirstNewDelayMs = animateMarkdownHtmlNodeChildren(child, state, blockState);
    if (child.tagName === "li" && childFirstNewDelayMs !== null) {
      applySerializedStreamingAnimationToNode(child, {
        delayMs: childFirstNewDelayMs,
        durationMs: 0,
      });
    }
    firstNewDelayMs = getEarlierDelay(firstNewDelayMs, childFirstNewDelayMs);
  }

  return firstNewDelayMs;
}

function createAnimatedTextNodes(
  text: string,
  state: SerializedStreamingAnimationState,
  blockState: SerializedStreamingAnimationBlockState,
): AnimatedTextReplacement {
  if (text.trim().length === 0) {
    blockState.textLength += text.length;
    recordRenderedBlockTextLength(state, blockState);
    return {
      firstNewDelayMs: null,
      nodes: [{ type: "text", value: text }],
    };
  }

  let firstNewDelayMs: number | null = null;
  const nodes = splitTextIntoAnimationChunks(text).map((chunk) => {
    const chunkStartIndex = blockState.textLength;
    blockState.textLength += chunk.length;

    if (chunk.trim().length === 0) {
      return { type: "text", value: chunk };
    }

    const chunkKey = createStreamingAnimationChunkKey(blockState, chunkStartIndex, chunk);
    const alreadyVisible =
      chunkStartIndex < blockState.previousTextLength || state.visibleChunkKeys.has(chunkKey);
    state.visibleChunkKeys.add(chunkKey);
    const delayMs = alreadyVisible
      ? 0
      : state.animatedChunkIndex * SerializedStreamingAnimationStaggerMs;
    if (!alreadyVisible) {
      state.animatedChunkIndex += 1;
      firstNewDelayMs = getEarlierDelay(firstNewDelayMs, delayMs);
    }

    return {
      children: [{ type: "text", value: chunk }],
      properties: {
        "data-sd-animate": true,
        style: createSerializedStreamingAnimationStyle({
          delayMs,
          durationMs: alreadyVisible ? 0 : SerializedStreamingAnimationDurationMs,
        }),
      },
      tagName: "span",
      type: "element",
    };
  });

  recordRenderedBlockTextLength(state, blockState);

  return {
    firstNewDelayMs,
    nodes,
  };
}

function createStreamingAnimationChunkKey(
  blockState: SerializedStreamingAnimationBlockState,
  chunkStartIndex: number,
  chunk: string,
): string {
  return [String(blockState.blockIndex), String(chunkStartIndex), chunk].join(":");
}

function recordRenderedBlockTextLength(
  state: SerializedStreamingAnimationState,
  blockState: SerializedStreamingAnimationBlockState,
): void {
  const previousTextLength = state.previousBlockTextLengths.get(blockState.blockIndex) ?? 0;
  state.previousBlockTextLengths.set(
    blockState.blockIndex,
    Math.max(previousTextLength, blockState.textLength),
  );
}

function splitTextIntoAnimationChunks(text: string): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  let currentChunkIsWhitespace: boolean | null = null;

  for (const character of text) {
    const characterIsWhitespace = /\s/.test(character);
    if (currentChunkIsWhitespace !== null && characterIsWhitespace !== currentChunkIsWhitespace) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    currentChunk += character;
    currentChunkIsWhitespace = characterIsWhitespace;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function applySerializedStreamingAnimationToNode(
  node: MarkdownHtmlNode,
  input: {
    delayMs: number;
    durationMs: number;
  },
): void {
  node.properties = {
    ...node.properties,
    "data-sd-animate": true,
    style: createSerializedStreamingAnimationStyle(input),
  };
}

function createSerializedStreamingAnimationStyle(input: {
  delayMs: number;
  durationMs: number;
}): string {
  return [
    "--sd-animation:sd-fadeIn",
    `--sd-duration:${String(input.durationMs)}ms`,
    "--sd-easing:ease",
    `--sd-delay:${String(input.delayMs)}ms`,
  ].join(";");
}

function getEarlierDelay(leftDelayMs: number | null, rightDelayMs: number | null): number | null {
  if (leftDelayMs === null) {
    return rightDelayMs;
  }

  if (rightDelayMs === null) {
    return leftDelayMs;
  }

  return Math.min(leftDelayMs, rightDelayMs);
}

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
      {props.isStreaming ? (
        <StreamingChatMarkdownContent
          contentClassName={props.contentClassName}
          preserveSoftLineBreaks={props.preserveSoftLineBreaks}
          text={props.text}
        />
      ) : (
        <BaseChatMarkdownContent
          contentClassName={props.contentClassName}
          isStreaming={false}
          preserveSoftLineBreaks={props.preserveSoftLineBreaks}
          text={props.text}
        />
      )}
    </div>
  );
}

function StreamingChatMarkdownContent(props: StreamingChatMarkdownContentProps): JSX.Element {
  const [streamingAnimationPlugin] = useState(createSerializedStreamingAnimationPlugin);
  const SerializedStreamingBlock = useMemo(() => {
    return function SerializedStreamingBlock(blockProps: BlockProps): JSX.Element {
      const blockAnimationPlugin = streamingAnimationPlugin.prepareBlock(blockProps.index);
      const rehypePlugins =
        blockProps.rehypePlugins === undefined
          ? [blockAnimationPlugin.rehypePlugin]
          : [...blockProps.rehypePlugins, blockAnimationPlugin.rehypePlugin];

      return <Block {...blockProps} rehypePlugins={rehypePlugins} />;
    };
  }, [streamingAnimationPlugin]);

  return (
    <BaseChatMarkdownContent
      contentClassName={props.contentClassName}
      isStreaming
      preserveSoftLineBreaks={props.preserveSoftLineBreaks}
      SerializedStreamingBlock={SerializedStreamingBlock}
      text={props.text}
    />
  );
}

function BaseChatMarkdownContent(props: BaseChatMarkdownContentProps): JSX.Element {
  return (
    <Streamdown
      className={[
        "chat-markdown-content max-md:[&_[data-streamdown=list-item]]:leading-6 max-md:[&_[data-streamdown=list-item]>p]:leading-6 max-md:[&_p]:leading-6",
        props.contentClassName,
      ]
        .filter(Boolean)
        .join(" ")}
      isAnimating={props.isStreaming}
      linkSafety={{
        enabled: true,
        onLinkCheck: isTrustedChatLink,
        renderModal: (modalProps: ComponentProps<typeof ChatExternalLinkDialog>) => (
          <ChatExternalLinkDialog {...modalProps} />
        ),
      }}
      mode={props.isStreaming ? "streaming" : "static"}
      plugins={StreamdownPlugins}
      {...(props.SerializedStreamingBlock === undefined
        ? {}
        : {
            BlockComponent: props.SerializedStreamingBlock,
            rehypePlugins: Object.values(defaultRehypePlugins),
          })}
      {...(props.preserveSoftLineBreaks === true
        ? { remarkPlugins: RemarkPluginsPreservingSoftBreaks }
        : {})}
    >
      {props.text}
    </Streamdown>
  );
}
