import { systemScheduler } from "@mistle/time";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type SessionBootstrapTranscriptPanelProps = {
  animateTail?: boolean;
  animationStepMs?: number;
  className?: string;
  lines: readonly string[];
  simulateStreaming?: boolean;
  streamingStepMs?: number;
  visibleLineCount?: number;
};

export function SessionBootstrapTranscriptPanel({
  animateTail = false,
  animationStepMs = 120,
  className,
  lines,
  simulateStreaming = false,
  streamingStepMs = 220,
  visibleLineCount = 16,
}: SessionBootstrapTranscriptPanelProps): React.JSX.Element {
  const [streamedLineCount, setStreamedLineCount] = useState(simulateStreaming ? 1 : lines.length);
  const streamedLines = useMemo(
    () => lines.slice(0, Math.max(1, streamedLineCount)),
    [lines, streamedLineCount],
  );
  const [revealedLineCount, setRevealedLineCount] = useState(
    animateTail ? 1 : streamedLines.length,
  );
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [contentTranslateYPx, setContentTranslateYPx] = useState(0);
  const [hasEnabledTransitions, setHasEnabledTransitions] = useState(false);
  const transitionEnableHandleRef = useRef<ReturnType<typeof systemScheduler.schedule> | null>(
    null,
  );

  useEffect(() => {
    setStreamedLineCount(simulateStreaming ? 1 : lines.length);
  }, [lines.length, simulateStreaming]);

  useEffect(() => {
    if (!simulateStreaming || streamedLineCount >= lines.length) {
      return;
    }

    const timeout = systemScheduler.schedule(() => {
      setStreamedLineCount((currentCount) =>
        currentCount >= lines.length ? currentCount : currentCount + 1,
      );
    }, streamingStepMs);

    return () => {
      systemScheduler.cancel(timeout);
    };
  }, [lines.length, simulateStreaming, streamedLineCount, streamingStepMs]);

  useEffect(() => {
    setRevealedLineCount(animateTail ? 1 : streamedLines.length);
  }, [animateTail, streamedLines.length]);

  useEffect(() => {
    if (!animateTail || streamedLines.length <= 1) {
      return;
    }

    if (revealedLineCount >= streamedLines.length) {
      return;
    }

    const timeout = systemScheduler.schedule(() => {
      setRevealedLineCount((currentCount) =>
        currentCount >= streamedLines.length ? currentCount : currentCount + 1,
      );
    }, animationStepMs);

    return () => {
      systemScheduler.cancel(timeout);
    };
  }, [animateTail, animationStepMs, revealedLineCount, streamedLines.length]);

  const visibleLines = streamedLines.slice(0, Math.max(1, revealedLineCount));

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) {
      return;
    }

    const nextTranslateYPx = viewport.clientHeight - content.scrollHeight;
    setContentTranslateYPx(nextTranslateYPx);
  }, [visibleLines]);

  useEffect(() => {
    if (hasEnabledTransitions) {
      return;
    }

    if (transitionEnableHandleRef.current !== null) {
      systemScheduler.cancel(transitionEnableHandleRef.current);
    }

    transitionEnableHandleRef.current = systemScheduler.schedule(() => {
      setHasEnabledTransitions(true);
      transitionEnableHandleRef.current = null;
    }, 16);

    return () => {
      if (transitionEnableHandleRef.current !== null) {
        systemScheduler.cancel(transitionEnableHandleRef.current);
        transitionEnableHandleRef.current = null;
      }
    };
  }, [hasEnabledTransitions]);

  return (
    <div
      aria-label="Bootstrap transcript"
      className={`min-h-0 w-full min-w-0 overflow-hidden px-5 py-4 text-stone-400/80${className === undefined ? "" : ` ${className}`}`}
      data-pty-state="bootstrapping"
      style={{
        height: `calc(${String(visibleLineCount)} * 1.55em + 2rem)`,
        WebkitMaskImage:
          "linear-gradient(to bottom, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.6) 4%, rgba(0,0,0,0.82) 11%, rgba(0,0,0,1) 18%, rgba(0,0,0,1) 82%, rgba(0,0,0,0.82) 89%, rgba(0,0,0,0.6) 96%, rgba(0,0,0,0.42) 100%)",
        maskImage:
          "linear-gradient(to bottom, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.6) 4%, rgba(0,0,0,0.82) 11%, rgba(0,0,0,1) 18%, rgba(0,0,0,1) 82%, rgba(0,0,0,0.82) 89%, rgba(0,0,0,0.6) 96%, rgba(0,0,0,0.42) 100%)",
      }}
    >
      <div className="h-full overflow-hidden" ref={viewportRef}>
        <div
          className="font-mono text-[13px] leading-[1.55] will-change-transform"
          ref={contentRef}
          style={{
            transform: `translateY(${String(contentTranslateYPx)}px)`,
            transition: !hasEnabledTransitions
              ? "none"
              : simulateStreaming && !animateTail
                ? `transform ${String(Math.max(streamingStepMs, 320))}ms linear`
                : "transform 220ms ease-out",
          }}
        >
          {visibleLines.map((line, index) => (
            <div className="whitespace-pre-wrap break-words" key={`${index}:${line}`}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
