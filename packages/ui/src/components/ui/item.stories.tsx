import { ArrowSquareOutIcon, GitBranchIcon } from "@phosphor-icons/react";

import { Button } from "./button.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from "./item.js";

export default {
  title: "UI/Item",
  component: Item,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="w-[28rem]">
        <ItemGroup>
          <Item variant="outline">
            <ItemMedia variant="icon">
              <GitBranchIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>control-plane-api</ItemTitle>
              <ItemDescription>
                Owns authentication, organization management, and API keys.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button type="button" size="sm" variant="outline">
                Open
              </Button>
            </ItemActions>
          </Item>
        </ItemGroup>
      </div>
    );
  },
};

export const Grouped = {
  render: function Render() {
    return (
      <div className="w-[30rem]">
        <ItemGroup>
          <Item size="sm" variant="muted">
            <ItemContent>
              <ItemTitle>Dashboard redesign</ItemTitle>
              <ItemDescription>Last updated 2 hours ago by the platform team.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ArrowSquareOutIcon />
            </ItemActions>
          </Item>
          <ItemSeparator />
          <Item size="sm">
            <ItemContent>
              <ItemTitle>Sandbox runtime migration</ItemTitle>
              <ItemDescription>
                Queued for review after the release branch stabilizes.
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </div>
    );
  },
};
