import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";

type ScreenActionButtonProps = ComponentProps<typeof Button>;

function ScreenActionButton({
  className,
  size,
  ...props
}: ScreenActionButtonProps): React.JSX.Element {
  return <Button className={cn("h-12 w-full text-sm", className)} size={size ?? "lg"} {...props} />;
}

export { ScreenActionButton };
