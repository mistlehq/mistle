import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const inlineCodeVariants = cva("rounded-sm border px-1 font-mono text-[0.9em] align-baseline", {
  variants: {
    variant: {
      default: "bg-muted text-foreground",
      muted: "bg-muted text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function InlineCode({
  className,
  variant,
  ...props
}: React.ComponentProps<"code"> & VariantProps<typeof inlineCodeVariants>) {
  return (
    <code
      data-slot="inline-code"
      className={cn(inlineCodeVariants({ className, variant }))}
      {...props}
    />
  );
}

export { InlineCode, inlineCodeVariants };
