import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "./button.js";
import { Input } from "./input.js";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";

const meta = {
  title: "UI/Popover",
  component: Popover,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Popover>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <Popover>
        <PopoverTrigger render={<Button type="button" variant="outline" />}>
          Edit metadata
        </PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Session label</PopoverTitle>
            <PopoverDescription>
              Update the display name used in the sidebar and recent lists.
            </PopoverDescription>
          </PopoverHeader>
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium" htmlFor="session-label">
              Name
            </label>
            <Input defaultValue="review-openapi-drift" id="session-label" />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" type="button" variant="outline">
              Cancel
            </Button>
            <Button size="sm" type="button">
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  },
};
