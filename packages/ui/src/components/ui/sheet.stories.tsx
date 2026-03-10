import { Button } from "./button.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet.js";

export default {
  title: "UI/Sheet",
  component: Sheet,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Right = {
  render: function Render() {
    return (
      <Sheet defaultOpen>
        <SheetTrigger render={<Button type="button" />}>Open sheet</SheetTrigger>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Workspace settings</SheetTitle>
            <SheetDescription>Manage defaults, access, and review preferences.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 px-4 text-sm">
            <p>Notifications: weekly digest</p>
            <p>Member invites: restricted</p>
            <p>Sandbox approvals: required</p>
          </div>
          <SheetFooter>
            <Button type="button">Save changes</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  },
};

export const Bottom = {
  render: function Render() {
    return (
      <Sheet defaultOpen>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Quick actions</SheetTitle>
            <SheetDescription>
              Run common workspace tasks without leaving the page.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-2 px-4 pb-4 text-sm sm:grid-cols-3">
            <div className="rounded-md border p-3">Create session</div>
            <div className="rounded-md border p-3">Invite member</div>
            <div className="rounded-md border p-3">Export logs</div>
          </div>
        </SheetContent>
      </Sheet>
    );
  },
};
