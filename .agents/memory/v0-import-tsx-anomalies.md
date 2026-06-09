---
name: v0/Vercel import .tsx anomalies
description: Imported projects may have config/entry files with wrong .tsx extension that break tooling
---

# `.tsx` extension anomalies from v0/Vercel imports

Projects imported from v0/Vercel into Replit have been seen with config and entry files saved as `.tsx` when they should be `.ts`. This silently breaks tooling that only recognizes `.ts`:
- `vite.config.tsx` → Vite ignores it, falls back to default port (5173) instead of the configured `PORT`.
- esbuild/build entry `src/index.tsx` / `app.tsx` for a non-React server → build/entry resolution breaks.

**How to apply:** When an imported app's dev server uses the wrong port or a build entry can't resolve, check for `.tsx` config/entry files and rename to `.ts` (update any `tsconfig.json` `include` and build entry references to match).
