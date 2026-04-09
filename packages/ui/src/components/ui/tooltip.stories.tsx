import { Button } from "./button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

const WrappedPayloadText =
  '{"event":"session.bootstrap","payload":{"profile":"repo-maintainer","files":["sessions-sidebar-nav.tsx","sessions-sidebar-nav.test.tsx"],"message":"This payload should wrap cleanly inside the tooltip without requiring internal scrolling."},"metadata":{"user":"jonathan.low@example.com"}}';

const ScrollablePayloadText =
  '{"event":"session.bootstrap","payload":{"requestId":"req_01JSW2S6YVB4TQ2GJ1F9V2A6M3","workspaceId":"ws_01JSW2S6YVB4TQ2GJ1F9V2A6M3","profile":"repo-maintainer","messages":[{"index":1,"text":"Investigate tooltip overflow for extremely long unwrapped JSON content in the sessions sidebar tooltip rendering path."},{"index":2,"text":"Verify wrapping keeps the tooltip contained without forcing the page layout to stretch."},{"index":3,"text":"Confirm max-height introduces internal scrolling once the tooltip exceeds the viewport-safe height cap."},{"index":4,"text":"Check that long file paths still wrap correctly even when they contain repeated slash-delimited segments."},{"index":5,"text":"apps/dashboard/src/features/navigation/sessions-sidebar-nav.tsx"},{"index":6,"text":"apps/dashboard/src/features/navigation/sessions-sidebar-nav.test.tsx"},{"index":7,"text":"apps/dashboard/src/features/pages/sessions-sidebar.stories.tsx"},{"index":8,"text":"packages/ui/src/components/ui/tooltip.tsx"},{"index":9,"text":"The tooltip should remain readable on desktop and narrow viewports."},{"index":10,"text":"The payload is intentionally verbose so Storybook demonstrates the scroll state, not just the wrapped state."}],"metadata":{"trace":"trace_01JSW2S6YVB4TQ2GJ1F9V2A6M3","span":"span_01JSW2S6YVB4TQ2GJ1F9V2A6M3","user":"jonathan.low@example.com","environment":"storybook","note":"This entry is intentionally oversized to force tooltip scrolling."}}}';

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

export const LightVariant = {
  render: function Render() {
    return (
      <div className="flex min-h-32 items-center justify-center gap-6">
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>
            Light with arrow
          </TooltipTrigger>
          <TooltipContent side="top" variant="light">
            Uses the light surface treatment.
          </TooltipContent>
        </Tooltip>
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>
            Light without arrow
          </TooltipTrigger>
          <TooltipContent showArrow={false} side="top" variant="light">
            Uses the light surface treatment without an arrow.
          </TooltipContent>
        </Tooltip>
      </div>
    );
  },
};

export const WrappedLongContent = {
  render: function Render() {
    return (
      <div className="flex min-h-32 items-center justify-center">
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>
            Wrapped payload
          </TooltipTrigger>
          <TooltipContent
            className="[&_[data-slot=tooltip-scroll]]:max-h-56"
            showArrow={false}
            side="top"
            variant="light"
          >
            {WrappedPayloadText}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  },
};

export const ScrollableLongContent = {
  render: function Render() {
    return (
      <div className="flex min-h-32 items-center justify-center">
        <Tooltip open>
          <TooltipTrigger render={<Button type="button" variant="outline" />}>
            Scrollable payload
          </TooltipTrigger>
          <TooltipContent
            className="[&_[data-slot=tooltip-scroll]]:max-h-56"
            showArrow={false}
            side="top"
            variant="light"
          >
            {ScrollablePayloadText}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  },
};
