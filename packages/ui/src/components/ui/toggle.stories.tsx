import { TextBIcon } from "@phosphor-icons/react";

import { Toggle } from "./toggle.js";

export default {
  title: "UI/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  args: {
    children: "Bold",
    defaultPressed: true,
  },
};

export const Default = {};

export const Outline = {
  args: {
    variant: "outline",
    children: "Review mode",
  },
};

export const Icon = {
  args: {
    "aria-label": "Bold",
    children: <TextBIcon />,
    size: "sm",
    variant: "outline",
  },
};
