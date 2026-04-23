import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

const linkClassName =
  "text-primary cursor-pointer rounded-[2px] underline decoration-[1px] underline-offset-[0.18em] outline-none transition-[text-decoration-thickness,text-underline-offset] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 hover:decoration-[1.5px] hover:underline-offset-[0.24em] focus-visible:decoration-[1.5px] focus-visible:underline-offset-[0.24em]";

type LinkProps = ComponentProps<"a">;

function Link({ className, ...props }: LinkProps): React.JSX.Element {
  return <a className={cn(linkClassName, className)} data-slot="link" {...props} />;
}

export { Link, linkClassName };
