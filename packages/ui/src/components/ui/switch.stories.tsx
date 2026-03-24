import type { Meta, StoryObj } from "@storybook/react-vite";

import { Field, FieldDescription, FieldHeader, FieldLabel, FieldSet } from "./field.js";
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
        <Field
          className="items-center has-[>[data-slot=field-content]]:items-center"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel>Enable approvals</FieldLabel>
          </FieldContent>
          <Switch aria-label="Enable approvals" defaultChecked />
        </Field>
        <Field
          className="items-center has-[>[data-slot=field-content]]:items-center"
          orientation="horizontal"
        >
          <FieldContent>
            <FieldLabel>Dense session tables</FieldLabel>
          </FieldContent>
          <Switch aria-label="Dense session tables" size="sm" />
        </Field>
      </FieldSet>
    );
  },
};

export const WithDescriptions: Story = {
  render: function Render() {
    return (
      <FieldSet className="w-[420px]">
        <Field orientation="horizontal">
          <FieldHeader>
            <FieldLabel>Enable approvals</FieldLabel>
            <FieldDescription>
              Require explicit confirmation before destructive file system changes.
            </FieldDescription>
          </FieldHeader>
          <Switch aria-label="Enable approvals" defaultChecked />
        </Field>
        <Field orientation="horizontal">
          <FieldHeader>
            <FieldLabel>Dense session tables</FieldLabel>
            <FieldDescription>
              Reduce vertical spacing in sidebar and session tables.
            </FieldDescription>
          </FieldHeader>
          <Switch aria-label="Dense session tables" size="sm" />
        </Field>
      </FieldSet>
    );
  },
};
