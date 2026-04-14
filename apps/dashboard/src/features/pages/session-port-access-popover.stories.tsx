import type { ProcessEntry } from "@mistle/sandbox-session-protocol";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { createProcessKey } from "./session-port-access-model.js";
import { SessionPortAccessPopover } from "./session-port-access-popover.js";
import type { SessionPortAccessState } from "./use-session-port-access.js";

const StoryProcesses: ProcessEntry[] = [
  {
    pid: 6402,
    command: "node server.js",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 3000,
      },
      {
        bindAddress: "::1",
        port: 3000,
      },
      {
        bindAddress: "127.0.0.1",
        port: 3001,
      },
    ],
  },
  {
    pid: 4321,
    command: "vite dev --host 127.0.0.1 --port 5173",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 5173,
      },
      {
        bindAddress: "127.0.0.1",
        port: 24678,
      },
    ],
  },
  {
    pid: 7788,
    command: "python -m http.server 8000",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 8000,
      },
      {
        bindAddress: "::1",
        port: 8000,
      },
      {
        bindAddress: "127.0.0.1",
        port: 8001,
      },
    ],
  },
  {
    pid: 9901,
    command: "storybook dev -p 6006",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 6006,
      },
      {
        bindAddress: "127.0.0.1",
        port: 6007,
      },
    ],
  },
  {
    pid: 1204,
    command: "grafana-server --homepath /usr/share/grafana",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 9000,
      },
      {
        bindAddress: "::1",
        port: 9000,
      },
      {
        bindAddress: "127.0.0.1",
        port: 9090,
      },
    ],
  },
  {
    pid: 5432,
    command: "postgres -D /var/lib/postgresql/data",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 5432,
      },
      {
        bindAddress: "::1",
        port: 5432,
      },
    ],
  },
  {
    pid: 6379,
    command: "redis-server *:6379",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 6379,
      },
      {
        bindAddress: "::1",
        port: 6379,
      },
    ],
  },
  {
    pid: 9091,
    command: "prometheus --config.file=prometheus.yml --web.listen-address=127.0.0.1:9091",
    listeners: [
      {
        bindAddress: "127.0.0.1",
        port: 9091,
      },
    ],
  },
];

const StoryPrimaryProcess = StoryProcesses[0];

if (StoryPrimaryProcess === undefined) {
  throw new Error("Session port access story fixtures must include at least one process.");
}

function createStoryState(overrides?: Partial<SessionPortAccessState>): SessionPortAccessState {
  return {
    buttonDisabledReason: null,
    errorMessage: null,
    isLoadingProcesses: false,
    isOpeningProcessKey: null,
    isPanelOpen: true,
    observedAt: null,
    openProcess: async () => {
      return;
    },
    processes: StoryProcesses,
    setPanelOpen: () => {
      return;
    },
    ...overrides,
  };
}

type SessionPortAccessPopoverStoryArgs = {
  state: SessionPortAccessState;
};

const meta = {
  title: "Dashboard/Sessions/SessionWorkbench/ProcessesPopover",
  component: SessionPortAccessPopover,
  tags: ["autodocs"],
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "centered",
  },
  args: {
    state: createStoryState(),
  },
  render: (args): React.JSX.Element => {
    return <SessionPortAccessPopover state={args.state} />;
  },
} satisfies Meta<SessionPortAccessPopoverStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Loading: Story = {
  args: {
    state: createStoryState({
      isLoadingProcesses: true,
      observedAt: null,
      processes: [],
    }),
  },
};

export const Empty: Story = {
  args: {
    state: createStoryState({
      processes: [],
    }),
  },
};

export const OpeningProcess: Story = {
  args: {
    state: createStoryState({
      isOpeningProcessKey: createProcessKey(StoryPrimaryProcess),
    }),
  },
};

export const ErrorState: Story = {
  args: {
    state: createStoryState({
      errorMessage: "That process is not serving HTTP or HTTPS on its selected port.",
    }),
  },
};
