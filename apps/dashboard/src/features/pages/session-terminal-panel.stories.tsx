import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

import { withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import { type UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import {
  createStorySessionBottomPanel,
  createStorySessionMainContent,
  renderSessionWorkbenchContentStory,
  StorySandboxInstanceId,
} from "./session-story-support.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";

const textEncoder = new TextEncoder();

type TerminalStoryScenario = {
  initialErrorMessage?: string | null;
  initialOutput?: string;
  initialPanelSize?: number;
  initialState?: UseSandboxPtyStateResult["lifecycle"]["state"];
  initialTerminalVisible?: boolean;
};

function createPtyChunks(text: string): readonly Uint8Array[] {
  if (text.length === 0) {
    return [];
  }

  return text.split(/(?<=\n)/).map((chunk) => textEncoder.encode(chunk));
}

function StoryTerminalWorkbench(input: TerminalStoryScenario): React.JSX.Element {
  const [isTerminalVisible, setIsTerminalVisible] = useState(input.initialTerminalVisible ?? true);
  const [panelSize, setPanelSize] = useState(input.initialPanelSize ?? 38);
  const [lifecycleState, setLifecycleState] = useState<
    UseSandboxPtyStateResult["lifecycle"]["state"]
  >(input.initialState ?? "closed");
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
          lifecycleState === "open" || lifecycleState === "connected"
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
          setLifecycleState("connected");
        },
        disconnectPty: async () => {
          setLifecycleState("closed");
          setErrorMessage(null);
        },
        openPty: async () => {
          setLifecycleState("opening");
          await Promise.resolve();
          setLifecycleState("open");
          setErrorMessage(null);
          setOutputChunks((currentChunks) => {
            if (currentChunks.length > 0) {
              return currentChunks;
            }

            return createPtyChunks(
              [
                "root@sandbox:~# pwd",
                "/root",
                "root@sandbox:~# echo 'storybook terminal ready'",
                "storybook terminal ready",
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

  return renderSessionWorkbenchContentStory({
    alert: null,
    bottomPanel: (
      <SessionTerminalPanel
        cwd={null}
        isConnectionReady={true}
        isVisible={isTerminalVisible}
        onHide={() => {
          setIsTerminalVisible(false);
        }}
        onDisconnectTerminal={() => {
          setIsTerminalVisible(false);
        }}
        ptyState={ptyState}
        sandboxStatus="running"
        sandboxInstanceId={StorySandboxInstanceId}
      />
    ),
    bottomPanelSize: panelSize,
    isBottomPanelVisible: isTerminalVisible,
    mainContent: createStorySessionMainContent(),
    onBottomPanelResize: setPanelSize,
    primaryBottomPanel: createStorySessionBottomPanel(),
    sandboxInstanceId: StorySandboxInstanceId,
  });
}

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/TerminalPanel",
  component: StoryTerminalWorkbench,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardWorkspaceStory],
  args: {
    initialErrorMessage: null,
    initialOutput: "",
    initialPanelSize: 38,
    initialState: "closed",
    initialTerminalVisible: true,
  },
} satisfies Meta<typeof StoryTerminalWorkbench>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ActiveWithOutput: Story = {
  args: {
    initialOutput: [
      "root@sandbox:~# git status --short",
      " M apps/dashboard/src/features/pages/session-terminal-panel.tsx",
      " M apps/dashboard/src/features/pages/session-workbench-page.tsx",
      "",
    ].join("\n"),
    initialState: "open",
    initialTerminalVisible: true,
  },
};

export const InactiveConnecting: Story = {
  args: {
    initialState: "connecting",
    initialTerminalVisible: true,
  },
};
