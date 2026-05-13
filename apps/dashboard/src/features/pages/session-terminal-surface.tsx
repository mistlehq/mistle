import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import { cn } from "@mistle/ui";

import "@xterm/xterm/css/xterm.css";
import "./session-terminal-surface.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

const FALLBACK_PTY_COLS = 120;
const FALLBACK_PTY_ROWS = 20;
const INITIAL_PTY_DIMENSIONS = {
  cols: FALLBACK_PTY_COLS,
  rows: FALLBACK_PTY_ROWS,
};
const FALLBACK_TERMINAL_FONT_FAMILY =
  '"JetBrains Mono Variable", "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

export type SessionTerminalContentInset = "default" | "none";
export type SessionTerminalThemeMode = "dark" | "light" | "system";

const TerminalBackgroundColor = "var(--session-terminal-background)";

function resolveTerminalFontFamily(): string {
  if (typeof document === "undefined") {
    return FALLBACK_TERMINAL_FONT_FAMILY;
  }

  const fontFamily = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();

  return fontFamily.length > 0 ? fontFamily : FALLBACK_TERMINAL_FONT_FAMILY;
}

function readRequiredCssVariable(style: CSSStyleDeclaration, variableName: string): string {
  const value = style.getPropertyValue(variableName).trim();
  if (value.length === 0) {
    throw new Error(`Missing required terminal CSS variable: ${variableName}`);
  }

  return value;
}

function resolveTerminalTheme(element: HTMLElement): ITheme {
  const style = getComputedStyle(element);

  return {
    background: readRequiredCssVariable(style, "--session-terminal-background"),
    foreground: readRequiredCssVariable(style, "--session-terminal-foreground"),
    cursor: readRequiredCssVariable(style, "--session-terminal-cursor"),
    cursorAccent: readRequiredCssVariable(style, "--session-terminal-cursor-accent"),
    selectionBackground: readRequiredCssVariable(style, "--session-terminal-selection-background"),
    black: readRequiredCssVariable(style, "--session-terminal-black"),
    red: readRequiredCssVariable(style, "--session-terminal-red"),
    green: readRequiredCssVariable(style, "--session-terminal-green"),
    yellow: readRequiredCssVariable(style, "--session-terminal-yellow"),
    blue: readRequiredCssVariable(style, "--session-terminal-blue"),
    magenta: readRequiredCssVariable(style, "--session-terminal-magenta"),
    cyan: readRequiredCssVariable(style, "--session-terminal-cyan"),
    white: readRequiredCssVariable(style, "--session-terminal-white"),
    brightBlack: readRequiredCssVariable(style, "--session-terminal-bright-black"),
    brightRed: readRequiredCssVariable(style, "--session-terminal-bright-red"),
    brightGreen: readRequiredCssVariable(style, "--session-terminal-bright-green"),
    brightYellow: readRequiredCssVariable(style, "--session-terminal-bright-yellow"),
    brightBlue: readRequiredCssVariable(style, "--session-terminal-bright-blue"),
    brightMagenta: readRequiredCssVariable(style, "--session-terminal-bright-magenta"),
    brightCyan: readRequiredCssVariable(style, "--session-terminal-bright-cyan"),
    brightWhite: readRequiredCssVariable(style, "--session-terminal-bright-white"),
  };
}

type SessionTerminalSurfaceProps = {
  refitKey?: string;
  contentInset?: SessionTerminalContentInset;
  themeMode?: SessionTerminalThemeMode;
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
  refitKey,
  contentInset = "default",
  themeMode = "system",
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
  const [themeRevision, setThemeRevision] = useState(0);

  lifecycleStateRef.current = lifecycleState;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const observer = new MutationObserver(() => {
      setThemeRevision((currentRevision) => currentRevision + 1);
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

    const terminalTheme = resolveTerminalTheme(container);
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      fontFamily: resolveTerminalFontFamily(),
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
  }, [fitTerminal, isVisible, onWriteInput, resizePtyToTerminal]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (terminal === null || container === null) {
      return;
    }

    terminal.options.theme = resolveTerminalTheme(container);
  }, [themeMode, themeRevision]);

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

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    // Split-pane transitions can settle after the initial resize observer callback,
    // so refit again on the next paint when an external layout phase changes.
    let animationFrameId = 0;
    let nestedAnimationFrameId = 0;

    animationFrameId = window.requestAnimationFrame(() => {
      nestedAnimationFrameId = window.requestAnimationFrame(() => {
        fitTerminal();

        if (lifecycleStateRef.current === SandboxPtyStates.OPEN) {
          resizePtyToTerminal();
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.cancelAnimationFrame(nestedAnimationFrameId);
    };
  }, [fitTerminal, isVisible, refitKey, resizePtyToTerminal]);

  if (!isVisible) {
    return null;
  }

  const isLive = lifecycleState === SandboxPtyStates.OPEN;
  const hasOutput = outputChunks.length > 0;

  return (
    <div
      className="session-terminal-surface relative h-full min-h-0 overflow-hidden"
      data-terminal-theme={themeMode}
      style={{ backgroundColor: TerminalBackgroundColor }}
    >
      <div
        className={cn(
          "relative h-full w-full overflow-hidden transition-[opacity] duration-150",
          isLive ? "opacity-100" : hasOutput ? "opacity-[0.52]" : "opacity-[0.38]",
          !isLive && !hasOutput && "pointer-events-none",
        )}
      >
        <div
          className={cn("h-full w-full", contentInset === "default" && "pl-3")}
          ref={containerRef}
          style={{ backgroundColor: TerminalBackgroundColor }}
        />
      </div>
    </div>
  );
}

export { INITIAL_PTY_DIMENSIONS };
