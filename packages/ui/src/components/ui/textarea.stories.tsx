import { Textarea } from "./textarea.js";

export default {
  title: "UI/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  args: {
    placeholder: "Describe the sandbox profile behavior",
  },
};

export const Default = {};

export const WithValue = {
  args: {
    defaultValue:
      "This profile is optimized for reviewing repository changes and validating command approval flows.",
  },
};

export const Invalid = {
  args: {
    "aria-invalid": true,
    defaultValue: "Missing required validation details.",
  },
};

export const Disabled = {
  args: {
    disabled: true,
    defaultValue: "This setting is managed by the workspace administrator.",
  },
};
