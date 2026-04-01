import { SandboxPtyStates } from "@mistle/sandbox-session-client";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

import type { UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import { SessionCliPanel } from "./session-cli-panel.js";
import {
  createStoryLongCliOutput,
  createStoryPtyChunks,
  renderSessionWorkbenchStory,
  SessionWorkbenchStoryChrome,
  StorySandboxInstanceId,
} from "./session-story-support.js";

type CliStoryScenario = {
  initialErrorMessage?: string | null;
  initialOutput?: string;
  initialState?: UseSandboxPtyStateResult["lifecycle"]["state"];
};

function StoryCliWorkbench(input: CliStoryScenario): React.JSX.Element {
  const [lifecycleState, setLifecycleState] = useState<
    UseSandboxPtyStateResult["lifecycle"]["state"]
  >(input.initialState ?? SandboxPtyStates.CONNECTING);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    input.initialErrorMessage ?? null,
  );
  const [outputChunks, setOutputChunks] = useState<readonly Uint8Array[]>(
    createStoryPtyChunks(input.initialOutput ?? ""),
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

            return createStoryPtyChunks(
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
          setOutputChunks((currentChunks) => [...currentChunks, ...createStoryPtyChunks(nextText)]);
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
    initialOutput: createStoryLongCliOutput("log"),
    initialState: SandboxPtyStates.OPEN,
  },
};
