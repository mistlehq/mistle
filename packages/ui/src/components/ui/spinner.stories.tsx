import { Spinner } from "./spinner.js";

export default {
  title: "UI/Spinner",
  component: Spinner,
  tags: ["autodocs"],
};

export const Default = {};

export const Sizes = {
  render: function Render() {
    return (
      <div className="flex items-center gap-4">
        <Spinner className="size-4" />
        <Spinner className="size-6" />
        <Spinner className="size-8" />
      </div>
    );
  },
};

export const InlineLoadingState = {
  render: function Render() {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Spinner className="text-muted-foreground" />
        <span>Syncing repository permissions</span>
      </div>
    );
  },
};
