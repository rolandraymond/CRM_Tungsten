import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import { useCrmLang } from '../useCrmLang';
import type { CrmDeal, CrmCompany, CrmContact, WorkspaceMember, DealStage } from '../types';
import { DEAL_STAGES } from '../types';
import {
  LayoutGrid,
  Table as TableIcon,
  Plus,
  Calendar,
  Building,
  User,
  Trash2,
  Edit2,
  Eye,
  X,
  ArrowRightLeft,
  Search,
  UserCheck,
  Award,
  CheckCircle2,
  Stethoscope,
  Sparkles,
  Building2,
  Undo2,
} from 'lucide-react';

function parseDealDescription(rawDescription?: string | null): {
  plan: any | null;
  cleanNotes: string;
} {
  if (!rawDescription) return { plan: null, cleanNotes: '' };

  let plan: any | null = null;
  let cleanNotes = rawDescription;

  const planMarker = '__PLAN_JSON__:';
  const markerIdx = rawDescription.indexOf(planMarker);

  if (markerIdx !== -1) {
    const afterMarker = rawDescription.slice(markerIdx + planMarker.length);
    let jsonCandidate = afterMarker;
    const splitIndex = afterMarker.indexOf('\n\n');
    if (splitIndex !== -1) {
      jsonCandidate = afterMarker.slice(0, splitIndex);
      cleanNotes = (rawDescription.slice(0, markerIdx) + '\n' + afterMarker.slice(splitIndex + 2)).trim();
    } else {
      cleanNotes = rawDescription.slice(0, markerIdx).trim();
    }

    try {
      plan = JSON.parse(jsonCandidate.trim());
    } catch {
      try {
        const lastBrace = afterMarker.lastIndexOf('}');
        if (lastBrace !== -1) {
          plan = JSON.parse(afterMarker.slice(0, lastBrace + 1));
          cleanNotes = (rawDescription.slice(0, markerIdx) + '\n' + afterMarker.slice(lastBrace + 1)).trim();
        }
      } catch {
        // ignore
      }
    }
  }

  cleanNotes = cleanNotes
    .replace(/__PLAN_JSON__:[^\n]*/g, '')
    .replace(/__PLAN_JSON__/g, '')
    .trim();

  return { plan, cleanNotes };
}

export default function CrmDealsPage({
  initialView,
  initialMode,
}: {
  initialView?: 'cards' | 'table' | 'kanban';
  initialMode?: 'leads' | 'deals';
} = {}) {
  const { activeWorkspace, apiFetch, userRole } = useCrm();
  const { ar, dir, tr, fmtNum, fmtCurrency, fmtDate, labelDealStage } = useCrmLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const isLeadsPath = location.pathname.includes('/leads') || location.pathname.includes('/pipeline');
  const [mode, setMode] = useState<'leads' | 'deals'>(initialMode || (isLeadsPath ? 'leads' : 'deals'));

  useEffect(() => {
    if (location.pathname.includes('/leads') || location.pathname.includes('/pipeline')) {
      setMode('leads');
    } else if (location.pathname.includes('/deals')) {
      setMode('deals');
    }
  }, [location.pathname]);

  const [viewMode, setViewMode] = useState<'cards' | 'table'>(initialView === 'table' ? 'table' : 'cards');
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // Modals & Drawers
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDeal, setEditingDeal] = useState<CrmDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<CrmDeal | null>(null);
  const [transferDeal, setTransferDeal] = useState<CrmDeal | null>(null);
  const [newOwnerId, setNewOwnerId] = useState('');

  // Aux
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  const isOwner =
    userRole === 'owner' ||
    userRole === 'company_owner' ||
    userRole === 'brand_owner' ||
    userRole === 'platform_admin';
  const isModerator = (userRole as any) === 'moderator';
  const isSales = userRole === 'sales';

  // Owner & Moderator can add both Leads and Deals; Sales can manually add Leads too!
  const canAddDeal = isOwner || isModerator || (mode === 'leads' && isSales);

  useEffect(() => {
    if (searchParams.get('action') === 'new' && canAddDeal) {
      setShowCreateModal(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, canAddDeal]);

  const loadDeals = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ data: CrmDeal[] }>(
        `/api/crm/workspaces/${activeWorkspace.id}/deals`
      );
      setDeals(res.data || []);
    } catch (err: any) {
      console.error('[Load Deals Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  const loadAux = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [comps, conts, mems] = await Promise.all([
        apiFetch<{ data: CrmCompany[] }>(`/api/crm/workspaces/${activeWorkspace.id}/companies`),
        apiFetch<{ data: CrmContact[] }>(`/api/crm/workspaces/${activeWorkspace.id}/contacts?limit=200`),
        apiFetch<{ data: WorkspaceMember[] }>(`/api/crm/workspaces/${activeWorkspace.id}/members`),
      ]);
      setCompanies(comps.data || []);
      setContacts(conts.data || []);
      setMembers(mems.data || []);
    } catch {
      // ignore
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadDeals();
    void loadAux();
  }, [loadDeals, loadAux]);

  async function handleReturnToLead(dealId: string) {
    if (!activeWorkspace) return;
    if (!window.confirm('هل تريد إرجاع هذا العميل إلى مسار العملاء المحتملين (Leads Pipeline) بحالة "قيد المتابعة"؟')) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals/${dealId}/stage`, {
        method: 'POST',
        body: JSON.stringify({ stage: 'return_to_lead' }),
      });
      if (detailDeal?.id === dealId) setDetailDeal(null);
      alert('↩ تم إرجاع العميل بنجاح إلى Leads Pipeline (قيد المتابعة).');
      void loadDeals();
    } catch (err: any) {
      alert(`فشل إرجاع العميل لليد: ${err.message}`);
      void loadDeals();
    }
  }

  async function handleSetStage(dealId: string, newStage: DealStage | '__return_to_lead__') {
    if (!activeWorkspace) return;
    if (newStage === '__return_to_lead__') {
      await handleReturnToLead(dealId);
      return;
    }
    try {
      // optimistic update
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, deal_stage: newStage } : d))
      );

      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals/${dealId}/stage`, {
        method: 'POST',
        body: JSON.stringify({ stage: newStage }),
      });

      if (newStage === 'عقد' || newStage === 'عميل') {
        alert('🎉 تهانينا! تمت ترقية العميل المحتمل إلى صفقة معتمدة وتسجيله كعميل رسمي بنجاح.');
      }
      void loadDeals();
    } catch (err: any) {
      alert(`فشل تغيير المرحلة: ${err.message}`);
      void loadDeals();
    }
  }

  async function handleDelete(dealId: string) {
    if (!window.confirm('هل أنت متأكد من حذف هذه الصفقة؟')) return;
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals/${dealId}`, {
        method: 'DELETE',
      });
      if (detailDeal?.id === dealId) setDetailDeal(null);
      void loadDeals();
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    }
  }

  async function handleTransferOwnership(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !transferDeal || !newOwnerId) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals/${transferDeal.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      });
      setTransferDeal(null);
      setNewOwnerId('');
      void loadDeals();
    } catch (err: any) {
      alert(`فشل نقل الملكية: ${err.message}`);
    }
  }

  async function openDetail(dealId: string) {
    if (!activeWorkspace) return;
    try {
      const res = await apiFetch<{ data: CrmDeal }>(
        `/api/crm/workspaces/${activeWorkspace.id}/deals/${dealId}`
      );
      setDetailDeal(res.data);
    } catch (err: any) {
      alert(`فشل فتح تفاصيل الصفقة: ${err.message}`);
    }
  }

  const LEADS_STAGES: DealStage[] = ['مكالمة', 'زيارة', 'عرض سعر', 'خسارة مغلقة', 'غير مؤهل'];
  const DEALS_STAGES: DealStage[] = ['عقد', 'عميل', 'فقدان العميل'];

  const displayedStages = mode === 'leads' ? LEADS_STAGES : DEALS_STAGES;

  const modeDeals = useMemo(() => {
    if (mode === 'leads') {
      // In leads pipeline: show prospecting leads (exclude won contracts & clients)
      return deals.filter((d) => d.deal_stage !== 'عقد' && d.deal_stage !== 'عميل');
    } else {
      // In won deals: show closed won contracts, active clients, and churned
      return deals.filter((d) => d.deal_stage === 'عقد' || d.deal_stage === 'عميل' || d.deal_stage === 'فقدان العميل');
    }
  }, [deals, mode]);

  const filteredDeals = useMemo(() => {
    return modeDeals.filter((d) => {
      if (selectedStage !== 'all' && d.deal_stage !== selectedStage) {
        return false;
      }
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        d.deal_name.toLowerCase().includes(term) ||
        (d.company_name && d.company_name.toLowerCase().includes(term)) ||
        (d.contacts && d.contacts.some((c) => c.full_name.toLowerCase().includes(term)))
      );
    });
  }, [modeDeals, selectedStage, searchTerm]);

  const stageBadgeColor: Record<DealStage, string> = {
    'مكالمة': 'border-blue-500/30 bg-blue-500/10 text-blue-600',
    'زيارة': 'border-cyan-500/30 bg-cyan-500/10 text-cyan-600',
    'عرض سعر': 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600',
    'عقد': 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    'عميل': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
    'خسارة مغلقة': 'border-rose-500/30 bg-rose-500/10 text-rose-600',
    'غير مؤهل': 'border-gray-500/30 bg-gray-500/10 text-gray-600',
    'فقدان العميل': 'border-rose-700/30 bg-rose-700/10 text-rose-700',
  };

  const totalValue = filteredDeals.reduce((sum, d) => sum + (Number(d.deal_amount) || 0), 0);

  return (
    <div className="space-y-4" dir={dir}>
      {/* Top Level Won Deals Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/20 bg-surface p-3.5 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
            <Award className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-ink flex items-center gap-2">
              <span>{tr('الصفقات المعتمدة والعقود (Won Deals)', 'Won Deals & Contracts')}</span>
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-mono font-bold text-emerald-700">
                {fmtNum(modeDeals.length)}
              </span>
            </h2>
            <p className="text-[11px] text-muted">
              {tr(
                'العملاء المحوّلون لمرحلة العقد أو الفوز مع وصول مباشر لبروفايل كل عميل',
                'Converted clients in Contract or Active status with direct access to each client profile'
              )}
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate('/crm/contacts')}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-surface/60 px-3.5 py-2 text-xs font-bold text-muted hover:text-ink hover:bg-surface transition"
        >
          <UserCheck className="h-4 w-4 text-amber-500" />
          <span>{tr('العودة إلى Leads Pipeline', 'Back to Leads Pipeline')}</span>
        </button>
      </div>

      {/* Top Bar: Search, View Mode Switcher, and Add Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div>
          <h2 className="text-sm font-bold text-ink">
            {mode === 'leads'
              ? tr('مسار تأهيل العملاء المحتملين (Leads Pipeline)', 'Leads Pipeline')
              : tr('الصفقات المعتمدة والعقود المكتملة (Won Deals)', 'Confirmed Won Deals & Contracts')}
          </h2>
          <p className="text-xs text-muted">
            {ar
              ? `إجمالي ${fmtNum(filteredDeals.length)} ${mode === 'leads' ? 'عميل محتمل' : 'صفقة معتمدة'} بقيمة ${fmtCurrency(totalValue)}`
              : `Total ${fmtNum(filteredDeals.length)} ${mode === 'leads' ? 'leads' : 'won deals'} worth ${fmtCurrency(totalValue)}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex items-center rounded-xl border border-line bg-surface/50 p-1">
            <button
              onClick={() => setViewMode('cards')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                viewMode === 'cards'
                  ? (mode === 'leads' ? 'bg-amber-500 text-white shadow-sm' : 'bg-emerald-600 text-white shadow-sm')
                  : 'text-muted hover:text-ink'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>{tr('عرض البطاقات', 'Cards View')}</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                viewMode === 'table'
                  ? (mode === 'leads' ? 'bg-amber-500 text-white shadow-sm' : 'bg-emerald-600 text-white shadow-sm')
                  : 'text-muted hover:text-ink'
              }`}
            >
              <TableIcon className="h-3.5 w-3.5" />
              <span>{tr('عرض الجدول', 'Table View')}</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[200px]">
            <Search className={`absolute ${ar ? 'right-3' : 'left-3'} top-1/2 h-4 w-4 -translate-y-1/2 text-muted`} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={tr('بحث بالصفقة، العميل، الشركة...', 'Search deal, client, company...')}
              className={`w-full rounded-xl border border-line bg-surface/50 py-1.5 ${ar ? 'pr-9 pl-3' : 'pl-9 pr-3'} text-xs outline-none transition focus:border-amber-500`}
            />
          </div>

          {isSales && (
            <span className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-bold text-blue-600 shadow-sm">
              {tr(`المخصصة لك فقط (${fmtNum(modeDeals.length)})`, `Assigned to you (${fmtNum(modeDeals.length)})`)}
            </span>
          )}

          {canAddDeal && (
            <button
              onClick={() => setShowCreateModal(true)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-sm transition ${
                mode === 'leads' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              <Plus className="h-4 w-4" />
              <span>{mode === 'leads' ? tr('إضافة عميل محتمل (Lead)', 'Add Lead') : tr('إضافة صفقة معتمدة', 'Add Won Deal')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Top Filter Bar: Client Status / Stage Filter Pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-sm">
        <span className="text-xs font-bold text-muted mx-1">
          {mode === 'leads' ? tr('مراحل التأهيل والمتابعة:', 'Lead Stages:') : tr('مراحل الصفقات والعملاء:', 'Deal Stages:')}
        </span>
        <button
          onClick={() => setSelectedStage('all')}
          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
            selectedStage === 'all'
              ? (mode === 'leads' ? 'bg-amber-500 text-white shadow-sm' : 'bg-emerald-600 text-white shadow-sm')
              : 'text-muted hover:bg-surface/80 hover:text-ink border border-line/60'
          }`}
        >
          {tr(`الكل (${fmtNum(modeDeals.length)})`, `All (${fmtNum(modeDeals.length)})`)}
        </button>

        {displayedStages.map((st) => {
          const count = modeDeals.filter((d) => d.deal_stage === st).length;
          const isSelected = selectedStage === st;
          return (
            <button
              key={st}
              onClick={() => setSelectedStage(st)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                isSelected
                  ? (mode === 'leads' ? 'bg-amber-500 text-white border-amber-600 shadow-sm' : 'bg-emerald-600 text-white border-emerald-700 shadow-sm')
                  : `${stageBadgeColor[st]} hover:opacity-85`
              }`}
            >
              <span>{labelDealStage(st)}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-black font-mono ${
                  isSelected ? 'bg-white/25 text-white' : 'bg-black/10 text-ink'
                }`}
              >
                {fmtNum(count)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Deals Content Area (Vertical Scroll, No Horizontal Scroll) */}
      {loading ? (
        <div className="py-20 text-center text-xs text-muted">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent mb-2" />
          <div>{tr('جاري تحميل الصفقات...', 'Loading deals...')}</div>
        </div>
      ) : filteredDeals.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-xs text-muted shadow-sm">
          {tr('لا توجد صفقات تطابق معايير البحث أو الفلتر المحدد', 'No deals match your search or filter criteria')}
        </div>
      ) : viewMode === 'cards' ? (
        /* RESPONSIVE CARDS VIEW (Clean, Vertical Scrolling) */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredDeals.map((deal) => (
            <div
              key={deal.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:border-amber-500/50 hover:shadow-md"
            >
              <div>
                {/* Header: Deal Name & Amount */}
                <div className="flex items-start justify-between gap-3">
                  <h3
                    onClick={() => openDetail(deal.id)}
                    className="font-bold text-ink hover:text-amber-500 cursor-pointer text-sm leading-snug"
                  >
                    {deal.deal_name}
                  </h3>
                  <span className="font-black text-amber-500 text-sm whitespace-nowrap font-mono">
                    {Number(deal.deal_amount) > 0
                      ? fmtCurrency(deal.deal_amount)
                      : <span className="text-muted font-sans font-normal text-[11px]">{tr('لم يحدد أي باكيدج', 'No package set')}</span>}
                  </span>
                </div>

                {/* Quick Stage Selector Dropdown */}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted">{tr('حالة الصفقة:', 'Deal Stage:')}</span>
                  <select
                    value={deal.deal_stage}
                    onChange={(e) => handleSetStage(deal.id, e.target.value as DealStage | '__return_to_lead__')}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-bold outline-none cursor-pointer ${stageBadgeColor[deal.deal_stage]}`}
                  >
                    {(mode === 'deals' ? DEALS_STAGES : DEAL_STAGES).map((st) => (
                      <option key={st} value={st} className="bg-surface text-ink">
                        {labelDealStage(st)}
                      </option>
                    ))}
                    {mode === 'deals' && (
                      <option value="__return_to_lead__" className="bg-surface text-amber-600 font-bold">
                        {tr('↩ إرجاع لليد (Leads Pipeline)', '↩ Return to Leads Pipeline')}
                      </option>
                    )}
                  </select>
                </div>

                {/* Quick Promotion Button for Leads to transform into Won Deals */}
                {deal.deal_stage !== 'عقد' && deal.deal_stage !== 'عميل' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetStage(deal.id, 'عميل');
                    }}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 transition hover:bg-emerald-600 hover:text-white shadow-sm"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>اعتماد كعميل رسمي (تحويل للديلز) ➔</span>
                  </button>
                )}

                {/* Company & Client info */}
                <div className="mt-3 space-y-1.5 border-t border-line/60 pt-2.5 text-xs text-muted">
                  {deal.company_name && (
                    <div className="flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-muted shrink-0" />
                      <span className="font-semibold text-ink truncate">{deal.company_name}</span>
                    </div>
                  )}

                  {deal.contacts && deal.contacts.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted shrink-0" />
                      <span className="truncate">
                        {deal.contacts.map((c) => c.full_name).join(', ')}
                        {deal.contacts[0].phone_number ? ` (${deal.contacts[0].phone_number})` : ''}
                      </span>
                    </div>
                  )}

                  {deal.closing_date && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <Calendar className="h-3 w-3 text-muted shrink-0" />
                      <span>{tr('تاريخ الإغلاق:', 'Close Date:')} <span className="font-mono">{fmtDate(deal.closing_date)}</span></span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Actions Footer */}
              <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-2.5 text-xs">
                <div className="flex items-center gap-2">
                  {deal.contacts?.[0]?.id && (
                    <button
                      onClick={() => navigate(`/crm/contacts/${deal.contacts![0].id}`)}
                      className="flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-amber-700 hover:bg-amber-500/20 font-bold transition"
                      title={tr('فتح البروفايل الكامل للعميل', 'Open full client profile')}
                    >
                      <User className="h-3.5 w-3.5" />
                      <span>{tr('البروفايل', 'Profile')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => openDetail(deal.id)}
                    className="flex items-center gap-1 text-muted hover:text-ink font-medium"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>{tr('الصفقة', 'Deal')}</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  {mode === 'deals' && (
                    <button
                      onClick={() => void handleReturnToLead(deal.id)}
                      className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-500/10 transition"
                      title={tr('إرجاع لليد (Leads Pipeline)', 'Return to Leads Pipeline')}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setEditingDeal(deal)}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-amber-500 transition"
                    title={tr('تعديل', 'Edit')}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>

                  {(userRole === 'owner' || userRole === 'manager' || userRole === 'company_owner') && (
                    <button
                      onClick={() => {
                        setTransferDeal(deal);
                        setNewOwnerId(deal.deal_owner_id || '');
                      }}
                      className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-blue-500 transition"
                      title={tr('نقل الملكية', 'Transfer Ownership')}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(deal.id)}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-rose-500 transition"
                    title={tr('حذف', 'Delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* TABLE VIEW (Vertical Scrolling) */
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <table className={`w-full ${ar ? 'text-right' : 'text-left'} text-xs`}>
            <thead className="border-b border-line bg-surface/70 text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">{tr('اسم الصفقة', 'Deal Name')}</th>
                <th className="px-4 py-3 font-semibold">{tr('حالة العميل / المرحلة', 'Stage')}</th>
                <th className="px-4 py-3 font-semibold">{tr('القيمة (ج.م)', 'Amount (EGP)')}</th>
                <th className="px-4 py-3 font-semibold">{tr('الشركة المرتبطة', 'Company / Entity')}</th>
                <th className="px-4 py-3 font-semibold">{tr('جهات الاتصال', 'Client / Contact')}</th>
                <th className="px-4 py-3 font-semibold">{tr('تاريخ الإغلاق', 'Closing Date')}</th>
                <th className="px-4 py-3 font-semibold text-center">{tr('إجراءات', 'Actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {filteredDeals.map((deal) => (
                <tr key={deal.id} className="transition hover:bg-surface/60">
                  <td
                    className="px-4 py-3 font-bold text-ink cursor-pointer hover:text-amber-500"
                    onClick={() => openDetail(deal.id)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{deal.deal_name}</span>
                      {deal.contacts?.[0]?.lead_id && (
                        <span className="rounded bg-surface border border-line px-1.5 py-0.5 text-[10px] font-mono text-muted">
                          {deal.contacts[0].lead_id}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={deal.deal_stage}
                      onChange={(e) => handleSetStage(deal.id, e.target.value as DealStage | '__return_to_lead__')}
                      className={`rounded-lg border px-2 py-1 text-[11px] font-bold outline-none cursor-pointer ${stageBadgeColor[deal.deal_stage]}`}
                    >
                      {(mode === 'deals' ? DEALS_STAGES : DEAL_STAGES).map((st) => (
                        <option key={st} value={st} className="bg-surface text-ink">
                          {labelDealStage(st)}
                        </option>
                      ))}
                      {mode === 'deals' && (
                        <option value="__return_to_lead__" className="bg-surface text-amber-600 font-bold">
                          {tr('↩ إرجاع لليد (Leads Pipeline)', '↩ Return to Leads Pipeline')}
                        </option>
                      )}
                    </select>
                  </td>
                  <td className="px-4 py-3 font-bold font-mono text-amber-500">
                    {Number(deal.deal_amount) > 0
                      ? fmtCurrency(deal.deal_amount)
                      : <span className="text-muted font-sans font-normal text-[11px]">{tr('لم يحدد أي باكيدج', 'No package set')}</span>}
                  </td>
                  <td className="px-4 py-3 text-muted">{deal.company_name || '—'}</td>
                  <td className="px-4 py-3 text-muted">
                    {deal.contacts && deal.contacts.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {deal.contacts.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => navigate(`/crm/contacts/${c.id}`)}
                            className={`font-bold text-ink hover:text-amber-600 hover:underline transition ${ar ? 'text-right' : 'text-left'}`}
                            title={tr('فتح البروفايل الكامل للعميل', 'Open full client profile')}
                          >
                            {c.lead_id ? `${c.full_name} (${c.lead_id})` : c.full_name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted font-mono">
                    {fmtDate(deal.closing_date)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {deal.contacts?.[0]?.id && (
                        <button
                          onClick={() => navigate(`/crm/contacts/${deal.contacts![0].id}`)}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2 py-1 text-[11px] font-bold text-amber-700 hover:bg-amber-500/20 transition"
                          title={tr('فتح بروفايل العميل الكامل', 'Open full client profile')}
                        >
                          <User className="h-3.5 w-3.5" />
                          <span>{tr('البروفايل', 'Profile')}</span>
                        </button>
                      )}
                      {deal.deal_stage === 'عقد' && (
                        <button
                          onClick={() => handleSetStage(deal.id, 'عميل')}
                          className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-500/10 transition"
                          title={tr('تفعيل كعميل نشط (عميل)', 'Activate as Active Client')}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      {mode === 'deals' && (
                        <button
                          onClick={() => void handleReturnToLead(deal.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface/70 px-2 py-1 text-[11px] font-bold text-muted hover:border-amber-500/40 hover:text-amber-600 transition"
                          title={tr('إرجاع لليد (Leads Pipeline)', 'Return to Leads Pipeline')}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          <span>{tr('إرجاع لليد', 'Return to Lead')}</span>
                        </button>
                      )}
                      <button
                        onClick={() => openDetail(deal.id)}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-ink transition"
                        title={tr('عرض التفاصيل', 'View Details')}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditingDeal(deal)}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-amber-500 transition"
                        title={tr('تعديل', 'Edit')}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      {(userRole === 'owner' || userRole === 'manager' || userRole === 'company_owner') && (
                        <button
                          onClick={() => {
                            setTransferDeal(deal);
                            setNewOwnerId(deal.deal_owner_id || '');
                          }}
                          className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-blue-500 transition"
                          title="نقل الملكية"
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(deal.id)}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-rose-500 transition"
                        title="حذف"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Create Deal */}
      {showCreateModal && (
        <DealFormModal
          mode={mode}
          defaultStage={mode === 'deals' ? 'عقد' : 'مكالمة'}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            void loadDeals();
          }}
          companies={companies}
          contacts={contacts}
          members={members}
        />
      )}

      {/* Modal: Edit Deal */}
      {editingDeal && (
        <DealFormModal
          deal={editingDeal}
          mode={mode}
          onClose={() => setEditingDeal(null)}
          onSuccess={() => {
            setEditingDeal(null);
            void loadDeals();
          }}
          companies={companies}
          contacts={contacts}
          members={members}
        />
      )}

      {/* Modal: Transfer Ownership */}
      {transferDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl" dir="rtl">
            <h3 className="text-sm font-bold text-ink mb-2">نقل ملكية الصفقة</h3>
            <p className="text-xs text-muted mb-4">
              نقل الصفقة: <span className="font-bold text-ink">{transferDeal.deal_name}</span> إلى مسؤول آخر.
            </p>
            <form onSubmit={handleTransferOwnership} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">اختر المسؤول الجديد:</label>
                <select
                  value={newOwnerId}
                  onChange={(e) => setNewOwnerId(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-ink"
                  required
                >
                  <option value="">-- اختر عضو الفريق --</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name} ({m.email}) - {m.role}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferDeal(null)}
                  className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-muted hover:bg-surface/80"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600"
                >
                  تأكيد النقل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      {detailDeal && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-2xl overflow-y-auto border-s border-line bg-surface p-6 shadow-2xl" dir={dir}>
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <h3 className="text-base font-bold text-ink">{detailDeal.deal_name}</h3>
                <span className={`mt-1 inline-block rounded-md border px-2 py-0.5 text-xs font-bold ${stageBadgeColor[detailDeal.deal_stage]}`}>
                  {labelDealStage(detailDeal.deal_stage)}
                </span>
              </div>
              <button onClick={() => setDetailDeal(null)} className="rounded-lg p-2 text-muted hover:bg-surface/80">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 space-y-6 text-xs">
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-line/60 bg-surface/30 p-4">
                <div>
                  <span className="text-muted">{tr('قيمة الصفقة:', 'Deal Value:')}</span>
                  <div className="font-mono font-black text-amber-500 text-base mt-0.5">
                    {Number(detailDeal.deal_amount || 0) > 0
                      ? fmtCurrency(Number(detailDeal.deal_amount))
                      : tr('لم يحدد أي باكيدج', 'No package set')}
                  </div>
                </div>
                <div>
                  <span className="text-muted">{tr('الشركة:', 'Company:')}</span>
                  <div className="font-bold text-ink mt-0.5">{detailDeal.company_name || '—'}</div>
                </div>
                <div>
                  <span className="text-muted">{tr('تاريخ الإغلاق المتوقع:', 'Closing Date:')}</span>
                  <div className="font-mono font-bold text-ink mt-0.5">
                    {detailDeal.closing_date ? fmtDate(detailDeal.closing_date) : '—'}
                  </div>
                </div>
                <div className="col-span-2 pt-2 border-t border-line/60">
                  <span className="text-muted font-bold block mb-2">{tr('الوصف ومخرجات الخطة والملاحظات:', 'Plan Deliverables & Notes:')}</span>
                  {(() => {
                    const { plan, cleanNotes } = parseDealDescription(detailDeal.description);
                    return (
                      <div className="space-y-3">
                        {plan && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-sm text-ink">{plan.plan_name || tr('الباقة المخصصة', 'Custom Package')}</span>
                                  {plan.badge && (
                                    <span className="rounded-full bg-amber-500/20 text-amber-600 px-2.5 py-0.5 text-[10px] font-bold">
                                      {plan.badge}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted mt-0.5">
                                  {plan.pricing_location || tr('تسعير القاهرة', 'Cairo Pricing')} • {tr('الدورة:', 'Cycle:')} {plan.billing_cycle || tr('شهرياً', 'Monthly')}
                                </div>
                              </div>
                              <div className="text-left font-mono">
                                <span className="text-base font-black text-amber-500">
                                  {fmtCurrency(Number(plan.price || detailDeal.deal_amount || 0))}
                                </span>
                                <span className="text-[10px] text-muted block font-sans">
                                  {plan.status || (plan.is_approved ? tr('مشترك بها (معتمدة)', 'Approved') : tr('قيد المراجعة', 'Pending Review'))}
                                </span>
                              </div>
                            </div>

                            {plan.description && (
                              <p className="text-ink leading-relaxed text-xs font-medium">
                                {plan.description}
                              </p>
                            )}

                            {plan.strategy_goal && (
                              <div className="rounded-lg bg-surface/80 border border-line/60 p-2.5 text-xs text-ink flex items-start gap-2">
                                <span className="text-sm">🎯</span>
                                <div className="leading-relaxed">
                                  <span className="font-bold text-amber-600 block mb-0.5">{tr('الهدف الاستراتيجي:', 'Strategic Goal:')}</span>
                                  <span>{plan.strategy_goal}</span>
                                </div>
                              </div>
                            )}

                            {/* Services breakdown list */}
                            {plan.services && Array.isArray(plan.services) && plan.services.length > 0 && (
                              <div>
                                <span className="block font-bold text-[11px] text-muted mb-2">{tr('مخرجات وخدمات الخطة:', 'Plan Services & Deliverables:')}</span>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {plan.services.map((s: any, idx: number) => (
                                    <div key={s.id || idx} className="rounded-lg border border-line bg-surface p-2.5 flex items-start justify-between gap-2">
                                      <div>
                                        <span className="font-bold text-ink block text-[11px]">{s.title || s.serviceName}</span>
                                        {s.description && (
                                          <p className="text-[10px] text-muted mt-0.5 leading-snug line-clamp-2">{s.description}</p>
                                        )}
                                      </div>
                                      <div className="text-left whitespace-nowrap">
                                        <span className="text-[10px] font-mono font-bold text-amber-600">
                                          {s.quantity ? `${s.quantity}x ` : ''}{fmtCurrency(Number(s.total_price || s.unit_price || 0))}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {cleanNotes ? (
                          <div className="rounded-xl border border-line/60 bg-surface/50 p-3">
                            <span className="text-muted block text-[11px] font-bold mb-1">{tr('ملاحظات إضافية:', 'Additional Notes:')}</span>
                            <p className="text-ink text-xs leading-relaxed whitespace-pre-wrap">{cleanNotes}</p>
                          </div>
                        ) : !plan ? (
                          <div className="text-muted">{tr('لا توجد ملاحظات إضافية', 'No additional notes')}</div>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Linked Contacts */}
              <div>
                <h4 className="font-bold text-ink mb-2">جهات الاتصال المرتبطة بالصفقة:</h4>
                {!detailDeal.contacts || detailDeal.contacts.length === 0 ? (
                  <div className="rounded-xl border border-line/60 p-4 text-center text-muted">لا يوجد جهات اتصال مرتبطة</div>
                ) : (
                  <div className="space-y-2">
                    {detailDeal.contacts.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl border border-line p-3">
                        <div>
                          <div className="font-bold text-ink">{c.full_name}</div>
                          <div className="text-[11px] text-muted">{c.phone_number || ''}</div>
                        </div>
                        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                          {c.lead_status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked Activities */}
              <div>
                <h4 className="font-bold text-ink mb-2">الأنشطة المرتبطة:</h4>
                {!detailDeal.activities || detailDeal.activities.length === 0 ? (
                  <div className="rounded-xl border border-line/60 p-4 text-center text-muted">لا توجد أنشطة مسجلة لهذه الصفقة</div>
                ) : (
                  <div className="space-y-2">
                    {detailDeal.activities.map((a) => (
                      <div key={a.id} className="rounded-xl border border-line/60 p-3">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-ink">{a.title}</span>
                          <span className="text-[10px] text-muted">{a.completion_status}</span>
                        </div>
                        {a.details && <p className="mt-1 text-muted">{a.details}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DealFormModal({
  deal,
  mode,
  defaultStage,
  onClose,
  onSuccess,
  companies,
  contacts,
  members,
}: {
  deal?: CrmDeal;
  mode?: 'leads' | 'deals';
  defaultStage?: DealStage;
  onClose: () => void;
  onSuccess: () => void;
  companies: CrmCompany[];
  contacts: CrmContact[];
  members: WorkspaceMember[];
}) {
  const { activeWorkspace, apiFetch, userRole } = useCrm();

  const [dealName, setDealName] = useState(deal?.deal_name || '');
  const [dealStage, setDealStage] = useState<DealStage>(
    deal?.deal_stage || defaultStage || (mode === 'deals' ? 'عقد' : 'مكالمة')
  );
  const [dealAmount, setDealAmount] = useState(deal ? deal.deal_amount.toString() : '0');
  const [companyId, setCompanyId] = useState(deal?.company_id || '');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(
    deal?.contacts ? deal.contacts.map((c) => c.id) : []
  );
  const [closingDate, setClosingDate] = useState(
    deal?.closing_date ? deal.closing_date.slice(0, 10) : ''
  );

  const initialEntityType = useMemo(() => {
    if (deal?.company_id) {
      const comp = companies.find((c) => c.id === deal.company_id);
      if (comp?.industry === 'عيادة طبية' || comp?.industry === 'مركز طبي' || comp?.company_name.includes('عياد')) return 'clinic';
      if (comp?.industry === 'براند شخصي' || comp?.company_name.includes('براند')) return 'brand';
      return 'company';
    }
    return 'clinic';
  }, [deal, companies]);

  const [leadEntityType, setLeadEntityType] = useState<'clinic' | 'brand' | 'company'>(initialEntityType);

  const filteredCompanies = useMemo(() => {
    const list = companies.filter((c) => {
      const isCln = c.industry === 'عيادة طبية' || c.industry === 'مركز طبي' || c.company_name.includes('عياد') || c.company_name.includes('مركز');
      const isBrd = c.industry === 'براند شخصي' || c.company_name.includes('براند');
      if (leadEntityType === 'clinic') return isCln;
      if (leadEntityType === 'brand') return isBrd;
      return !isCln && !isBrd;
    });
    return list.length > 0 ? list : companies;
  }, [companies, leadEntityType]);

  const filteredContacts = useMemo(() => {
    const list = contacts.filter((c) => {
      const isCln = Boolean(
        c.medical_specialty ||
        c.business_name?.includes('عياد') ||
        c.business_name?.includes('دكتور') ||
        c.business_name?.includes('طبي') ||
        c.job_title?.includes('طبيب') ||
        c.job_title?.includes('دكتور')
      );
      const isBrd = Boolean(
        c.job_title?.includes('شخصي') ||
        c.business_name?.includes('براند') ||
        c.job_title?.includes('تصوير') ||
        c.job_title?.includes('فردي')
      );
      if (leadEntityType === 'clinic') return isCln;
      if (leadEntityType === 'brand') return isBrd;
      return !isCln && !isBrd;
    });
    return list.length > 0 ? list : contacts;
  }, [contacts, leadEntityType]);

  const initialParsed = useMemo(() => parseDealDescription(deal?.description), [deal?.description]);
  const [cleanNotes, setCleanNotes] = useState(initialParsed.cleanNotes);
  const [ownerId, setOwnerId] = useState(deal?.deal_owner_id || '');
  const [submitting, setSubmitting] = useState(false);

  function toggleContact(cid: string) {
    setSelectedContactIds((prev) =>
      prev.includes(cid) ? prev.filter((id) => id !== cid) : [...prev, cid]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);

    try {
      let finalDescription = cleanNotes.trim();
      if (initialParsed.plan) {
        finalDescription = `__PLAN_JSON__:${JSON.stringify(initialParsed.plan)}\n\n${cleanNotes.trim()}`.trim();
      }

      const payload: Record<string, any> = {
        deal_name: dealName,
        deal_stage: dealStage,
        deal_amount: Number(dealAmount) || 0,
        currency: 'EGP',
        company_id: companyId || null,
        closing_date: closingDate || null,
        description: finalDescription || null,
        deal_owner_id: ownerId || null,
        contact_ids: selectedContactIds,
      };

      if (deal) {
        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals/${deal.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/deals`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onSuccess();
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
          <h3 className="text-sm font-bold text-ink">
            {deal
              ? 'تعديل البيانات'
              : mode === 'leads'
              ? 'إضافة عميل محتمل جديد (New Lead)'
              : 'إضافة صفقة معتمدة (New Won Deal)'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Entity Type Selector (عيادة / براند شخصي / شركة) */}
          <div>
            <label className="block font-medium text-muted mb-1.5">تصنيف الليد / العميل *</label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-surface/50 border border-line rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setLeadEntityType('clinic');
                  setCompanyId('');
                }}
                className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  leadEntityType === 'clinic'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <Stethoscope className="h-3.5 w-3.5" />
                <span>عيادة طبية</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeadEntityType('brand');
                  setCompanyId('');
                }}
                className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  leadEntityType === 'brand'
                    ? 'bg-sky-600 text-white shadow-xs'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>براند شخصي</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeadEntityType('company');
                  setCompanyId('');
                }}
                className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  leadEntityType === 'company'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-muted hover:text-ink'
                }`}
              >
                <Building2 className="h-3.5 w-3.5" />
                <span>شركة تجارية</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">اسم الصفقة *</label>
            <input
              type="text"
              value={dealName}
              onChange={(e) => setDealName(e.target.value)}
              placeholder={
                leadEntityType === 'clinic'
                  ? 'مثال: اشتراك سنوي - عيادة النخبة، باقة نمو العيادة'
                  : leadEntityType === 'brand'
                  ? 'مثال: عقد صناعة محتوى - براند أحمد فهمي، باقة تصوير'
                  : 'مثال: عقد خدمات رقمية - شركة الأمل التجارية'
              }
              required
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-muted mb-1">حالة العميل / المرحلة *</label>
              <select
                value={dealStage}
                onChange={(e) => setDealStage(e.target.value as DealStage)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold text-amber-500"
              >
                {(mode === 'deals'
                  ? (['عقد', 'عميل', 'فقدان العميل'] as DealStage[])
                  : userRole === 'sales'
                  ? DEAL_STAGES.filter((st) => !['تم الفوز', 'فوز', 'مكتملة', 'عقد'].includes(st))
                  : DEAL_STAGES
                ).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-muted mb-1">
                قيمة الصفقة (ج.م) * (الافتراضي 25,000)
              </label>
              <input
                type="number"
                value={dealAmount}
                onChange={(e) => setDealAmount(e.target.value)}
                required
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-black text-amber-500 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block font-medium text-muted mb-1">
                {leadEntityType === 'clinic'
                  ? 'العيادة أو المركز الطبي'
                  : leadEntityType === 'brand'
                  ? 'البراند الشخصي'
                  : 'الشركة أو المؤسسة'}
              </label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              >
                <option value="">-- اختياري --</option>
                {filteredCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-muted mb-1">تاريخ الإغلاق المتوقع</label>
              <input
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              />
            </div>
          </div>

          {/* Contact Linker */}
          <div>
            <label className="block font-medium text-muted mb-1">
              ربط جهات الاتصال (اختر العملاء المرتبطين):
            </label>
            <div className="max-h-36 overflow-y-auto rounded-xl border border-line bg-surface/50 p-2 space-y-1">
              {filteredContacts.length === 0 ? (
                <div className="p-2 text-center text-muted">لا يوجد جهات اتصال مسجلة لهذا التصنيف</div>
              ) : (
                filteredContacts.map((ct) => (
                  <label
                    key={ct.id}
                    className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContactIds.includes(ct.id)}
                      onChange={() => toggleContact(ct.id)}
                      className="rounded border-line text-amber-500"
                    />
                    <span className="font-medium text-ink">{ct.full_name}</span>
                    <span className="text-[10px] text-muted">({ct.business_name || ct.phone_number || ''})</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {userRole !== 'sales' && (
              <div>
                <label className="block font-medium text-muted mb-1">مسؤول المبيعات (Deal Owner)</label>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                >
                  <option value="">-- اختياري (تلقائي الحساب الحالي) --</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.full_name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={userRole === 'sales' ? 'sm:col-span-2' : ''}>
              <label className="block font-medium text-muted mb-1">ملاحظات إضافية</label>
              <textarea
                rows={2}
                value={cleanNotes}
                onChange={(e) => setCleanNotes(e.target.value)}
                placeholder="شروط خاصة، تفاصيل أو ملاحظات للمتابعة..."
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink text-xs resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-muted hover:bg-surface/80"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'جاري الحفظ...' : deal ? 'حفظ التعديلات' : 'إنشاء الصفقة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
