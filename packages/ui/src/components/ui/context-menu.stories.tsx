import { ArrowsOutCardinalIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react";

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu.js";

export default {
  title: "UI/Context Menu",
  component: ContextMenu,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <ContextMenu>
        <ContextMenuTrigger className="border-muted-foreground/30 text-muted-foreground flex h-40 w-72 items-center justify-center rounded-lg border border-dashed text-sm">
          Right click this panel
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuLabel>Session actions</ContextMenuLabel>
          <ContextMenuItem>
            <CopyIcon />
            Copy link
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem>
            <ArrowsOutCardinalIcon />
            Open in new pane
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem defaultChecked>Show timestamps</ContextMenuCheckboxItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Sort by</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup defaultValue="recent">
                <ContextMenuRadioItem value="recent">Most recent</ContextMenuRadioItem>
                <ContextMenuRadioItem value="oldest">Oldest first</ContextMenuRadioItem>
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive">
            <TrashIcon />
            Delete session
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  },
};
