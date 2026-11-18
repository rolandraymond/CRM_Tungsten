-- Idempotent migration for already-initialized Native PostgreSQL (crm_tungsten) databases
-- Adds 'عقد' (Contract) to crm_contacts.lead_status CHECK constraint so leads can convert directly to Contract / Won Deals.
DO $$
BEGIN
  ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_lead_status_check;
  ALTER TABLE public.crm_contacts
    ADD CONSTRAINT crm_contacts_lead_status_check
    CHECK (lead_status IN ('جديد', 'قيد المتابعة', 'عقد', 'تم الفوز', 'خاسر'));
END $$;
