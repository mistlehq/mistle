import { Button } from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { ActionTile } from "./action-tile.js";

function ShellPreview(): React.JSX.Element {
  return (
    <div className="w-full max-w-4xl">
      <ActionTile
        action={<Button type="button">Add integrations</Button>}
        className="border-primary/40 bg-primary/5"
        description="Shared action-tile shell for dashboard cards with a trailing action."
        title="Add integrations"
      />
    </div>
  );
}

const meta = {
  title: "Dashboard/Shared/ActionTile",
  component: ShellPreview,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ShellPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Shell: Story = {};

export const HomeStepStyle: Story = {
  render: function RenderHomeStepStyle() {
    return (
      <div className="w-full max-w-4xl">
        <ActionTile
          action={<Button type="button">Add integrations</Button>}
          actionContainerClassName="sm:items-start"
          className="border-primary/40 bg-primary/5"
          description="The home page keeps its responsive status mark layout while reusing the same shell."
          leading={<div aria-hidden className="size-2.5 rounded-full bg-primary" />}
          leadingPlacement="detached"
          title="Add integrations"
        />
      </div>
    );
  },
};

export const IntegrationTileStyle: Story = {
  render: function RenderIntegrationTileStyle() {
    return (
      <div className="w-full max-w-4xl">
        <ActionTile
          action={<Button type="button">Add</Button>}
          actionContainerClassName="gap-2"
          badge={
            <span className="rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              Connected
            </span>
          }
          className="rounded-md px-3 py-3 sm:items-center"
          description="Integration cards keep their inline icon layout while reusing the same outer shell."
          descriptionClassName="text-xs"
          leading={
            <CheckCircleIcon aria-hidden className="size-5 text-emerald-600" weight="fill" />
          }
          title="Integration Tile"
        />
      </div>
    );
  },
};

export const NoAction: Story = {
  render: function RenderNoAction() {
    return (
      <div className="w-full max-w-4xl">
        <ActionTile
          action={null}
          actionContainerClassName="sm:items-start"
          className="border-border/60 bg-muted/15"
          description="Use this story at a narrow viewport to verify that omitting the action does not leave an empty trailing row."
          leading={
            <CheckCircleIcon aria-hidden className="size-5 text-emerald-600" weight="fill" />
          }
          leadingPlacement="detached"
          title="Completed step"
        />
      </div>
    );
  },
};
