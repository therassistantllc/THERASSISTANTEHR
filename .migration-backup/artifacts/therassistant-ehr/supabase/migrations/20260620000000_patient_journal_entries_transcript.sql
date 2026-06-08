-- Migration: 20260620000000_patient_journal_entries_transcript.sql
-- Purpose: Add a column to hold the auto-generated transcript for voice-note
--          journal entries. Populated asynchronously by the portal audio
--          upload route after the audio is stored. Clinicians read this so
--          they can scan a list of voice notes without playing each clip,
--          and the SOAP import for voice notes inserts this text (with the
--          audio link as a footnote).

alter table public.patient_journal_entries
  add column if not exists audio_transcript text;

select pg_notify('pgrst', 'reload schema');
