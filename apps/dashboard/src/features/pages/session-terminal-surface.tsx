import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { cn } from "@mistle/ui";

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";

const FALLBACK_PTY_COLS = 120;
const FALLBACK_PTY_ROWS = 20;
const TERMINAL_SURFACE_COLOR = "#FFFFFF";
const INITIAL_PTY_DIMENSIONS = {
  cols: FALLBACK_PTY_COLS,
  rows: FALLBACK_PTY_ROWS,
};

type SessionTerminalSurfaceProps = {
  isVisible: boolean;
  lifecycleState: string;
  outputChunks: readonly Uint8Array[];
  onResize: (dimensions: { cols: number; rows: number }) => Promise<void>;
  onWriteInput: (input: string) => Promise<void>;
};

function resolveTerminalDimensions(fitAddon: FitAddon | null): { cols: number; rows: number } {
  const proposedDimensions = fitAddon?.proposeDimensions();
  if (proposedDimensions === undefined) {
    return {
      cols: FALLBACK_PTY_COLS,
      rows: FALLBACK_PTY_ROWS,
    };
  }

  return {
    cols: Math.max(2, proposedDimensions.cols),
    rows: Math.max(1, proposedDimensions.rows),
  };
}

export function SessionTerminalSurface({
  isVisible,
  lifecycleState,
  outputChunks,
  onResize,
  onWriteInput,
}: SessionTerminalSurfaceProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lifecycleStateRef = useRef(lifecycleState);
  const lastRenderedChunkCountRef = useRef(0);
  const outputDecoderRef = useRef(new TextDecoder());

  lifecycleStateRef.current = lifecycleState;

  const fitTerminal = useCallback((): void => {
    const fitAddon = fitAddonRef.current;
    if (fitAddon === null) {
      return;
    }

    fitAddon.fit();
  }, []);

  const resizePtyToTerminal = useCallback((): void => {
    const nextDimensions = resolveTerminalDimensions(fitAddonRef.current);
    void onResize(nextDimensions).catch(() => {
      // PTY resize is best-effort while the terminal surface is mounting or disconnecting.
    });
  }, [onResize]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      fontFamily:
        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 2_000,
      theme: {
        background: TERMINAL_SURFACE_COLOR,
        foreground: "#1F2937",
        cursor: "#111827",
        cursorAccent: TERMINAL_SURFACE_COLOR,
        selectionBackground: "rgba(245, 158, 11, 0.22)",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    lastRenderedChunkCountRef.current = 0;
    outputDecoderRef.current = new TextDecoder();

    fitTerminal();

    const dataDisposable = terminal.onData((data) => {
      if (lifecycleStateRef.current !== SandboxPtyStates.OPEN) {
        return;
      }

      void onWriteInput(data).catch(() => {
        // The lifecycle state and toolbar status surface the PTY error.
      });
    });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitTerminal();

            if (lifecycleStateRef.current === SandboxPtyStates.OPEN) {
              resizePtyToTerminal();
            }
          });

    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      dataDisposable.dispose();
      terminal.dispose();
      fitAddonRef.current = null;
      terminalRef.current = null;
      lastRenderedChunkCountRef.current = 0;
      outputDecoderRef.current = new TextDecoder();
    };
  }, [fitTerminal, isVisible, onWriteInput, resizePtyToTerminal]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const terminal = terminalRef.current;
    if (terminal === null) {
      return;
    }

    const nextChunkCount = outputChunks.length;

    if (nextChunkCount < lastRenderedChunkCountRef.current) {
      terminal.reset();
      lastRenderedChunkCountRef.current = 0;
      outputDecoderRef.current = new TextDecoder();
    }

    const nextChunks = outputChunks.slice(lastRenderedChunkCountRef.current);

    for (const chunk of nextChunks) {
      terminal.write(outputDecoderRef.current.decode(chunk, { stream: true }));
    }

    lastRenderedChunkCountRef.current = nextChunkCount;
  }, [isVisible, outputChunks]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null || !isVisible) {
      return;
    }

    if (lifecycleState === SandboxPtyStates.OPEN) {
      terminal.options.cursorBlink = true;
      terminal.options.cursorInactiveStyle = "outline";
      fitTerminal();
      resizePtyToTerminal();
      terminal.focus();
    } else {
      terminal.options.cursorBlink = false;
      terminal.options.cursorInactiveStyle = "none";
    }
  }, [fitTerminal, isVisible, lifecycleState, resizePtyToTerminal]);

  if (!isVisible) {
    return null;
  }

  const isLive = lifecycleState === SandboxPtyStates.OPEN;
  const hasOutput = outputChunks.length > 0;

  return (
    <div className="relative min-h-0 flex-1 px-3 py-3">
      <div
        className={cn(
          "relative h-full w-full transition-[opacity] duration-150",
          isLive ? "opacity-100" : hasOutput ? "opacity-[0.52]" : "opacity-[0.38]",
          !isLive && !hasOutput && "pointer-events-none",
        )}
      >
        <div className="bg-white h-full w-full" ref={containerRef} />
        {isLive ? null : (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0",
              hasOutput ? "bg-stone-100/40" : "bg-stone-200/55",
            )}
          />
        )}
      </div>
    </div>
  );
}

export { INITIAL_PTY_DIMENSIONS };
