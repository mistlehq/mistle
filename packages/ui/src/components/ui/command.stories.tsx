import { GearIcon, MagnifyingGlassIcon, RocketLaunchIcon, UsersIcon } from "@phosphor-icons/react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command.js";

export default {
  title: "UI/Command",
  component: Command,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-96 rounded-xl border">
        <Command>
          <CommandInput placeholder="Search commands" />
          <CommandList>
            <CommandGroup heading="Quick actions">
              <CommandItem value="deploy">
                <RocketLaunchIcon />
                Deploy latest build
                <CommandShortcut>⌘D</CommandShortcut>
              </CommandItem>
              <CommandItem value="members">
                <UsersIcon />
                Invite teammate
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Preferences">
              <CommandItem value="settings">
                <GearIcon />
                Open workspace settings
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    );
  },
};

export const Dialog = {
  render: function Render() {
    return (
      <CommandDialog defaultOpen>
        <Command>
          <CommandInput placeholder="Jump to..." />
          <CommandList>
            <CommandGroup heading="Navigate">
              <CommandItem value="search">
                <MagnifyingGlassIcon />
                Search activity
              </CommandItem>
              <CommandItem value="settings">
                <GearIcon />
                Workspace settings
              </CommandItem>
            </CommandGroup>
            <CommandEmpty>No results found.</CommandEmpty>
          </CommandList>
        </Command>
      </CommandDialog>
    );
  },
};
