import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { contentSecurityPolicy, securityHeaders } from "./scripts/security-headers";

/**
 * Keeps a single production CSP `<meta http-equiv>` in the built index.html.
 * Source `index.html` already carries the live policy so a host that serves
 * that file still enforces it. The build refreshes that tag in place (it does
 * not append a second one, and it does not drop it).
 * frame-ancestors is header-only; `_headers` + the dev server cover it.
 *
 * Tip 9de17a0a used `@lovable.dev/mcp-js` mcpPlugin — omitted here so GH CI
 * stays free of that optional runtime; CSP + headers remain tip-aligned.
 */
function cspMetaPlugin() {
  return {
    name: "csp-meta",
    apply: "build" as const,
    transformIndexHtml(html: string) {
      const policy = contentSecurityPolicy({ extraOrigins: process.env.CSP_EXTRA_ORIGINS })
        .split("; ")
        .filter(d => !d.startsWith("frame-ancestors"))
        .join("; ");
      const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
      if (/<meta\s+http-equiv="Content-Security-Policy"\s+/i.test(html)) {
        return html.replace(/<meta\s+http-equiv="Content-Security-Policy"\s+[^>]*>/i, meta);
      }
      return html.replace("</head>", `  ${meta}\n  </head>`);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    headers: securityHeaders({ dev: true, extraOrigins: process.env.CSP_EXTRA_ORIGINS }),
  },
  preview: {
    headers: securityHeaders({ dev: true, extraOrigins: process.env.CSP_EXTRA_ORIGINS }),
  },
  plugins: [react(), cspMetaPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
