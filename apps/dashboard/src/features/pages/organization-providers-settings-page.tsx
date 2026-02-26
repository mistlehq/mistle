import { ProviderCatalogPanel } from "../providers/provider-catalog-panel.js";

export function OrganizationProvidersSettingsPage(): React.JSX.Element {
  return (
    <div className="gap-4 flex flex-col">
      <div className="gap-1 flex flex-col">
        <h1 className="text-xl font-semibold">Providers</h1>
        <p className="text-muted-foreground text-sm">
          Manage provider connections for this organization.
        </p>
      </div>
      <ProviderCatalogPanel />
    </div>
  );
}
