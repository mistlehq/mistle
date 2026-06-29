import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mistle/ui";

import { FormPageHeader, FormPageSection, FormPageStack } from "../shared/form-page.js";

export type OrganizationUsagePeriodKind = "calendar_month" | "subscription_period";

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

      <section className="grid gap-5 xl:grid-cols-2">
        <UsageBreakdownTable rows={props.profileBreakdown} title="By sandbox profile" />
        <UsageBreakdownTable rows={props.activityBreakdown} title="By activity" />
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
  const maxSandboxHours = Math.max(...input.points.map((point) => point.sandboxHours), 1);
  const axisMax = Math.ceil(maxSandboxHours / 10) * 10;
  const axisTicks = [axisMax, axisMax * 0.75, axisMax * 0.5, axisMax * 0.25, 0];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-primary" />
        Sandbox hours
      </div>
      <div className="grid h-72 grid-cols-[3rem_minmax(0,1fr)] gap-3">
        <div className="relative h-full text-right text-[11px] text-muted-foreground tabular-nums">
          {axisTicks.map((tick) => (
            <span
              className="absolute right-0 -translate-y-1/2"
              key={tick}
              style={{ top: `${100 - (tick / axisMax) * 100}%` }}
            >
              {tick.toFixed(0)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 border-b border-l">
          {axisTicks.slice(0, -1).map((tick) => (
            <div
              className="absolute left-0 right-0 border-t border-dashed border-border"
              key={tick}
              style={{ top: `${100 - (tick / axisMax) * 100}%` }}
            />
          ))}
          <div className="relative z-10 grid h-full grid-cols-10 items-end gap-2 px-2 pt-4">
            {input.points.map((point) => {
              const heightPercent = Math.max((point.sandboxHours / axisMax) * 100, 3);

              return (
                <div
                  className="group relative flex h-full min-w-0 items-end justify-center"
                  key={point.day}
                >
                  <div
                    aria-label={`${point.day}: ${formatHours(point.sandboxHours)}, ${point.runCount} runs`}
                    className="relative w-full max-w-8 rounded-t bg-primary transition-colors group-hover:bg-primary/80"
                    style={{ height: `${heightPercent}%` }}
                  >
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden min-w-36 -translate-x-1/2 rounded border bg-popover px-3 py-2 text-left text-xs shadow-md group-hover:block">
                      <div className="font-medium text-popover-foreground">{point.day}</div>
                      <div className="mt-1 text-muted-foreground">
                        {formatHours(point.sandboxHours)} sandbox hours
                      </div>
                      <div className="text-muted-foreground">{point.runCount} runs</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
        <div />
        <div className="grid grid-cols-10 gap-2 px-2 text-center text-[11px] text-muted-foreground">
          {input.points.map((point) => (
            <span className="truncate" key={point.day}>
              {point.day}
            </span>
          ))}
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
              <TableHead className="w-[31%] py-2 text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Segment
              </TableHead>
              <TableHead className="w-[13%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Sandbox
              </TableHead>
              <TableHead className="w-[13%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                vCPU
              </TableHead>
              <TableHead className="w-[15%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Memory
              </TableHead>
              <TableHead className="w-[15%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Storage
              </TableHead>
              <TableHead className="w-[8%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Runs
              </TableHead>
              <TableHead className="w-[5%] py-2 text-right text-[11px] font-semibold tracking-wide text-foreground uppercase">
                Share
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {input.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-0 align-top">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium">{row.label}</span>
                    <span className="truncate text-sm text-muted-foreground">{row.detail}</span>
                  </div>
                </TableCell>
                <TableCell className="align-top text-right font-mono text-sm tabular-nums">
                  {formatHours(row.sandboxHours)}
                </TableCell>
                <TableCell className="align-top text-right font-mono text-sm tabular-nums">
                  {formatResourceHours(row.vcpuHours)}
                </TableCell>
                <TableCell className="align-top text-right font-mono text-sm tabular-nums">
                  {formatResourceHours(row.memoryGbHours)}
                </TableCell>
                <TableCell className="align-top text-right font-mono text-sm tabular-nums">
                  {formatResourceHours(row.storageGbHours)}
                </TableCell>
                <TableCell className="align-top text-right text-sm tabular-nums">
                  {row.runCount}
                </TableCell>
                <TableCell className="align-top text-right text-sm tabular-nums">
                  {row.sharePercent}%
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
