import { ArrowSquareOutIcon, BooksIcon, RocketLaunchIcon } from "@phosphor-icons/react";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "./navigation-menu.js";

export default {
  title: "UI/Navigation Menu",
  component: NavigationMenu,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuTrigger>Platform</NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="grid w-[420px] gap-2 p-2">
                <NavigationMenuLink href="#">
                  <RocketLaunchIcon />
                  Releases
                </NavigationMenuLink>
                <NavigationMenuLink href="#">
                  <BooksIcon />
                  Documentation
                </NavigationMenuLink>
                <NavigationMenuLink href="#">
                  <ArrowSquareOutIcon />
                  API reference
                </NavigationMenuLink>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink active href="#">
              Changelog
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
        <NavigationMenuIndicator />
      </NavigationMenu>
    );
  },
};
