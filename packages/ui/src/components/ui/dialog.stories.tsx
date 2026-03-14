import { useState } from "react";

import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";

export default {
  title: "UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  render: function Render() {
    return (
      <Dialog defaultOpen>
        <DialogTrigger render={<Button type="button" />}>Open dialog</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm sign out</DialogTitle>
            <DialogDescription>
              Signing out will disconnect this dashboard session on this device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button type="button">Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
};

export const Controlled = {
  render: function Render() {
    const [open, setOpen] = useState(true);

    return (
      <div className="flex min-h-screen items-center justify-center">
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger render={<Button type="button" variant="outline" />}>
            {open ? "Dialog open" : "Reopen dialog"}
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader variant="sectioned">
              <DialogTitle>Sandbox profile settings</DialogTitle>
              <DialogDescription>
                Review the applied configuration before continuing.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm">
                This state is useful for checking spacing, scroll behavior, and footer actions in
                Storybook.
              </p>
              <p className="text-muted-foreground text-sm">
                Use the close button, Escape, or click outside the dialog to close it.
              </p>
            </div>
            <DialogFooter showCloseButton>
              <Button type="button">Save changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
};

export const LockedWhileBusy = {
  render: function Render() {
    const [open, setOpen] = useState(true);

    return (
      <div className="flex min-h-screen items-center justify-center">
        <Dialog isBusy isDismissible={false} onOpenChange={setOpen} open={open}>
          <DialogTrigger render={<Button type="button" variant="outline" />}>
            {open ? "Dialog locked" : "Reopen dialog"}
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader variant="sectioned">
              <DialogTitle>Deleting workspace</DialogTitle>
              <DialogDescription>
                Escape, outside clicks, and the close button are disabled while the request is in
                flight.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm">
                This demonstrates the shared nondismissible state for non-interruptible workflows.
              </p>
              <p className="text-muted-foreground text-sm">
                Footer controls stay explicit, so callers still decide which actions remain enabled.
              </p>
            </div>
            <DialogFooter>
              <Button disabled type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled type="button">
                Deleting...
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  },
};
