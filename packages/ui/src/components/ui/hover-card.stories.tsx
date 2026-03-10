import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card.js";

export default {
  title: "UI/Hover Card",
  component: HoverCard,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <HoverCard defaultOpen>
          <HoverCardTrigger className="text-sm font-medium underline underline-offset-4">
            @platform-team
          </HoverCardTrigger>
          <HoverCardContent>
            <div className="space-y-2">
              <p className="font-medium">Platform Team</p>
              <p className="text-muted-foreground text-sm">
                Maintains deployment workflows, sandbox profiles, and internal UI primitives.
              </p>
            </div>
          </HoverCardContent>
        </HoverCard>
      </div>
    );
  },
};
