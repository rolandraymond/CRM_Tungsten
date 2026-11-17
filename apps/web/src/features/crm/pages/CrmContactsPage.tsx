import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import type { CrmContact, CrmCompany, WorkspaceMember } from '../types';
import { ContactFormModal } from '../components/ContactFormModal';
import {
  Search,
  Plus,
  ArrowRightLeft,
  Trash2,
  Edit2,
  Eye,
  MessageCircle,
  Users,
  Building2,
  Stethoscope,
  Tag,
  Sparkles,
} from 'lucide-react';

export interface UnifiedClientItem {
  id: string;
  sourceType: 'contact' | 'company';
  name: string;
  category: 'individual' | 'clinic' | 'company';
  categoryBadge: string;
  activityLabel: string;
  subtitle: string;
  phone: string;
  cleanPhone: string;
  leadStatus: string;
  activityStatus: string;
  meetingStatus: string;
  ownerName: string;
  leadId: string;
  rawContact?: CrmContact;
  rawCompany?: CrmCompany;
}

export default function CrmContactsPage() {
  const { activeWorkspace, apiFetch, userRole } = useCrm();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const isSales = userRole === 'sales';

  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'individual' | 'clinic' | 'company'>('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [activityFilter, setActivityFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');

  // Modals & Popups
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingContact, setEditingContact] = useState<CrmContact | null>(null);
  const [transferContact, setTransferContact] = useState<CrmContact | null>(null);
  const [newOwnerId, setNewOwnerId] = useState('');

  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowCreateModal(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadAllData = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    setLoading(true);
    try {
      const [contsRes, compsRes, memsRes] = await Promise.all([
        apiFetch<{ data: CrmContact[]; total: number }>(
          `/api/crm/workspaces/${activeWorkspace.id}/contacts?limit=250`
        ),
        apiFetch<{ data: CrmCompany[]; total: number }>(
          `/api/crm/workspaces/${activeWorkspace.id}/companies?limit=250`
        ),
        apiFetch<{ data: WorkspaceMember[] }>(
          `/api/crm/workspaces/${activeWorkspace.id}/members`
        ),
      ]);

      setContacts(contsRes.data || []);
      setCompanies(compsRes.data || []);
      setMembers(memsRes.data || []);
    } catch (err: any) {
      console.error('[Load All CRM Clients Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Unified client records: all individual clients, clinic doctors, clinics, and companies
  const unifiedClients: UnifiedClientItem[] = useMemo(() => {
    const list: UnifiedClientItem[] = [];

    // 1. In "كل العملاء" (All Clients): Add ONLY won/confirmed clients (تم الفوز)
    // Non-won leads stay exclusively in "العملاء المحتملون (Leads)"
    const wonContacts = contacts.filter((c) => c.lead_status === 'تم الفوز');
    wonContacts.forEach((c) => {
      const isCln = Boolean(
        (c.medical_specialty &&
          !c.medical_specialty.includes('علامة شخصية') &&
          !c.medical_specialty.includes('شركة') &&
          !c.medical_specialty.includes('تجارة')) ||
        c.business_name?.includes('عياد') ||
        c.business_name?.includes('دكتور') ||
        c.business_name?.includes('طبي') ||
        c.business_name?.includes('مركز طبي') ||
        c.job_title?.includes('طبيب') ||
        c.job_title?.includes('دكتور')
      );

      const isCmp = Boolean(
        !isCln && (
          c.company_id ||
          c.business_name?.includes('شرك') ||
          c.business_name?.includes('متجر') ||
          c.business_name?.includes('مؤسس') ||
          c.business_name?.includes('عقار') ||
          c.business_name?.includes('مطعم') ||
          c.business_name?.includes('تجارة') ||
          c.business_name?.includes('منشأة') ||
          c.job_title?.includes('شرك') ||
          c.job_title?.includes('تجارة') ||
          c.job_title?.includes('منشأة') ||
          c.job_title?.includes('مسؤول')
        )
      );

      const cat: 'individual' | 'clinic' | 'company' = isCln ? 'clinic' : isCmp ? 'company' : 'individual';

      let activityLabel = 'نشاط تجاري عام';
      if (isCln) {
        activityLabel = c.medical_specialty || (c.business_name?.includes('عياد') ? c.business_name : 'عيادة طبية');
      } else if (isCmp) {
        activityLabel = c.job_title || (c.business_name?.includes('تجارة إلكترونية') ? 'تجارة إلكترونية' : 'شركة تجارية');
      } else {
        activityLabel = c.job_title || 'علامة شخصية (Personal Brand)';
      }

      const assigned = members.find((m) => m.user_id === c.contact_owner_id);
      const clean = (c.whatsapp_number || c.phone_number || '').replace(/\D/g, '');

      list.push({
        id: c.id,
        sourceType: 'contact',
        name: c.full_name,
        category: cat,
        categoryBadge: isCln ? 'عيادة طبية' : isCmp ? 'شركة تجارية' : 'براند شخصي',
        activityLabel,
        subtitle: isCln
          ? (c.business_name || c.medical_specialty || 'عيادة طبية')
          : isCmp
          ? (c.business_name || 'شركة تجارية')
          : (c.business_name || 'براند شخصي'),
        phone: c.phone_number || '',
        cleanPhone: clean,
        leadStatus: c.lead_status || 'جديد',
        activityStatus: c.activity_status || 'معاودة الاتصال',
        meetingStatus: c.meeting_status || 'محجوز',
        ownerName: assigned?.full_name || 'غير محدد',
        leadId: c.lead_id || '',
        rawContact: c,
      });
    });

    // 2. Add all companies and clinics (so clinics & companies created by user appear in "كل العملاء")
    companies.forEach((comp) => {
      const isCln = Boolean(
        comp.industry === 'عيادة طبية' ||
        comp.industry === 'مركز طبي' ||
        comp.company_name.includes('عياد') ||
        comp.company_name.includes('مركز طبي')
      );
      const cat: 'individual' | 'clinic' | 'company' = isCln ? 'clinic' : 'company';
      const assigned = members.find((m) => m.user_id === comp.company_owner_id);
      const clean = (comp.phone || '').replace(/\D/g, '');
      const actLabel = comp.industry || (isCln ? 'عيادة طبية' : 'شركة تجارية');

      list.push({
        id: comp.id,
        sourceType: 'company',
        name: comp.company_name,
        category: cat,
        categoryBadge: isCln ? 'عيادة / مركز طبي' : 'شركة ومؤسسة',
        activityLabel: actLabel,
        subtitle: `${actLabel}${comp.city ? ' • ' + comp.city : ''}`,
        phone: comp.phone || '',
        cleanPhone: clean,
        leadStatus: isCln ? 'عيادة معتمدة' : 'شركة معتمدة',
        activityStatus: 'نشط',
        meetingStatus: '—',
        ownerName: assigned?.full_name || 'مسؤول المنشأة',
        leadId: `COMP-${comp.id.slice(0, 6).toUpperCase()}`,
        rawCompany: comp,
      });
    });

    return list;
  }, [contacts, companies, members]);

  // Counts for Category Pills
  const counts = useMemo(() => {
    let ind = 0;
    let cln = 0;
    let cmp = 0;
    unifiedClients.forEach((item) => {
      if (item.category === 'individual') ind++;
      else if (item.category === 'clinic') cln++;
      else cmp++;
    });
    return { all: unifiedClients.length, individual: ind, clinic: cln, company: cmp };
  }, [unifiedClients]);

  // Filtered Clients based on Search, Category, Status, Owner
  const displayedClients = useMemo(() => {
    return unifiedClients.filter((item) => {
      // Category filter
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

      // Owner filter
      if (ownerFilter && item.rawContact?.contact_owner_id !== ownerFilter && item.rawCompany?.company_owner_id !== ownerFilter) {
        return false;
      }

      // Search term
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesSubtitle = item.subtitle.toLowerCase().includes(q);
        const matchesPhone = item.phone.toLowerCase().includes(q);
        const matchesId = item.leadId.toLowerCase().includes(q);
        if (!matchesName && !matchesSubtitle && !matchesPhone && !matchesId) return false;
      }

      // Status filter
      if (statusFilter && item.leadStatus !== statusFilter) return false;

      // Activity filter
      if (activityFilter && item.activityStatus !== activityFilter) return false;

      return true;
    });
  }, [unifiedClients, categoryFilter, searchTerm, statusFilter, activityFilter, ownerFilter]);

  async function handleDeleteContact(contactId: string) {
    if (!window.confirm('هل أنت متأكد من حذف هذا العميل؟')) return;
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${contactId}`, {
        method: 'DELETE',
      });
      void loadAllData();
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    }
  }

  async function handleTransferOwnership(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !transferContact || !newOwnerId) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${transferContact.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      });
      setTransferContact(null);
      setNewOwnerId('');
      void loadAllData();
    } catch (err: any) {
      alert(`فشل نقل المسؤولية: ${err.message}`);
    }
  }

  function handleItemClick(item: UnifiedClientItem) {
    if (item.sourceType === 'contact') {
      navigate(`/crm/contacts/${item.id}`);
    } else {
      navigate(`/crm/companies`);
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* 1. TOP CATEGORY PILLS BAR (كل العملاء: عيادات + شركات + أفراد) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              categoryFilter === 'all'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>كل عملاء تنجستين</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {counts.all}
            </span>
          </button>

          <button
            onClick={() => setCategoryFilter('individual')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              categoryFilter === 'individual'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>البراند الشخصي</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {counts.individual}
            </span>
          </button>

          <button
            onClick={() => setCategoryFilter('clinic')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              categoryFilter === 'clinic'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            <span>العيادات والمراكز الطبية</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {counts.clinic}
            </span>
          </button>

          <button
            onClick={() => setCategoryFilter('company')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              categoryFilter === 'company'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>الشركات والمؤسسات</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {counts.company}
            </span>
          </button>
        </div>

        {/* Add Contact Button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" />
          <span>إضافة عميل جديد (براند شخصي / عيادة / شركة)</span>
        </button>
      </div>

      {/* 2. SEARCH & ATTRIBUTE FILTERS */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          {/* Search Input */}
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث بالاسم، رقم الهاتف، النشاط، Lead ID..."
              className="w-full rounded-xl border border-line bg-surface/50 py-2 pr-9 pl-3 text-xs outline-none transition focus:border-amber-500"
            />
          </div>

          {/* Lead Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink outline-none transition focus:border-amber-500"
          >
            <option value="">جميع الحالات</option>
            <option value="جديد">جديد (New)</option>
            <option value="قيد المتابعة">قيد المتابعة (In Progress)</option>
            <option value="تم الفوز">تم الفوز / عميل (Won / Client)</option>
            <option value="خاسر">خاسر (Lost)</option>
          </select>

          {/* Activity Status Filter */}
          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink outline-none transition focus:border-amber-500"
          >
            <option value="">حالة النشاط (Activity)</option>
            <option value="معاودة الاتصال">معاودة الاتصال (Call back)</option>
            <option value="مهتم">مهتم (Interested)</option>
            <option value="اهتمام مستقبلي">اهتمام مستقبلي (Future Interest)</option>
            <option value="غير مهتم">غير مهتم (Not Interested)</option>
            <option value="اجتماع">اجتماع (Meeting)</option>
          </select>

          {/* Owner Filter (Only for Owner/Manager) */}
          {!isSales && members.length > 0 && (
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-ink outline-none transition focus:border-amber-500"
            >
              <option value="">جميع مسؤولي المبيعات (Owner)</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </select>
          )}

          {(searchTerm || statusFilter || activityFilter || ownerFilter || categoryFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('');
                setActivityFilter('');
                setOwnerFilter('');
                setCategoryFilter('all');
              }}
              className="text-xs text-amber-600 hover:underline"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {/* Sales badge */}
        {isSales && (
          <span className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-bold text-blue-600 shadow-sm">
            العملاء المخصصون لك فقط ({displayedClients.length})
          </span>
        )}
      </div>

      {/* 3. UNIFIED CLIENTS TABLE */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-line bg-surface/70 text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">العميل / المنشأة (Name & ID)</th>
                <th className="px-4 py-3 font-semibold">نوع العميل والنشاط</th>
                <th className="px-4 py-3 font-semibold">الهاتف / واتساب</th>
                <th className="px-4 py-3 font-semibold">حالة العميل / المنشأة</th>
                <th className="px-4 py-3 font-semibold">حالة النشاط</th>
                <th className="px-4 py-3 font-semibold">المسؤول (Owner)</th>
                <th className="px-4 py-3 font-semibold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-muted">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                      <span>جاري تحميل قائمة عملاء تنجستين الشاملة...</span>
                    </div>
                  </td>
                </tr>
              ) : displayedClients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-muted">
                    لا يوجد عملاء يطابقون معايير البحث أو الفلتر المحدد
                  </td>
                </tr>
              ) : (
                displayedClients.map((item) => (
                  <tr
                    key={`${item.sourceType}-${item.id}`}
                    className="transition hover:bg-surface/60 group cursor-pointer"
                    onClick={() => handleItemClick(item)}
                  >
                    {/* Name & ID */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold text-xs border ${
                            item.category === 'clinic'
                              ? 'bg-purple-500/10 text-purple-600 border-purple-500/20'
                              : item.category === 'company'
                              ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                              : 'bg-sky-500/10 text-sky-600 border-sky-500/20'
                          }`}
                        >
                          {item.category === 'clinic' ? (
                            <Stethoscope className="h-4 w-4" />
                          ) : item.category === 'company' ? (
                            <Building2 className="h-4 w-4" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                        </div>
                        <div>
                          <div className="font-bold text-ink hover:text-amber-500 transition flex items-center gap-1.5">
                            <span>{item.name}</span>
                            {item.leadId && (
                              <span className="rounded bg-surface border border-line px-1.5 py-0.2 text-[10px] font-mono text-muted">
                                {item.leadId}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted">{item.subtitle}</div>
                        </div>
                      </div>
                    </td>

                    {/* Classification & Category & Activity */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold border ${
                            item.category === 'clinic'
                              ? 'bg-purple-500/10 border-purple-500/20 text-purple-600'
                              : item.category === 'company'
                              ? 'bg-amber-500/10 border-amber-500/20 text-amber-700'
                              : 'bg-sky-500/10 border-sky-500/20 text-sky-700'
                          }`}
                        >
                          {item.category === 'clinic' ? (
                            <Stethoscope className="h-3 w-3" />
                          ) : item.category === 'company' ? (
                            <Building2 className="h-3 w-3" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          <span>{item.categoryBadge}</span>
                        </span>

                        {/* Exact Activity Label ("نوع النشاط الي بيتضاف يبقي موجود") */}
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted bg-surface/80 border border-line/60 rounded-md px-2 py-0.5">
                          <Tag className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                          <span>{item.activityLabel}</span>
                        </span>
                      </div>
                    </td>

                    {/* Phone & Direct WhatsApp */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="font-mono text-ink text-xs font-semibold">
                        {item.phone || '—'}
                      </div>
                      {item.cleanPhone ? (
                        <a
                          href={`https://wa.me/${item.cleanPhone.startsWith('0') ? '2' + item.cleanPhone : item.cleanPhone}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:underline font-mono"
                        >
                          <MessageCircle className="h-3 w-3" />
                          <span>واتساب مباشر</span>
                        </a>
                      ) : null}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-lg px-2.5 py-1 text-[11px] font-bold border ${
                          item.leadStatus === 'تم الفوز' || item.leadStatus === 'عميل' || item.leadStatus.includes('معتمدة')
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600'
                            : item.leadStatus === 'قيد المتابعة'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                            : item.leadStatus === 'خاسر'
                            ? 'bg-rose-500/10 border-rose-500/30 text-rose-600'
                            : 'bg-blue-500/10 border-blue-500/30 text-blue-600'
                        }`}
                      >
                        {item.leadStatus}
                      </span>
                    </td>

                    {/* Activity Status */}
                    <td className="px-4 py-3 text-muted">
                      <span className="font-medium text-ink">{item.activityStatus}</span>
                    </td>

                    {/* Owner */}
                    <td className="px-4 py-3 text-muted">
                      <span className="font-medium text-ink">{item.ownerName}</span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleItemClick(item)}
                          className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-amber-500 transition"
                          title="عرض التفاصيل والبروفايل"
                        >
                          <Eye className="h-4 w-4" />
                        </button>

                        {item.sourceType === 'contact' && item.rawContact && (
                          <>
                            <button
                              onClick={() => setEditingContact(item.rawContact!)}
                              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink transition"
                              title="تعديل بيانات العميل"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            {!isSales && (
                              <button
                                onClick={() => setTransferContact(item.rawContact!)}
                                className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-blue-500 transition"
                                title="نقل مسؤولية العميل"
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </button>
                            )}
                            {!isSales && (
                              <button
                                onClick={() => void handleDeleteContact(item.id)}
                                className="rounded-lg p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-500 transition"
                                title="حذف العميل"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line px-4 py-3 text-xs text-muted flex items-center justify-between">
          <span>إجمالي عملاء تنجستين المسجلين: {unifiedClients.length}</span>
          <span>عرض {displayedClients.length} من {unifiedClients.length}</span>
        </div>
      </div>

      {/* Modal: Create Contact with All 25 Fields & 3 Categories (Defaults to Won Client) */}
      {showCreateModal && (
        <ContactFormModal
          defaultLeadStatus="تم الفوز"
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            void loadAllData();
          }}
          companies={companies}
          members={members}
        />
      )}

      {/* Modal: Edit Contact */}
      {editingContact && (
        <ContactFormModal
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSuccess={() => {
            setEditingContact(null);
            void loadAllData();
          }}
          companies={companies}
          members={members}
        />
      )}

      {/* Modal: Transfer Ownership */}
      {transferContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-ink mb-2">نقل مسؤولية العميل</h3>
            <p className="text-xs text-muted mb-4">
              اختر مسؤول المبيعات الجديد الذي ستُنقل إليه متابعة العميل ({transferContact.full_name}).
            </p>

            <form onSubmit={handleTransferOwnership} className="space-y-4">
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                required
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-ink font-bold"
              >
                <option value="">-- اختر مسؤول المبيعات الجديد --</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.role})
                  </option>
                ))}
              </select>

              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setTransferContact(null)}
                  className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={!newOwnerId}
                  className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
                >
                  تأكيد النقل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
