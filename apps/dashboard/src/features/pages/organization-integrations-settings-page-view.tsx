import { Skeleton } from "@mistle/ui";
import type { ReactNode } from "react";

import { IntegrationSection } from "../integrations/integration-section.js";
import { IntegrationTile } from "../integrations/integration-tile.js";
import { StatusBox } from "../shared/status-box.js";

export type OrganizationIntegrationsSettingsPageCard = {
  actionDisabled?: boolean;
  actionLabel: string;
  configStatus: "valid" | "invalid";
  description: string;
  displayName: string;
  logoKey?: string;
  onAction: () => void;
  targetKey: string;
};

export type OrganizationIntegrationsSettingsPageViewProps = {
  availableCards: readonly OrganizationIntegrationsSettingsPageCard[];
  connectedCards: readonly OrganizationIntegrationsSettingsPageCard[];
  connectionDialog?: ReactNode;
  detailSurface?: ReactNode;
  isLoading: boolean;
  loadErrorMessage: string | null;
};

export function OrganizationIntegrationsSettingsPageView(
  props: OrganizationIntegrationsSettingsPageViewProps,
): React.JSX.Element {
  const isDetailFocused = props.detailSurface !== undefined && props.detailSurface !== null;

  if (props.isLoading) {
    return (
      <div className="gap-3 flex flex-col">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (props.loadErrorMessage !== null) {
    return (
      <div className="flex flex-col gap-3">
        <StatusBox tone="destructive">{props.loadErrorMessage} Please try again later.</StatusBox>
      </div>
    );
  }

  if (props.connectedCards.length === 0 && props.availableCards.length === 0) {
    return (
      <StatusBox title="No integrations available">
        <p>
          No integration targets are currently configured for this environment. Seed integration
          targets in the control-plane database to populate this page.
        </p>
      </StatusBox>
    );
  }

  if (isDetailFocused) {
    return (
      <section aria-label="Integration detail" className="w-full gap-4 flex flex-col">
        {props.connectionDialog ?? null}
        {props.detailSurface}
      </section>
    );
  }

  return (
    <div className="w-full gap-4 flex flex-col">
      <IntegrationSection
        cards={props.connectedCards}
        emptyStateMessage="No integration connections yet. Add one from the integrations list below."
        getCardKey={(card) => card.targetKey}
        renderTile={(card) => renderIntegrationSettingsTile(card, { actionVariant: "outline" })}
        title="Connected"
      />

      <IntegrationSection
        cards={props.availableCards}
        getCardKey={(card) => card.targetKey}
        renderTile={(card) => renderIntegrationSettingsTile(card)}
        title="Available Integrations"
      />

      {props.connectionDialog ?? null}
      {props.detailSurface ?? null}
    </div>
  );
}

function renderIntegrationSettingsTile(
  card: OrganizationIntegrationsSettingsPageCard,
  options?: {
    actionVariant?: "default" | "outline";
  },
): React.JSX.Element {
  return (
    <IntegrationTile
      actionLabel={card.actionLabel}
      description={card.description}
      displayName={card.displayName}
      {...(options?.actionVariant === undefined ? {} : { actionVariant: options.actionVariant })}
      {...(card.actionDisabled === undefined ? {} : { actionDisabled: card.actionDisabled })}
      {...(card.logoKey === undefined ? {} : { logoKey: card.logoKey })}
      {...(card.configStatus === "invalid" ? { statusBadge: "Invalid config" } : {})}
      onAction={card.onAction}
    />
  );
}
