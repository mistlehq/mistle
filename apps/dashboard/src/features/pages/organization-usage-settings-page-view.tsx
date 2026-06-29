import {
  Notice,
  OverflowTooltipText,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";

import { FormPageHeader, FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationUsageSummaryMetric = {
  id: string;
  label: string;
  value: string;
};

export type OrganizationUsageDailyPoint = {
  day: string;
  sandboxHours: number;
  runCount: number;
};

export type OrganizationUsageBreakdownRow = {
  id: string;
  label: string;
  detail: string;
  sandboxHours: number;
  vcpuHours: number;
  memoryGbHours: number;
  storageGbHours: number;
  sharePercent: number;
  runCount: number;
};

export type OrganizationUsageSettingsPageViewProps = {
  period: {
    range: string;
  };
  measurement: {
    notice: string | null;
  };
  summaryMetrics: readonly OrganizationUsageSummaryMetric[];
  dailyUsage: readonly OrganizationUsageDailyPoint[];
  profileBreakdown: readonly OrganizationUsageBreakdownRow[];
  activityBreakdown: readonly OrganizationUsageBreakdownRow[];
};

export function OrganizationUsageSettingsPageView(
  props: OrganizationUsageSettingsPageViewProps,
): React.JSX.Element {
  return (
    <FormPageStack className="gap-5">
      <FormPageHeader
        titleSlot={
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-xl font-semibold">Usage</h1>
            <span className="text-base font-medium text-muted-foreground">
              {props.period.range}
            </span>
          </div>
        }
      />

      {props.measurement.notice === null ? null : (
        <Notice variant="warning">{props.measurement.notice}</Notice>
      )}

      <section className="grid gap-3 md:grid-cols-6">
        {props.summaryMetrics.map((metric) => (
          <SummaryMetricCard key={metric.id} metric={metric} />
        ))}
      </section>

      <FormPageSection
        header={<SectionHeading title="Daily sandbox hours" detail="Runtime by day" />}
      >
        <div className="p-4">
          <DailyUsageChart points={props.dailyUsage} />
        </div>
      </FormPageSection>

      <section className="grid gap-5">
        <UsageBreakdownTable
          labelColumnHeader="Sandbox profile"
          rows={props.profileBreakdown}
          title="By sandbox profile"
        />
        <UsageBreakdownTable
          labelColumnHeader="Activity"
          rows={props.activityBreakdown}
          title="By activity"
        />
      </section>
    </FormPageStack>
  );
}

function SummaryMetricCard(input: { metric: OrganizationUsageSummaryMetric }): React.JSX.Element {
  const isPrimaryMetric = input.metric.id === "sandbox-hours" || input.metric.id === "sandbox-runs";

  return (
    <div
      className={
        isPrimaryMetric
          ? "rounded border bg-card p-4 md:col-span-3"
          : "rounded border bg-card p-4 md:col-span-2"
      }
    >
      <p className="truncate text-sm text-muted-foreground">{input.metric.label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
        {input.metric.value}
      </p>
    </div>
  );
}

function DailyUsageChart(input: {
  points: readonly OrganizationUsageDailyPoint[];
}): React.JSX.Element {
  if (input.points.length === 0) {
    return <p className="text-sm text-muted-foreground">No daily usage data is available.</p>;
  }

  const maxSandboxHours = Math.max(...input.points.map((point) => point.sandboxHours), 1);
  const axisMax = Math.ceil(maxSandboxHours / 10) * 10;
  const axisTicks = [axisMax, axisMax * 0.75, axisMax * 0.5, axisMax * 0.25, 0];
  const chartColumnWidthPx = 44;
  const chartMinContentWidthPx = Math.max(input.points.length * chartColumnWidthPx, 720);
  const chartGridStyle = {
    gridTemplateColumns: `repeat(${String(input.points.length)}, ${String(chartColumnWidthPx)}px)`,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
        <div className="flex h-80 flex-col gap-2">
          <div className="text-right text-xs text-muted-foreground">Hours</div>
          <div className="relative h-full">
            {axisTicks.map((tick) => (
              <span
                className="absolute right-0 -translate-y-1/2 text-right text-[11px] text-muted-foreground tabular-nums"
                key={tick}
                style={{ top: `${100 - (tick / axisMax) * 100}%` }}
              >
                {tick.toFixed(0)}
              </span>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div
            className="relative h-80"
            style={{ minWidth: `${String(chartMinContentWidthPx)}px`, width: "100%" }}
          >
            <div className="relative h-full border-b border-l">
              {axisTicks.slice(0, -1).map((tick) => (
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-border"
                  key={tick}
                  style={{ top: `${100 - (tick / axisMax) * 100}%` }}
                />
              ))}
              <div className="relative z-10 grid h-full items-end gap-2" style={chartGridStyle}>
                {input.points.map((point, index) => {
                  const heightPercent =
                    point.sandboxHours === 0
                      ? 0
                      : Math.max((point.sandboxHours / axisMax) * 100, 3);

                  return (
                    <div
                      className="group relative flex h-full min-w-0 items-end justify-center"
                      key={point.day}
                    >
                      <div
                        aria-label={`${point.day}: ${formatHours(point.sandboxHours)}, ${point.runCount} runs`}
                        className={
                          point.sandboxHours === 0
                            ? "relative min-h-px w-full max-w-8 bg-muted transition-colors group-hover:bg-muted-foreground/30"
                            : "relative w-full max-w-8 rounded-t bg-primary transition-colors group-hover:bg-primary/80"
                        }
                        style={{ height: `${heightPercent}%` }}
                      />
                      <div className={getChartTooltipClassName(index, input.points.length)}>
                        <div className="font-medium text-popover-foreground">{point.day}</div>
                        <div className="mt-1 text-muted-foreground">
                          {formatHours(point.sandboxHours)} sandbox hours
                        </div>
                        <div className="text-muted-foreground">{point.runCount} runs</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div
            className="grid gap-2 pt-2 text-center text-[11px] text-muted-foreground"
            style={{
              ...chartGridStyle,
              minWidth: `${String(chartMinContentWidthPx)}px`,
              width: "100%",
            }}
          >
            {input.points.map((point) => (
              <span key={point.day}>{formatXAxisDay(point.day)}</span>
            ))}
          </div>
          <div
            className="pt-1 text-center text-xs text-muted-foreground"
            style={{ minWidth: `${String(chartMinContentWidthPx)}px`, width: "100%" }}
          >
            Day of month
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading(input: { title: string; detail: string }): React.JSX.Element {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">{input.title}</h2>
        {input.detail.length === 0 ? null : (
          <p className="truncate text-sm text-muted-foreground">{input.detail}</p>
        )}
      </div>
    </div>
  );
}

function UsageBreakdownTable(input: {
  labelColumnHeader: string;
  rows: readonly OrganizationUsageBreakdownRow[];
  title: string;
  detail?: string;
}): React.JSX.Element {
  return (
    <FormPageSection header={<SectionHeading title={input.title} detail={input.detail ?? ""} />}>
      <div className="overflow-x-auto">
        <Table className="min-w-[54rem] table-fixed">
          <TableHeader className="bg-muted/60">
            <TableRow className="h-9 border-b">
              <TableHead className="w-[22%] py-2 text-[11px] font-semibold tracking-wide text-foreground uppercase">
                {input.labelColumnHeader}
              </TableHead>
              <TableHead className="w-[14%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Sandbox
              </TableHead>
              <TableHead className="w-[14%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                vCPU
              </TableHead>
              <TableHead className="w-[16%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Memory
              </TableHead>
              <TableHead className="w-[16%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Storage
              </TableHead>
              <TableHead className="w-[9%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Runs
              </TableHead>
              <TableHead className="w-[9%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Share
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {input.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-0 align-top">
                  <div className="flex min-w-0 flex-col gap-1">
                    <OverflowTooltipText
                      className="font-medium"
                      text={row.label}
                      tooltipSide="right"
                    />
                    {row.detail.length === 0 ? null : (
                      <OverflowTooltipText
                        className="text-sm text-muted-foreground"
                        text={row.detail}
                        tooltipSide="right"
                      />
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top text-right text-sm">
                  {formatHours(row.sandboxHours)}
                </TableCell>
                <TableCell className="align-top text-right text-sm">
                  {formatResourceHours(row.vcpuHours)}
                </TableCell>
                <TableCell className="align-top text-right text-sm">
                  {formatResourceHours(row.memoryGbHours)}
                </TableCell>
                <TableCell className="align-top text-right text-sm">
                  {formatResourceHours(row.storageGbHours)}
                </TableCell>
                <TableCell className="align-top text-right text-sm">{row.runCount}</TableCell>
                <TableCell className="align-top text-right text-sm">
                  {row.sandboxHours === 0 ? null : `${String(row.sharePercent)}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </FormPageSection>
  );
}

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function formatResourceHours(value: number): string {
  return value.toFixed(1);
}

function formatXAxisDay(value: string): string {
  const day = value.trim().split(" ").at(-1);
  return day === undefined || day.length === 0 ? value : day;
}

function getChartTooltipClassName(index: number, pointCount: number): string {
  const baseClassName =
    "pointer-events-none absolute top-2 z-20 hidden min-w-36 rounded border bg-popover px-3 py-2 text-left text-xs shadow-md group-hover:block";

  if (index === 0) {
    return `${baseClassName} left-0`;
  }

  if (index === pointCount - 1) {
    return `${baseClassName} right-0`;
  }

  return `${baseClassName} left-1/2 -translate-x-1/2`;
}
