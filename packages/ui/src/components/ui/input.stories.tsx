import { Input } from "./input.js";

export default {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  args: {
    placeholder: "Organization name",
  },
};

export const Default = {};

export const WithValue = {
  args: {
    defaultValue: "Acme Labs",
  },
};

export const Invalid = {
  args: {
    "aria-invalid": true,
    defaultValue: "bad-value",
  },
};

export const Disabled = {
  args: {
    disabled: true,
    defaultValue: "Read only value",
  },
};
