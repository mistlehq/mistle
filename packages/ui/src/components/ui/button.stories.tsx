import { ArrowCircleUpIcon } from "@phosphor-icons/react";

import { Button } from "./button.js";

export default {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  args: {
    children: "Launch",
    variant: "default",
    size: "default",
    disabled: false,
  },
};

export const Default = {};

export const Outline = {
  args: {
    variant: "outline",
    children: "Secondary action",
  },
};

export const Destructive = {
  args: {
    variant: "destructive",
    children: "Delete profile",
  },
};

export const Disabled = {
  args: {
    disabled: true,
    children: "Processing",
  },
};

export const IconFill = {
  args: {
    "aria-label": "Send message",
    children: <ArrowCircleUpIcon weight="fill" />,
    size: "icon-fill",
  },
};
