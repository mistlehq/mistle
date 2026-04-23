import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils.js";

const linkVariants = cva(
  "cursor-pointer rounded-[2px] underline decoration-[1px] underline-offset-[0.18em] outline-none transition-[text-decoration-thickness,text-underline-offset] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 hover:decoration-[1.5px] hover:underline-offset-[0.24em] focus-visible:decoration-[1.5px] focus-visible:underline-offset-[0.24em]",
  {
    variants: {
      variant: {
        default: "text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type LinkProps = ComponentProps<"a"> & VariantProps<typeof linkVariants>;

function Link({ className, variant, ...props }: LinkProps): React.JSX.Element {
  return <a className={cn(linkVariants({ variant, className }))} data-slot="link" {...props} />;
}

export { Link, linkVariants };
