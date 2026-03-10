import {
  TextAlignCenterIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextBIcon,
  TextItalicIcon,
} from "@phosphor-icons/react";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";

export default {
  title: "UI/Toggle Group",
  component: ToggleGroup,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <ToggleGroup variant="outline">
        <ToggleGroupItem aria-label="Bold" value="bold">
          <TextBIcon />
        </ToggleGroupItem>
        <ToggleGroupItem aria-label="Italic" value="italic">
          <TextItalicIcon />
        </ToggleGroupItem>
      </ToggleGroup>
    );
  },
};

export const WithSpacing = {
  render: function Render() {
    return (
      <ToggleGroup spacing={1} variant="outline">
        <ToggleGroupItem aria-label="Align left" value="left">
          <TextAlignLeftIcon />
        </ToggleGroupItem>
        <ToggleGroupItem aria-label="Align center" value="center">
          <TextAlignCenterIcon />
        </ToggleGroupItem>
        <ToggleGroupItem aria-label="Align right" value="right">
          <TextAlignRightIcon />
        </ToggleGroupItem>
      </ToggleGroup>
    );
  },
};

export const Vertical = {
  render: function Render() {
    return (
      <ToggleGroup orientation="vertical" variant="outline">
        <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
        <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
        <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
      </ToggleGroup>
    );
  },
};
