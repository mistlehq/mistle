import { Separator } from "./separator.js";

export default {
  title: "UI/Separator",
  component: Separator,
  tags: ["autodocs"],
};

export const Horizontal = {
  render: function Render() {
    return (
      <div className="max-w-md space-y-4">
        <div>
          <p className="text-sm font-medium">Workspace settings</p>
          <p className="text-muted-foreground text-sm">
            Control notifications, billing, and access.
          </p>
        </div>
        <Separator />
        <div>
          <p className="text-sm font-medium">Danger zone</p>
          <p className="text-muted-foreground text-sm">
            Archive or permanently delete this workspace.
          </p>
        </div>
      </div>
    );
  },
};

export const Vertical = {
  render: function Render() {
    return (
      <div className="flex h-8 items-center gap-4">
        <span className="text-sm">Overview</span>
        <Separator orientation="vertical" />
        <span className="text-sm">Members</span>
        <Separator orientation="vertical" />
        <span className="text-sm">Billing</span>
      </div>
    );
  },
};
