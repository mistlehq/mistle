import { Button } from "@mistle/ui";

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
    <div className="flex gap-2">
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
      <Button
        disabled={props.cancelDisabled}
        onClick={props.onCancel}
        type="button"
        variant="outline"
      >
        Cancel
      </Button>
    </div>
  );
}
