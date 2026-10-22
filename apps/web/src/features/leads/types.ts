export type Clinic = {
  id: string;
  name: string;
  role: 'moderator' | 'agency_follow_up' | 'clinic_customer_service'
    | 'doctor' | 'clinic_manager' | 'platform_admin';
};

export function canCreateLeads(role: Clinic['role']) {
  return role !== 'doctor';
}

export type WorkspaceContext = {
  isAdmin?: boolean;
  token: string;
  clinic: Clinic;
  userId: string;
};

export type Lead = {
  id: string;
  status: string;
  source: string;
  created_at: string;
  requested_service_id: string
  requested_service_name_snapshot: string;
  contact_type_at_creation: 'new_contact' | 'existing_contact';
  contact: {
    full_name: string;
    phone: string;
  } | null;
};

export type LeadPage = {
  data: Lead[];
  pagination: {
    page: number;
    page_size: number;
    has_more: boolean;
  };
};

export const lanes = [
  {
    key: 'new',
    statuses: ['new'],
    color: 'bg-lavender',
  },
  {
    key: 'progress',
    statuses: ['in_progress', 'follow_up', 'no_answer'],
    color: 'bg-coral',
  },
  {
    key: 'converted',
    statuses: ['converted'],
    color: 'bg-[#b9d5c3]',
  },
  {
    key: 'uninterested',
    statuses: ['not_interested'],
    color: 'bg-[#d2cdd7]',
  },
];
