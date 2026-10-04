# Clinic dashboard update

This source bundle adds the first clinic and customer-service dashboard slice.

## Included

- `GET /dashboard?clinic_id=<uuid>` returns RLS-scoped lead totals, recent leads,
  upcoming bookings, and the count of active selectable ads. It verifies that
  the authenticated user can read the selected clinic first.
- The overview uses those clinic-wide counts instead of counting the first 20
  leads. It displays upcoming bookings and useful empty states in English and
  Arabic.
- The overview, leads board, and create-lead ad picker subscribe to lead,
  appointment, and ad changes as relevant. Events trigger a fresh API read;
  reconnecting or returning to the tab also refreshes the screen.
- `20260929120000_dashboard_realtime_publication.sql` adds the three tables to
  the Supabase Realtime publication, retaining the existing SELECT RLS policies.
- The clinics API includes the user's membership role. Lead creation controls
  are hidden for the `doctor` role, matching the existing `create_lead` RPC
  permission check. Customer service and clinic managers retain lead creation.

## Apply

1. Review the migration against the current Supabase project. Apply it with
   your normal migration process before expecting live database events.
2. Preserve your existing `.env` files. Install dependencies in `apps/api` and
   `apps/web` with `npm ci` if needed, then build each app.
3. Test with two authorized clinic accounts and one account from another clinic:
   create a lead, change an appointment, and activate an ad. Only the correct
   clinic should update without a manual refresh. Disconnect and reconnect a
   browser tab to verify catch-up.

## Scope

This release does not add booking write actions, chat platform integrations,
admin requests, or clinic-created customers/doctors. No remote migration or
deployment has been executed from this bundle.
