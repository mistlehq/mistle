import { addDays } from "date-fns";

import { Calendar } from "./calendar.js";

export default {
  title: "UI/Calendar",
  component: Calendar,
  tags: ["autodocs"],
};

export const Default = {
  render: function Render() {
    return <Calendar mode="single" selected={new Date(2026, 2, 10)} />;
  },
};

export const Range = {
  render: function Render() {
    const start = new Date(2026, 2, 10);
    return <Calendar mode="range" selected={{ from: start, to: addDays(start, 4) }} />;
  },
};
