import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mistle/ui";

import {
  PROVIDER_CATALOG_UI_ENTRIES,
  summarizeProviderCatalog,
  type ProviderCatalogEntry,
} from "./model.js";

type ProviderCatalogPanelProps = {
  entries?: readonly ProviderCatalogEntry[];
};

export function ProviderCatalogPanel(props: ProviderCatalogPanelProps): React.JSX.Element {
  const entries = props.entries ?? PROVIDER_CATALOG_UI_ENTRIES;
  const stats = summarizeProviderCatalog(entries);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Provider catalog
          <Badge variant="secondary">UI scaffold</Badge>
        </CardTitle>
        <CardDescription>
          Static provider inventory surface. API integration is intentionally deferred.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-4 grid">
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="bg-muted/40 rounded-md px-3 py-2">
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Providers</dt>
            <dd className="text-lg font-semibold">{stats.totalProviders}</dd>
          </div>
          <div className="bg-muted/40 rounded-md px-3 py-2">
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Connected</dt>
            <dd className="text-lg font-semibold">{stats.connectedProviders}</dd>
          </div>
          <div className="bg-muted/40 rounded-md px-3 py-2">
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Errors</dt>
            <dd className="text-lg font-semibold">{stats.providersWithErrors}</dd>
          </div>
        </dl>

        <div className="gap-3 grid">
          {entries.map((entry) => (
            <div className="rounded-md border p-3" key={entry.providerInstanceId}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{entry.displayName}</p>
                  <p className="text-muted-foreground text-xs">{entry.description}</p>
                </div>
                <ProviderStatusBadge status={entry.status} />
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                Auth methods: {entry.authMethodLabels.join(", ")}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderStatusBadge(props: { status: ProviderCatalogEntry["status"] }): React.JSX.Element {
  if (props.status === "Connected") {
    return (
      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600/90" variant="secondary">
        {props.status}
      </Badge>
    );
  }

  if (props.status === "Error") {
    return <Badge variant="destructive">{props.status}</Badge>;
  }

  return <Badge variant="outline">{props.status}</Badge>;
}
