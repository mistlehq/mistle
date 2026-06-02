import type { IntegrationKind } from "@mistle/integrations-core";
import { Notice, SectionBlock, Tabs, TabsContent, TabsList, TabsTrigger } from "@mistle/ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { IntegrationSection } from "../integrations/integration-section.js";
import { IntegrationTile } from "../integrations/integration-tile.js";
import { ToolbarSearchInput } from "../shared/toolbar-search-input.js";

export type OrganizationIntegrationsSettingsPageCard = {
  actionDisabled?: boolean;
  actionHref?: string;
  actionLabel: string;
  configStatus: "valid" | "invalid";
  description: string;
  displayName: string;
  integrationKind: IntegrationKind;
  logoKey?: string;
  onAction?: () => void;
  targetKey: string;
};

export type OrganizationIntegrationsSettingsPageViewProps = {
  availableCards: readonly OrganizationIntegrationsSettingsPageCard[];
  connectedCards: readonly OrganizationIntegrationsSettingsPageCard[];
  connectionDialog?: ReactNode;
  detailSurface?: ReactNode;
  loadErrorMessage: string | null;
};

type AvailableIntegrationGroupSpec = {
  kind: IntegrationKind;
  title: string;
};

type AvailableIntegrationGroup = AvailableIntegrationGroupSpec & {
  cards: readonly OrganizationIntegrationsSettingsPageCard[];
};

const AvailableIntegrationGroupSpecs: readonly AvailableIntegrationGroupSpec[] = [
  {
    kind: "agent",
    title: "Models",
  },
  {
    kind: "git",
    title: "Git",
  },
  {
    kind: "connector",
    title: "Tools",
  },
  {
    kind: "sandbox",
    title: "Sandboxes",
  },
];

export function OrganizationIntegrationsSettingsPageView(
  props: OrganizationIntegrationsSettingsPageViewProps,
): React.JSX.Element {
  const isDetailFocused = props.detailSurface !== undefined && props.detailSurface !== null;

  if (props.loadErrorMessage !== null) {
    return (
      <div className="flex flex-col gap-3">
        <Notice variant="alert">{props.loadErrorMessage} Please try again later.</Notice>
      </div>
    );
  }

  if (props.connectedCards.length === 0 && props.availableCards.length === 0) {
    return (
      <Notice title="No integrations available">
        <p>
          No integration targets are currently configured for this environment. Seed integration
          targets in the control-plane database to populate this page.
        </p>
      </Notice>
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
    <div className="w-full gap-12 flex flex-col">
      <IntegrationSection
        cards={props.connectedCards}
        emptyStateMessage="No integration connections yet. Add an integration from the list below."
        getCardKey={(card) => card.targetKey}
        renderTile={(card) => renderIntegrationSettingsTile(card, { actionVariant: "outline" })}
        title="Connected"
      />

      <AvailableIntegrationsSection cards={props.availableCards} />

      {props.connectionDialog ?? null}
      {props.detailSurface ?? null}
    </div>
  );
}

function AvailableIntegrationsSection(input: {
  cards: readonly OrganizationIntegrationsSettingsPageCard[];
}): React.JSX.Element | null {
  const [searchValue, setSearchValue] = useState("");
  const [selectedGroupKind, setSelectedGroupKind] = useState<IntegrationKind | null>(null);

  const matchingCards = filterIntegrationCards({
    cards: input.cards,
    searchValue,
  });
  const groups = buildAvailableIntegrationGroups(matchingCards);
  const defaultGroup = groups[0];
  const activeGroupKind = resolveAvailableIntegrationActiveGroupKind({
    groups,
    selectedGroupKind,
  });

  useEffect(() => {
    if (selectedGroupKind !== activeGroupKind) {
      setSelectedGroupKind(activeGroupKind);
    }
  }, [activeGroupKind, selectedGroupKind]);

  if (input.cards.length === 0) {
    return null;
  }

  if (defaultGroup === undefined && searchValue.trim().length === 0) {
    throw new Error("Available integration cards could not be grouped by integration kind.");
  }
  const normalizedSearchValue = searchValue.trim();

  return (
    <SectionBlock title="Available Integrations">
      <div className="flex flex-col gap-3">
        <ToolbarSearchInput
          ariaLabel="Search integrations"
          onValueChange={setSearchValue}
          placeholder="Search integrations"
          value={searchValue}
        />

        {defaultGroup === undefined ? (
          <p className="text-muted-foreground text-sm">
            No integrations match "{normalizedSearchValue}".
          </p>
        ) : (
          <Tabs
            className="w-full"
            onValueChange={(value) => {
              setSelectedGroupKind(parseAvailableIntegrationGroupKind(value));
            }}
            value={activeGroupKind ?? defaultGroup.kind}
          >
            <TabsList variant="line">
              {groups.map((group) => (
                <TabsTrigger key={group.kind} value={group.kind}>
                  {group.title}
                </TabsTrigger>
              ))}
            </TabsList>

            {groups.map((group) => (
              <TabsContent key={group.kind} value={group.kind}>
                {renderIntegrationSettingsGrid(group.cards)}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </SectionBlock>
  );
}

function resolveAvailableIntegrationActiveGroupKind(input: {
  groups: readonly AvailableIntegrationGroup[];
  selectedGroupKind: IntegrationKind | null;
}): IntegrationKind | null {
  if (
    input.selectedGroupKind !== null &&
    input.groups.some((group) => group.kind === input.selectedGroupKind)
  ) {
    return input.selectedGroupKind;
  }

  return input.groups[0]?.kind ?? null;
}

function buildAvailableIntegrationGroups(
  cards: readonly OrganizationIntegrationsSettingsPageCard[],
): readonly AvailableIntegrationGroup[] {
  return AvailableIntegrationGroupSpecs.map((group) => ({
    ...group,
    cards: cards.filter((card) => card.integrationKind === group.kind),
  })).filter((group) => group.cards.length > 0);
}

function parseAvailableIntegrationGroupKind(value: string): IntegrationKind {
  if (value === "agent" || value === "git" || value === "connector" || value === "sandbox") {
    return value;
  }

  throw new Error(`Unknown integration group kind '${value}'.`);
}

function filterIntegrationCards(input: {
  cards: readonly OrganizationIntegrationsSettingsPageCard[];
  searchValue: string;
}): readonly OrganizationIntegrationsSettingsPageCard[] {
  const normalizedSearchValue = input.searchValue.trim().toLowerCase();
  if (normalizedSearchValue.length === 0) {
    return input.cards;
  }

  return input.cards.filter((card) => {
    const haystack = [card.displayName, card.description, card.targetKey].join(" ").toLowerCase();
    return haystack.includes(normalizedSearchValue);
  });
}

function renderIntegrationSettingsGrid(
  cards: readonly OrganizationIntegrationsSettingsPageCard[],
): React.JSX.Element {
  return (
    <div className="w-full max-w-6xl">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div key={card.targetKey}>{renderIntegrationSettingsTile(card)}</div>
        ))}
      </div>
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
      {...(card.actionHref === undefined ? {} : { actionHref: card.actionHref })}
      {...(card.onAction === undefined ? {} : { onAction: card.onAction })}
    />
  );
}
