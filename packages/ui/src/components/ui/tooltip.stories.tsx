import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export default {
  title: "UI/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="flex min-h-32 items-center justify-center">
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>
            Hover target
          </TooltipTrigger>
          <TooltipContent>Re-run the last successful deployment.</TooltipContent>
        </Tooltip>
      </div>
    );
  },
};

export const SidePositions = {
  render: function Render() {
    return (
      <div className="grid grid-cols-2 gap-6">
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>Top</TooltipTrigger>
          <TooltipContent side="top">Appears above the trigger.</TooltipContent>
        </Tooltip>
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>Right</TooltipTrigger>
          <TooltipContent side="right">Appears to the right.</TooltipContent>
        </Tooltip>
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>
            Bottom
          </TooltipTrigger>
          <TooltipContent side="bottom">Appears below the trigger.</TooltipContent>
        </Tooltip>
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>Left</TooltipTrigger>
          <TooltipContent side="left">Appears to the left.</TooltipContent>
        </Tooltip>
      </div>
    );
  },
};
