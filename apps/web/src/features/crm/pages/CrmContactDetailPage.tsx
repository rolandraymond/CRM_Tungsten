import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import { useCrmLang } from '../useCrmLang';
import type {
  CrmContact,
  CrmCompany,
  WorkspaceMember,
  DealStage,
  LeadStatus,
  MeetingStatus,
  ActivityType,
} from '../types';
import { DEAL_STAGES } from '../types';
import { ContactFormModal } from '../components/ContactFormModal';
import {
  ArrowRight,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Globe,
  ExternalLink,
  Edit2,
  Trash2,
  ArrowRightLeft,
  Calendar,
  Clock,
  CheckSquare,
  FileText,
  User,
  Building2,
  Tag,
  Plus,
  Copy,
  Check,
  Briefcase,
  Layers,
  History,
  AlertCircle,
  Package,
  Eye,
  CheckCircle2,
  X,
  Target,
  RefreshCw,
} from 'lucide-react';

export default function CrmContactDetailPage({ mode = 'client' }: { mode?: 'client' | 'contact' }) {
  const isContactOnly = mode === 'contact';
  const backRoute = isContactOnly ? '/crm/all-contacts' : '/crm/contacts';
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace, apiFetch, userRole } = useCrm();
  const { ar, dir, tr, fmtNum, fmtCurrency, fmtDate, labelLeadStatus, labelDealStage, labelMeetingStatus } = useCrmLang();

  const isSales = userRole === 'sales';

  const [contact, setContact] = useState<CrmContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Aux data
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  // Modals & Popups
  const [showEditModal, setShowEditModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDeliverablesModal, setShowDeliverablesModal] = useState(false);
  const [showPlanSelectorModal, setShowPlanSelectorModal] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [copiedLeadId, setCopiedLeadId] = useState(false);

  // Inline Quick Logger State
  const [logType, setLogType] = useState<ActivityType>('ملاحظة');
  const [logTitle, setLogTitle] = useState('');
  const [logDetails, setLogDetails] = useState('');
  const [logDueDate, setLogDueDate] = useState('');
  const [logMeetingStatus, setLogMeetingStatus] = useState<MeetingStatus>('محجوز');
  const [loggingActivity, setLoggingActivity] = useState(false);

  // Feed Filter Tab
  const [feedFilter, setFeedFilter] = useState<'all' | 'notes' | 'calls' | 'meetings' | 'audit'>('all');

  // Quick Deal State
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [newDealName, setNewDealName] = useState('');
  const [newDealAmount, setNewDealAmount] = useState('0');
  const [newDealStage, setNewDealStage] = useState<DealStage>('مكالمة');
  const [creatingDeal, setCreatingDeal] = useState(false);

  // Load Contact Details
  const loadContact = useCallback(async () => {
    if (!activeWorkspace || !id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ data: CrmContact }>(
        `/api/crm/workspaces/${activeWorkspace.id}/contacts/${id}`
      );
      setContact(res.data);
      if (!newDealName && res.data) {
        setNewDealName(`باقة Tungsten Enterprise - ${res.data.full_name}`);
      }
    } catch (err: any) {
      console.error('[Load Contact Detail Error]', err);
      setError(err.message || 'فشل تحميل بيانات العميل');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, id, apiFetch, newDealName]);

  // Load Aux data (companies & team members)
  const loadAuxData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [compsRes, memsRes] = await Promise.all([
        apiFetch<{ data: CrmCompany[] }>(`/api/crm/workspaces/${activeWorkspace.id}/companies`),
        apiFetch<{ data: WorkspaceMember[] }>(`/api/crm/workspaces/${activeWorkspace.id}/members`),
      ]);
      setCompanies(compsRes.data || []);
      setMembers(memsRes.data || []);
    } catch {
      // ignore
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadContact();
    void loadAuxData();
  }, [loadContact, loadAuxData]);

  // Quick Update Contact Field (Lead Status, Activity Status, Meeting Status, etc.)
  async function handleQuickUpdate(patch: Partial<CrmContact>) {
    if (!activeWorkspace || !contact) return;
    try {
      const res = await apiFetch<{ data: CrmContact }>(
        `/api/crm/workspaces/${activeWorkspace.id}/contacts/${contact.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }
      );
      setContact((prev) => (prev ? { ...prev, ...res.data } : null));
      void loadContact(); // Refresh timeline with audit log
    } catch (err: any) {
      alert(`فشل التحديث: ${err.message}`);
    }
  }

  // Quick Update Deal Stage
  async function handleDealStageChange(dealId: string, newStage: DealStage) {
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals/${dealId}`, {
        method: 'PATCH',
        body: JSON.stringify({ deal_stage: newStage }),
      });
      void loadContact(); // Reload to reflect stage change and audit trail
    } catch (err: any) {
      alert(`فشل تحديث مرحلة الصفقة: ${err.message}`);
    }
  }

  // Create Associated Deal
  async function handleCreateDeal(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !contact || !newDealName) return;
    setCreatingDeal(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals`, {
        method: 'POST',
        body: JSON.stringify({
          deal_name: newDealName,
          deal_amount: Number(newDealAmount) || 0,
          deal_stage: newDealStage,
          currency: 'EGP',
          company_id: contact.company_id || null,
          contact_ids: [contact.id],
        }),
      });
      setShowNewDealModal(false);
      void loadContact();
    } catch (err: any) {
      alert(`فشل إنشاء الصفقة: ${err.message}`);
    } finally {
      setCreatingDeal(false);
    }
  }

  // Approve or Activate Plan
  async function handleApprovePlan(planOverride?: any) {
    if (!activeWorkspace || !contact) return;
    setApprovingPlan(true);
    try {
      const planToApprove = planOverride || activePlan;
      if (!planToApprove) throw new Error('لا توجد خطة مسجلة لاعتمادها');

      await apiFetch(
        `/api/crm/workspaces/${activeWorkspace.id}/contacts/${contact.id}/plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...planToApprove,
            available_plans: activePlan?.available_plans || planToApprove.available_plans,
            is_approved: true,
          }),
        }
      );
      void loadContact();
    } catch (err: any) {
      alert(`فشل اعتماد وتفعيل الخطة: ${err.message}`);
    } finally {
      setApprovingPlan(false);
    }
  }

  // Save Selected Plan (either approved or proposal)
  async function handleSavePlan(planToSave: any, approveNow: boolean) {
    if (!activeWorkspace || !contact) return;
    setApprovingPlan(true);
    try {
      await apiFetch(
        `/api/crm/workspaces/${activeWorkspace.id}/contacts/${contact.id}/plan`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...planToSave,
            available_plans: activePlan?.available_plans || planToSave.available_plans,
            is_approved: approveNow,
          }),
        }
      );
      setShowPlanSelectorModal(false);
      void loadContact();
    } catch (err: any) {
      alert(`فشل حفظ الخطة: ${err.message}`);
    } finally {
      setApprovingPlan(false);
    }
  }

  // Log Activity (Note, Call, Meeting, Task)
  async function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !contact || !logTitle.trim()) return;
    setLoggingActivity(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          activity_type: logType,
          title: logTitle.trim(),
          details: logDetails.trim() || null,
          contact_id: contact.id,
          company_id: contact.company_id || null,
          due_date: logDueDate || null,
          meeting_status: logType === 'اجتماع' ? logMeetingStatus : null,
        }),
      });
      setLogTitle('');
      setLogDetails('');
      setLogDueDate('');
      void loadContact();
    } catch (err: any) {
      alert(`فشل تسجيل النشاط: ${err.message}`);
    } finally {
      setLoggingActivity(false);
    }
  }

  // Transfer Ownership
  async function handleTransferOwner() {
    if (!activeWorkspace || !contact || !newOwnerId) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${contact.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      });
      setShowTransferModal(false);
      void loadContact();
    } catch (err: any) {
      alert(`فشل نقل المسؤولية: ${err.message}`);
    }
  }

  // Delete Contact
  async function handleDelete() {
    if (!window.confirm('هل أنت متأكد من حذف هذا العميل نهائياً من النظام؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    if (!activeWorkspace || !contact) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${contact.id}`, {
        method: 'DELETE',
      });
      navigate(backRoute);
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    }
  }

  // Copy Lead ID to clipboard
  function copyLeadId() {
    if (!contact?.lead_id) return;
    void navigator.clipboard.writeText(contact.lead_id);
    setCopiedLeadId(true);
    setTimeout(() => setCopiedLeadId(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
        <p className="text-xs font-semibold text-muted">جاري تحميل بروفايل العميل الشامل وسجل الحركات...</p>
      </div>
    );
  }

  if (error || !contact) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-rose-600">
        <AlertCircle className="mx-auto mb-2 h-8 w-8" />
        <h3 className="font-bold">تعذر العثور على العميل</h3>
        <p className="text-xs text-muted mt-1">{error || 'قد يكون تم حذف العميل أو ليس لديك صلاحية الوصول إليه.'}</p>
        <Link
          to={backRoute}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-surface px-4 py-2 text-xs font-bold shadow-sm"
        >
          <ArrowRight className="h-4 w-4" />
          <span>{isContactOnly ? 'العودة لكل جهات الاتصال' : 'العودة لقائمة العملاء'}</span>
        </Link>
      </div>
    );
  }

  const cleanPhone = (contact.whatsapp_number || contact.phone_number || '').replace(/\D/g, '');

  // Build Chronological Timeline from Activities + Audit Logs + Creation Event
  interface TimelineEvent {
    id: string;
    type: 'creation' | 'activity' | 'audit';
    timestamp: string;
    title: string;
    subtitle?: string;
    details?: string;
    author?: string;
    meta?: any;
    badge?: string;
    badgeColor?: string;
  }

  const timelineEvents: TimelineEvent[] = [];

  // 1. Initial Creation Event
  timelineEvents.push({
    id: 'creation',
    type: 'creation',
    timestamp: contact.created_at,
    title: 'تم إنشاء العميل لأول مرة في النظام',
    subtitle: `عبر المنصة: ${contact.source_platform || 'Meta Ads'} • معرف الإعلان: ${contact.ad_id || '-'}`,
    author: contact.creator_name || 'فريق Tungsten',
    details: `تم تسجيل العميل بنجاح بواسطة ${contact.creator_name || 'النظام'} مع معرف العميل ${contact.lead_id || '-'}`,
    badge: 'إنشاء',
    badgeColor: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  });

  // 2. Activities (Notes, Calls, Meetings, Tasks)
  (contact.activities || []).forEach((act) => {
    let badgeColor = 'bg-blue-500/10 text-blue-600 border-blue-500/30';
    if (act.activity_type === 'ملاحظة') badgeColor = 'bg-amber-500/10 text-amber-600 border-amber-500/30';
    if (act.activity_type === 'مكالمة') badgeColor = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';
    if (act.activity_type === 'اجتماع') badgeColor = 'bg-purple-500/10 text-purple-600 border-purple-500/30';

    timelineEvents.push({
      id: `act-${act.id}`,
      type: 'activity',
      timestamp: act.created_at,
      title: `${act.activity_type}: ${act.title}`,
      subtitle: act.meeting_status ? `حالة الاجتماع: ${act.meeting_status}` : undefined,
      details: act.details || undefined,
      author: act.assigned_user_name || 'المسؤول',
      badge: act.activity_type,
      badgeColor,
      meta: act,
    });
  });

  // 3. Audit Logs (Stage changes, Updates, Transfers)
  (contact.audit_logs || []).forEach((log) => {
    let title = 'تحديث سجل العميل';
    let details = '';
    let badgeColor = 'bg-gray-500/10 text-gray-600 border-gray-500/30';

    if (log.action === 'STAGE_CHANGE') {
      const isSocialLens = log.new_values?.source === 'SocialLens Webhook' || log.new_values?.source === 'SocialLens';
      title = isSocialLens ? '🏆 ترقية إلى عميل رسمي عبر SocialLens' : 'تغيير مرحلة الباقة / الصفقة';
      badgeColor = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';
      const oldStage = log.old_values?.deal_stage || 'مكالمة';
      const newStage = log.new_values?.deal_stage || 'عميل';
      details = isSocialLens
        ? `تم اعتماد العميل وترقيته ونقله إلى الصفقات المعتمدة (Deals). مسؤول المتابعة / من تابع معه: [${log.new_values?.sales_rep || 'فريق المبيعات'}]. المرحلة السابقة: [${oldStage}] ➔ الحالية: [${newStage}]`
        : `تم نقل مرحلة الصفقة من [${oldStage}] إلى [${newStage}]`;
    } else if (log.action === 'TRANSFER_OWNERSHIP') {
      title = 'نقل ملكية العميل إلى موظف آخر';
      badgeColor = 'bg-blue-500/10 text-blue-600 border-blue-500/30';
      details = 'تم تغيير مسؤول المبيعات المعين لهذا العميل';
    } else if (log.action === 'INSERT') {
      // already represented by creation event, skip duplicate
      return;
    } else if (log.action === 'UPDATE') {
      const isSocialLens = log.new_values?.source === 'SocialLens Webhook' || log.new_values?.source === 'SocialLens';
      if (isSocialLens) {
        title = log.new_values?.is_won ? '🏆 ترقية إلى عميل نشط (SocialLens)' : 'تحديث حالة ومتابعة عبر SocialLens';
        badgeColor = log.new_values?.is_won ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' : 'bg-blue-500/10 text-blue-600 border-blue-500/30';
        details = `تم استلام تحديث من SocialLens. مسؤول المتابعة والسيلز: [${log.new_values?.sales_rep || 'فريق المبيعات'}]. حالة العميل: [${log.new_values?.lead_status || '-'}] • مرحلة الصفقة: [${log.new_values?.deal_stage || '-'}]`;
      } else {
        title = 'تعديل بيانات العميل';
        badgeColor = 'bg-amber-500/10 text-amber-600 border-amber-500/30';
        if (log.new_values?.lead_status) {
          details = `تم تحديث حالة العميل إلى: ${log.new_values.lead_status}`;
        } else if (log.new_values?.activity_status) {
          details = `تم تحديث حالة النشاط إلى: ${log.new_values.activity_status}`;
        } else if (log.new_values?.meeting_status) {
          details = `تم تحديث حالة الاجتماع إلى: ${log.new_values.meeting_status}`;
        } else {
          details = 'تم إجراء تحديثات على حقول العميل في قاعدة البيانات';
        }
      }
    }

    timelineEvents.push({
      id: `audit-${log.id}`,
      type: 'audit',
      timestamp: log.created_at,
      title,
      details,
      author: log.performed_by_name || 'النظام',
      badge: log.action,
      badgeColor,
      meta: log,
    });
  });

  // Sort Chronologically (Newest First) as base
  timelineEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Base Filtered Events by Type
  const baseFilteredEvents = timelineEvents.filter((ev) => {
    if (feedFilter === 'all') return true;
    if (feedFilter === 'notes') return ev.badge === 'ملاحظة';
    if (feedFilter === 'calls') return ev.badge === 'مكالمة';
    if (feedFilter === 'meetings') return ev.badge === 'اجتماع';
    if (feedFilter === 'audit') return ev.type === 'audit' || ev.type === 'creation';
    return true;
  });

  const filteredEvents = baseFilteredEvents;

  // Active Subscribed Plan / SocialLens Package Deliverables (NEVER fabricate fake 16,450 price if none exists)
  const clientDeal = contact?.deals?.[0];
  const linkedDealAmount = clientDeal?.deal_amount ? Number(clientDeal.deal_amount) : 0;
  const isClientWon = contact && (contact.lead_status === 'تم الفوز' || contact.lead_status === 'عميل' || contact.deals?.some((d) => d.deal_stage === 'عميل'));

  const hasValidStoredPlan = Boolean(
    contact?.plan_details &&
    (Number(contact.plan_details.price) > 0 || (contact.plan_details.services && contact.plan_details.services.length > 0))
  );

  const activePlan = hasValidStoredPlan
    ? contact!.plan_details!
    : (contact && linkedDealAmount > 0
      ? {
          plan_name: clientDeal?.deal_name || 'باكيدج مخصص',
          plan_tier: 'custom' as const,
          plan_code: contact.lead_id || `PKG-${String(clientDeal?.id || '').slice(0, 6).toUpperCase()}`,
          pricing_location: 'تسعير مخصص',
          price: linkedDealAmount,
          billing_cycle: 'شهرياً',
          status: isClientWon ? 'مشترك بها (معتمدة)' : 'قيد المراجعة والتفاوض',
          badge: isClientWon ? 'باقة معتمدة ومفعلة' : 'باكيدج مخصص',
          is_approved: Boolean(isClientWon),
          description: clientDeal?.description && !clientDeal.description.includes('__PLAN_JSON__:') ? clientDeal.description : '',
          strategy_goal: '',
          diagnostics: {
            account: contact.social_profile_link && contact.social_profile_link !== '-'
              ? contact.social_profile_link
              : (contact.full_name || 'حساب العميل'),
            platform: contact.source_platform || 'CRM',
            engagement_rate: '—',
            analysis_date: new Date(contact.created_at).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-US', { day: 'numeric', month: 'long' }),
            status_label: isClientWon ? tr('عميل نشط ومعتمد', 'Active Approved Client') : tr('قيد المتابعة', 'In Progress'),
          },
          services: [],
        }
      : null);

  return (
    <div className="space-y-4" dir={dir}>
      {/* 1. TOP HEADER & BREADCRUMB */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            to={backRoute}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-muted hover:bg-surface/80 hover:text-ink transition"
            title={isContactOnly ? tr('العودة لكل جهات الاتصال', 'Back to All Contacts') : tr('العودة لقائمة العملاء', 'Back to Leads Pipeline')}
          >
            <ArrowRight className={`h-4 w-4 ${!ar ? 'rotate-180' : ''}`} />
          </Link>

          {/* Avatar & Name */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 font-bold text-amber-600 text-base border border-amber-500/20 shadow-xs">
            {contact.full_name ? contact.full_name.slice(0, 2).toUpperCase() : 'LE'}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-ink">{contact.full_name}</h1>
              {contact.lead_id && (
                <button
                  onClick={copyLeadId}
                  className="flex items-center gap-1 rounded-lg border border-line bg-surface/60 px-2 py-0.5 text-xs font-mono text-muted hover:text-ink transition"
                  title={tr('نسخ Lead ID', 'Copy Lead ID')}
                >
                  <span>{contact.lead_id}</span>
                  {copiedLeadId ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                </button>
              )}
              <span
                className={`rounded-lg px-2.5 py-0.5 text-[11px] font-bold border ${
                  contact.lead_status === 'تم الفوز' || contact.lead_status === 'عميل' || contact.lead_status === 'عقد'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                    : contact.lead_status === 'قيد المتابعة'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                    : contact.lead_status === 'خاسر'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-600'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-600'
                }`}
              >
                {labelLeadStatus(contact.lead_status)}
              </span>
            </div>
            <p className="text-xs text-muted flex items-center gap-2 mt-0.5">
              <span>{contact.job_title || tr('عميل محتمل', 'Lead')}</span>
              {contact.business_name && <span>• {contact.business_name}</span>}
              {contact.email && <span>• {contact.email}</span>}
            </p>
          </div>
        </div>

        {/* Quick Action Toolbar (HubSpot Style) */}
        <div className="flex flex-wrap items-center gap-2">
          {contact.phone_number && (
            <a
              href={`tel:${contact.phone_number}`}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-xs hover:border-amber-500 hover:text-amber-600 transition"
              title={tr('اتصال هاتفي مباشر', 'Direct Call')}
            >
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              <span>{tr('اتصال', 'Call')}</span>
            </a>
          )}

          {cleanPhone && (
            <a
              href={`https://wa.me/${cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-700 shadow-xs hover:bg-emerald-500/20 transition"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>{tr('واتساب مباشر', 'WhatsApp')}</span>
            </a>
          )}

          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-xs hover:border-amber-500 transition"
            >
              <Mail className="h-3.5 w-3.5 text-blue-500" />
              <span>{tr('بريد', 'Email')}</span>
            </a>
          )}

          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-600 transition"
          >
            <Edit2 className="h-3.5 w-3.5" />
            <span>{tr('تعديل البيانات', 'Edit Details')}</span>
          </button>

          {!isSales && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-xs hover:text-blue-600 transition"
              title={tr('نقل مسؤولية العميل لموظف آخر', 'Transfer Ownership')}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>{tr('نقل المسؤول', 'Transfer')}</span>
            </button>
          )}

          {!isSales && (
            <button
              onClick={() => void handleDelete()}
              className="flex items-center gap-1 rounded-xl border border-rose-500/20 bg-surface px-2.5 py-2 text-xs text-rose-500 shadow-xs hover:bg-rose-500/10 transition"
              title={tr('حذف العميل', 'Delete Client')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. DATA HIGHLIGHTS STRIP (HubSpot Style Highlights Bar) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Highlight 1: Creator & Create Date */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-amber-500" />
            <span>{tr('تاريخ الإنشاء ومن ضافه', 'Created Date & Creator')}</span>
          </div>
          <div className="mt-1 font-mono font-bold text-ink text-xs">
            {new Date(contact.created_at).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
          <div className="mt-0.5 text-[11px] text-muted flex items-center gap-1">
            <span>{tr('بواسطة:', 'By:')}</span>
            <span className="font-semibold text-ink">{contact.creator_name || 'Tungsten Team'}</span>
            {contact.creator_email && <span className="font-mono text-[10px]">({contact.creator_email})</span>}
          </div>
        </div>

        {/* Highlight 2: Lead Status (Live Selector) */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-blue-500" />
            <span>{tr('حالة العميل (Lead Status)', 'Lead Status')}</span>
          </div>
          <div className="mt-1.5">
            <select
              value={contact.lead_status}
              onChange={(e) => void handleQuickUpdate({ lead_status: e.target.value as LeadStatus })}
              className="w-full rounded-xl border border-line bg-surface/50 px-2.5 py-1 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
            >
              <option value="جديد">{tr('جديد (New)', 'New')}</option>
              <option value="قيد المتابعة">{tr('قيد المتابعة (In Progress)', 'In Progress')}</option>
              <option value="عقد">{tr('عقد (Contract ➔ Won Deals)', 'Contract ➔ Won Deals')}</option>
              <option value="تم الفوز">{tr('تم الفوز / عميل (Won ➔ Won Deals)', 'Won / Client ➔ Won Deals')}</option>
              <option value="خاسر">{tr('خاسر (Lost)', 'Lost')}</option>
            </select>
          </div>
        </div>

        {/* Highlight 3: Activity Status (Live Selector) */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
            <span>{tr('حالة النشاط (Activity Status)', 'Activity Status')}</span>
          </div>
          <div className="mt-1.5">
            <select
              value={contact.activity_status || 'معاودة الاتصال'}
              onChange={(e) => void handleQuickUpdate({ activity_status: e.target.value })}
              className="w-full rounded-xl border border-line bg-surface/50 px-2.5 py-1 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
            >
              <option value="معاودة الاتصال">{tr('معاودة الاتصال (Call back)', 'Call Back')}</option>
              <option value="مهتم">{tr('مهتم (Interested)', 'Interested')}</option>
              <option value="اهتمام مستقبلي">{tr('اهتمام مستقبلي (Future Interest)', 'Future Interest')}</option>
              <option value="غير مهتم">{tr('غير مهتم (Not Interested)', 'Not Interested')}</option>
              <option value="اجتماع">{tr('اجتماع (Meeting)', 'Meeting')}</option>
            </select>
          </div>
        </div>

        {/* Highlight 4: Assigned Owner */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-purple-500" />
            <span>{tr('المسؤول الحالي (Contact Owner)', 'Contact Owner')}</span>
          </div>
          <div className="mt-1 font-bold text-ink text-xs flex items-center justify-between">
            <span>{contact.owner_name || tr('غير محدد', 'Unassigned')}</span>
            {!isSales && (
              <button
                onClick={() => setShowTransferModal(true)}
                className="text-[10px] text-amber-600 hover:underline"
              >
                {tr('تغيير', 'Change')}
              </button>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted font-mono">
            {contact.owner_email || '—'}
          </div>
        </div>
      </div>

      {/* 2.5 CURRENT SUBSCRIBED PLAN & DIAGNOSTICS (Hidden in All Contacts mode) */}
      {!isContactOnly && activePlan ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Main Plan Card (8 cols) */}
          <div className="lg:col-span-8 rounded-3xl border border-line/70 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-5 text-white shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3 mb-4 flex-wrap">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-2">
                <Package className="h-4 w-4 text-amber-400" />
                <span>{activePlan.is_approved ? tr('الخطة المشترك بها حالياً', 'Active Subscribed Plan') : tr('الخطة وعرض السعر المقترح', 'Proposed Package & Pricing')}</span>
              </span>

              <div className="flex items-center gap-2 flex-wrap">
                {activePlan.is_approved ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{activePlan.status || tr('مشترك بها (معتمدة)', 'Approved & Active')}</span>
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>{activePlan.status || tr('قيد المراجعة والتفاوض (لم تُعتمد بعد)', 'Pending Review')}</span>
                    </span>
                    <button
                      type="button"
                      disabled={approvingPlan}
                      onClick={() => void handleApprovePlan()}
                      className="px-3 py-1 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-bold transition flex items-center gap-1 cursor-pointer shadow-sm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{approvingPlan ? tr('جاري الاعتماد...', 'Approving...') : tr('اعتماد وتفعيل الخطة الآن ✅', 'Approve & Activate Plan ✅')}</span>
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowPlanSelectorModal(true)}
                  className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer border border-white/10"
                  title={tr('تغيير أو اختيار باقة أخرى', 'Change or select another plan')}
                >
                  <RefreshCw className="h-3 w-3 text-amber-400" />
                  <span>{tr('تغيير الباقة', 'Change Plan')}</span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h4 className="text-lg font-black text-white">{activePlan.plan_name}</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    <span className="font-mono text-amber-400 font-bold">{activePlan.plan_code}</span> • {activePlan.pricing_location}
                  </p>
                </div>

                <div className="text-end">
                  <span className="font-mono text-2xl font-black text-white tracking-tight tabular-nums">
                    {fmtNum(Number(activePlan.price))}
                  </span>
                  <span className="text-xs font-bold text-amber-400 ms-1.5">{tr('ج.م / شهر', 'EGP / mo')}</span>
                </div>
              </div>

              {/* Deliverables preview */}
              <div className="pt-3 border-t border-white/10 space-y-2">
                <span className="text-xs font-semibold text-slate-300 block">
                  {tr('مخرجات وخدمات الخطة:', 'Plan Services & Deliverables:')}
                </span>
                <div className="flex flex-wrap gap-2">
                  {activePlan.services.map((srv, idx) => (
                    <span
                      key={srv.id || idx}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/10 text-white/95 font-medium shadow-2xs"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>{srv.title}</span>
                      <span className="text-amber-400 font-bold font-mono">({srv.quantity}×)</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeliverablesModal(true)}
                  className="w-full py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-bold border border-white/15 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm hover:border-amber-400/50"
                >
                  <Eye className="h-4 w-4 text-amber-400" />
                  <span>{tr('استعراض خدمات ومخرجات الباقة 👁️', 'View Package Deliverables 👁️')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Diagnosis & Analysis Card (4 cols) matching Image 1 */}
          <div className="lg:col-span-4 rounded-3xl border border-line/70 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-5 text-white shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-rose-500" />
                  <span>{tr('آخر تشخيص وتحليل للحساب', 'Account Analysis & Diagnostics')}</span>
                </span>
                <span className="rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 text-[10px] font-bold font-mono">
                  {activePlan.diagnostics?.platform || 'YOUTUBE'}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm font-mono" dir="ltr">
                    {activePlan.diagnostics?.account || 'HalalChef@'}
                  </span>
                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3 text-slate-400" />
                    <span>{tr('تم التحليل:', 'Analyzed:')} {activePlan.diagnostics?.analysis_date || '14 Nov'}</span>
                  </span>
                </div>

                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{tr('معدل التفاعل', 'Engagement Rate')}</span>
                    <span className="text-lg font-black text-amber-400 font-mono">
                      {activePlan.diagnostics?.engagement_rate || '0.5%'}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-400 font-medium">
                    {activePlan.diagnostics?.status_label || tr('أداء متوسط بإمكانات واعدة', 'Moderate performance with high potential')}
                  </p>
                </div>

                {activePlan.strategy_goal && (
                  <p className="text-xs text-slate-300 leading-relaxed bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                    {activePlan.strategy_goal}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 mt-3 text-start">
              <button
                type="button"
                onClick={() => setShowDeliverablesModal(true)}
                className="text-xs text-amber-400 hover:text-amber-300 font-bold inline-flex items-center gap-1 transition"
              >
                <span>{tr('عرض تفاصيل المخرجات الاستراتيجية', 'View Strategic Deliverables')}</span>
                <ArrowRight className={`h-3 w-3 ${!ar ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-line bg-surface p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-ink">{tr('لم يحدد أي باكيدج لهذا العميل بعد', 'No package set for this client yet')}</h4>
              <p className="text-xs text-muted">{tr('يمكنك اختيار باقة معتمدة أو إضافة سعر باكيدج مخصص للعميل في أي وقت.', 'You can select an approved plan or set a custom package price anytime.')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPlanSelectorModal(true)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>{tr('تحديد واعتماد باقة للعميل', 'Assign & Approve Package')}</span>
          </button>
        </div>
      )}

      {/* 3. MAIN 3-COLUMN LAYOUT (HubSpot Record View) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* RIGHT COLUMN (4 cols): Complete Contact Info (All 25 Fields) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card 1: Identity & Contact Numbers */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <User className="h-4 w-4 text-amber-500" />
              <span>{tr('بيانات الهوية والتواصل (Contact Details)', 'Contact Details')}</span>
            </h3>

            <div className="space-y-2.5 text-xs">
              <div>
                <span className="block text-muted text-[11px]">{tr('الاسم الكامل:', 'Full Name:')}</span>
                <span className="font-bold text-ink">{contact.full_name}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">{tr('المسمى الوظيفي:', 'Job Title:')}</span>
                <span className="font-medium text-ink">{contact.job_title || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">{tr('رقم الهاتف الأساسي:', 'Primary Phone:')}</span>
                <span className="font-mono font-bold text-ink">{contact.phone_number || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">{tr('رقم الواتساب:', 'WhatsApp Number:')}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-emerald-600">{contact.whatsapp_number || '—'}</span>
                  {cleanPhone && (
                    <a
                      href={`https://wa.me/${cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-emerald-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      <MessageCircle className="h-3 w-3" />
                      <span>{tr('فتح واتساب', 'Open WhatsApp')}</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line/60">
                <div>
                  <span className="block text-muted text-[11px]">{tr('هاتف العمل:', 'Business Phone:')}</span>
                  <span className="font-mono text-ink text-[11px]">{contact.business_phone || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">{tr('هاتف الشركة:', 'Company Phone:')}</span>
                  <span className="font-mono text-ink text-[11px]">{contact.company_phone || '—'}</span>
                </div>
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">{tr('البريد الإلكتروني:', 'Email:')}</span>
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="font-mono text-amber-600 hover:underline">
                    {contact.email}
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">{tr('رابط الملف التعريفي (Social Profile):', 'Social Profile Link:')}</span>
                {contact.social_profile_link && contact.social_profile_link !== '-' ? (
                  <a
                    href={contact.social_profile_link.startsWith('http') ? contact.social_profile_link : `https://${contact.social_profile_link}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline break-all"
                  >
                    <span>{contact.social_profile_link}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Business & Clinic Details */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-blue-500" />
              <span>{tr('بيانات المنشأة والعيادة (Business / Clinic)', 'Business / Clinic Details')}</span>
            </h3>

            <div className="space-y-2.5 text-xs">
              <div>
                <span className="block text-muted text-[11px]">{tr('اسم العيادة أو المنشأة:', 'Business / Clinic Name:')}</span>
                <span className="font-bold text-ink">{contact.business_name || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">{tr('التخصص الطبي:', 'Specialty / Field:')}</span>
                <span className="font-semibold text-ink">{contact.medical_specialty || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">{tr('العنوان التفصيلي:', 'Address:')}</span>
                <span className="text-ink">{contact.clinic_address || '—'}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-line/60">
                <div>
                  <span className="block text-muted text-[11px]">{tr('المدينة:', 'City:')}</span>
                  <span className="font-medium text-ink">{contact.city || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">{tr('الحي:', 'District:')}</span>
                  <span className="font-medium text-ink">{contact.district || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">{tr('عدد الفروع:', 'Branches:')}</span>
                  <span className="font-mono font-bold text-ink">{fmtNum(contact.branch_count || 1)}</span>
                </div>
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">{tr('خرائط جوجل (Google Maps):', 'Google Maps:')}</span>
                {contact.google_maps ? (
                  <a
                    href={contact.google_maps.startsWith('http') ? contact.google_maps : `https://${contact.google_maps}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
                  >
                    <MapPin className="h-3 w-3" />
                    <span>{tr('عرض الموقع على الخريطة', 'View on Map')}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">{tr('الموقع الإلكتروني (Website):', 'Website:')}</span>
                {contact.website ? (
                  <a
                    href={contact.website.startsWith('http') ? contact.website : `https://${contact.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    <Globe className="h-3 w-3" />
                    <span>{contact.website}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line/60">
                <div>
                  <span className="block text-muted text-[11px]">{tr('إنستغرام:', 'Instagram:')}</span>
                  <span className="text-ink text-[11px]">{contact.business_instagram || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">{tr('فيسبوك:', 'Facebook:')}</span>
                  <span className="text-ink text-[11px]">{contact.business_facebook || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Campaign & Tracking (Hidden in All Contacts mode) */}
          {!isContactOnly && (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-purple-500" />
              <span>{tr('الحملة التسويقية والتتبع (Campaign & Source)', 'Campaign & Source Tracking')}</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted">{tr('منصة المصدر:', 'Source Platform:')}</span>
                <span className="font-bold text-ink rounded-lg bg-surface/80 border border-line px-2 py-0.5">
                  {contact.source_platform || 'Meta Ads'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">{tr('معرف الإعلان (Ad ID):', 'Ad ID:')}</span>
                <span className="font-mono text-ink text-[11px]">{contact.ad_id || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Lead ID:</span>
                <span className="font-mono text-ink text-[11px]">{contact.lead_id || '—'}</span>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* MIDDLE COLUMN (5 cols): Timeline & Complete History ("الهستوري بتاعته وكل حاجه") */}
        <div className="lg:col-span-5 space-y-4">
          {/* Quick Activity Logger Form (HubSpot Style) */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2.5 mb-3">
              <div className="flex items-center gap-1 font-bold text-xs text-ink">
                <FileText className="h-4 w-4 text-amber-500" />
                <span>{tr('تسجيل نشاط فوري للعميل', 'Quick Activity Logger')}</span>
              </div>
              {/* Logger Tabs */}
              <div className="flex rounded-xl bg-surface/80 p-0.5 border border-line text-[11px]">
                <button
                  type="button"
                  onClick={() => setLogType('ملاحظة')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'ملاحظة' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  {tr('ملاحظة', 'Note')}
                </button>
                <button
                  type="button"
                  onClick={() => setLogType('مكالمة')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'مكالمة' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  {tr('مكالمة', 'Call')}
                </button>
                <button
                  type="button"
                  onClick={() => setLogType('اجتماع')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'اجتماع' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  {tr('اجتماع', 'Meeting')}
                </button>
                <button
                  type="button"
                  onClick={() => setLogType('مهمة')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'مهمة' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  {tr('مهمة', 'Task')}
                </button>
              </div>
            </div>

            <form onSubmit={handleAddActivity} className="space-y-2.5 text-xs">
              <div>
                <input
                  type="text"
                  value={logTitle}
                  onChange={(e) => setLogTitle(e.target.value)}
                  required
                  placeholder={
                    logType === 'ملاحظة'
                      ? tr('عنوان الملاحظة (مثال: العميل مهتم بعرض سعر Enterprise)...', 'Note title (e.g. Interested in Enterprise quote)...')
                      : logType === 'مكالمة'
                      ? tr('ملخص المكالمة (مثال: تم الاتصال وشرح مزايا النظام)...', 'Call summary...')
                      : logType === 'اجتماع'
                      ? tr('عنوان الاجتماع (مثال: جلسة عرض تقديمي ديمو)...', 'Meeting title (e.g. Demo session)...')
                      : tr('عنوان المهمة المطلوبة...', 'Task title...')
                  }
                  className="w-full rounded-xl border border-line bg-surface/50 p-2.5 text-ink outline-none transition focus:border-amber-500"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  value={logDetails}
                  onChange={(e) => setLogDetails(e.target.value)}
                  placeholder={tr('التفاصيل الإضافية أو نقاط النقاش...', 'Additional details or discussion notes...')}
                  className="w-full rounded-xl border border-line bg-surface/50 p-2.5 text-ink outline-none transition focus:border-amber-500"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {logType === 'اجتماع' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={logDueDate}
                      onChange={(e) => setLogDueDate(e.target.value)}
                      className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-ink font-mono text-xs"
                    />
                    <select
                      value={logMeetingStatus}
                      onChange={(e) => setLogMeetingStatus(e.target.value as MeetingStatus)}
                      className="rounded-xl border border-line bg-surface px-2 py-1.5 text-ink text-xs font-bold"
                    >
                      <option value="محجوز">{labelMeetingStatus('محجوز')}</option>
                      <option value="حضر">{labelMeetingStatus('حضر')}</option>
                      <option value="لم يحضر">{labelMeetingStatus('لم يحضر')}</option>
                      <option value="ملغي">{labelMeetingStatus('ملغي')}</option>
                    </select>
                  </div>
                )}

                {logType === 'مهمة' && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-[11px]">{tr('تاريخ الاستحقاق:', 'Due Date:')}</span>
                    <input
                      type="date"
                      value={logDueDate}
                      onChange={(e) => setLogDueDate(e.target.value)}
                      className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-ink font-mono text-xs"
                    />
                  </div>
                )}

                <div className="ms-auto">
                  <button
                    type="submit"
                    disabled={loggingActivity}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 font-bold text-white shadow-xs hover:bg-amber-600 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{loggingActivity ? tr('جاري الحفظ...', 'Saving...') : tr('حفظ السجل', 'Save Entry')}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Timeline Feed & Audit History */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 mb-4">
              <div>
                <h3 className="font-bold text-xs text-ink flex items-center gap-1.5">
                  <History className="h-4 w-4 text-indigo-500" />
                  <span>{tr('السجل الزمني وحركات العميل (Activity & Audit History)', 'Activity & Audit History')}</span>
                </h3>
                <p className="text-[11px] text-muted">
                  {tr('سجل كامل ومفصل من لحظة إنشاء العميل وكافة التعديلات والملاحظات', 'Complete chronological timeline of edits, calls, meetings, and notes')}
                </p>
              </div>

              {/* Feed Filters */}
              <div className="flex flex-wrap gap-1 text-[11px]">
                <button
                  onClick={() => setFeedFilter('all')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'all' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  {tr(`الكل (${fmtNum(timelineEvents.length)})`, `All (${fmtNum(timelineEvents.length)})`)}
                </button>
                <button
                  onClick={() => setFeedFilter('notes')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'notes' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  {tr('الملاحظات', 'Notes')}
                </button>
                <button
                  onClick={() => setFeedFilter('calls')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'calls' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  {tr('المكالمات', 'Calls')}
                </button>
                <button
                  onClick={() => setFeedFilter('meetings')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'meetings' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  {tr('الاجتماعات', 'Meetings')}
                </button>
                <button
                  onClick={() => setFeedFilter('audit')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'audit' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  {tr('سجل التدقيق', 'Audit')}
                </button>
              </div>
            </div>

            {/* Timeline Events Scrollable List */}
            {filteredEvents.length === 0 ? (
              <div className="py-12 text-center text-muted text-xs">
                {tr('لا توجد سجلات تطابق الفلتر المحدد حالياً', 'No records match the selected filter')}
              </div>
            ) : (
              <div className={`relative ${ar ? 'border-r-2 mr-3 pr-4 pl-2' : 'border-l-2 ml-3 pl-4 pr-2'} border-line/60 max-h-[520px] overflow-y-auto space-y-3.5 custom-scrollbar scroll-smooth [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-500/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-amber-500/60`}>
                {filteredEvents.map((item) => (
                  <div key={item.id} className="relative group">
                    {/* Timeline Node Point */}
                    <div className={`absolute ${ar ? '-right-[23px]' : '-left-[23px]'} top-3 h-3.5 w-3.5 rounded-full border-2 border-surface bg-amber-500`} />

                    <div className="rounded-xl border border-line bg-surface/50 p-3 shadow-xs transition-all hover:border-amber-500/50 hover:bg-surface">
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border shrink-0 ${item.badgeColor || 'border-line text-muted'}`}>
                            {item.badge}
                          </span>
                          <span className="font-bold text-ink text-xs truncate">{item.title}</span>
                        </div>
                        <span className="text-[10px] text-muted font-mono shrink-0">
                          {new Date(item.timestamp).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {item.subtitle && (
                        <div className="text-[11px] font-semibold text-amber-600 mb-1">
                          {item.subtitle}
                        </div>
                      )}

                      {item.details && (
                        <p className="text-xs text-muted leading-relaxed whitespace-pre-wrap">
                          {item.details}
                        </p>
                      )}

                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted border-t border-line/40 pt-1.5">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-muted" />
                          <span>{tr('المسؤول:', 'Owner:')} {item.author}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* LEFT COLUMN (3 cols): Package, Deals & Meetings ("الباكيدج بتاعته والاجتماعات") */}
        <div className="lg:col-span-3 space-y-4">
          {/* Card 1: Offered Package & Deals (Hidden in All Contacts mode) */}
          {!isContactOnly && (
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
              <h3 className="font-bold text-xs text-ink flex items-center gap-1.5">
                <Briefcase className="h-4 w-4 text-amber-500" />
                <span>{tr('الباكيدج والصفقات (Package / Deals)', 'Packages & Deals')}</span>
              </h3>
              <button
                onClick={() => setShowNewDealModal(true)}
                className="rounded-lg p-1 text-amber-600 hover:bg-amber-500/10 transition"
                title={tr('إضافة صفقة أو باقة جديدة', 'Add Deal or Package')}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {contact.deals && contact.deals.length > 0 ? (
              <div className="space-y-3">
                {contact.deals.map((deal) => (
                  <div key={deal.id} className="rounded-xl border border-line bg-surface/50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-ink">{deal.deal_name}</span>
                      <span className="font-mono font-bold text-xs text-emerald-600">
                        {Number(deal.deal_amount) > 0
                          ? fmtCurrency(Number(deal.deal_amount))
                          : tr('لم يحدد أي باكيدج', 'No package set')}
                      </span>
                    </div>

                    {/* Deal Stage Live Selector */}
                    <div>
                      <span className="block text-muted text-[10px] mb-1">{tr('مرحلة الصفقة (Deal Stage):', 'Deal Stage:')}</span>
                      <select
                        value={deal.deal_stage}
                        onChange={(e) => void handleDealStageChange(deal.id, e.target.value as DealStage)}
                        className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
                      >
                        {DEAL_STAGES.map((st) => (
                          <option key={st} value={st}>
                            {labelDealStage(st)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-between text-[11px] text-muted pt-1 border-t border-line/60">
                      <span>{tr('تاريخ الإغلاق:', 'Close Date:')} <span className="font-mono">{deal.closing_date ? fmtDate(deal.closing_date) : tr('قيد التفاوض', 'Negotiating')}</span></span>
                      <span>{tr('المسؤول:', 'Owner:')} {deal.owner_name || 'Peter'}</span>
                    </div>

                    {activePlan && (
                      <button
                        type="button"
                        onClick={() => setShowDeliverablesModal(true)}
                        className="w-full py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 text-[11px] font-bold border border-amber-500/30 flex items-center justify-center gap-1.5 transition"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>{tr(`استعراض مخرجات الخطة (${fmtNum(activePlan.services.length)} مخرجات)`, `View Deliverables (${fmtNum(activePlan.services.length)})`)}</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line p-4 text-center text-muted text-xs">
                <p>{tr('لا توجد باقة أو صفقة مسجلة لهذا العميل حالياً', 'No deal or package assigned yet')}</p>
                <button
                  onClick={() => setShowNewDealModal(true)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{tr('تخصيص باقة للعميل (25,000 ج.م)', 'Assign Package (25,000 EGP)')}</span>
                </button>
              </div>
            )}
          </div>
          )}

          {/* Card 2: Meetings & Appointments ("الاجتماعات") */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-purple-500" />
              <span>{tr('الاجتماعات والمواعيد (Meetings)', 'Meetings & Appointments')}</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <span className="block text-muted text-[11px] mb-0.5">{tr('موعد الاجتماع المسجل:', 'Scheduled Meeting:')}</span>
                {contact.meeting_date ? (
                  <span className="font-mono font-bold text-ink">
                    {new Date(contact.meeting_date).toLocaleDateString(ar ? 'ar-EG-u-nu-latn' : 'en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : (
                  <span className="text-muted">{tr('لم يتم تحديد موعد اجتماع بعد', 'No meeting scheduled yet')}</span>
                )}
              </div>

              <div>
                <span className="block text-muted text-[11px] mb-1">{tr('حالة الاجتماع (Meeting Status):', 'Meeting Status:')}</span>
                <select
                  value={contact.meeting_status || 'محجوز'}
                  onChange={(e) => void handleQuickUpdate({ meeting_status: e.target.value as MeetingStatus })}
                  className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
                >
                  <option value="محجوز">{tr('محجوز (Booked)', 'Booked')}</option>
                  <option value="حضر">{tr('حضر (Show up)', 'Show Up')}</option>
                  <option value="لم يحضر">{tr('لم يحضر (No show)', 'No Show')}</option>
                  <option value="ملغي">{tr('ملغي (Cancelled)', 'Cancelled')}</option>
                </select>
              </div>

              <div className="pt-2 border-t border-line/60">
                <span className="block text-muted text-[11px] mb-1">{tr('تاريخ المتابعة القادمة:', 'Next Follow-up Date:')}</span>
                <input
                  type="date"
                  value={contact.follow_up_date ? contact.follow_up_date.slice(0, 10) : ''}
                  onChange={(e) => void handleQuickUpdate({ follow_up_date: e.target.value })}
                  className="w-full rounded-xl border border-line bg-surface px-2.5 py-1 text-ink font-mono text-xs"
                />
              </div>
            </div>
          </div>

          {/* Card 3: Associated Company */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-blue-500" />
              <span>الشركة المرتبطة (Associated Company)</span>
            </h3>

            {contact.company ? (
              <div className="space-y-2 text-xs">
                <div className="font-bold text-ink">{contact.company.company_name}</div>
                <div className="text-muted text-[11px]">{contact.company.industry || 'مجال طبي'}</div>
                {contact.company.phone && (
                  <div className="font-mono text-muted text-[11px]">{contact.company.phone}</div>
                )}
                {contact.company.website && (
                  <a
                    href={contact.company.website.startsWith('http') ? contact.company.website : `https://${contact.company.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline text-[11px]"
                  >
                    <span>{contact.company.website}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            ) : (
              <div className="text-muted text-xs">
                لا توجد شركة مرتبطة بهذا العميل
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: Full Edit Contact Form Modal (Includes Step 3 Campaign & Sales Pipeline) */}
      {showEditModal && (
        <ContactFormModal
          contact={contact}
          hidePipeline={false}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            void loadContact();
          }}
          companies={companies}
          members={members}
        />
      )}

      {/* MODAL: Transfer Ownership */}
      {showTransferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-ink mb-2">نقل ملكية العميل إلى موظف آخر</h3>
            <p className="text-xs text-muted mb-4">
              اختر مسؤول المبيعات الجديد الذي سيتولى متابعة وإدارة العميل ({contact.full_name}).
            </p>

            <div className="mb-4">
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-ink font-bold"
              >
                <option value="">-- اختر مسؤول المبيعات الجديد --</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.role})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={!newOwnerId}
                onClick={() => void handleTransferOwner()}
                className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
              >
                تأكيد النقل
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Add New Deal */}
      {showNewDealModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-ink mb-2">إضافة باقة / صفقة جديدة للعميل</h3>
            <p className="text-xs text-muted mb-4">
              إنشاء صفقة مخصصة وربطها مباشرة بالعميل ({contact.full_name})
            </p>

            <form onSubmit={handleCreateDeal} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted mb-1 font-medium">اسم الباقة / الصفقة *</label>
                <input
                  type="text"
                  value={newDealName}
                  onChange={(e) => setNewDealName(e.target.value)}
                  required
                  placeholder="باقة Tungsten Enterprise السنوية..."
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                />
              </div>

              <div>
                <label className="block text-muted mb-1 font-medium">قيمة الصفقة (ج.م) *</label>
                <input
                  type="number"
                  value={newDealAmount}
                  onChange={(e) => setNewDealAmount(e.target.value)}
                  required
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-muted mb-1 font-medium">مرحلة الصفقة (Deal Stage)</label>
                <select
                  value={newDealStage}
                  onChange={(e) => setNewDealStage(e.target.value as DealStage)}
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                >
                  {DEAL_STAGES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewDealModal(false)}
                  className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creatingDeal}
                  className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600"
                >
                  {creatingDeal ? 'جاري الإنشاء...' : 'حفظ وربط الصفقة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. DELIVERABLES & PLAN MODAL (Matching SocialLens Offer View from Screenshot 2) */}
      {showDeliverablesModal && activePlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-700/80 bg-slate-900 p-6 text-white shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Package className="h-5 w-5 text-amber-400" />
                <h3 className="text-sm sm:text-base font-black text-white">
                  تفاصيل ومخرجات الخطة: {activePlan.plan_code}
                </h3>
                <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400 font-mono">
                  In Package
                </span>
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                  {activePlan.badge || 'باقة معتمدة ونشطة'}
                </span>
              </div>

              <button
                onClick={() => setShowDeliverablesModal(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
                title="إغلاق النافذة"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Top Summary Box */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4.5 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h4 className="text-base sm:text-lg font-black text-white">{activePlan.plan_name}</h4>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {activePlan.description}
                  </p>
                </div>
                <div className="text-end shrink-0">
                  <span className="text-2xl sm:text-3xl font-black text-white tabular-nums tracking-tight">
                    {Number(activePlan.price).toLocaleString()}
                  </span>
                  <span className="text-xs font-bold text-amber-400 block mt-0.5">ج.م / شهرياً</span>
                </div>
              </div>

              {activePlan.strategy_goal && (
                <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 text-xs text-emerald-400 font-medium leading-relaxed">
                  {activePlan.strategy_goal}
                </div>
              )}
            </div>

            {/* Services Section Header */}
            <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1 pt-1">
              <span>الخدمات والمخرجات المتضمنة في هذه الباقة:</span>
              <span className="font-mono text-amber-400">{activePlan.services.length} خدمة</span>
            </div>

            {/* Services List (Itemized Deliverables) */}
            <div className="space-y-2.5">
              {activePlan.services.map((service, idx) => (
                <div
                  key={service.id || idx}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-white/20 transition-all space-y-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="text-xs sm:text-sm font-bold text-white">
                        {service.title}
                      </span>
                    </div>

                    <div className="text-end shrink-0">
                      <span className="text-xs sm:text-sm font-black text-white tabular-nums" dir="ltr">
                        {Number(service.total_price).toLocaleString()} ج.م
                      </span>
                      <span className="text-[11px] text-slate-400 block font-mono" dir="ltr">
                        ({service.quantity} × {Number(service.unit_price).toLocaleString()} ج.م)
                      </span>
                    </div>
                  </div>

                  {service.description && (
                    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs text-slate-300 leading-relaxed">
                      💡 {service.description}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
              <span className="font-mono text-[11px]">
                كود العرض: <strong className="text-amber-400">{activePlan.plan_code}</strong> • الحالة: <strong className={activePlan.is_approved ? 'text-emerald-400' : 'text-amber-400'}>{activePlan.status}</strong>
              </span>
              <div className="flex items-center gap-2">
                {!activePlan.is_approved && (
                  <button
                    type="button"
                    disabled={approvingPlan}
                    onClick={() => {
                      void handleApprovePlan();
                      setShowDeliverablesModal(false);
                    }}
                    className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 font-bold text-white transition cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>اعتماد وتفعيل هذه الخطة الآن ✅</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDeliverablesModal(false)}
                  className="rounded-xl bg-amber-500 hover:bg-amber-600 px-5 py-2 font-bold text-white transition cursor-pointer shadow-sm"
                >
                  إغلاق النافذة
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. PLAN SELECTOR & ACTIVATION MODAL */}
      {showPlanSelectorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-4xl rounded-3xl border border-slate-700/80 bg-slate-900 p-6 text-white shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto" dir="rtl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-amber-400" />
                <h3 className="text-base font-black text-white">
                  اختيار وتفعيل باقة تسويقية للعميل: {contact.full_name}
                </h3>
              </div>
              <button
                onClick={() => setShowPlanSelectorModal(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              اختر إحدى الباقات الرسمية المعتمدة لربطها وتثبيتها في ملف العميل. يمكنك اعتمادها وتفعيلها كعميل رسمي مباشرة (Deals - تم الفوز) أو حفظها كعرض سعر مقترح قيد التفاوض.
            </p>

            {(() => {
              const avail = activePlan?.available_plans;
              const starterPlan = avail?.starter;
              const growthPlan = avail?.growth;
              const premiumPlan = avail?.premium;

              const sPrice = starterPlan?.price ?? 16450;
              const gPrice = growthPlan?.price ?? 37550;
              const pPrice = premiumPlan?.price ?? 56250;

              const sName = starterPlan?.name || 'الباقة الأساسية (Starter)';
              const gName = growthPlan?.name || 'باقة النمو والمضاعفة (Growth)';
              const pName = premiumPlan?.name || 'الباقة الاحترافية الشاملة (Premium)';

              const sServices = (starterPlan?.services && starterPlan.services.length > 0)
                ? starterPlan.services
                : [
                    { id: '1', title: 'منشورات كاروسيل تفاعلية', quantity: 3, unit_price: 3150, total_price: 9450, description: '3 منشورات كاروسيل تعليمية مكثفة' },
                    { id: '2', title: 'إدارة صفحة تيك توك', quantity: 1, unit_price: 7000, total_price: 7000, description: 'إدارة متخصصة لصفحة تيك توك' },
                  ];

              const gServices = (growthPlan?.services && growthPlan.services.length > 0)
                ? growthPlan.services
                : [
                    { id: '1', title: 'منشورات كاروسيل تفاعلية', quantity: 5, unit_price: 3150, total_price: 15750, description: '5 منشورات كاروسيل استراتيجية' },
                    { id: '2', title: 'إدارة صفحة تيك توك', quantity: 1, unit_price: 7000, total_price: 7000, description: 'إدارة شاملة لصفحة تيك توك' },
                    { id: '3', title: 'حالة فيديو (Video Case)', quantity: 4, unit_price: 2500, total_price: 10000, description: '4 حالات فيديو احترافية' },
                    { id: '4', title: 'حالة تصميم (Design Case)', quantity: 6, unit_price: 800, total_price: 4800, description: '6 حالات تصميم نوعية' },
                  ];

              const pServices = (premiumPlan?.services && premiumPlan.services.length > 0)
                ? premiumPlan.services
                : [
                    { id: '1', title: 'منشورات كاروسيل تفاعلية', quantity: 7, unit_price: 3150, total_price: 22050, description: '7 منشورات كاروسيل متقدمة' },
                    { id: '2', title: 'إدارة صفحة تيك توك', quantity: 1, unit_price: 7000, total_price: 7000, description: 'استراتيجية هيمنة كاملة لتيك توك' },
                    { id: '3', title: 'حالة فيديو (Video Case)', quantity: 6, unit_price: 2500, total_price: 15000, description: '6 حالات فيديو ريلز استراتيجية' },
                    { id: '4', title: 'حالة تصميم (Design Case)', quantity: 8, unit_price: 800, total_price: 6400, description: '8 حالات تصميم مكثفة' },
                    { id: '5', title: 'ستوري تفاعلية (30 ستوري)', quantity: 1, unit_price: 3000, total_price: 3000, description: 'باقة ستوري تفاعلية متقدمة' },
                    { id: '6', title: 'حالة محتوى (Content Case)', quantity: 8, unit_price: 350, total_price: 2800, description: 'صياغة 8 نصوص وسيناريوهات متقدمة' },
                  ];

              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Plan 1: Starter */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4.5 flex flex-col justify-between space-y-4 hover:border-amber-400/50 transition">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400">البداية السريعة</span>
                        <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded">Starter</span>
                      </div>
                      <h4 className="text-sm font-black text-white">{sName}</h4>
                      <div className="text-xl font-black text-white tracking-tight">
                        {sPrice.toLocaleString()} <span className="text-xs font-bold text-amber-400">ج.م / شهر</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {starterPlan?.description || 'إيقاف تراجع الحساب ومعالجة معدل التفاعل والحفظ بأقل استثمار مالي.'}
                      </p>
                      <div className="border-t border-white/10 pt-2 space-y-1.5 text-[11px] text-slate-300">
                        {sServices.slice(0, 3).map((it, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <span>{it.title} ({it.quantity}×)</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        disabled={approvingPlan}
                        onClick={() => void handleSavePlan({
                          plan_name: sName,
                          plan_tier: 'starter',
                          plan_code: `SL-STARTER-${Date.now().toString().slice(-4)}`,
                          pricing_location: activePlan?.pricing_location || 'تسعير القاهرة',
                          price: sPrice,
                          services: sServices,
                          available_plans: avail,
                        }, true)}
                        className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer shadow-sm"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>اعتماد وتفعيل الآن ✅</span>
                      </button>
                      <button
                        type="button"
                        disabled={approvingPlan}
                        onClick={() => void handleSavePlan({
                          plan_name: sName,
                          plan_tier: 'starter',
                          plan_code: `SL-STARTER-${Date.now().toString().slice(-4)}`,
                          pricing_location: activePlan?.pricing_location || 'تسعير القاهرة',
                          price: sPrice,
                          services: sServices,
                          available_plans: avail,
                        }, false)}
                        className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>حفظ كعرض سعر 📋</span>
                      </button>
                    </div>
                  </div>

                  {/* Plan 2: Growth (Recommended) */}
                  <div className="rounded-2xl border-2 border-amber-500/80 bg-white/[0.05] p-4.5 flex flex-col justify-between space-y-4 shadow-lg shadow-amber-500/5 relative">
                    <span className="absolute -top-3 right-4 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-black shadow-xs">
                      الأكثر طلباً ⭐
                    </span>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400">النمو والتوسع</span>
                        <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded">Growth</span>
                      </div>
                      <h4 className="text-sm font-black text-white">{gName}</h4>
                      <div className="text-xl font-black text-white tracking-tight">
                        {gPrice.toLocaleString()} <span className="text-xs font-bold text-amber-400">ج.م / شهر</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {growthPlan?.description || 'مضاعفة الوصول والتفاعل مع المحتوى وبناء حضور رقمي قوي ومستمر.'}
                      </p>
                      <div className="border-t border-white/10 pt-2 space-y-1.5 text-[11px] text-slate-300">
                        {gServices.slice(0, 3).map((it, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <span>{it.title} ({it.quantity}×)</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        disabled={approvingPlan}
                        onClick={() => void handleSavePlan({
                          plan_name: gName,
                          plan_tier: 'growth',
                          plan_code: `SL-GROWTH-${Date.now().toString().slice(-4)}`,
                          pricing_location: activePlan?.pricing_location || 'تسعير القاهرة',
                          price: gPrice,
                          services: gServices,
                          available_plans: avail,
                        }, true)}
                        className="w-full py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-black transition flex items-center justify-center gap-1 cursor-pointer shadow-md"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>اعتماد وتفعيل الآن ✅</span>
                      </button>
                      <button
                        type="button"
                        disabled={approvingPlan}
                        onClick={() => void handleSavePlan({
                          plan_name: gName,
                          plan_tier: 'growth',
                          plan_code: `SL-GROWTH-${Date.now().toString().slice(-4)}`,
                          pricing_location: activePlan?.pricing_location || 'تسعير القاهرة',
                          price: gPrice,
                          services: gServices,
                          available_plans: avail,
                        }, false)}
                        className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>حفظ كعرض سعر 📋</span>
                      </button>
                    </div>
                  </div>

                  {/* Plan 3: Premium */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4.5 flex flex-col justify-between space-y-4 hover:border-amber-400/50 transition">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400">السيطرة الكاملة</span>
                        <span className="text-[10px] font-mono text-slate-400 bg-white/5 px-2 py-0.5 rounded">Premium</span>
                      </div>
                      <h4 className="text-sm font-black text-white">{pName}</h4>
                      <div className="text-xl font-black text-white tracking-tight">
                        {pPrice.toLocaleString()} <span className="text-xs font-bold text-amber-400">ج.م / شهر</span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {premiumPlan?.description || 'منظومة تسويق رقمي متكاملة تشمل تصوير ريلز وحملات إعلانية ممولة.'}
                      </p>
                      <div className="border-t border-white/10 pt-2 space-y-1.5 text-[11px] text-slate-300">
                        {pServices.slice(0, 3).map((it, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <span>{it.title} ({it.quantity}×)</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        disabled={approvingPlan}
                        onClick={() => void handleSavePlan({
                          plan_name: pName,
                          plan_tier: 'premium',
                          plan_code: `SL-PREMIUM-${Date.now().toString().slice(-4)}`,
                          pricing_location: activePlan?.pricing_location || 'تسعير القاهرة',
                          price: pPrice,
                          services: pServices,
                          available_plans: avail,
                        }, true)}
                        className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer shadow-sm"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>اعتماد وتفعيل الآن ✅</span>
                      </button>
                      <button
                        type="button"
                        disabled={approvingPlan}
                        onClick={() => void handleSavePlan({
                          plan_name: pName,
                          plan_tier: 'premium',
                          plan_code: `SL-PREMIUM-${Date.now().toString().slice(-4)}`,
                          pricing_location: activePlan?.pricing_location || 'تسعير القاهرة',
                          price: pPrice,
                          services: pServices,
                          available_plans: avail,
                        }, false)}
                        className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <span>حفظ كعرض سعر 📋</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
