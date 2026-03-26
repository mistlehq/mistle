import { InlineCode } from "./inline-code.js";

export default {
  title: "UI/InlineCode",
  component: InlineCode,
  tags: ["autodocs"],
  args: {
    children: "payload.repository.full_name",
  },
};

export const Default = {};

export const Muted = {
  args: {
    variant: "muted",
  },
};

export const InSentence = {
  render: function Render() {
    return (
      <p className="text-sm">
        Use Liquid syntax with{" "}
        <InlineCode variant="muted">{"{{webhookEvent.eventType}}"}</InlineCode> and{" "}
        <InlineCode variant="muted">{"{{payload}}"}</InlineCode>.
      </p>
    );
  },
};
