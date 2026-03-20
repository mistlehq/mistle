import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";

import {
  CodexStorySessionComposerProps,
  CodexStorySessionEntriesWithExploringGroup,
  CodexStorySessionServerRequests,
} from "../session-agents/codex/fixtures/session-story-fixtures.js";
import { type UseSandboxPtyStateResult } from "../sessions/use-sandbox-pty-state.js";
import {
  SessionConversationBottomPanel,
  SessionConversationMainContent,
} from "./session-conversation-pane.js";
import { SessionTerminalPanel } from "./session-terminal-panel.js";
import { SessionWorkbenchPageView } from "./session-workbench-page-view.js";

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
          lifecycleState === "open" || lifecycleState === "connected" ? "sbi_storybook" : null,
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
                "mistle@sandbox:~$ pwd",
                "/workspace",
                "mistle@sandbox:~$ echo 'storybook terminal ready'",
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

  return (
    <div className="from-background to-muted/20 min-h-screen bg-linear-to-b">
      <div className="bg-background/80 flex h-12 items-center justify-end gap-2 border-b px-4 backdrop-blur-sm">
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
          Connected
        </Badge>
      </div>
      <div className="h-[calc(100vh-3rem)]">
        <SessionWorkbenchPageView
          alerts={[]}
          isSecondaryPanelVisible={isTerminalVisible}
          mainContent={
            <SessionConversationMainContent
              chatEntries={CodexStorySessionEntriesWithExploringGroup}
              composerProps={CodexStorySessionComposerProps}
              isRespondingToServerRequest={false}
              onRespondToServerRequest={function onRespondToServerRequest() {}}
              serverRequestPanelEntries={CodexStorySessionServerRequests}
            />
          }
          onSecondaryPanelResize={setPanelSize}
          primaryBottomPanel={
            <SessionConversationBottomPanel
              chatEntries={CodexStorySessionEntriesWithExploringGroup}
              composerProps={CodexStorySessionComposerProps}
              isRespondingToServerRequest={false}
              onRespondToServerRequest={function onRespondToServerRequest() {}}
              serverRequestPanelEntries={CodexStorySessionServerRequests}
            />
          }
          secondaryPanel={
            <SessionTerminalPanel
              isConnectionReady={true}
              isVisible={isTerminalVisible}
              onHide={() => {
                setIsTerminalVisible(false);
              }}
              onClose={() => {
                setIsTerminalVisible(false);
              }}
              ptyState={ptyState}
              sandboxInstanceId="sbi_storybook"
              sandboxStatus="running"
            />
          }
          secondaryPanelSize={panelSize}
          sandboxInstanceId="sbi_storybook"
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Dashboard/Pages/SessionTerminalPanel",
  component: StoryTerminalWorkbench,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
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

export const TerminalClosed: Story = {
  args: {
    initialTerminalVisible: false,
  },
};

export const OpenEmpty: Story = {
  args: {
    initialOutput: "",
    initialState: "closed",
    initialTerminalVisible: true,
  },
};

export const OpenWithOutput: Story = {
  args: {
    initialOutput: [
      "mistle@sandbox:~/workspace$ git status --short",
      " M apps/dashboard/src/features/pages/session-terminal-panel.tsx",
      " M apps/dashboard/src/features/pages/session-workbench-page.tsx",
      "",
    ].join("\n"),
    initialState: "open",
    initialTerminalVisible: true,
  },
};

export const Connecting: Story = {
  args: {
    initialState: "connecting",
    initialTerminalVisible: true,
  },
};

export const ErrorState: Story = {
  args: {
    initialErrorMessage: "Sandbox PTY websocket connection failed.",
    initialState: "error",
    initialTerminalVisible: true,
  },
};

export const ErrorWithBufferedOutput: Story = {
  args: {
    initialErrorMessage: "Sandbox PTY websocket connection failed.",
    initialOutput: ["mistle@sandbox:~/workspace$ ./long-task.sh", "running\u2026", ""].join("\n"),
    initialState: "error",
    initialTerminalVisible: true,
  },
};
