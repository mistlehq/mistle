import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "./badge.js";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.js";

const meta = {
  title: "UI/Table",
  component: Table,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <div className="mx-auto max-w-4xl">
        <Table>
          <TableCaption>Recent sandbox sessions across the active organization.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Runtime</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">codex-review-214</TableCell>
              <TableCell>
                <Badge>Running</Badge>
              </TableCell>
              <TableCell>18m 42s</TableCell>
              <TableCell className="text-right">2m ago</TableCell>
            </TableRow>
            <TableRow data-state="selected">
              <TableCell className="font-medium">sandbox-github-sync</TableCell>
              <TableCell>
                <Badge variant="secondary">Idle</Badge>
              </TableCell>
              <TableCell>1h 06m</TableCell>
              <TableCell className="text-right">12m ago</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">fix-drizzle-plan</TableCell>
              <TableCell>
                <Badge variant="destructive">Failed</Badge>
              </TableCell>
              <TableCell>6m 11s</TableCell>
              <TableCell className="text-right">27m ago</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>3 sessions</TableCell>
              <TableCell className="text-right">1 requiring attention</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    );
  },
};
