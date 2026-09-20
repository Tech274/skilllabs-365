/**
 * Single source of truth for company branding in the frontend.
 * Anything user-visible — public pages, shared links, PDFs, exports —
 * must read the name and logo from here so branding stays consistent.
 */
export const BRAND = {
  name: "SkillHub Labs",
  tagline: "Cloud Labs & Certification Training",
  description:
    "Hands-on cloud labs on AWS, Azure and GCP with governed access, live sessions and certification prep.",
  site: "https://skillhub365.co.in",
  supportEmail: "support@skillhub365.co.in",
  /** App-relative product logo URL. */
  logoUrl: "/icon-512.png",
  /** Always-available local square icon — fallback when the CDN asset can't load. */
  logoFallbackUrl: "/icon-512.png",
  /** Absolute logo URL — use in shared links, emails and printable documents. */
  logoAbsoluteUrl: "https://skillhub365.co.in/icon-512.png",
} as const;

/** Footer line used on every generated document/export. */
export const brandDocumentFooter = () =>
  `${BRAND.name} · ${BRAND.site} · Generated ${new Date().toLocaleString()}`;
