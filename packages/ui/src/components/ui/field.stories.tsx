import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "./field.js";
import { Input } from "./input.js";
import { Textarea } from "./textarea.js";

export default {
  title: "UI/Field",
  component: Field,
  tags: ["autodocs"],
};

export const Vertical = {
  render: function Render() {
    return (
      <div className="w-[24rem]">
        <Field>
          <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
          <FieldContent>
            <FieldDescription>The display name shown in the dashboard sidebar.</FieldDescription>
            <Input defaultValue="Mistle Labs" id="organization-name" />
          </FieldContent>
        </Field>
      </div>
    );
  },
};

export const WithError = {
  render: function Render() {
    return (
      <div className="w-[24rem]">
        <Field data-invalid orientation="vertical">
          <FieldLabel htmlFor="api-key">API key</FieldLabel>
          <FieldContent>
            <FieldDescription>
              Paste the credential used for outbound sandbox access.
            </FieldDescription>
            <Input aria-invalid defaultValue="sk-invalid" id="api-key" />
            <FieldError errors={[{ message: "API key format is invalid." }]} />
          </FieldContent>
        </Field>
      </div>
    );
  },
};

export const Horizontal = {
  render: function Render() {
    return (
      <div className="w-[40rem]">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="profile-notes">Notes</FieldLabel>
          <FieldContent>
            <FieldDescription>
              Add internal guidance for anyone launching this profile.
            </FieldDescription>
            <Textarea
              defaultValue="Use this profile for reviewing pull requests and verifying command approvals."
              id="profile-notes"
            />
          </FieldContent>
        </Field>
      </div>
    );
  },
};
