import { buttonVariants, cn, type Button } from "@mistle/ui";
import type { ComponentProps } from "react";
import { Link as RouterLink } from "react-router";

type RoutedButtonLinkProps = Omit<ComponentProps<typeof RouterLink>, "className" | "role"> &
  Pick<ComponentProps<typeof Button>, "className" | "size" | "variant">;

export function RoutedButtonLink({
  children,
  className,
  size,
  to,
  variant,
  ...linkProps
}: RoutedButtonLinkProps): React.JSX.Element {
  return (
    <RouterLink className={cn(buttonVariants({ variant, size }), className)} to={to} {...linkProps}>
      {children}
    </RouterLink>
  );
}
