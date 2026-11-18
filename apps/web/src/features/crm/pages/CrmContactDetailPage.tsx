import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCrm } from '../CrmContext';
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

export default function CrmContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeWorkspace, apiFetch, userRole } = useCrm();

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
      navigate('/crm/contacts');
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
          to="/crm/contacts"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-surface px-4 py-2 text-xs font-bold shadow-sm"
        >
          <ArrowRight className="h-4 w-4" />
          <span>العودة لقائمة العملاء</span>
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

  // Active Subscribed Plan / SocialLens Package Deliverables
  const activePlan = contact?.plan_details ?? null;

  return (
    <div className="space-y-4" dir="rtl">
      {/* 1. TOP HEADER & BREADCRUMB */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            to="/crm/contacts"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-muted hover:bg-surface/80 hover:text-ink transition"
            title="العودة لقائمة العملاء"
          >
            <ArrowRight className="h-4 w-4" />
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
                  title="نسخ Lead ID"
                >
                  <span>{contact.lead_id}</span>
                  {copiedLeadId ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                </button>
              )}
              <span
                className={`rounded-lg px-2.5 py-0.5 text-[11px] font-bold border ${
                  contact.lead_status === 'تم الفوز' || contact.lead_status === 'عميل'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                    : contact.lead_status === 'قيد المتابعة'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                    : contact.lead_status === 'خاسر'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-600'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-600'
                }`}
              >
                {contact.lead_status}
              </span>
            </div>
            <p className="text-xs text-muted flex items-center gap-2 mt-0.5">
              <span>{contact.job_title || 'عميل محتمل'}</span>
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
              title="اتصال هاتفي مباشر"
            >
              <Phone className="h-3.5 w-3.5 text-emerald-600" />
              <span>اتصال</span>
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
              <span>واتساب مباشر</span>
            </a>
          )}

          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-xs hover:border-amber-500 transition"
            >
              <Mail className="h-3.5 w-3.5 text-blue-500" />
              <span>بريد</span>
            </a>
          )}

          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-amber-600 transition"
          >
            <Edit2 className="h-3.5 w-3.5" />
            <span>تعديل البيانات</span>
          </button>

          {!isSales && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink shadow-xs hover:text-blue-600 transition"
              title="نقل مسؤولية العميل لموظف آخر"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span>نقل المسؤول</span>
            </button>
          )}

          {!isSales && (
            <button
              onClick={() => void handleDelete()}
              className="flex items-center gap-1 rounded-xl border border-rose-500/20 bg-surface px-2.5 py-2 text-xs text-rose-500 shadow-xs hover:bg-rose-500/10 transition"
              title="حذف العميل"
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
            <span>تاريخ الإنشاء ومن ضافه (Create Date & User)</span>
          </div>
          <div className="mt-1 font-bold text-ink text-xs">
            {new Date(contact.created_at).toLocaleDateString('ar-EG', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
          <div className="mt-0.5 text-[11px] text-muted flex items-center gap-1">
            <span>بواسطة:</span>
            <span className="font-semibold text-ink">{contact.creator_name || 'فريق Tungsten'}</span>
            {contact.creator_email && <span className="font-mono text-[10px]">({contact.creator_email})</span>}
          </div>
        </div>

        {/* Highlight 2: Lead Status (Live Selector) */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-blue-500" />
            <span>حالة العميل (Lead Status)</span>
          </div>
          <div className="mt-1.5">
            <select
              value={contact.lead_status}
              onChange={(e) => void handleQuickUpdate({ lead_status: e.target.value as LeadStatus })}
              className="w-full rounded-xl border border-line bg-surface/50 px-2.5 py-1 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
            >
              <option value="جديد">جديد (New)</option>
              <option value="قيد المتابعة">قيد المتابعة (In Progress)</option>
              <option value="تم الفوز">تم الفوز / عميل (Won)</option>
              <option value="خاسر">خاسر (Lost)</option>
            </select>
          </div>
        </div>

        {/* Highlight 3: Activity Status (Live Selector) */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
            <span>حالة النشاط (Activity Status)</span>
          </div>
          <div className="mt-1.5">
            <select
              value={contact.activity_status || 'معاودة الاتصال'}
              onChange={(e) => void handleQuickUpdate({ activity_status: e.target.value })}
              className="w-full rounded-xl border border-line bg-surface/50 px-2.5 py-1 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
            >
              <option value="معاودة الاتصال">معاودة الاتصال (Call back)</option>
              <option value="مهتم">مهتم (Interested)</option>
              <option value="اهتمام مستقبلي">اهتمام مستقبلي (Future Interest)</option>
              <option value="غير مهتم">غير مهتم (Not Interested)</option>
              <option value="اجتماع">اجتماع (Meeting)</option>
            </select>
          </div>
        </div>

        {/* Highlight 4: Assigned Owner */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
          <div className="text-[11px] font-bold text-muted flex items-center gap-1.5">
            <User className="h-3.5 w-3.5 text-purple-500" />
            <span>المسؤول الحالي (Contact Owner)</span>
          </div>
          <div className="mt-1 font-bold text-ink text-xs flex items-center justify-between">
            <span>{contact.owner_name || 'غير محدد'}</span>
            {!isSales && (
              <button
                onClick={() => setShowTransferModal(true)}
                className="text-[10px] text-amber-600 hover:underline"
              >
                تغيير
              </button>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-muted font-mono">
            {contact.owner_email || '—'}
          </div>
        </div>
      </div>

      {/* 2.5 CURRENT SUBSCRIBED PLAN & DIAGNOSTICS (SocialLens Plan & Deliverables matching Image 1) */}
      {activePlan ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Main Plan Card (8 cols) */}
          <div className="lg:col-span-8 rounded-3xl border border-line/70 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-5 text-white shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3 mb-4 flex-wrap">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-2">
                <Package className="h-4 w-4 text-amber-400" />
                <span>{activePlan.is_approved ? 'الخطة المشترك بها حالياً' : 'الخطة وعرض السعر المقترح'}</span>
              </span>

              <div className="flex items-center gap-2 flex-wrap">
                {activePlan.is_approved ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{activePlan.status || 'مشترك بها (معتمدة)'}</span>
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>{activePlan.status || 'قيد المراجعة والتفاوض (لم تُعتمد بعد)'}</span>
                    </span>
                    <button
                      type="button"
                      disabled={approvingPlan}
                      onClick={() => void handleApprovePlan()}
                      className="px-3 py-1 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-[11px] font-bold transition flex items-center gap-1 cursor-pointer shadow-sm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{approvingPlan ? 'جاري الاعتماد...' : 'اعتماد وتفعيل الخطة الآن ✅'}</span>
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowPlanSelectorModal(true)}
                  className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 text-[11px] font-bold transition flex items-center gap-1 cursor-pointer border border-white/10"
                  title="تغيير أو اختيار باقة أخرى"
                >
                  <RefreshCw className="h-3 w-3 text-amber-400" />
                  <span>تغيير الباقة</span>
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
                  <span className="text-2xl font-black text-white tracking-tight tabular-nums">
                    {Number(activePlan.price).toLocaleString()}
                  </span>
                  <span className="text-xs font-bold text-amber-400 mr-1.5">ج.م / شهر</span>
                </div>
              </div>

              {/* Deliverables preview */}
              <div className="pt-3 border-t border-white/10 space-y-2">
                <span className="text-xs font-semibold text-slate-300 block">
                  مخرجات وخدمات الخطة:
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
                  <span>استعراض خدمات ومخرجات الباقة 👁️</span>
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
                  <span>آخر تشخيص وتحليل للحساب</span>
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
                    <span>تم التحليل: {activePlan.diagnostics?.analysis_date || '14 نوفمبر'}</span>
                  </span>
                </div>

                <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">معدل التفاعل</span>
                    <span className="text-lg font-black text-amber-400 font-mono">
                      {activePlan.diagnostics?.engagement_rate || '0.5%'}
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-400 font-medium">
                    {activePlan.diagnostics?.status_label || 'أداء متوسط بإمكانات واعدة'}
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
                <span>عرض تفاصيل المخرجات الاستراتيجية</span>
                <ArrowRight className="h-3 w-3" />
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
              <h4 className="text-sm font-bold text-ink">لم يتم ربط أو تحديد باقة تسويقية لهذا العميل بعد</h4>
              <p className="text-xs text-muted">يمكنك اختيار باقة من باقات السوشيال ميديا المعتمدة (Starter / Growth / Premium) واعتمادها كعميل رسمي أو حفظها كعرض سعر.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPlanSelectorModal(true)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>تحديد واعتماد باقة للعميل</span>
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
              <span>بيانات الهوية والتواصل (Contact Details)</span>
            </h3>

            <div className="space-y-2.5 text-xs">
              <div>
                <span className="block text-muted text-[11px]">الاسم الكامل:</span>
                <span className="font-bold text-ink">{contact.full_name}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">المسمى الوظيفي:</span>
                <span className="font-medium text-ink">{contact.job_title || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">رقم الهاتف الأساسي:</span>
                <span className="font-mono font-bold text-ink">{contact.phone_number || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">رقم الواتساب:</span>
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
                      <span>فتح واتساب</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line/60">
                <div>
                  <span className="block text-muted text-[11px]">هاتف العمل:</span>
                  <span className="font-mono text-ink text-[11px]">{contact.business_phone || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">هاتف الشركة:</span>
                  <span className="font-mono text-ink text-[11px]">{contact.company_phone || '—'}</span>
                </div>
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">البريد الإلكتروني:</span>
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="font-mono text-amber-600 hover:underline">
                    {contact.email}
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">رابط الملف التعريفي (Social Profile):</span>
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
              <span>بيانات المنشأة والعيادة (Business / Clinic)</span>
            </h3>

            <div className="space-y-2.5 text-xs">
              <div>
                <span className="block text-muted text-[11px]">اسم العيادة أو المنشأة:</span>
                <span className="font-bold text-ink">{contact.business_name || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">التخصص الطبي:</span>
                <span className="font-semibold text-ink">{contact.medical_specialty || '—'}</span>
              </div>

              <div>
                <span className="block text-muted text-[11px]">العنوان التفصيلي:</span>
                <span className="text-ink">{contact.clinic_address || '—'}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-line/60">
                <div>
                  <span className="block text-muted text-[11px]">المدينة:</span>
                  <span className="font-medium text-ink">{contact.city || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">الحي:</span>
                  <span className="font-medium text-ink">{contact.district || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">عدد الفروع:</span>
                  <span className="font-bold text-ink">{contact.branch_count || 1}</span>
                </div>
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">خرائط جوجل (Google Maps):</span>
                {contact.google_maps ? (
                  <a
                    href={contact.google_maps.startsWith('http') ? contact.google_maps : `https://${contact.google_maps}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-600 hover:underline"
                  >
                    <MapPin className="h-3 w-3" />
                    <span>عرض الموقع على الخريطة</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </div>

              <div className="pt-1 border-t border-line/60">
                <span className="block text-muted text-[11px]">الموقع الإلكتروني (Website):</span>
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
                  <span className="block text-muted text-[11px]">إنستغرام:</span>
                  <span className="text-ink text-[11px]">{contact.business_instagram || '—'}</span>
                </div>
                <div>
                  <span className="block text-muted text-[11px]">فيسبوك:</span>
                  <span className="text-ink text-[11px]">{contact.business_facebook || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Campaign & Tracking */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-purple-500" />
              <span>الحملة التسويقية والتتبع (Campaign & Source)</span>
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-muted">منصة المصدر:</span>
                <span className="font-bold text-ink rounded-lg bg-surface/80 border border-line px-2 py-0.5">
                  {contact.source_platform || 'Meta Ads'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">معرف الإعلان (Ad ID):</span>
                <span className="font-mono text-ink text-[11px]">{contact.ad_id || '—'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Lead ID:</span>
                <span className="font-mono text-ink text-[11px]">{contact.lead_id || '—'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN (5 cols): Timeline & Complete History ("الهستوري بتاعته وكل حاجه") */}
        <div className="lg:col-span-5 space-y-4">
          {/* Quick Activity Logger Form (HubSpot Style) */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2.5 mb-3">
              <div className="flex items-center gap-1 font-bold text-xs text-ink">
                <FileText className="h-4 w-4 text-amber-500" />
                <span>تسجيل نشاط فوري للعميل</span>
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
                  ملاحظة
                </button>
                <button
                  type="button"
                  onClick={() => setLogType('مكالمة')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'مكالمة' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  مكالمة
                </button>
                <button
                  type="button"
                  onClick={() => setLogType('اجتماع')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'اجتماع' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  اجتماع
                </button>
                <button
                  type="button"
                  onClick={() => setLogType('مهمة')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    logType === 'مهمة' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  مهمة
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
                      ? 'عنوان الملاحظة (مثال: العميل مهتم بعرض سعر Enterprise)...'
                      : logType === 'مكالمة'
                      ? 'ملخص المكالمة (مثال: تم الاتصال وشرح مزايا النظام)...'
                      : logType === 'اجتماع'
                      ? 'عنوان الاجتماع (مثال: جلسة عرض تقديمي ديمو)...'
                      : 'عنوان المهمة المطلوبة...'
                  }
                  className="w-full rounded-xl border border-line bg-surface/50 p-2.5 text-ink outline-none transition focus:border-amber-500"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  value={logDetails}
                  onChange={(e) => setLogDetails(e.target.value)}
                  placeholder="التفاصيل الإضافية أو نقاط النقاش..."
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
                      <option value="محجوز">محجوز</option>
                      <option value="حضر">حضر</option>
                      <option value="لم يحضر">لم يحضر</option>
                      <option value="ملغي">ملغي</option>
                    </select>
                  </div>
                )}

                {logType === 'مهمة' && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted text-[11px]">تاريخ الاستحقاق:</span>
                    <input
                      type="date"
                      value={logDueDate}
                      onChange={(e) => setLogDueDate(e.target.value)}
                      className="rounded-xl border border-line bg-surface px-2.5 py-1.5 text-ink font-mono text-xs"
                    />
                  </div>
                )}

                <div className="mr-auto">
                  <button
                    type="submit"
                    disabled={loggingActivity}
                    className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 font-bold text-white shadow-xs hover:bg-amber-600 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{loggingActivity ? 'جاري الحفظ...' : 'حفظ السجل'}</span>
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
                  <span>السجل الزمني وحركات العميل (Activity & Audit History)</span>
                </h3>
                <p className="text-[11px] text-muted">
                  سجل كامل ومفصل من لحظة إنشاء العميل وكافة التعديلات والملاحظات
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
                  الكل ({timelineEvents.length})
                </button>
                <button
                  onClick={() => setFeedFilter('notes')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'notes' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  الملاحظات
                </button>
                <button
                  onClick={() => setFeedFilter('calls')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'calls' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  المكالمات
                </button>
                <button
                  onClick={() => setFeedFilter('meetings')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'meetings' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  الاجتماعات
                </button>
                <button
                  onClick={() => setFeedFilter('audit')}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    feedFilter === 'audit' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink border border-line'
                  }`}
                >
                  سجل التدقيق
                </button>
              </div>
            </div>

            {/* Timeline Events Scrollable List */}
            {filteredEvents.length === 0 ? (
              <div className="py-12 text-center text-muted text-xs">
                لا توجد سجلات تطابق الفلتر المحدد حالياً
              </div>
            ) : (
              <div className="relative border-r-2 border-line/60 mr-3 pr-4 max-h-[520px] overflow-y-auto space-y-3.5 pl-2 custom-scrollbar scroll-smooth [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-amber-500/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-amber-500/60">
                {filteredEvents.map((item) => (
                  <div key={item.id} className="relative group">
                    {/* Timeline Node Point */}
                    <div className="absolute -right-[23px] top-3 h-3.5 w-3.5 rounded-full border-2 border-surface bg-amber-500" />

                    <div className="rounded-xl border border-line bg-surface/50 p-3 shadow-xs transition-all hover:border-amber-500/50 hover:bg-surface">
                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border shrink-0 ${item.badgeColor || 'border-line text-muted'}`}>
                            {item.badge}
                          </span>
                          <span className="font-bold text-ink text-xs truncate">{item.title}</span>
                        </div>
                        <span className="text-[10px] text-muted font-mono shrink-0">
                          {new Date(item.timestamp).toLocaleDateString('ar-EG', {
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
                          <span>المسؤول: {item.author}</span>
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
          {/* Card 1: Offered Package & Deals ("الباكيدج بتاعته") */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-line pb-2 mb-3">
              <h3 className="font-bold text-xs text-ink flex items-center gap-1.5">
                <Briefcase className="h-4 w-4 text-amber-500" />
                <span>الباكيدج والصفقات (Package / Deals)</span>
              </h3>
              <button
                onClick={() => setShowNewDealModal(true)}
                className="rounded-lg p-1 text-amber-600 hover:bg-amber-500/10 transition"
                title="إضافة صفقة أو باقة جديدة"
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
                        {Number(deal.deal_amount).toLocaleString()} {deal.currency || 'ج.م'}
                      </span>
                    </div>

                    {/* Deal Stage Live Selector */}
                    <div>
                      <span className="block text-muted text-[10px] mb-1">مرحلة الصفقة (Deal Stage):</span>
                      <select
                        value={deal.deal_stage}
                        onChange={(e) => void handleDealStageChange(deal.id, e.target.value as DealStage)}
                        className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
                      >
                        {DEAL_STAGES.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex justify-between text-[11px] text-muted pt-1 border-t border-line/60">
                      <span>تاريخ الإغلاق: {deal.closing_date ? new Date(deal.closing_date).toLocaleDateString('ar-EG') : 'قيد التفاوض'}</span>
                      <span>المسؤول: {deal.owner_name || 'Peter'}</span>
                    </div>

                    {activePlan && (
                      <button
                        type="button"
                        onClick={() => setShowDeliverablesModal(true)}
                        className="w-full py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 text-[11px] font-bold border border-amber-500/30 flex items-center justify-center gap-1.5 transition"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>استعراض مخرجات الخطة ({activePlan.services.length} مخرجات)</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line p-4 text-center text-muted text-xs">
                <p>لا توجد باقة أو صفقة مسجلة لهذا العميل حالياً</p>
                <button
                  onClick={() => setShowNewDealModal(true)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>إضافة باقة أو صفقة للعميل</span>
                </button>
              </div>
            )}
          </div>

          {/* Card 2: Meetings & Appointments ("الاجتماعات") */}
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <h3 className="font-bold text-xs text-ink border-b border-line pb-2 mb-3 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-purple-500" />
              <span>الاجتماعات والمواعيد (Meetings)</span>
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <span className="block text-muted text-[11px] mb-0.5">موعد الاجتماع المسجل:</span>
                {contact.meeting_date ? (
                  <span className="font-mono font-bold text-ink">
                    {new Date(contact.meeting_date).toLocaleDateString('ar-EG', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : (
                  <span className="text-muted">لم يتم تحديد موعد اجتماع بعد</span>
                )}
              </div>

              <div>
                <span className="block text-muted text-[11px] mb-1">حالة الاجتماع (Meeting Status):</span>
                <select
                  value={contact.meeting_status || 'محجوز'}
                  onChange={(e) => void handleQuickUpdate({ meeting_status: e.target.value as MeetingStatus })}
                  className="w-full rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-ink outline-none transition focus:border-amber-500"
                >
                  <option value="محجوز">محجوز (Booked)</option>
                  <option value="حضر">حضر (Show up)</option>
                  <option value="لم يحضر">لم يحضر (No show)</option>
                  <option value="ملغي">ملغي (Cancelled)</option>
                </select>
              </div>

              <div className="pt-2 border-t border-line/60">
                <span className="block text-muted text-[11px] mb-1">تاريخ المتابعة القادمة:</span>
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

      {/* MODAL: Full Edit Contact Form Modal (25 Fields) */}
      {showEditModal && (
        <ContactFormModal
          contact={contact}
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
              const catalog = activePlan?.available_plans;
              const offers = Object.entries(catalog ?? {}).filter(([, offer]) => offer && Number.isFinite(Number(offer.price)));
              if (!offers.length) return <p className="rounded-xl border border-white/10 p-5 text-sm text-slate-300">لا توجد باقات مسجلة لهذا العميل. أضف صفقة بقيمها الفعلية، أو استقبل تفاصيل الباقة من التكامل.</p>;
              return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {offers.map(([tier, offer]) => {
                  const plan = { ...offer, plan_name: offer.name, plan_tier: tier, price: Number(offer.price), available_plans: catalog };
                  return <div key={tier} className="rounded-2xl border border-white/10 p-4 space-y-4">
                    <h4 className="font-bold">{offer.name}</h4>
                    <p>{Number(offer.price).toLocaleString()} ج.م</p>
                    {offer.description && <p className="text-xs text-slate-300">{offer.description}</p>}
                    <div className="space-y-2">
                      <button type="button" disabled={approvingPlan} onClick={() => void handleSavePlan(plan, true)} className="w-full rounded-xl bg-emerald-600 p-2 text-sm">اعتماد وتفعيل</button>
                      <button type="button" disabled={approvingPlan} onClick={() => void handleSavePlan(plan, false)} className="w-full rounded-xl bg-white/10 p-2 text-sm">حفظ كعرض سعر</button>
                    </div>
                  </div>;
                })}
              </div>;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
