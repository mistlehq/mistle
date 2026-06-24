import { Button, Input } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { ComposerActionPanel, ComposerActionPanelStack } from "./composer-action-panel.js";

type ComposerActionDetail = {
  label: string;
  value: React.ReactNode;
};

function ComposerActionDetailList(input: {
  details: readonly ComposerActionDetail[];
}): React.JSX.Element | null {
  if (input.details.length === 0) {
    return null;
  }

  return (
    <dl className="grid gap-3 text-sm">
      {input.details.map((detail, detailIndex) => (
        <div key={`${detail.label}:${String(detailIndex)}`}>
          <dt className="text-muted-foreground">{detail.label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap">{detail.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ComposerActionPanelStory(): React.JSX.Element {
  return (
    <div className="w-full max-w-3xl">
      <ComposerActionPanel
        actions={
          <>
            <Button type="button" variant="outline">
              Decline
            </Button>
            <Button type="button">Approve</Button>
          </>
        }
        details={
          <div className="space-y-4">
            <p className="text-base leading-7 text-muted-foreground">
              Create a webhook on the selected repository for pull request events.
            </p>
            <ComposerActionDetailList
              details={[
                {
                  label: "Events",
                  value: "pull_request, pull_request_review",
                },
                {
                  label: "Target",
                  value: "https://app.mistle.dev/api/github/webhooks",
                },
              ]}
            />
          </div>
        }
        title="Create GitHub webhook"
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Shared/Composer Action Panel",
  component: ComposerActionPanelStory,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ComposerActionPanelStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LongDetails: Story = {
  render: function RenderLongDetails() {
    return (
      <div className="w-full max-w-3xl">
        <ComposerActionPanel
          actions={
            <>
              <Button type="button" variant="outline">
                Cancel
              </Button>
              <Button type="button">Run command</Button>
            </>
          }
          details={
            <div className="space-y-4">
              <p className="text-base leading-7 text-muted-foreground">
                Run the setup command in the sandbox. The command output may take a few minutes and
                will continue in the transcript after approval.
              </p>
              <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs leading-5 whitespace-pre-wrap">
                pnpm --filter @mistle/dashboard exec vitest run -c vitest.component.config.ts
                src/features/session-agents/server-requests/server-requests-panel.component.test.tsx
              </pre>
              <ComposerActionDetailList
                details={[
                  {
                    label: "Working directory",
                    value: "/Users/jonathanlow/mistle-projects/mistle-add-central-chat",
                  },
                  {
                    label: "Reason",
                    value:
                      "Validate the approval UI after changing the shared composer action panel.",
                  },
                ]}
              />
            </div>
          }
          title="Command approval"
        />
      </div>
    );
  },
};

export const Stacked: Story = {
  render: function RenderStacked() {
    return (
      <div className="w-full max-w-3xl">
        <ComposerActionPanelStack>
          <ComposerActionPanel
            actions={
              <>
                <Button type="button" variant="outline">
                  Decline
                </Button>
                <Button type="button">Approve</Button>
              </>
            }
            details={
              <p className="text-base leading-7 text-muted-foreground">
                Publish the current sandbox profile draft as a new version.
              </p>
            }
            title="Publish profile draft"
          />
          <ComposerActionPanel
            actions={
              <>
                <Button type="button" variant="outline">
                  Dismiss
                </Button>
                <Button disabled type="button">
                  Submitting
                </Button>
              </>
            }
            details={
              <ComposerActionDetailList
                details={[
                  {
                    label: "Profile",
                    value: "GitHub PR reviewer",
                  },
                  {
                    label: "Setup script",
                    value: "pnpm install && pnpm --filter @mistle/dashboard build",
                  },
                ]}
              />
            }
            title="Update setup script"
          />
        </ComposerActionPanelStack>
      </div>
    );
  },
};

export const UserInput: Story = {
  render: function RenderUserInput() {
    return (
      <div className="w-full max-w-3xl">
        <ComposerActionPanel
          actions={<Button type="button">Submit response</Button>}
          details={
            <div className="mx-4 space-y-4">
              <p className="ml-6 text-muted-foreground text-sm leading-6">
                Which repository should Designer configure?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline">
                  mistle
                </Button>
                <Button type="button">mistle-dashboard</Button>
                <Button type="button" variant="outline">
                  mistle-docs
                </Button>
              </div>
              <Input placeholder="Use another repository..." />
            </div>
          }
          padding="flush-x"
          title={null}
        />
      </div>
    );
  },
};
