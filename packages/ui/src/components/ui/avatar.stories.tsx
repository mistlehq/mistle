import { CheckIcon } from "@phosphor-icons/react";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "./avatar.js";

const DemoAvatarImage =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23d97706'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23fde68a'/%3E%3Cpath d='M14 54c4-10 14-16 18-16s14 6 18 16' fill='%23fde68a'/%3E%3C/svg%3E";

export default {
  title: "UI/Avatar",
  component: Avatar,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <Avatar>
        <AvatarImage alt="Mia Wong" src={DemoAvatarImage} />
        <AvatarFallback>MW</AvatarFallback>
      </Avatar>
    );
  },
};

export const WithBadge = {
  render: function Render() {
    return (
      <Avatar size="lg">
        <AvatarImage alt="Mia Wong" src={DemoAvatarImage} />
        <AvatarFallback>MW</AvatarFallback>
        <AvatarBadge>
          <CheckIcon weight="bold" />
        </AvatarBadge>
      </Avatar>
    );
  },
};

export const Group = {
  render: function Render() {
    return (
      <AvatarGroup>
        <Avatar>
          <AvatarImage alt="Mia Wong" src={DemoAvatarImage} />
          <AvatarFallback>MW</AvatarFallback>
        </Avatar>
        <Avatar size="sm">
          <AvatarFallback>AL</AvatarFallback>
        </Avatar>
        <Avatar size="lg">
          <AvatarFallback>RK</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+4</AvatarGroupCount>
      </AvatarGroup>
    );
  },
};
