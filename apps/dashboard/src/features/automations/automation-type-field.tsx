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

export type AutomationTypeValue = "trigger" | "scheduled";

export function formatAutomationTypeValue(value: AutomationTypeValue): string {
  return value === "scheduled" ? "Schedule" : "Event";
}

export function AutomationTypeSelectField(input: {
  value: AutomationTypeValue | null;
  error?: string | undefined;
  onValueChange?: (value: AutomationTypeValue) => void;
}): React.JSX.Element {
  const isInvalid = input.error !== undefined;

  return (
    <Field orientation="horizontal">
      <FieldHeader>
        <FieldLabel>Automation type</FieldLabel>
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
            <SelectValue placeholder="Select type">
              {input.value === null ? undefined : formatAutomationTypeValue(input.value)}
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

export function AutomationTypeDisplayField(input: {
  value: AutomationTypeValue;
}): React.JSX.Element {
  return (
    <Field orientation="horizontal">
      <FieldHeader>
        <FieldLabel>Automation type</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <div className="flex min-h-9 items-center justify-end text-right text-sm text-foreground">
          {formatAutomationTypeValue(input.value)}
        </div>
      </FieldContent>
    </Field>
  );
}
