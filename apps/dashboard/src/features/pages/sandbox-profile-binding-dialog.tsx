import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";

import {
  IntegrationHorizontalFieldGroupClassName,
  IntegrationSelectContentClassName,
} from "../forms/integration-form-theme.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveSelectableValue } from "../shared/select-value.js";
import {
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

export type SandboxProfileBindingDialogState = {
  mode: "add" | "edit";
  row: SandboxProfileBindingEditorRow;
  error: string | null;
};

function formatAddBindingLabel(kind: SandboxProfileBindingEditorRow["kind"]): string {
  if (kind === "agent") {
    return "Add agent harness";
  }
  if (kind === "git") {
    return "Add Git provider";
  }
  return "Add connector";
}

export function SandboxProfileBindingDialog(input: {
  state: SandboxProfileBindingDialogState | null;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  availableConnectionsByKind: Readonly<
    Record<SandboxProfileBindingEditorRow["kind"], readonly IntegrationConnectionSummary[]>
  >;
  isSubmittingIntegrationBindings: boolean;
  resolveSelectedConnectionDisplayName: (row: SandboxProfileBindingEditorRow) => string | undefined;
  onClose: () => void;
  onConnectionIdChange: (nextConnectionId: string) => void;
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onSave: () => void;
}): React.JSX.Element {
  if (input.state === null) {
    return <></>;
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          input.onClose();
        }
      }}
      open
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader variant="sectioned">
          <DialogTitle>
            {input.state.mode === "add"
              ? formatAddBindingLabel(input.state.row.kind)
              : "Edit binding"}
          </DialogTitle>
        </DialogHeader>
        <div className={IntegrationHorizontalFieldGroupClassName}>
          <Field className="gap-2" contentWidth="fill" orientation="horizontal">
            <FieldLabel htmlFor="add-binding-connection">Connection</FieldLabel>
            <FieldContent>
              <Select
                onValueChange={(nextValue) => {
                  if (nextValue === null) {
                    return;
                  }
                  input.onConnectionIdChange(nextValue);
                }}
                value={resolveSelectableValue({
                  selectedValue: input.state.row.connectionId,
                  optionValues: input.availableConnectionsByKind[input.state.row.kind].map(
                    (connection) => connection.id,
                  ),
                })}
              >
                <div className="md:flex md:justify-end">
                  <SelectTrigger
                    aria-label="Add binding connection"
                    className="w-full md:w-auto md:min-w-fit md:max-w-full"
                    id="add-binding-connection"
                  >
                    <SelectValue placeholder="Select integration connection">
                      {input.resolveSelectedConnectionDisplayName(input.state.row)}
                    </SelectValue>
                  </SelectTrigger>
                </div>
                <SelectContent
                  align="end"
                  alignItemWithTrigger={false}
                  className={IntegrationSelectContentClassName}
                >
                  {input.availableConnectionsByKind[input.state.row.kind].map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {formatConnectionDisplayName({ connection })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>
          <SandboxProfileBindingConfigEditor
            availableConnections={input.availableConnections}
            availableTargets={input.availableTargets}
            layout="horizontal"
            onIntegrationBindingRowChange={input.onRowChange}
            row={input.state.row}
          />
          {input.state.error ? (
            <p className="text-destructive text-sm">{input.state.error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={input.onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              input.isSubmittingIntegrationBindings ||
              input.availableConnectionsByKind[input.state.row.kind].length === 0
            }
            onClick={input.onSave}
            type="button"
          >
            {input.state.mode === "add" ? <PlusIcon /> : null}
            {input.state.mode === "add" ? "Add" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
