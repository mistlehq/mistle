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
} from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";

import { SchemaFormHorizontalFieldGroupClassName } from "../forms/schema-form.js";
import { IntegrationConnectionSelect } from "./integration-connection-select.js";
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
  onClose: () => void;
  onConnectionIdChange: (nextConnectionId: string) => void;
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onSave: () => void;
}): React.JSX.Element {
  const { state } = input;

  if (state === null) {
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
            {state.mode === "add" ? formatAddBindingLabel(state.row.kind) : "Edit binding"}
          </DialogTitle>
        </DialogHeader>
        <div className={SchemaFormHorizontalFieldGroupClassName}>
          <Field className="gap-2" contentWidth="fill" orientation="horizontal">
            <FieldLabel htmlFor="add-binding-connection">Connection</FieldLabel>
            <FieldContent>
              <div className="md:flex md:justify-end">
                <IntegrationConnectionSelect
                  ariaLabel="Add binding connection"
                  availableConnections={input.availableConnectionsByKind[state.row.kind]}
                  availableTargets={input.availableTargets}
                  id="add-binding-connection"
                  onValueChange={input.onConnectionIdChange}
                  placeholder="Select integration connection"
                  selectedConnectionId={state.row.connectionId}
                  triggerClassName="w-full md:w-auto md:min-w-fit md:max-w-full"
                />
              </div>
            </FieldContent>
          </Field>
          <SandboxProfileBindingConfigEditor
            availableConnections={input.availableConnections}
            availableTargets={input.availableTargets}
            layout="horizontal"
            onIntegrationBindingRowChange={input.onRowChange}
            row={state.row}
          />
          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
        </div>
        <DialogFooter>
          <Button onClick={input.onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              input.isSubmittingIntegrationBindings ||
              input.availableConnectionsByKind[state.row.kind].length === 0
            }
            onClick={input.onSave}
            type="button"
          >
            {state.mode === "add" ? <PlusIcon /> : null}
            {state.mode === "add" ? "Add" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
