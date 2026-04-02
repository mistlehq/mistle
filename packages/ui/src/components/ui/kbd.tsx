import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.js";

const kbdVariants = cva("inline-flex items-center justify-center select-none pointer-events-none", {
  variants: {
    variant: {
      default:
        "bg-muted text-muted-foreground [[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10 h-5 w-fit min-w-5 gap-1 rounded-sm px-1 font-sans text-xs font-medium [&_svg:not([class*='size-'])]:size-3",
      shortcut: "rounded-sm font-mono text-[9px] text-current/80",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Kbd({
  className,
  variant,
  ...props
}: React.ComponentProps<"kbd"> & VariantProps<typeof kbdVariants>) {
  return <kbd data-slot="kbd" className={cn(kbdVariants({ className, variant }))} {...props} />;
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("gap-1 inline-flex items-center", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
