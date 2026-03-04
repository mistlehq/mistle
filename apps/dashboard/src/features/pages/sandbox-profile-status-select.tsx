import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";

import type { SandboxProfileStatus } from "../sandbox-profiles/sandbox-profiles-types.js";

type SandboxProfileStatusSelectProps = {
  value: SandboxProfileStatus;
  disabled: boolean;
  onValueChange: (nextValue: SandboxProfileStatus) => void;
};

export function SandboxProfileStatusSelect(
  props: SandboxProfileStatusSelectProps,
): React.JSX.Element {
  return (
    <Select
      disabled={props.disabled}
      onValueChange={(nextValue) => {
        if (nextValue !== "active" && nextValue !== "inactive") {
          return;
        }
        props.onValueChange(nextValue);
      }}
      value={props.value}
    >
      <SelectTrigger aria-label="Sandbox profile status" className="w-36">
        <SelectValue>{props.value === "active" ? "Active" : "Inactive"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inactive">Inactive</SelectItem>
        <SelectItem value="active">Active</SelectItem>
      </SelectContent>
    </Select>
  );
}
