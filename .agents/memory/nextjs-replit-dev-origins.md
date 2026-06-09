---
name: Next.js dev origins on Replit
description: Why a Next.js app renders but is non-interactive in the Replit preview, and the allowedDevOrigins fix
---

# Symptom
App renders (SSR HTML looks correct in screenshots) but in the user's live preview iframe **nothing is interactive**: dropdowns won't open, buttons do nothing, collapsible nav appears "missing". Server logs show:
`⚠ Blocked cross-origin request to Next.js dev resource /_next/... from "<id>.worf.replit.dev"`.

# Cause
Next.js (v16) blocks cross-origin requests to dev resources (`/_next/*`, including the client JS chunks) by default. The Replit preview is a proxied iframe served from a different origin (`<id>.worf.replit.dev`) than the dev server, so the client JS never loads → no hydration → SSR-only page with dead event handlers.

# Rule
`allowedDevOrigins` wildcards match exactly **one** subdomain label. `*.replit.dev` does NOT cover `<id>.worf.replit.dev` (two labels before `replit.dev`). Must include the cluster wildcard (`*.worf.replit.dev`) AND/OR the exact host.

**Why:** a config that already listed `*.replit.dev` looked correct but still blocked the worf-cluster host, making the failure look like an app/auth bug instead of a config gap.

**How to apply:** in `next.config.ts`, build `allowedDevOrigins` from `process.env.REPLIT_DEV_DOMAIN` (the exact current host) plus cluster wildcards. Restart the web workflow after editing. Verify with:
`curl -H "Origin: https://$REPLIT_DEV_DOMAIN" "$ REPLIT_DEV_DOMAIN/_next/static/chunks/main-app.js"` → expect 200, and confirm the "Blocked cross-origin" warning is gone from the web log. A `/_next/webpack-hmr 404` is harmless.
