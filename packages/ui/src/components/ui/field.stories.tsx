import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldHeader,
  FieldLabel,
} from "./field.js";
import { Input } from "./input.js";

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
            <Input aria-invalid defaultValue="sk-invalid" id="api-key" />
            <FieldError errors={[{ message: "API key format is invalid." }]} />
          </FieldContent>
        </Field>
      </div>
    );
  },
};

export const VerticalWithDescription = {
  render: function Render() {
    return (
      <div className="w-[24rem]">
        <Field>
          <FieldHeader>
            <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
            <FieldDescription>
              The display name shown in shared activity and review queues.
            </FieldDescription>
          </FieldHeader>
          <FieldContent>
            <Input defaultValue="Platform Engineering" id="workspace-name" />
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
        <Field contentWidth="fill" orientation="horizontal">
          <FieldLabel htmlFor="profile-name">Profile name</FieldLabel>
          <FieldContent>
            <Input defaultValue="Coder" id="profile-name" />
          </FieldContent>
        </Field>
      </div>
    );
  },
};

export const HorizontalWithDescription = {
  render: function Render() {
    return (
      <div className="w-[40rem]">
        <Field contentWidth="fill" orientation="horizontal">
          <FieldHeader>
            <FieldLabel htmlFor="profile-notes">Profile notes</FieldLabel>
            <FieldDescription>
              Add internal guidance for anyone launching this profile.
            </FieldDescription>
          </FieldHeader>
          <FieldContent>
            <Input defaultValue="Use for code review and command approvals." id="profile-notes" />
          </FieldContent>
        </Field>
      </div>
    );
  },
};
