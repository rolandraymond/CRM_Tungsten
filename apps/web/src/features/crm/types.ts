export type WorkspaceType = 'tungsten_internal' | 'client_company';

export type WorkspaceRole =
  | 'owner'
  | 'manager'
  | 'sales'
  | 'company_owner'
  | 'company_manager'
  | 'platform_admin';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  workspace_type: WorkspaceType;
  domain: string | null;
  is_active: boolean;
  created_at: string;
  user_role: WorkspaceRole;
  manager_id?: string | null;
  is_managed_only?: boolean;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  manager_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  email: string;
  full_name: string;
  manager_name: string | null;
}

export type LeadStatus =
  | 'جديد'
  | 'قيد المتابعة'
  | 'تم الفوز'
  | 'خاسر'
  | 'مؤهل'
  | 'غير مؤهل'
  | 'عميل'
  | 'متابعة'
  | 'مغلق';

export type ActivityStatus =
  | 'معاودة الاتصال'
  | 'مهتم'
  | 'اهتمام مستقبلي'
  | 'غير مهتم'
  | 'اجتماع';

export type ActivityType =
  | 'مكالمة'
  | 'اجتماع'
  | 'ملاحظة'
  | 'مهمة'
  | 'متابعة';

export type MeetingStatus =
  | 'محجوز'
  | 'لم يحضر'
  | 'حضر'
  | 'ملغي';

export type CompletionStatus =
  | 'قيد الانتظار'
  | 'مكتمل'
  | 'ملغي';

export const DEAL_STAGES = [
  'مكالمة',
  'زيارة',
  'عرض سعر',
  'عقد',
  'عميل',
  'خسارة مغلقة',
  'غير مؤهل',
  'فقدان العميل',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export interface SocialLensPlanService {
  id?: string;
  title: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  description?: string;
}

export interface SocialLensPlanDetails {
  plan_name: string;
  plan_tier?: 'starter' | 'growth' | 'premium' | 'custom' | string;
  plan_code: string;
  pricing_location: string;
  price: number;
  billing_cycle?: string;
  status: string;
  is_approved?: boolean;
  badge?: string;
  description?: string;
  strategy_goal?: string;
  diagnostics?: {
    account?: string;
    platform?: string;
    engagement_rate?: string;
    analysis_date?: string;
    status_label?: string;
  };
  services: SocialLensPlanService[];
  available_plans?: Record<string, {
    tier: string;
    name: string;
    name_en?: string;
    price: number;
    description?: string;
    strategy_goal?: string;
    is_recommended?: boolean;
    services: SocialLensPlanService[];
  }>;
}

export interface CrmContact {
  id: string;
  workspace_id: string;
  lead_id: string | null;
  full_name: string;
  job_title: string | null;
  phone_number: string | null;
  whatsapp_number: string | null;
  business_phone: string | null;
  company_phone: string | null;
  email: string | null;
  social_profile_link: string | null;
  business_name: string | null;
  medical_specialty: string | null;
  clinic_address: string | null;
  city: string | null;
  district: string | null;
  google_maps: string | null;
  website: string | null;
  business_instagram: string | null;
  business_facebook: string | null;
  branch_count: number | null;
  source_platform: string | null;
  ad_id: string | null;
  lead_status: LeadStatus;
  meeting_date: string | null;
  follow_up_date: string | null;
  activity_status: string | null;
  meeting_status: MeetingStatus | null;
  contact_owner_id: string | null;
  company_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deals?: CrmDeal[];
  activities?: CrmActivity[];
  audit_logs?: (CrmAuditLog & { performed_by_name?: string; performed_by_email?: string })[];
  creator_name?: string;
  creator_email?: string;
  owner_name?: string;
  owner_email?: string;
  company?: CrmCompany | null;
  plan_details?: SocialLensPlanDetails | null;
}

export interface CrmCompany {
  id: string;
  workspace_id: string;
  company_name: string;
  industry: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  company_owner_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  contacts?: Partial<CrmContact>[];
  deals?: Partial<CrmDeal>[];
}

export interface CrmDeal {
  id: string;
  workspace_id: string;
  deal_name: string;
  deal_stage: DealStage;
  deal_amount: number;
  currency: string;
  closing_date: string | null;
  deal_owner_id: string | null;
  company_id: string | null;
  company_name?: string | null;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  contacts?: CrmContact[];
  activities?: CrmActivity[];
  owner_name?: string;
  owner_email?: string;
}

export interface CrmActivity {
  id: string;
  workspace_id: string;
  activity_type: ActivityType;
  title: string;
  details: string | null;
  assigned_user_id: string | null;
  assigned_user_name?: string;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  reminder_at: string | null;
  performed_at?: string | null;
  meeting_status: MeetingStatus | null;
  completion_status: CompletionStatus;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  crm_contacts?: { id: string; full_name: string; phone_number?: string | null };
  crm_companies?: { id: string; company_name: string };
  crm_deals?: { id: string; deal_name: string };
}

export interface CrmAuditLog {
  id: number | string;
  workspace_id: string;
  original_workspace_id?: string;
  workspace_type?: WorkspaceType;
  entity_type: string;
  entity_id: string;
  record_owner_id?: string | null;
  action: string;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  performed_by: string | null;
  created_at: string;
}

export interface DashboardMetrics {
  totalDeals: number;
  pipelineValue: number;
  wonDeals: number;
  wonValue: number;
  lostDeals: number;
  winRate: number;
  totalContacts: number;
}

export interface DashboardData {
  metrics: DashboardMetrics;
  stageDistribution: Record<DealStage, { count: number; total: number }>;
  contactsByStatus: Record<string, number>;
  upcomingMeetings: any[];
  pendingTasks: any[];
  recentActivities: any[];
}
