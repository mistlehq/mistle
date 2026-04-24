import { DetailLabel, DetailLabelWithTooltip } from "./detail-label.js";

export default {
  title: "UI/DetailLabel",
  component: DetailLabel,
  tags: ["autodocs"],
  args: {
    children: "Method",
  },
};

export const Default = {};

export const WithStrongerWeight = {
  args: {
    children: "Tools in sandbox",
    className: "font-semibold",
    as: "p",
  },
};

export const WithTooltip = {
  render: function Render() {
    return (
      <DetailLabelWithTooltip
        as="p"
        tooltip="Shown in shared activity and review queues."
        tooltipLabel="Explain workspace name"
      >
        Workspace name
      </DetailLabelWithTooltip>
    );
  },
};

export const InContext = {
  render: function Render() {
    return (
      <div className="w-full max-w-md rounded-md border p-4">
        <div className="flex flex-col gap-1.5">
          <DetailLabel as="p">Method</DetailLabel>
          <p className="text-sm">GitHub App installation</p>
        </div>
      </div>
    );
  },
};
