import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  ResponsiveFieldList,
  ResponsiveFieldListCell,
  ResponsiveFieldListRow,
} from "./responsive-field-list.js";

function ResponsiveFieldListStoryPreview(): React.JSX.Element {
  return (
    <div className="w-full max-w-4xl">
      <ResponsiveFieldList
        className="border-y bg-card"
        columns={[
          { key: "integration", label: "Integration", desktopWidth: "minmax(0,1.1fr)" },
          { key: "connection", label: "Connection", desktopWidth: "minmax(0,1.6fr)" },
          { key: "linkedUsers", label: "Linked Users", desktopWidth: "180px", align: "center" },
          { key: "enable", label: "Enable", desktopWidth: "88px", align: "center" },
        ]}
        headerClassName="px-4 py-3 font-medium"
      >
        <ResponsiveFieldListRow className="px-4 py-4">
          <ResponsiveFieldListCell columnKey="integration">
            <div className="text-sm font-medium">GitHub</div>
          </ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="connection">
            <Select defaultValue="engineering">
              <SelectTrigger aria-label="GitHub connection" className="w-full md:max-w-xl">
                <SelectValue>GitHub Engineering</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="engineering">GitHub Engineering</SelectItem>
                <SelectItem value="platform">GitHub Platform</SelectItem>
              </SelectContent>
            </Select>
          </ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="linkedUsers">
            <Button
              className="h-auto w-auto p-0 hover:bg-transparent"
              type="button"
              variant="ghost"
            >
              12
            </Button>
          </ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="enable">
            <Switch aria-label="Enable GitHub" checked={true} />
          </ResponsiveFieldListCell>
        </ResponsiveFieldListRow>

        <ResponsiveFieldListRow className="px-4 py-4" isLastRow={true}>
          <ResponsiveFieldListCell columnKey="integration">
            <div className="text-sm font-medium">Linear</div>
          </ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="connection">
            <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              No eligible active connections
            </div>
          </ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="linkedUsers">0</ResponsiveFieldListCell>
          <ResponsiveFieldListCell columnKey="enable">
            <Switch aria-label="Enable Linear" checked={false} disabled={true} />
          </ResponsiveFieldListCell>
        </ResponsiveFieldListRow>
      </ResponsiveFieldList>
    </div>
  );
}

const meta = {
  title: "Dashboard/Shared/ResponsiveFieldList",
  component: ResponsiveFieldListStoryPreview,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ResponsiveFieldListStoryPreview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
