import {
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";

export type TriggerTypeValue = "trigger" | "scheduled";

export function formatTriggerTypeValue(value: TriggerTypeValue): string {
  return value === "scheduled" ? "Schedule" : "Event";
}

export function TriggerTypeSelectField(input: {
  value: TriggerTypeValue | null;
  error?: string | undefined;
  onValueChange?: (value: TriggerTypeValue) => void;
}): React.JSX.Element {
  const isInvalid = input.error !== undefined;

  return (
    <Field orientation="horizontal">
      <FieldHeader>
        <FieldLabel>Trigger source</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select
          onValueChange={(value) => {
            if (value === "trigger" || value === "scheduled") {
              input.onValueChange?.(value);
            }
          }}
          value={input.value ?? ""}
        >
          <SelectTrigger aria-invalid={isInvalid ? true : undefined}>
            <SelectValue placeholder="Select source">
              {input.value === null ? undefined : formatTriggerTypeValue(input.value)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trigger">Event</SelectItem>
            <SelectItem value="scheduled">Schedule</SelectItem>
          </SelectContent>
        </Select>
        {input.error === undefined ? null : (
          <p className="text-destructive text-sm">{input.error}</p>
        )}
      </FieldContent>
    </Field>
  );
}

export function TriggerTypeDisplayField(input: { value: TriggerTypeValue }): React.JSX.Element {
  return (
    <Field orientation="horizontal">
      <FieldHeader>
        <FieldLabel>Trigger source</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <div className="flex min-h-9 items-center justify-end text-right text-sm text-foreground">
          {formatTriggerTypeValue(input.value)}
        </div>
      </FieldContent>
    </Field>
  );
}
