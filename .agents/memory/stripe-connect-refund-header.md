---
name: Stripe Connect refund header
description: Refunding a Connect (destination/direct) charge requires the Stripe-Account header set to the connected account; without it the charge "doesn't exist" on the platform account and the refund 404s.
---

When a charge was created on a Stripe Express/Custom connected account (i.e. the
PaymentIntent was created with the Stripe-Account header), any later refund or
read of that charge MUST also be issued with `Stripe-Account: acct_…` set.
Without the header, Stripe routes the API call to the platform account and the
charge id appears nonexistent — the refund returns HTTP 404 / resource_missing.

**Why:** Stripe Connect isolates per-account object namespaces. Platform-API
calls only see platform charges. Our copay flow charges land on the clinician's
connected account, so we persist `client_payments.stripe_connected_account_id`
at insert time and read it back in the refund path.

**How to apply:** Any new Stripe REST call that targets a Connect charge
(refunds, retrieves, captures, updates, disputes, balance transactions tied to
the charge) must look up the connected account id from `client_payments` (or
the equivalent record) and set the `Stripe-Account` header. The platform-level
`STRIPE_SECRET_KEY` is still the bearer token — only the header changes.
