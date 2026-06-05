import type { Meta, StoryObj } from "@storybook/react-vite";

import { IntegrationLogo } from "./integration-logo.js";

const DashboardLogoKeys = [
  "anthropic",
  "aws",
  "datadog",
  "docker",
  "e2b",
  "gcp",
  "github",
  "google",
  "jira",
  "linear",
  "openai",
  "opencode",
  "pi",
  "planetscale",
  "sentry",
  "signoz",
  "slack",
  "tensorlake",
] as const;

const meta = {
  title: "Dashboard/Integrations/Primitives/Logo",
  parameters: {
    layout: "padded",
  },
  render: function RenderStory(): React.JSX.Element {
    return (
      <div className="grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DashboardLogoKeys.map((logoKey) => (
          <div
            className="flex min-h-14 items-center gap-3 rounded-md border bg-background px-3 py-2"
            key={logoKey}
          >
            <div className="flex size-5 shrink-0 items-center justify-center">
              <IntegrationLogo alt="" logoKey={logoKey} />
            </div>
            <p className="text-sm font-medium">{logoKey}</p>
          </div>
        ))}
      </div>
    );
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
