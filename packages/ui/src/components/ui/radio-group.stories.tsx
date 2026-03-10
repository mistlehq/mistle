import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "./field.js";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";

export default {
  title: "UI/Radio Group",
  component: RadioGroup,
  tags: ["autodocs"],
  args: {
    defaultValue: "automatic",
  },
};

export const Default = {
  render: function Render(args: { defaultValue: string }) {
    return (
      <FieldSet className="max-w-md">
        <FieldLegend>Deployment strategy</FieldLegend>
        <RadioGroup {...args}>
          <Field orientation="horizontal">
            <RadioGroupItem id="deploy-automatic" value="automatic" />
            <FieldLabel htmlFor="deploy-automatic">
              Automatic rollout
              <FieldDescription>Ship changes immediately after all checks pass.</FieldDescription>
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem id="deploy-manual" value="manual" />
            <FieldLabel htmlFor="deploy-manual">
              Manual approval
              <FieldDescription>
                Require a release manager to confirm each deployment.
              </FieldDescription>
            </FieldLabel>
          </Field>
        </RadioGroup>
      </FieldSet>
    );
  },
};

export const DisabledOption = {
  render: function Render() {
    return (
      <FieldSet className="max-w-md">
        <FieldLegend>Access duration</FieldLegend>
        <RadioGroup defaultValue="30-days">
          <Field orientation="horizontal">
            <RadioGroupItem id="access-7-days" value="7-days" />
            <FieldLabel htmlFor="access-7-days">7 days</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <RadioGroupItem disabled id="access-30-days" value="30-days" />
            <FieldLabel htmlFor="access-30-days">
              30 days
              <FieldDescription>
                This plan is unavailable on the current workspace tier.
              </FieldDescription>
            </FieldLabel>
          </Field>
        </RadioGroup>
      </FieldSet>
    );
  },
};
