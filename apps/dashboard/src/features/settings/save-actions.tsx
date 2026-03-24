import { Button } from "@mistle/ui";

import { FormPageFooter } from "../shared/form-page.js";

export type SaveActionsProps = {
  cancelDisabled: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saveSuccess: boolean;
  saving: boolean;
};

export function SaveActions(props: SaveActionsProps): React.JSX.Element {
  return (
    <FormPageFooter>
      <Button
        disabled={props.cancelDisabled}
        onClick={props.onCancel}
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
      <Button
        className={
          props.saveSuccess ? "bg-emerald-600 text-white hover:bg-emerald-600/90" : undefined
        }
        disabled={props.saveDisabled}
        onClick={props.onSave}
        type="button"
      >
        {props.saving ? "Saving..." : props.saveSuccess ? "Saved" : "Save"}
      </Button>
    </FormPageFooter>
  );
}
