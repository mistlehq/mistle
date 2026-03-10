import { Button } from "./button.js";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./drawer.js";

export default {
  title: "UI/Drawer",
  component: Drawer,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Bottom = {
  render: function Render() {
    return (
      <Drawer defaultOpen>
        <DrawerTrigger>Open drawer</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Create sandbox profile</DrawerTitle>
            <DrawerDescription>
              Start from a preset and refine bindings before publishing.
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 pb-4 text-sm">
            <p>Profiles bundle integrations, policies, and session defaults for a workspace.</p>
            <p className="text-muted-foreground">
              This story documents spacing, stacking, and footer behavior for drawer layouts.
            </p>
          </div>
          <DrawerFooter>
            <Button type="button">Create profile</Button>
            <DrawerClose>Cancel</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  },
};

export const Right = {
  render: function Render() {
    return (
      <Drawer defaultOpen direction="right">
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Deployment details</DrawerTitle>
            <DrawerDescription>Review the last rollout without leaving the page.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-3 px-4 text-sm">
            <p>Commit: `21a9597`</p>
            <p>Environment: production</p>
            <p>Status: successful</p>
          </div>
          <DrawerFooter>
            <DrawerClose>Close</DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  },
};
