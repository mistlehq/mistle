type MistleLogoProps = {
  mode?: "with-text" | "icon-only";
  className?: string;
};

export function MistleLogo({ mode = "with-text", className }: MistleLogoProps): React.JSX.Element {
  const logoClassName =
    mode === "icon-only" ? "h-[60px] w-[60px] object-contain" : "h-12 w-auto object-contain";

  return (
    <div className={["text-primary flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <img alt="Mistle logo" className={logoClassName} loading="eager" src="/brand/logo.webp" />
      {mode === "with-text" ? (
        <span className="font-logo text-4xl font-semibold">Mistle</span>
      ) : null}
    </div>
  );
}
