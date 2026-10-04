import { useGet } from '../../hooks/useGet';
import type { LeadPage } from './types';

export function useLeads(
  token: string,
  clinicId: string,
  page: number,
) {
  const params = new URLSearchParams({
    clinic_id: clinicId,
    page: String(page),
    page_size: '20',
  });

  return useGet<LeadPage>(`/api/leads?${params}`, token);
}