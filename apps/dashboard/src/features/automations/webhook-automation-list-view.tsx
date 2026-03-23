import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";

import { useWebhookAutomationListState } from "./use-webhook-automation-list-state.js";
import { WebhookAutomationListToolbar } from "./webhook-automation-list-toolbar.js";

export type WebhookAutomationListItemViewModel = {
  id: string;
  name: string;
  integrationConnectionName: string;
  sandboxProfileName: string;
  eventSummary: string;
  updatedAtLabel: string;
  enabled: boolean;
};

type WebhookAutomationListViewProps = {
  items: readonly WebhookAutomationListItemViewModel[];
  isLoading: boolean;
  errorMessage: string | null;
  onOpenAutomation: (automationId: string) => void;
  onRetry: () => void;
};

function LoadingState(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function WebhookAutomationListView(
  input: WebhookAutomationListViewProps,
): React.JSX.Element {
  const { activeFilter, setActiveFilter, searchValue, setSearchValue, visibleItems, hasItems } =
    useWebhookAutomationListState({
      items: input.items,
    });

  if (input.isLoading) {
    return <LoadingState />;
  }

  if (input.errorMessage !== null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load automations</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{input.errorMessage}</span>
          <Button onClick={input.onRetry} type="button" variant="outline">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {input.items.length > 0 ? (
        <WebhookAutomationListToolbar
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          onSearchValueChange={setSearchValue}
          searchValue={searchValue}
        />
      ) : null}

      <Table className="min-w-[56rem] table-fixed">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[24%]" />
          <col className="w-[18%]" />
          <col className="w-[18%]" />
          <col className="w-[10%]" />
        </colgroup>
        <TableHeader className="bg-muted/60">
          <TableRow className="h-9 border-b">
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Automation
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Connection
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Target
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Events
            </TableHead>
            <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
              Updated
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleItems.length === 0 ? (
            <TableRow>
              <TableCell className="text-muted-foreground" colSpan={5}>
                {hasItems
                  ? "No automations match the current search or filter."
                  : "No automations have been created yet."}
              </TableCell>
            </TableRow>
          ) : null}
          {visibleItems.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={`inline-block size-2 shrink-0 rounded-full ${
                      item.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"
                    }`}
                  />
                  <span className="sr-only">{item.enabled ? "Enabled" : "Disabled"}</span>
                  <button
                    className="text-left font-medium underline-offset-4 hover:underline"
                    onClick={() => {
                      input.onOpenAutomation(item.id);
                    }}
                    type="button"
                  >
                    {item.name}
                  </button>
                </div>
              </TableCell>
              <TableCell>{item.integrationConnectionName}</TableCell>
              <TableCell>{item.sandboxProfileName}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{item.eventSummary}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{item.updatedAtLabel}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
