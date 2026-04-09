import { Switch } from "@mistle/ui";

export function SessionsSidebarModeSwitch(input: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  preventSidebarItemNavigation?: boolean;
}): React.JSX.Element {
  function handleClick(event: React.MouseEvent<HTMLSpanElement>): void {
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <Switch
      aria-label="Toggle sessions sidebar view"
      checked={input.checked}
      onCheckedChange={input.onCheckedChange}
      onClick={input.preventSidebarItemNavigation ? handleClick : undefined}
      className="cursor-default"
      size="sm"
    />
  );
}
