import { Button, buttonVariants } from "@mistle/ui";
import { Link as RouterLink } from "react-router";

import { ActionTile } from "../shared/action-tile.js";
import { IntegrationLogo } from "./integration-logo.js";

type IntegrationTileProps = {
  actionLabel: string;
  actionDisabled?: boolean;
  actionHref?: string;
  actionVariant?: "default" | "outline";
  description: string;
  displayName: string;
  logoKey?: string;
  statusBadge?: string;
  onAction?: () => void;
};

export function IntegrationTile(props: IntegrationTileProps) {
  const statusBadgeClassName =
    props.statusBadge === "Invalid config"
      ? "border border-destructive/30 bg-destructive/10 text-destructive"
      : "border";

  const statusBadge =
    props.statusBadge === undefined ? null : (
      <span
        className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadgeClassName}`}
      >
        {props.statusBadge}
      </span>
    );
  return (
    <ActionTile
      action={
        props.actionHref === undefined || props.actionDisabled === true ? (
          <Button
            disabled={props.actionDisabled ?? false}
            {...(props.onAction === undefined ? {} : { onClick: props.onAction })}
            type="button"
            variant={props.actionVariant}
          >
            {props.actionLabel}
          </Button>
        ) : (
          <RouterLink
            className={buttonVariants({ variant: props.actionVariant })}
            to={props.actionHref}
          >
            {props.actionLabel}
          </RouterLink>
        )
      }
      actionContainerClassName="gap-2"
      badge={statusBadge}
      description={props.description}
      descriptionClassName="text-xs"
      leading={
        <IntegrationNameBadge
          displayName={props.displayName}
          {...(props.logoKey === undefined ? {} : { logoKey: props.logoKey })}
        />
      }
      title={props.displayName}
    />
  );
}

function IntegrationNameBadge(input: { logoKey?: string; displayName: string }) {
  if (input.logoKey !== undefined) {
    return (
      <IntegrationLogo
        alt={`${input.displayName} logo`}
        className="h-5 w-5 rounded-sm"
        logoKey={input.logoKey}
      />
    );
  }

  const firstCharacter = input.displayName.slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold">
      {firstCharacter}
    </span>
  );
}
