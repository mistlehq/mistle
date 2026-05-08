import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { TablePagination } from "./table-pagination.js";

const meta = {
  title: "Dashboard/Shared/TablePagination",
  component: TablePagination,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    hasNextPage: true,
    hasPreviousPage: true,
    nextPageDisabled: false,
    previousPageDisabled: false,
    onNextPage: function onNextPage() {},
    onPreviousPage: function onPreviousPage() {},
  },
} satisfies Meta<typeof TablePagination>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FirstPage: Story = {
  args: {
    hasPreviousPage: false,
  },
};

export const Loading: Story = {
  args: {
    nextPageDisabled: true,
    previousPageDisabled: true,
  },
};
