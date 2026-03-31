import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

import type { UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  renderSessionWorkbenchStory,
  SessionWorkbenchStoryChrome,
  StorySandboxInstanceId,
} from "./session-story-support.js";

const textEncoder = new TextEncoder();

type CliStoryScenario = {
  initialErrorMessage?: string | null;
  initialOutput?: string;
  initialState?: UseSandboxPtyStateResult["lifecycle"]["state"];
};

function createPtyChunks(text: string): readonly Uint8Array[] {
  if (text.length === 0) {
    return [];
  }

  return text.split(/(?<=\n)/).map((chunk) => textEncoder.encode(chunk));
}

function createLongCliOutput(): string {
  return Array.from({ length: 120 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, "0");
    return `log ${lineNumber}: scanning repository state for pending changes`;
  }).join("\n");
}

function StoryCliWorkbench(input: CliStoryScenario): React.JSX.Element {
  const [lifecycleState, setLifecycleState] = useState<
    UseSandboxPtyStateResult["lifecycle"]["state"]
  >(input.initialState ?? SandboxPtyStates.CONNECTING);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    input.initialErrorMessage ?? null,
  );
  const [outputChunks, setOutputChunks] = useState<readonly Uint8Array[]>(
    createPtyChunks(input.initialOutput ?? ""),
  );

  const ptyState = useMemo<UseSandboxPtyStateResult>(() => {
    return {
      lifecycle: {
        connectedSandboxInstanceId:
          lifecycleState === SandboxPtyStates.OPEN || lifecycleState === SandboxPtyStates.CONNECTED
            ? StorySandboxInstanceId
            : null,
        errorMessage,
        exitInfo: null,
        resetInfo: null,
        state: lifecycleState,
      },
      output: {
        chunks: outputChunks,
        clearOutput: () => {
          setOutputChunks([]);
        },
      },
      actions: {
        closePty: async () => {
          setLifecycleState(SandboxPtyStates.CONNECTED);
        },
        disconnectPty: async () => {
          setLifecycleState(SandboxPtyStates.CLOSED);
          setErrorMessage(null);
        },
        openPty: async () => {
          setLifecycleState(SandboxPtyStates.OPENING);
          await Promise.resolve();
          setLifecycleState(SandboxPtyStates.OPEN);
          setErrorMessage(null);
          setOutputChunks((currentChunks) => {
            if (currentChunks.length > 0) {
              return currentChunks;
            }

            return createPtyChunks(
              [
                "Resuming thread thread_storybook_123...",
                "Connected to Codex remote session.",
                "root@sandbox:~# codex status",
                "Session ready",
                "",
              ].join("\n"),
            );
          });
        },
        resizePty: async () => {
          return;
        },
        writeInput: async (data) => {
          const nextText = typeof data === "string" ? data : new TextDecoder().decode(data);
          setOutputChunks((currentChunks) => [...currentChunks, textEncoder.encode(nextText)]);
        },
      },
    };
  }, [errorMessage, lifecycleState, outputChunks]);

  return (
    <SessionWorkbenchStoryChrome>
      {renderSessionWorkbenchStory({
        mainContentLayout: { scroll: "contained", width: "full" },
        mainContent: <SessionCliPanel ptyState={ptyState} />,
        primaryBottomPanel: null,
        sandboxInstanceId: StorySandboxInstanceId,
      })}
    </SessionWorkbenchStoryChrome>
  );
}

const meta = {
  title: "Dashboard/Pages/SessionCliPanel",
  component: StoryCliWorkbench,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    initialErrorMessage: null,
    initialOutput: "",
    initialState: SandboxPtyStates.CONNECTING,
  },
} satisfies Meta<typeof StoryCliWorkbench>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Connecting: Story = {
  args: {
    initialState: SandboxPtyStates.CONNECTING,
  },
};

export const Opening: Story = {
  args: {
    initialState: SandboxPtyStates.OPENING,
  },
};

export const ConnectedEmpty: Story = {
  args: {
    initialState: SandboxPtyStates.OPEN,
  },
};

export const ConnectedWithOutput: Story = {
  args: {
    initialOutput: [
      "Resuming thread thread_storybook_123...",
      "Connected to Codex remote session.",
      "root@sandbox:~# ls",
      "README.md  package.json  apps  packages",
      "",
    ].join("\n"),
    initialState: SandboxPtyStates.OPEN,
  },
};

export const ConnectedLongOutput: Story = {
  args: {
    initialOutput: createLongCliOutput(),
    initialState: SandboxPtyStates.OPEN,
  },
};

export const Disconnected: Story = {
  args: {
    initialState: SandboxPtyStates.CLOSED,
  },
};

export const Exited: Story = {
  args: {
    initialOutput: [
      "Resuming thread thread_storybook_123...",
      "Connected to Codex remote session.",
      "codex: session ended by remote peer",
      "",
    ].join("\n"),
    initialState: SandboxPtyStates.EXITED,
  },
};

export const ErrorState: Story = {
  args: {
    initialErrorMessage: "Sandbox PTY websocket connection failed.",
    initialState: SandboxPtyStates.ERROR,
  },
};

export const ErrorWithBufferedOutput: Story = {
  args: {
    initialErrorMessage: "Codex CLI exited before the session fully connected.",
    initialOutput: ["Resuming thread thread_storybook_123...", "Handshake failed.", ""].join("\n"),
    initialState: SandboxPtyStates.ERROR,
  },
};
