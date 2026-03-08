import { DotsThreeIcon, GearIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";

import { Button } from "./button.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu.js";

export default {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
};

export const Default = {
  render: function Render() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" type="button" variant="outline" />}>
          <DotsThreeIcon />
          <span className="sr-only">Open menu</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sandbox profile</DropdownMenuLabel>
            <DropdownMenuItem>
              <PencilSimpleIcon />
              Edit profile
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <GearIcon />
              Configure bindings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Notifications</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuCheckboxItem checked>Launch alerts</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem>Approval requests</DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <TrashIcon />
            Delete profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
};

export const RadioSelection = {
  render: function Render() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
          Session view
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Density</DropdownMenuLabel>
            <DropdownMenuRadioGroup defaultValue="comfortable">
              <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="expanded">Expanded</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
};
