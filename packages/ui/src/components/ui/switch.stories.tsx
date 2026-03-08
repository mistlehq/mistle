import type { Meta, StoryObj } from "@storybook/react-vite";

import { Field, FieldContent, FieldDescription, FieldLabel, FieldSet } from "./field.js";
import { Switch } from "./switch.js";

const meta = {
  title: "UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    return (
      <FieldSet className="w-[420px]">
        <Field orientation="horizontal">
          <FieldContent>
            <div className="space-y-1">
              <FieldLabel>Enable approvals</FieldLabel>
              <FieldDescription>
                Require explicit confirmation before destructive file system changes.
              </FieldDescription>
            </div>
          </FieldContent>
          <Switch aria-label="Enable approvals" defaultChecked />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <div className="space-y-1">
              <FieldLabel>Compact density</FieldLabel>
              <FieldDescription>
                Reduce vertical spacing in sidebar and session tables.
              </FieldDescription>
            </div>
          </FieldContent>
          <Switch aria-label="Compact density" size="sm" />
        </Field>
      </FieldSet>
    );
  },
};
