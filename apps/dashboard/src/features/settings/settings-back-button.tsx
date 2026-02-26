import { Button } from "@mistle/ui";
import { CaretLeftIcon } from "@phosphor-icons/react";

export type SettingsBackButtonInput = {
  onBack: () => void;
};

export function SettingsBackButton(input: SettingsBackButtonInput): React.JSX.Element {
  return (
    <Button
      aria-label="Back"
      className="h-8 w-full justify-start px-2"
      onClick={input.onBack}
      size="sm"
      type="button"
      variant="ghost"
    >
      <CaretLeftIcon aria-hidden="true" />
      <span>Back</span>
    </Button>
  );
}
