import { Badge } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ChatEntry } from "../chat/chat-types.js";
import type { CodexServerRequestEntry } from "../codex-client/codex-server-requests-state.js";
import { CodexSessionPageView } from "./codex-session-page-view.js";

const DemoEntries: readonly ChatEntry[] = [
  {
    id: "user-1",
    turnId: "turn-1",
    kind: "user-message",
    status: "completed",
    text: "Review the Storybook Phase 2 rollout and list the remaining cleanup.",
  },
  {
    id: "assistant-1",
    turnId: "turn-1",
    kind: "assistant-message",
    phase: null,
    status: "completed",
    text: [
      "The main cleanup items are:",
      "",
      "- shared fonts now belong in `@mistle/ui`",
      "- `CodexSessionPage` should render through a view boundary",
      "- next dashboard stories should stay prop-driven",
    ].join("\n"),
  },
];

const DemoServerRequests: readonly CodexServerRequestEntry[] = [
  {
    requestId: "generic-request-1",
    method: "tool/reportStatus",
    kind: "generic",
    paramsJson: JSON.stringify(
      {
        storybook: "phase-2",
        area: "codex-session-page-view",
      },
      null,
      2,
    ),
    status: "pending",
    responseErrorMessage: null,
  },
];

const meta = {
  title: "Dashboard/Pages/CodexSessionPageView",
  component: CodexSessionPageView,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    sandboxInstanceId: "sbi_storybook",
    hasTopAlert: false,
    sandboxStatusErrorMessage: null,
    startErrorMessage: null,
    sandboxFailureMessage: null,
    chatEntries: DemoEntries,
    serverRequestPanelEntries: DemoServerRequests,
    isRespondingToServerRequest: false,
    onRespondToServerRequest: function onRespondToServerRequest() {},
    composerProps: {
      composerText: "Focus on dashboard asset ownership next.",
      modelOptions: [
        { value: "gpt-5", label: "GPT-5" },
        { value: "gpt-5-mini", label: "GPT-5 Mini" },
      ],
      selectedModel: "gpt-5",
      selectedReasoningEffort: "medium",
      isConnected: true,
      isStartingTurn: false,
      isSteeringTurn: false,
      isInterruptingTurn: false,
      isUpdatingComposerConfig: false,
      canInterruptTurn: false,
      canSteerTurn: false,
      completedErrorMessage: null,
      onComposerTextChange: function onComposerTextChange() {},
      onModelChange: function onModelChange() {},
      onReasoningEffortChange: function onReasoningEffortChange() {},
      onSubmit: function onSubmit() {},
    },
  },
  decorators: [
    function StoryDecorator(Story): React.JSX.Element {
      return (
        <div className="from-background to-muted/20 min-h-screen bg-linear-to-b">
          <div className="bg-background/80 flex h-12 items-center justify-end border-b px-4 backdrop-blur-sm">
            <Badge
              className="bg-emerald-600 text-white hover:bg-emerald-600/90"
              variant="secondary"
            >
              Connected
            </Badge>
          </div>
          <div className="h-[calc(100vh-3rem)]">
            <Story />
          </div>
        </div>
      );
    },
  ],
} satisfies Meta<typeof CodexSessionPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAlerts: Story = {
  args: {
    hasTopAlert: true,
    sandboxStatusErrorMessage: "Could not load sandbox status.",
    startErrorMessage: "The session failed to connect to the agent.",
    sandboxFailureMessage: "The sandbox exited before the transport was ready.",
  },
};
