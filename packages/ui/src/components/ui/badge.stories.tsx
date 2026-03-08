import { Badge } from "./badge.js";

export default {
  title: "UI/Badge",
  component: Badge,
  tags: ["autodocs"],
  args: {
    children: "Active",
    variant: "default",
  },
};

export const Default = {};

export const Secondary = {
  args: {
    variant: "secondary",
    children: "Draft",
  },
};

export const Outline = {
  args: {
    variant: "outline",
    children: "Manual approval",
  },
};

export const Destructive = {
  args: {
    variant: "destructive",
    children: "Invalid config",
  },
};

export const Link = {
  args: {
    render: <a href="https://example.com" />,
    variant: "link",
    children: "Read policy",
  },
};
