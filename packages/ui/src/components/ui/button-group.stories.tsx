import {
  CalendarDotsIcon,
  ClockCounterClockwiseIcon,
  FadersHorizontalIcon,
} from "@phosphor-icons/react";

import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "./button-group.js";
import { Button } from "./button.js";

export default {
  title: "UI/Button Group",
  component: ButtonGroup,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return (
      <ButtonGroup>
        <Button type="button" variant="outline">
          Day
        </Button>
        <Button type="button" variant="outline">
          Week
        </Button>
        <Button type="button" variant="outline">
          Month
        </Button>
      </ButtonGroup>
    );
  },
};

export const WithTextAndSeparator = {
  render: function Render() {
    return (
      <ButtonGroup>
        <ButtonGroupText>
          <CalendarDotsIcon />
          Last 30 days
        </ButtonGroupText>
        <ButtonGroupSeparator />
        <Button type="button" variant="outline">
          <ClockCounterClockwiseIcon />
          Refresh
        </Button>
        <Button type="button" variant="outline">
          <FadersHorizontalIcon />
          Filters
        </Button>
      </ButtonGroup>
    );
  },
};

export const Vertical = {
  render: function Render() {
    return (
      <ButtonGroup orientation="vertical">
        <Button type="button" variant="outline">
          Overview
        </Button>
        <Button type="button" variant="outline">
          Members
        </Button>
        <Button type="button" variant="outline">
          Billing
        </Button>
      </ButtonGroup>
    );
  },
};
