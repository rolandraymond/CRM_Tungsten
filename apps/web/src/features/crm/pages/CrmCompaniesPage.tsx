import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import { useCrmLang } from '../useCrmLang';
import type { CrmCompany, CrmContact, WorkspaceMember } from '../types';
import {
  Building2,
  Search,
  Plus,
  Phone,
  Globe,
  MapPin,
  Trash2,
  Edit2,
  Eye,
  ArrowRightLeft,
  X,
  Users,
  Kanban,
  Stethoscope,
  MessageCircle,
  ExternalLink,
  UserPlus,
  UserCheck,
  Sparkles,
} from 'lucide-react';

export default function CrmCompaniesPage() {
  const { activeWorkspace, apiFetch, userRole } = useCrm();
  const { ar, dir, tr, fmtNum } = useCrmLang();
  const navigate = useNavigate();

  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [entityFilter, setEntityFilter] = useState<'all' | 'clinic' | 'company' | 'brand'>('all');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState<'clinic' | 'company' | 'brand'>('clinic');
  const [editingCompany, setEditingCompany] = useState<CrmCompany | null>(null);
  const [detailCompany, setDetailCompany] = useState<CrmCompany | null>(null);
  const [transferCompany, setTransferCompany] = useState<CrmCompany | null>(null);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  // Add / Link Person (Doctor for Clinic, Client for Company, Member for Brand)
  const [showAddDoctorModal, setShowAddDoctorModal] = useState(false);
  const [addTargetEntity, setAddTargetEntity] = useState<CrmCompany | null>(null);
  const [availableContacts, setAvailableContacts] = useState<CrmContact[]>([]);
  const [doctorModalMode, setDoctorModalMode] = useState<'new' | 'link'>('new');
  const [newDoctorName, setNewDoctorName] = useState('');
  const [newDoctorPhone, setNewDoctorPhone] = useState('');
  const [newDoctorWhatsapp, setNewDoctorWhatsapp] = useState('');
  const [newDoctorSpecialty, setNewDoctorSpecialty] = useState('');
  const [selectedContactToLink, setSelectedContactToLink] = useState('');
  const [linkingDoctor, setLinkingDoctor] = useState(false);

  function openAddPersonModal(entity: CrmCompany) {
    setAddTargetEntity(entity);
    setDoctorModalMode('new');
    setNewDoctorName('');
    setNewDoctorPhone('');
    setNewDoctorWhatsapp('');
    setSelectedContactToLink('');
    setNewDoctorSpecialty(
      isClinic(entity) ? 'أسنان' : isBrand(entity) ? 'عضو / مسؤول بالبراند' : 'مسؤول التعاقدات'
    );
    setShowAddDoctorModal(true);
  }

  const loadCompanies = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    setLoading(true);
    try {
      const qs = searchTerm ? `?q=${encodeURIComponent(searchTerm)}` : '';
      const res = await apiFetch<{ data: CrmCompany[]; total: number }>(
        `/api/crm/workspaces/${activeWorkspace.id}/companies${qs}`
      );
      setCompanies(res.data || []);
      setTotal(res.total || 0);
    } catch (err: any) {
      console.error('[Load Companies Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch, searchTerm]);

  const loadAuxData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [memsRes, contsRes] = await Promise.all([
        apiFetch<{ data: WorkspaceMember[] }>(`/api/crm/workspaces/${activeWorkspace.id}/members`),
        apiFetch<{ data: CrmContact[] }>(`/api/crm/workspaces/${activeWorkspace.id}/contacts?limit=200`),
      ]);
      setMembers(memsRes.data || []);
      setAvailableContacts(contsRes.data || []);
    } catch {
      // ignore
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadCompanies();
    void loadAuxData();
  }, [loadCompanies, loadAuxData]);

  // Determine if an entity is a Brand, Clinic or Company
  function isBrand(c: CrmCompany) {
    return (
      c.industry === 'براند شخصي' ||
      c.industry === 'صانع محتوى' ||
      c.industry?.includes('شخصي') ||
      c.industry?.includes('صانع') ||
      c.industry?.includes('محتوى') ||
      c.company_name.toLowerCase().includes('brand') ||
      c.company_name.includes('براند')
    );
  }

  function isClinic(c: CrmCompany) {
    if (isBrand(c)) return false;
    return (
      c.industry === 'عيادة طبية' ||
      c.industry === 'مركز طبي' ||
      c.company_name.includes('عياد') ||
      c.company_name.includes('مركز طبي')
    );
  }

  function isCompany(c: CrmCompany) {
    return !isClinic(c) && !isBrand(c);
  }

  // Filtered companies based on filter pills
  const filteredCompanies = useMemo(() => {
    if (entityFilter === 'clinic') {
      return companies.filter((c) => isClinic(c));
    }
    if (entityFilter === 'company') {
      return companies.filter((c) => isCompany(c));
    }
    if (entityFilter === 'brand') {
      return companies.filter((c) => isBrand(c));
    }
    return companies;
  }, [companies, entityFilter]);

  const counts = useMemo(() => {
    let cln = 0;
    let cmp = 0;
    let brd = 0;
    companies.forEach((c) => {
      if (isBrand(c)) brd++;
      else if (isClinic(c)) cln++;
      else cmp++;
    });
    return { all: companies.length, clinic: cln, company: cmp, brand: brd };
  }, [companies]);

  async function handleDelete(companyId: string) {
    if (!window.confirm('هل أنت متأكد من حذف هذه المنشأة؟')) return;
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/companies/${companyId}`, {
        method: 'DELETE',
      });
      if (detailCompany?.id === companyId) setDetailCompany(null);
      void loadCompanies();
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    }
  }

  async function handleTransferOwnership(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !transferCompany || !newOwnerId) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/companies/${transferCompany.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify({ new_owner_id: newOwnerId }),
      });
      setTransferCompany(null);
      setNewOwnerId('');
      void loadCompanies();
    } catch (err: any) {
      alert(`فشل نقل الملكية: ${err.message}`);
    }
  }

  async function openDetail(companyId: string) {
    if (!activeWorkspace) return;
    try {
      const res = await apiFetch<{ data: CrmCompany }>(
        `/api/crm/workspaces/${activeWorkspace.id}/companies/${companyId}`
      );
      setDetailCompany(res.data);
    } catch (err: any) {
      alert(`فشل فتح تفاصيل المنشأة: ${err.message}`);
    }
  }

  // Handle adding a new person or linking an existing contact to Clinic / Company / Brand
  async function handleAddOrLinkDoctor(e: React.FormEvent) {
    e.preventDefault();
    const target = addTargetEntity || detailCompany;
    if (!activeWorkspace || !target || linkingDoctor) return;
    setLinkingDoctor(true);
    const targetIsClinic = isClinic(target);
    const targetIsBrand = isBrand(target);
    try {
      if (doctorModalMode === 'new') {
        if (!newDoctorName.trim() || !newDoctorPhone.trim()) {
          alert('يرجى كتابة الاسم الكامل ورقم الهاتف');
          setLinkingDoctor(false);
          return;
        }

        const roleText = newDoctorSpecialty.trim();
        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts`, {
          method: 'POST',
          body: JSON.stringify({
            full_name: newDoctorName.trim(),
            phone_number: newDoctorPhone.trim(),
            whatsapp_number: newDoctorWhatsapp.trim() || newDoctorPhone.trim(),
            medical_specialty: targetIsClinic ? (roleText || 'طبيب') : null,
            business_name: target.company_name,
            company_id: target.id,
            job_title: targetIsClinic
              ? `طبيب (${roleText || 'عام'})`
              : targetIsBrand
              ? (roleText || 'عضو بالبراند')
              : (roleText || 'عميل بالشركة'),
            lead_status: 'جديد',
            activity_status: 'معاودة الاتصال',
            source_platform: 'Direct Entry',
          }),
        });
      } else {
        if (!selectedContactToLink) {
          alert('يرجى اختيار الشخص المطلوب للربط');
          setLinkingDoctor(false);
          return;
        }

        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${selectedContactToLink}`, {
          method: 'PATCH',
          body: JSON.stringify({
            company_id: target.id,
            business_name: target.company_name,
            ...(targetIsClinic ? { medical_specialty: newDoctorSpecialty || 'طبيب' } : {}),
          }),
        });
      }

      setShowAddDoctorModal(false);
      setAddTargetEntity(null);
      setNewDoctorName('');
      setNewDoctorPhone('');
      setNewDoctorWhatsapp('');
      setSelectedContactToLink('');
      // Reload details & contacts
      if (detailCompany && detailCompany.id === target.id) {
        await openDetail(target.id);
      }
      void loadCompanies();
      void loadAuxData();
    } catch (err: any) {
      alert(`فشل الإضافة/الربط: ${err.message}`);
    } finally {
      setLinkingDoctor(false);
    }
  }

  return (
    <div className="space-y-4" dir={dir}>
      {/* 1. FILTER PILLS & ACTION BUTTONS */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setEntityFilter('all')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              entityFilter === 'all'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>{tr('كل المنشآت', 'All Entities')}</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {fmtNum(counts.all)}
            </span>
          </button>

          <button
            onClick={() => setEntityFilter('clinic')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              entityFilter === 'clinic'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Stethoscope className="h-3.5 w-3.5" />
            <span>{tr('العيادات والمراكز الطبية', 'Clinics & Medical Centers')}</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {fmtNum(counts.clinic)}
            </span>
          </button>

          <button
            onClick={() => setEntityFilter('company')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              entityFilter === 'company'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>{tr('الشركات التجارية', 'Companies')}</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {fmtNum(counts.company)}
            </span>
          </button>

          <button
            onClick={() => setEntityFilter('brand')}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition ${
              entityFilter === 'brand'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-muted hover:bg-surface/80 hover:text-ink border border-line'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{tr('البراند الشخصي', 'Personal Brands')}</span>
            <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px] font-mono">
              {fmtNum(counts.brand)}
            </span>
          </button>
        </div>

        {/* Action Buttons: Add Clinic, Company, or Personal Brand */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setCreateType('clinic');
              setShowCreateModal(true);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-purple-700"
          >
            <Stethoscope className="h-4 w-4" />
            <span>{tr('إضافة عيادة جديدة', 'Add Clinic')}</span>
          </button>

          <button
            onClick={() => {
              setCreateType('company');
              setShowCreateModal(true);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
          >
            <Building2 className="h-4 w-4" />
            <span>{tr('إضافة شركة جديدة', 'Add Company')}</span>
          </button>

          <button
            onClick={() => {
              setCreateType('brand');
              setShowCreateModal(true);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-sky-700"
          >
            <Sparkles className="h-4 w-4" />
            <span>{tr('إضافة براند شخصي', 'Add Personal Brand')}</span>
          </button>
        </div>
      </div>

      {/* 2. SEARCH TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className={`absolute ${ar ? 'right-3' : 'left-3'} top-1/2 h-4 w-4 -translate-y-1/2 text-muted`} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={tr('بحث باسم العيادة أو الشركة أو التخصص أو المدينة...', 'Search by clinic, company, specialty, or city...')}
            className={`w-full rounded-xl border border-line bg-surface/50 py-2 ${ar ? 'pr-9 pl-3' : 'pl-9 pr-3'} text-xs outline-none transition focus:border-amber-500`}
          />
        </div>
        <span className="text-xs text-muted font-medium">
          {tr(`إجمالي المنشآت المعروضة: ${fmtNum(filteredCompanies.length)} من ${fmtNum(total)}`, `Showing ${fmtNum(filteredCompanies.length)} of ${fmtNum(total)} entities`)}
        </span>
      </div>

      {/* 3. COMPANIES & CLINICS GRID */}
      {loading ? (
        <div className="py-16 text-center text-xs text-muted">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent mb-2" />
          <div>{tr('جاري تحميل قائمة المنشآت...', 'Loading entities...')}</div>
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-xs text-muted">
          {tr('لا توجد عيادات أو شركات تطابق معايير البحث', 'No clinics, companies, or brands match your search')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCompanies.map((company) => {
            const clinicMode = isClinic(company);
            const brandMode = isBrand(company);

            return (
              <div
                key={company.id}
                className="flex flex-col justify-between rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:border-amber-500/40"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-sm ${
                          brandMode
                            ? 'bg-sky-500/10 text-sky-600 border border-sky-500/20'
                            : clinicMode
                            ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20'
                            : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                        }`}
                      >
                        {brandMode ? <Sparkles className="h-5 w-5" /> : clinicMode ? <Stethoscope className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4
                            className="font-bold text-ink hover:text-amber-500 cursor-pointer text-sm"
                            onClick={() => openDetail(company.id)}
                          >
                            {company.company_name}
                          </h4>
                        </div>
                        <span
                          className={`inline-block rounded-md px-1.5 py-0.2 text-[10px] font-bold ${
                            brandMode
                              ? 'bg-sky-500/10 text-sky-600'
                              : clinicMode
                              ? 'bg-purple-500/10 text-purple-600'
                              : 'bg-blue-500/10 text-blue-600'
                          }`}
                        >
                          {brandMode ? 'براند شخصي' : clinicMode ? 'عيادة / مركز طبي' : 'شركة تجارية'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5 text-xs text-muted border-t border-line/50 pt-3">
                    {company.city && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted shrink-0" />
                        <span>
                          {company.city} {company.address ? `- ${company.address}` : ''}
                        </span>
                      </div>
                    )}
                    {company.phone && (
                      <div className="flex items-center gap-2 font-mono">
                        <Phone className="h-3.5 w-3.5 text-muted shrink-0" />
                        <span>{company.phone}</span>
                      </div>
                    )}
                    {company.website && (
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5 text-muted shrink-0" />
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-500 hover:underline truncate"
                        >
                          {company.website}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line/60 pt-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => openDetail(company.id)}
                      className="font-bold text-amber-500 hover:text-amber-600 flex items-center gap-1"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{tr('التفاصيل', 'Details')}</span>
                    </button>

                    <button
                      onClick={() => openAddPersonModal(company)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                        isBrand(company)
                          ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20'
                          : isClinic(company)
                          ? 'border-purple-500/30 bg-purple-500/10 text-purple-700 hover:bg-purple-500/20'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20'
                      }`}
                    >
                      <UserPlus className="h-3 w-3" />
                      <span>
                        {isBrand(company)
                          ? tr('+ شخص للبراند', '+ Brand Member')
                          : isClinic(company)
                          ? tr('+ دكتور', '+ Doctor')
                          : tr('+ عميل', '+ Client')}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingCompany(company)}
                      className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-amber-500"
                      title="تعديل"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    {(userRole === 'owner' || userRole === 'manager' || userRole === 'company_owner') && (
                      <button
                        onClick={() => {
                          setTransferCompany(company);
                          setNewOwnerId(company.company_owner_id || '');
                        }}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-blue-500"
                        title="نقل الملكية"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(company.id)}
                      className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-rose-500"
                      title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. DETAIL DRAWER (WITH DOCTORS LINKING) */}
      {detailCompany && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div
            className="h-full w-full max-w-2xl overflow-y-auto border-s border-line bg-surface p-6 shadow-2xl"
            dir="rtl"
          >
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl font-bold ${
                    isBrand(detailCompany)
                      ? 'bg-sky-500/10 text-sky-600 border border-sky-500/20'
                      : isClinic(detailCompany)
                      ? 'bg-purple-500/10 text-purple-600 border border-purple-500/20'
                      : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                  }`}
                >
                  {isBrand(detailCompany) ? (
                    <Sparkles className="h-6 w-6" />
                  ) : isClinic(detailCompany) ? (
                    <Stethoscope className="h-6 w-6" />
                  ) : (
                    <Building2 className="h-6 w-6" />
                  )}
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">{detailCompany.company_name}</h3>
                  <p className="text-xs text-muted">
                    {isBrand(detailCompany)
                      ? 'براند شخصي / صانع محتوى'
                      : isClinic(detailCompany)
                      ? 'عيادة / مركز طبي'
                      : detailCompany.industry || 'منشأة تجارية'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetailCompany(null)}
                className="rounded-lg p-2 text-muted hover:bg-surface/80"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 space-y-6 text-xs">
              {/* Basic Info Box */}
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-line/60 bg-surface/30 p-4">
                <div>
                  <span className="text-muted">المدينة:</span>
                  <div className="font-bold text-ink mt-0.5">{detailCompany.city || '—'}</div>
                </div>
                <div>
                  <span className="text-muted">الهاتف:</span>
                  <div className="font-bold text-ink font-mono mt-0.5">{detailCompany.phone || '—'}</div>
                </div>
                <div>
                  <span className="text-muted">العنوان:</span>
                  <div className="font-bold text-ink mt-0.5">{detailCompany.address || '—'}</div>
                </div>
                <div>
                  <span className="text-muted">الموقع الإلكتروني:</span>
                  <div className="font-bold text-amber-500 mt-0.5">{detailCompany.website || '—'}</div>
                </div>
              </div>

              {/* LINKED DOCTORS & CONTACTS (SOLVES: "وكمان ف العياده اقدر اربط دكتورين بنفس العياده") */}
              <div className="rounded-2xl border border-line bg-surface/50 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-line pb-2.5">
                  <div className="flex items-center gap-1.5 font-bold text-ink text-xs">
                    {isBrand(detailCompany) ? (
                      <Sparkles className="h-4 w-4 text-sky-600" />
                    ) : isClinic(detailCompany) ? (
                      <Stethoscope className="h-4 w-4 text-purple-600" />
                    ) : (
                      <Users className="h-4 w-4 text-blue-600" />
                    )}
                    <span>
                      {isBrand(detailCompany)
                        ? `الأعضاء وصناع المحتوى المرتبطون بالبراند (${detailCompany.contacts?.length || 0})`
                        : isClinic(detailCompany)
                        ? `الأطباء المرتبطون بهذه العيادة (${detailCompany.contacts?.length || 0})`
                        : `الموظفون والعملاء التابعون للشركة (${detailCompany.contacts?.length || 0})`}
                    </span>
                  </div>

                  <button
                    onClick={() => openAddPersonModal(detailCompany)}
                    className="flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-600 transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>
                      {isBrand(detailCompany)
                        ? 'إضافة / ربط شخص بالبراند'
                        : isClinic(detailCompany)
                        ? 'إضافة / ربط دكتور بالعيادة'
                        : 'إضافة / ربط عميل بالشركة'}
                    </span>
                  </button>
                </div>

                {!detailCompany.contacts || detailCompany.contacts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line p-6 text-center text-muted">
                    <p className="mb-2">
                      {isBrand(detailCompany)
                        ? 'لم يتم ربط أعضاء أو أشخاص بهذا البراند بعد'
                        : isClinic(detailCompany)
                        ? 'لم يتم ربط أطباء بهذه العيادة بعد'
                        : 'لا يوجد عملاء مرتبطون بهذه الشركة بعد'}
                    </p>
                    <button
                      onClick={() => openAddPersonModal(detailCompany)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-amber-600 hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>
                        {isClinic(detailCompany) ? 'ربط دكتور بالعيادة الآن' : 'ربط عميل الآن'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detailCompany.contacts.map((c) => {
                      const cleanPhone = (c.phone_number || '').replace(/\D/g, '');

                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-xl border border-line bg-surface p-3 hover:border-amber-500/40 transition"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 font-bold text-amber-600 text-xs">
                              {c.full_name ? c.full_name.slice(0, 2).toUpperCase() : 'DR'}
                            </div>
                            <div>
                              <div
                                className="font-bold text-ink hover:text-amber-500 cursor-pointer flex items-center gap-1.5"
                                onClick={() => navigate(`/crm/contacts/${c.id}`)}
                              >
                                <span>{c.full_name}</span>
                                <ExternalLink className="h-3 w-3 text-muted" />
                              </div>
                              <div className="text-[11px] text-muted">
                                {c.job_title || (isClinic(detailCompany) ? 'طبيب' : 'موظف')}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {cleanPhone && (
                              <a
                                href={`https://wa.me/${cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-600 hover:bg-emerald-500/20"
                              >
                                <MessageCircle className="h-3 w-3" />
                                <span>واتساب</span>
                              </a>
                            )}
                            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                              {c.lead_status || 'جديد'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Linked Deals */}
              <div>
                <h4 className="font-bold text-ink mb-2 flex items-center gap-1.5">
                  <Kanban className="h-4 w-4 text-amber-500" />
                  <span>الصفقات والباقات المرتبطة بهذه المنشأة:</span>
                </h4>
                {!detailCompany.deals || detailCompany.deals.length === 0 ? (
                  <div className="rounded-xl border border-line/60 p-4 text-center text-muted">
                    لا توجد صفقات مرتبطة حالياً
                  </div>
                ) : (
                  <div className="space-y-2">
                    {detailCompany.deals.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between rounded-xl border border-line p-3"
                      >
                        <div>
                          <div className="font-bold text-ink">{d.deal_name}</div>
                          <div className="text-[11px] text-muted">المرحلة: {d.deal_stage}</div>
                        </div>
                        <div className="font-black text-amber-500">
                          {Number(d.deal_amount).toLocaleString('en-US')} {d.currency === 'EGP' || !d.currency ? tr('ج.م', 'EGP') : d.currency}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. MODAL: ADD / LINK PERSON TO CLINIC / COMPANY / BRAND */}
      {showAddDoctorModal && (addTargetEntity || detailCompany) && (() => {
        const modalTarget = (addTargetEntity || detailCompany)!;
        const modalIsClinic = isClinic(modalTarget);
        const modalIsBrand = isBrand(modalTarget);
        const personLabel = modalIsClinic ? 'دكتور' : modalIsBrand ? 'شخص للبراند' : 'عميل للشركة';
        const entityTypeLabel = modalIsClinic ? 'العيادة' : modalIsBrand ? 'البراند' : 'الشركة';

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-3xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  {`إضافة أو ربط ${personLabel} بـ (${modalTarget.company_name})`}
                </h3>
                <p className="text-[11px] text-muted">
                  {`يمكنك إنشاء ${personLabel} جديد مباشرة أو ربط شخص مسجل مسبقاً بـ${entityTypeLabel}`}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddDoctorModal(false);
                  setAddTargetEntity(null);
                }}
                className="rounded-lg p-1.5 text-muted hover:bg-surface/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mode Selector: New vs Existing */}
            <div className="grid grid-cols-2 gap-2 mb-4 p-1 bg-surface/50 border border-line rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setDoctorModalMode('new')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  doctorModalMode === 'new' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>{`إضافة ${personLabel} جديد`}</span>
              </button>
              <button
                type="button"
                onClick={() => setDoctorModalMode('link')}
                className={`py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  doctorModalMode === 'link' ? 'bg-amber-500 text-white shadow-xs' : 'text-muted hover:text-ink'
                }`}
              >
                <UserCheck className="h-3.5 w-3.5" />
                <span>ربط شخص مسجل مسبقاً</span>
              </button>
            </div>

            <form onSubmit={handleAddOrLinkDoctor} className="space-y-3 text-xs">
              {doctorModalMode === 'new' ? (
                <>
                  <div>
                    <label className="block text-muted mb-1 font-medium">
                      {modalIsClinic ? 'اسم الطبيب الكامل *' : modalIsBrand ? 'الاسم الكامل *' : 'اسم العميل / المسؤول الكامل *'}
                    </label>
                    <input
                      type="text"
                      value={newDoctorName}
                      onChange={(e) => setNewDoctorName(e.target.value)}
                      required
                      placeholder={
                        modalIsClinic
                          ? 'د. أحمد الشناوي...'
                          : modalIsBrand
                          ? 'اسم صاحب البراند أو العضو...'
                          : 'أحمد محمد...'
                      }
                      className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-muted mb-1 font-medium">رقم الهاتف *</label>
                      <input
                        type="text"
                        value={newDoctorPhone}
                        onChange={(e) => setNewDoctorPhone(e.target.value)}
                        required
                        placeholder="010xxxxxxxx"
                        className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-muted mb-1 font-medium">رقم الواتساب</label>
                      <input
                        type="text"
                        value={newDoctorWhatsapp}
                        onChange={(e) => setNewDoctorWhatsapp(e.target.value)}
                        placeholder="010xxxxxxxx"
                        className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono text-emerald-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-muted mb-1 font-medium">
                      {modalIsClinic ? 'التخصص الطبي *' : modalIsBrand ? 'الدور / الوظيفة في البراند *' : 'المسمى الوظيفي / الدور في الشركة *'}
                    </label>
                    <input
                      type="text"
                      value={newDoctorSpecialty}
                      onChange={(e) => setNewDoctorSpecialty(e.target.value)}
                      required
                      placeholder={
                        modalIsClinic
                          ? 'أسنان، جراحة، جلدية...'
                          : modalIsBrand
                          ? 'صاحب البراند، صانع محتوى، مدير حساب...'
                          : 'مدير تسويق، مسؤول تعاقدات...'
                      }
                      className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-muted mb-1 font-medium">
                    {`اختر الشخص المسجل في قاعدة البيانات للربط بـ${entityTypeLabel}:`}
                  </label>
                  <select
                    value={selectedContactToLink}
                    onChange={(e) => setSelectedContactToLink(e.target.value)}
                    required
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                  >
                    <option value="">{`-- اختر للربط بـ${entityTypeLabel} --`}</option>
                    {availableContacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name} ({c.phone_number || 'بدون هاتف'} - {c.medical_specialty || c.job_title || 'عميل'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddDoctorModal(false);
                    setAddTargetEntity(null);
                  }}
                  className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={linkingDoctor}
                  className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  {linkingDoctor ? 'جاري الحفظ...' : `تأكيد الحفظ والربط بـ${entityTypeLabel}`}
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* 6. MODAL: CREATE / EDIT COMPANY OR CLINIC */}
      {(showCreateModal || editingCompany) && (
        <CompanyFormModal
          company={editingCompany || undefined}
          defaultType={createType}
          onClose={() => {
            setShowCreateModal(false);
            setEditingCompany(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingCompany(null);
            void loadCompanies();
          }}
          members={members}
        />
      )}

      {/* 7. MODAL: TRANSFER COMPANY */}
      {transferCompany && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-2xl">
            <h3 className="text-sm font-bold text-ink mb-2">نقل ملكية المنشأة</h3>
            <p className="text-xs text-muted mb-4">
              اختر الموظف الجديد الذي ستنقل إليه إدارة ({transferCompany.company_name}).
            </p>

            <form onSubmit={handleTransferOwnership} className="space-y-4">
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                required
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs text-ink font-bold"
              >
                <option value="">-- اختر الموظف الجديد --</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.role})
                  </option>
                ))}
              </select>

              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setTransferCompany(null)}
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

function CompanyFormModal({
  company,
  defaultType = 'clinic',
  onClose,
  onSuccess,
  members,
}: {
  company?: CrmCompany;
  defaultType?: 'clinic' | 'company' | 'brand';
  onClose: () => void;
  onSuccess: () => void;
  members: WorkspaceMember[];
}) {
  const { activeWorkspace, apiFetch } = useCrm();

  const isBrandInitial = company
    ? company.industry === 'براند شخصي' || company.company_name.includes('براند')
    : defaultType === 'brand';
  const isClinicInitial = !isBrandInitial && (company
    ? company.industry === 'عيادة طبية' || company.company_name.includes('عياد')
    : defaultType === 'clinic');

  const [entityType, setEntityType] = useState<'clinic' | 'company' | 'brand'>(
    isBrandInitial ? 'brand' : isClinicInitial ? 'clinic' : 'company'
  );
  const [companyName, setCompanyName] = useState(company?.company_name || '');
  const [industry, setIndustry] = useState(
    company?.industry || (defaultType === 'brand' ? 'براند شخصي' : defaultType === 'clinic' ? 'عيادة طبية' : 'شركة تجارية')
  );
  const [city, setCity] = useState(company?.city || '');
  const [address, setAddress] = useState(company?.address || '');
  const [phone, setPhone] = useState(company?.phone || '');
  const [website, setWebsite] = useState(company?.website || '');
  const [ownerId, setOwnerId] = useState(company?.company_owner_id || '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      const payload = {
        company_name: companyName,
        industry: entityType === 'brand' ? 'براند شخصي' : entityType === 'clinic' ? 'عيادة طبية' : industry || 'شركة تجارية',
        city: city || null,
        address: address || null,
        phone: phone || null,
        website: website || null,
        company_owner_id: ownerId || null,
      };

      if (company) {
        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/companies/${company.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/companies`, {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-3xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
          <h3 className="text-base font-bold text-ink">
            {company
              ? 'تعديل بيانات المنشأة'
              : entityType === 'brand'
              ? 'إضافة براند شخصي جديد'
              : entityType === 'clinic'
              ? 'إضافة عيادة أو مركز طبي جديد'
              : 'إضافة شركة جديدة'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface/80">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Entity Type Selector */}
        {!company && (
          <div className="grid grid-cols-3 gap-2 mb-4 p-1 bg-surface/50 border border-line rounded-xl text-xs font-bold">
            <button
              type="button"
              onClick={() => {
                setEntityType('clinic');
                setIndustry('عيادة طبية');
              }}
              className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                entityType === 'clinic'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Stethoscope className="h-3.5 w-3.5" />
              <span>عيادة / مركز طبي</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEntityType('company');
                setIndustry('شركة تجارية');
              }}
              className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                entityType === 'company'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>شركة تجارية</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEntityType('brand');
                setIndustry('براند شخصي');
              }}
              className={`py-2 px-2.5 rounded-lg flex items-center justify-center gap-1.5 transition ${
                entityType === 'brand'
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>براند شخصي</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label className="block text-muted mb-1 font-medium">
              {entityType === 'clinic'
                ? 'اسم العيادة أو المركز الطبي *'
                : entityType === 'brand'
                ? 'اسم البراند الشخصي / صانع المحتوى *'
                : 'اسم الشركة أو المؤسسة *'}
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              placeholder={
                entityType === 'clinic'
                  ? 'عيادات النخبة التخصصية...'
                  : entityType === 'brand'
                  ? 'براند د. حسام / صانع المحتوى...'
                  : 'شركة التوريدات الطبية...'
              }
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-muted mb-1 font-medium">المدينة</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="القاهرة، الجيزة..."
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              />
            </div>
            <div>
              <label className="block text-muted mb-1 font-medium">رقم الهاتف</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="02xxxxxxxx أو 010xxxxxxxx"
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-muted mb-1 font-medium">العنوان التفصيلي</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="الشارع، المنطقة، رقم المبنى..."
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div>
            <label className="block text-muted mb-1 font-medium">الموقع الإلكتروني</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div>
            <label className="block text-muted mb-1 font-medium">المسؤول عن المنشأة</label>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
            >
              <option value="">-- تلقائي (حساب المستخدم الحالي) --</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600 transition"
            >
              {submitting ? 'جاري الحفظ...' : company ? 'حفظ التعديلات' : 'إنشاء وحفظ المنشأة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
