import { SpinnerIcon } from "@phosphor-icons/react";

import { cn } from "../../lib/utils.js";

function Spinner({ className, color, ...props }: React.ComponentProps<"svg">) {
  return (
    <SpinnerIcon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...(color === undefined ? {} : { color })}
      {...props}
    />
  );
}

export { Spinner };
