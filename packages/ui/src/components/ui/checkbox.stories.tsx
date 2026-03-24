import { Checkbox } from "./checkbox.js";
import { Field, FieldDescription, FieldHeader, FieldLabel } from "./field.js";

export default {
  title: "UI/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  args: {
    defaultChecked: true,
    disabled: false,
  },
};

export const Default = {};

export const WithLabel = {
  render: function Render() {
    return (
      <Field orientation="horizontal">
        <Checkbox defaultChecked id="email-updates" />
        <FieldLabel htmlFor="email-updates">Email updates</FieldLabel>
      </Field>
    );
  },
};

export const WithDescription = {
  render: function Render() {
    return (
      <Field orientation="horizontal">
        <Checkbox defaultChecked id="email-updates" />
        <FieldHeader>
          <FieldLabel htmlFor="email-updates">Email updates</FieldLabel>
          <FieldDescription>
            Send activity summaries and review reminders to this workspace email address.
          </FieldDescription>
        </FieldHeader>
      </Field>
    );
  },
};

export const Disabled = {
  args: {
    disabled: true,
  },
};
