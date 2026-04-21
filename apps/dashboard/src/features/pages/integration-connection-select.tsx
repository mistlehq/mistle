import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import type React from "react";

import { SchemaFormSelectContentClassName } from "../forms/schema-form.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveSelectableValue } from "../shared/select-value.js";
import { ConnectionSelectValueContent } from "./connection-select-value-content.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
} from "./sandbox-profile-binding-config-editor.js";

export function IntegrationConnectionSelect(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  selectedConnectionId: string | null;
  onValueChange: (nextConnectionId: string) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
  triggerClassName?: string;
}): React.JSX.Element {
  const selectedConnection = input.availableConnections.find(
    (connection) => connection.id === input.selectedConnectionId,
  );
  const selectedTarget = input.availableTargets.find(
    (candidate) => candidate.targetKey === selectedConnection?.targetKey,
  );
  const selectedConnectionDisplayName =
    selectedConnection === undefined
      ? undefined
      : formatConnectionDisplayName({
          connection: selectedConnection,
        });

  return (
    <Select
      {...(input.disabled === undefined ? {} : { disabled: input.disabled })}
      onValueChange={(nextValue) => {
        if (typeof nextValue !== "string") {
          return;
        }
        input.onValueChange(nextValue);
      }}
      value={resolveSelectableValue({
        selectedValue: input.selectedConnectionId,
        optionValues: input.availableConnections.map((connection) => connection.id),
      })}
    >
      <SelectTrigger
        aria-label={input.ariaLabel}
        className={input.triggerClassName ?? "w-full"}
        {...(input.id === undefined ? {} : { id: input.id })}
      >
        <SelectValue placeholder={input.placeholder}>
          {selectedConnectionDisplayName === undefined ? null : (
            <ConnectionSelectValueContent
              connectionDisplayName={selectedConnectionDisplayName}
              targetDisplayName={selectedTarget?.displayName}
              targetLogoKey={selectedTarget?.logoKey}
            />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className={SchemaFormSelectContentClassName}
      >
        {input.availableConnections.map((connection) => {
          const connectionTarget = input.availableTargets.find(
            (candidate) => candidate.targetKey === connection.targetKey,
          );

          return (
            <SelectItem key={connection.id} value={connection.id}>
              <ConnectionSelectValueContent
                connectionDisplayName={formatConnectionDisplayName({ connection })}
                targetDisplayName={connectionTarget?.displayName}
                targetLogoKey={connectionTarget?.logoKey}
              />
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
