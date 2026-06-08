---
name: Supabase CLI on Replit sandbox
description: How to run supabase CLI commands from the Replit sandbox without the Docker bundler.
---

Rule: in the Replit sandbox, `supabase functions deploy` must use `--use-api` because the default Docker-based bundler fails DNS resolution. `supabase db push --linked --include-all` works directly. Both require `SUPABASE_ACCESS_TOKEN` in the env.

**Why:** The Replit container does not run Docker, and the Supabase CLI's default function bundler needs to pull a Docker image. The `--use-api` path uploads the source directly and the Edge build happens server-side.

**How to apply:**
- CLI lives at `$HOME/.local/share/supabase/supabase` (v2.101+).
- Project ref is set on the linked CLI config; pass `--project-ref <ref>` explicitly when deploying functions to be safe.
- If the remote migration history is dirty, `supabase migration repair --status reverted <version>` can mark orphans before `db push` will proceed.

Postgres notes:
- Supabase runs PG 15+, so `UNIQUE NULLS NOT DISTINCT` is available.
- `run_sql(text)` exists in this project's schema but is locked to `service_role` — safe.
