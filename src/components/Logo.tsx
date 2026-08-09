/**
 * Real SREonCall logo mark, copied (not fetched from the live site) from
 * reference/sreoncall/packages/web/public/logo/ — visual reuse only, no
 * app code from that repo is run.
 */
export function Logo({ variant = "default", className }: { variant?: "default" | "white"; className?: string }) {
  const src = variant === "white" ? "/logo/sreoncall-logo-white.svg" : "/logo/sreoncall-logo.svg";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="SREonCall" className={className ?? "h-6"} />;
}
