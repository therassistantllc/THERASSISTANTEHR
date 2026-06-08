---
name: mailroom_items dual schema (legacy + compat)
description: mailroom_items has both legacy NOT NULL columns and a newer compat-column set that different APIs use; new writers must populate both.
---

Rule: any new code path that inserts into `public.mailroom_items` must populate **both** the legacy columns (`title` NOT NULL, `sender_name`, `mail_status`, `document_type`) **and** the compat columns (`status`, `source`, `notes`) added by `20260519000000_mailroom_api_compat_columns.sql`. Otherwise the insert fails on the NOT NULL `title`, or the row is invisible to whichever API queries the column set you skipped.

**Why:** Two coexisting API surfaces query different column sets — `/api/mailroom` reads legacy (`mail_status/title/sender_name`), `/api/mailroom/items` reads compat (`status/source/notes`). The compat migration didn't backfill the legacy required columns or vice versa; neither set is canonical.

**How to apply:**
- When writing a new ingest path (e.g. the per-user Gmail RPC `route_inbound_gmail_message`), set every column listed above; derive `title` from the most descriptive available field (e.g. email subject).
- When considering a "simplification" that drops one column set, audit both API routes plus the mailroom UI before doing so.
