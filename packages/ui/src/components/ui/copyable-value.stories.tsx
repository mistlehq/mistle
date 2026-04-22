import { CopyableValue } from "./copyable-value.js";

export default {
  title: "UI/CopyableValue",
  component: CopyableValue,
  tags: ["autodocs"],
};

export const Field = {
  args: {
    label: "Webhook callback URL",
    value: "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_demo",
  },
};

export const FieldLoading = {
  args: {
    label: "Webhook callback URL",
    loading: true,
  },
};
