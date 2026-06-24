import { Notice, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatDateTime } from "../shared/date-formatters.js";
import { FormPageHeader, FormPageSection } from "../shared/form-page.js";
import { triggerActivityQueryKey } from "./triggers-query-keys.js";
import { listTriggerActivity } from "./triggers-service.js";
import type { ScheduledTriggerActivityItem, WebhookTriggerActivityItem } from "./triggers-types.js";

function formatNullableDateTime(value: string | null): string {
  return value === null ? "Unknown" : formatDateTime(value);
}

function formatStatus(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function WebhookActivityRows(input: {
  items: readonly WebhookTriggerActivityItem[];
}): React.JSX.Element {
  return (
    <Table className="table-fixed">
      <colgroup>
        <col className="w-[30%]" />
        <col className="w-[30%]" />
        <col className="w-[24%]" />
        <col className="w-[16%]" />
      </colgroup>
      <TableHeader className="bg-muted/60">
        <TableRow>
          <TableHead>Event time</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Delivery</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {input.items.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={4}>
              No recent webhook events.
            </TableCell>
          </TableRow>
        ) : null}
        {input.items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="text-sm whitespace-normal">
              {formatNullableDateTime(item.sourceOccurredAt)}
            </TableCell>
            <TableCell className="text-sm whitespace-normal">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate">{item.eventType}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {item.providerEventType}
                </span>
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground truncate text-sm">
              {item.externalDeliveryId ?? "-"}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap">{formatStatus(item.status)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScheduleActivityRows(input: {
  items: readonly ScheduledTriggerActivityItem[];
}): React.JSX.Element {
  return (
    <Table className="table-fixed">
      <colgroup>
        <col className="w-[38%]" />
        <col className="w-[34%]" />
        <col className="w-[28%]" />
      </colgroup>
      <TableHeader className="bg-muted/60">
        <TableRow>
          <TableHead>Scheduled for</TableHead>
          <TableHead>Local time</TableHead>
          <TableHead>Dispatch status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {input.items.length === 0 ? (
          <TableRow>
            <TableCell className="text-muted-foreground" colSpan={3}>
              No recent scheduled actions.
            </TableCell>
          </TableRow>
        ) : null}
        {input.items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="text-sm whitespace-normal">
              {formatDateTime(item.scheduledAt)}
            </TableCell>
            <TableCell className="text-sm whitespace-normal">
              {item.localScheduledDate} {item.localScheduledTime}
            </TableCell>
            <TableCell className="text-sm whitespace-nowrap">{formatStatus(item.status)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TriggerActivitySection(input: { triggerId: string }): React.JSX.Element {
  const activityQuery = useQuery({
    queryKey: triggerActivityQueryKey(input.triggerId),
    queryFn: async ({ signal }) =>
      listTriggerActivity({
        triggerId: input.triggerId,
        signal,
      }),
    retry: false,
  });

  const errorMessage = activityQuery.isError
    ? resolveApiErrorMessage({
        error: activityQuery.error,
        fallbackMessage: "Could not load trigger activity.",
      })
    : null;

  return (
    <FormPageSection
      header={<FormPageHeader description="Most recent source events." title="Recent activity" />}
    >
      {errorMessage !== null ? (
        <div className="p-4">
          <Notice title="Could not load activity" variant="alert">
            {errorMessage}
          </Notice>
        </div>
      ) : activityQuery.isPending || activityQuery.data === undefined ? (
        <div className="text-muted-foreground p-4 text-sm">Loading activity...</div>
      ) : activityQuery.data.kind === "webhook" ? (
        <WebhookActivityRows items={activityQuery.data.items} />
      ) : (
        <ScheduleActivityRows items={activityQuery.data.items} />
      )}
    </FormPageSection>
  );
}
