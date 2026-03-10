import { AtIcon, MagnifyingGlassIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group.js";

export default {
  title: "UI/Input Group",
  component: InputGroup,
  tags: ["autodocs"],
};

export const WithInlineAddons = {
  render: function Render() {
    return (
      <div className="w-80">
        <InputGroup>
          <InputGroupAddon>
            <AtIcon />
          </InputGroupAddon>
          <InputGroupInput defaultValue="platform-team" placeholder="Workspace handle" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>.mistle.dev</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  },
};

export const WithAction = {
  render: function Render() {
    return (
      <div className="w-96">
        <InputGroup>
          <InputGroupAddon>
            <MagnifyingGlassIcon />
          </InputGroupAddon>
          <InputGroupInput defaultValue="deployment logs" placeholder="Search activity" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton aria-label="Search" size="icon-xs">
              <PaperPlaneTiltIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  },
};

export const WithTextarea = {
  render: function Render() {
    return (
      <div className="w-96">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Review notes</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea
            defaultValue="Flag the auth flow copy before the next internal release."
            rows={4}
          />
          <InputGroupAddon align="block-end">
            <InputGroupText>Saved to the release checklist</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  },
};
