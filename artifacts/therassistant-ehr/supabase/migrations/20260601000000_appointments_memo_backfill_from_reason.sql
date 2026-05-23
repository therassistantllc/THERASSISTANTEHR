-- One-time backfill: historical memos were written into appointments.reason
-- before the dedicated memo column existed. Copy them across so the read-side
-- fallback to reason can be removed. Skip rows whose reason is more likely to
-- be a clinical cancellation reason than a scheduling memo (canceled / no-show
-- appointments), and skip rows where memo is already set so we don't clobber
-- newer data.

update public.appointments
   set memo = reason
 where memo is null
   and reason is not null
   and length(btrim(reason)) > 0
   and coalesce(appointment_status, '') not in (
     'canceled', 'cancelled', 'no_show', 'no-show'
   );
