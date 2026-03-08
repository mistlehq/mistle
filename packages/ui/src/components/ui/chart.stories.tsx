import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "./chart.js";

const activityData = [
  { day: "Mon", approvals: 12, launches: 4 },
  { day: "Tue", approvals: 18, launches: 6 },
  { day: "Wed", approvals: 15, launches: 5 },
  { day: "Thu", approvals: 22, launches: 9 },
  { day: "Fri", approvals: 19, launches: 7 },
  { day: "Sat", approvals: 9, launches: 2 },
  { day: "Sun", approvals: 11, launches: 3 },
];

const activityConfig = {
  approvals: {
    label: "Approvals",
    color: "oklch(0.58 0.17 254)",
  },
  launches: {
    label: "Launches",
    color: "oklch(0.72 0.16 154)",
  },
};

export default {
  title: "UI/Chart",
  component: ChartContainer,
  tags: ["autodocs"],
};

export const LineChartStory = {
  render: function Render() {
    return (
      <ChartContainer className="h-72 w-[42rem]" config={activityConfig}>
        <LineChart accessibilityLayer data={activityData}>
          <CartesianGrid vertical={false} />
          <XAxis axisLine={false} dataKey="day" tickLine={false} />
          <YAxis axisLine={false} tickLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="approvals"
            dot={false}
            stroke="var(--color-approvals)"
            strokeWidth={2}
            type="monotone"
          />
          <Line
            dataKey="launches"
            dot={false}
            stroke="var(--color-launches)"
            strokeWidth={2}
            type="monotone"
          />
        </LineChart>
      </ChartContainer>
    );
  },
};

export const AreaChartStory = {
  render: function Render() {
    return (
      <ChartContainer className="h-72 w-[42rem]" config={activityConfig}>
        <AreaChart accessibilityLayer data={activityData}>
          <CartesianGrid vertical={false} />
          <XAxis axisLine={false} dataKey="day" tickLine={false} />
          <YAxis axisLine={false} tickLine={false} />
          <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
          <Area
            dataKey="approvals"
            fill="var(--color-approvals)"
            fillOpacity={0.22}
            stroke="var(--color-approvals)"
            strokeWidth={2}
            type="monotone"
          />
          <Area
            dataKey="launches"
            fill="var(--color-launches)"
            fillOpacity={0.18}
            stroke="var(--color-launches)"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ChartContainer>
    );
  },
};
