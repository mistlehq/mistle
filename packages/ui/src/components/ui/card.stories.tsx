import { DotsThreeIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge.js";
import { Button } from "./button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card.js";

const meta = {
  title: "UI/Card",
  component: Card,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <Card className="w-[380px]">
        <CardHeader>
          <CardTitle>Session review</CardTitle>
          <CardDescription>Inspect the latest sandbox execution before publishing.</CardDescription>
          <CardAction>
            <Button size="icon-sm" type="button" variant="ghost">
              <DotsThreeIcon />
              <span className="sr-only">Open card actions</span>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span className="text-sm font-medium">Build status</span>
            <Badge variant="secondary">Ready</Badge>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">
            All required bindings are configured and the last validation run completed without
            issues.
          </p>
        </CardContent>
        <CardFooter className="border-t justify-end gap-2">
          <Button type="button" variant="outline">
            View logs
          </Button>
          <Button type="button">Deploy</Button>
        </CardFooter>
      </Card>
    );
  },
};

export const Compact: Story = {
  render: function Render() {
    return (
      <Card className="w-[320px]" size="sm">
        <CardHeader className="border-b">
          <CardTitle>Organization quota</CardTitle>
          <CardDescription>Monthly sandbox runtime consumption</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="text-2xl font-semibold">184 / 240 hours</div>
            <p className="text-muted-foreground text-sm">
              56 hours remain before the next billing cycle.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  },
};
