import { Checkbox } from "./checkbox.js";
import { Field, FieldDescription, FieldHeader } from "./field.js";
import { Label } from "./label.js";

export default {
  title: "UI/Label",
  component: Label,
  tags: ["autodocs"],
  args: {
    children: "API token",
  },
};

export const Default = {};

export const WithFieldControl = {
  render: function Render() {
    return (
      <Field orientation="horizontal">
        <Checkbox defaultChecked id="incident-alerts" />
        <Label htmlFor="incident-alerts">Incident alerts</Label>
      </Field>
    );
  },
};

export const WithFieldControlDescription = {
  render: function Render() {
    return (
      <Field orientation="horizontal">
        <Checkbox defaultChecked id="incident-alerts" />
        <FieldHeader>
          <Label htmlFor="incident-alerts">Incident alerts</Label>
          <FieldDescription>
            Notify the on-call rotation when a production incident is detected.
          </FieldDescription>
        </FieldHeader>
      </Field>
    );
  },
};
