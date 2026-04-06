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
        <Table className="min-w-[40rem]">
          <TableCaption>Recent sandbox sessions across the active organization.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Session</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="whitespace-nowrap">Runtime</TableHead>
              <TableHead className="text-right whitespace-nowrap">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium whitespace-normal break-words">
                codex-review-214-with-a-longer-name
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge>Running</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">18m 42s</TableCell>
              <TableCell className="text-right whitespace-nowrap">2m ago</TableCell>
            </TableRow>
            <TableRow data-state="selected">
              <TableCell className="font-medium whitespace-normal break-words">
                sandbox-github-sync
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge variant="secondary">Idle</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">1h 06m</TableCell>
              <TableCell className="text-right whitespace-nowrap">12m ago</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium whitespace-normal break-words">
                fix-drizzle-plan
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge variant="destructive">Failed</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap">6m 11s</TableCell>
              <TableCell className="text-right whitespace-nowrap">27m ago</TableCell>
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
