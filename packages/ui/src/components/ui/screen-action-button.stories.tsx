import { ScreenActionButton } from "./screen-action-button.js";

export default {
  title: "UI/ScreenActionButton",
  component: ScreenActionButton,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Use for simple, uncluttered screens where one of a small number of actions should read as the clear CTA. Typical contexts are auth, invitation, and access-state screens. Avoid using this inside dense toolbars, tables, menus, or forms with many competing actions.",
      },
    },
  },
  args: {
    children: "Continue",
    variant: "default",
    disabled: false,
  },
};

export const Default = {};

export const Outline = {
  args: {
    children: "Back to login",
    variant: "outline",
  },
};

export const Link = {
  args: {
    children: "Use a different email",
    className: "text-zinc-500 hover:text-zinc-700",
    variant: "link",
  },
};
