import { Skeleton } from "./skeleton.js";

export default {
  title: "UI/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return <Skeleton className="h-4 w-48" />;
  },
};

export const CardPreview = {
  render: function Render() {
    return (
      <div className="max-w-sm space-y-4 rounded-lg border p-4">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-8/12" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
    );
  },
};
