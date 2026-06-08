-- Task #485: Add 'partial_payment' to claim_workqueue_items.item_status check.
-- ERA posting now seeds a claim_workqueue_items row when CLP04 is between 0
-- and CLP03 so Partial Payments has persistent per-row assignment/deferral
-- state instead of recomputing on every page load.

alter table public.claim_workqueue_items
  drop constraint if exists claim_workqueue_items_item_status_check;

alter table public.claim_workqueue_items
  add constraint claim_workqueue_items_item_status_check
  check (
    item_status in (
      'no_response', 'rejected', 'denied', 'appeal_needed',
      'eligibility_issue', 'missing_era', 'recoupment',
      'aging_0_30', 'aging_31_60', 'aging_61_90',
      'aging_91_120', 'aging_120_plus',
      'partial_payment',
      'resolved', 'deferred'
    )
  );
