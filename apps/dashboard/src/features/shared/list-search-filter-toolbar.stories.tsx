import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import {
  ListSearchFilterToolbar,
  type ListSearchFilterToolbarOption,
} from "./list-search-filter-toolbar.js";

type InteractiveToolbarProps = {
  searchAriaLabel: string;
  searchPlaceholder: string;
  filterAriaLabel: string;
  filterOptions: ReadonlyArray<ListSearchFilterToolbarOption>;
  filterTriggerClassName?: string;
};

const SampleFilterOptions: ReadonlyArray<ListSearchFilterToolbarOption> = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
];

function InteractiveToolbar(args: InteractiveToolbarProps): React.JSX.Element {
  const [searchValue, setSearchValue] = useState("");
  const [filterValue, setFilterValue] = useState(args.filterOptions[0]?.value ?? "");

  return (
    <ListSearchFilterToolbar
      filterAriaLabel={args.filterAriaLabel}
      filterOptions={args.filterOptions}
      filterValue={filterValue}
      onFilterValueChange={setFilterValue}
      onSearchValueChange={setSearchValue}
      searchAriaLabel={args.searchAriaLabel}
      searchPlaceholder={args.searchPlaceholder}
      searchValue={searchValue}
      {...(args.filterTriggerClassName === undefined
        ? {}
        : { filterTriggerClassName: args.filterTriggerClassName })}
    />
  );
}

const meta = {
  title: "Dashboard/Shared/ListSearchFilterToolbar",
  component: InteractiveToolbar,
  decorators: [withDashboardCenteredSurface],
  parameters: {
    layout: "fullscreen",
  },
  args: {
    searchAriaLabel: "Search automations",
    searchPlaceholder: "Search automations",
    filterAriaLabel: "Filter automations",
    filterOptions: SampleFilterOptions,
    filterTriggerClassName: "h-10 w-28",
  },
} satisfies Meta<typeof InteractiveToolbar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MembersStyle: Story = {
  args: {
    searchAriaLabel: "Search members and invitations",
    searchPlaceholder: "Search members or invitations",
    filterAriaLabel: "Filter directory rows",
    filterOptions: [
      { value: "all", label: "All" },
      { value: "members", label: "Members" },
      { value: "invitations", label: "Invitations" },
    ],
    filterTriggerClassName: "h-10 w-24",
  },
};
