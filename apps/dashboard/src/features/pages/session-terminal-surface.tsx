import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { cn } from "@mistle/ui";

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

const FALLBACK_PTY_COLS = 120;
const FALLBACK_PTY_ROWS = 20;
const INITIAL_PTY_DIMENSIONS = {
  cols: FALLBACK_PTY_COLS,
  rows: FALLBACK_PTY_ROWS,
};
const TERMINAL_FONT_FAMILY =
  '"JetBrains Mono Variable", "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

const DARK_TERMINAL_THEME: ITheme = {
  background: "#132723",
  foreground: "#dbf1ec",
  cursor: "#9fd3c8",
  cursorAccent: "#9fd3c8",
  selectionBackground: "#6b9bd9",
  black: "#23403b",
  red: "#d97780",
  green: "#7aa860",
  yellow: "#bc904f",
  blue: "#6b9bd9",
  magenta: "#b77ed1",
  cyan: "#52a9a9",
  white: "#9fd3c8",
  brightBlack: "#46756b",
  brightRed: "#e6949a",
  brightGreen: "#8ebf73",
  brightYellow: "#d3a563",
  brightBlue: "#88b1e5",
  brightMagenta: "#c899de",
  brightCyan: "#63c0bf",
  brightWhite: "#f0f9f7",
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#111111",
  cursor: "#444444",
  cursorAccent: "#ffffff",
  selectionBackground: "#cfe0ff",
  black: "#d9d9d9",
  red: "#c65a4b",
  green: "#3f9a52",
  yellow: "#8c6d1f",
  blue: "#4f86e8",
  magenta: "#a855b7",
  cyan: "#2f93a3",
  white: "#555555",
  brightBlack: "#9a9a9a",
  brightRed: "#d96f61",
  brightGreen: "#56ad68",
  brightYellow: "#a8842d",
  brightBlue: "#679cf0",
  brightMagenta: "#bb6ac9",
  brightCyan: "#46aaba",
  brightWhite: "#222222",
};

function readIsDarkTheme(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.classList.contains("dark");
}

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
  const [isDarkTheme, setIsDarkTheme] = useState(readIsDarkTheme);
  const terminalTheme = isDarkTheme ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
  const terminalBackgroundColor = terminalTheme.background ?? "#ffffff";

  lifecycleStateRef.current = lifecycleState;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const observer = new MutationObserver(() => {
      setIsDarkTheme(readIsDarkTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

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
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 2_000,
      theme: terminalTheme,
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
  }, [fitTerminal, isVisible, onWriteInput, resizePtyToTerminal, terminalTheme]);

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
    <div className="relative min-h-0 flex-1" style={{ backgroundColor: terminalBackgroundColor }}>
      <div
        className={cn(
          "relative h-full w-full transition-[opacity] duration-150",
          isLive ? "opacity-100" : hasOutput ? "opacity-[0.52]" : "opacity-[0.38]",
          !isLive && !hasOutput && "pointer-events-none",
        )}
      >
        <div
          className="h-full w-full pl-3"
          ref={containerRef}
          style={{ backgroundColor: terminalBackgroundColor }}
        />
      </div>
    </div>
  );
}

export { INITIAL_PTY_DIMENSIONS };
