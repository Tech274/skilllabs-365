import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const box: Record<Size, string> = {
  sm: "w-9 h-9 rounded-lg",
  md: "w-14 h-14 rounded-xl",
  lg: "w-20 h-20 rounded-2xl",
};
const img: Record<Size, string> = {
  sm: "w-7 h-7",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};
const text: Record<Size, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

/**
 * Company logo + name lockup. Used on every public / unauthenticated page so
 * shared links always show consistent branding.
 */
export function BrandMark({
  size = "md",
  showName = true,
  showTagline = false,
  className,
}: {
  size?: Size;
  showName?: boolean;
  showTagline?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("bg-primary/10 flex items-center justify-center overflow-hidden shrink-0", box[size])}>
        <img
          src={BRAND.logoUrl}
          alt={`${BRAND.name} logo`}
          className={cn("object-contain", img[size])}
          onError={(e) => {
            const el = e.currentTarget;
            if (el.src.endsWith(BRAND.logoFallbackUrl)) return;
            el.src = BRAND.logoFallbackUrl;
          }}
        />
      </div>
      {showName && (
        <div className="text-left">
          <div className={cn("font-bold tracking-tight text-foreground", text[size])}>{BRAND.name}</div>
          {showTagline && <div className="text-xs text-muted-foreground">{BRAND.tagline}</div>}
        </div>
      )}
    </div>
  );
}

export default BrandMark;
