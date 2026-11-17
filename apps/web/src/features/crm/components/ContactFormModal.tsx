import React, { useState } from 'react';
import { useCrm } from '../CrmContext';
import type { CrmContact, CrmCompany, WorkspaceMember, LeadStatus, ActivityStatus, MeetingStatus } from '../types';
import { X } from 'lucide-react';

export interface ContactFormModalProps {
  contact?: CrmContact;
  defaultLeadStatus?: LeadStatus;
  onClose: () => void;
  onSuccess: (updated?: CrmContact) => void;
  companies: CrmCompany[];
  members: WorkspaceMember[];
}

export function ContactFormModal({
  contact,
  defaultLeadStatus,
  onClose,
  onSuccess,
  companies,
  members,
}: ContactFormModalProps) {
  const { activeWorkspace, apiFetch } = useCrm();

  // Client Category: Individual (e.g. video shooting), Clinic Doctor, or Company Client
  const initialCategory = contact?.medical_specialty
    ? 'clinic'
    : contact?.company_id
    ? 'company'
    : contact?.job_title?.includes('تصوير') || contact?.job_title?.includes('فردي')
    ? 'individual'
    : 'individual';

  const [clientCategory, setClientCategory] = useState<'individual' | 'clinic' | 'company'>(initialCategory);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  // Tab inside form
  const [activeFormTab, setActiveFormTab] = useState<'identity' | 'business' | 'pipeline'>('identity');

  // 1. Identity Fields
  const [leadId, setLeadId] = useState(
    contact?.lead_id || `LEAD-${Math.floor(100000 + Math.random() * 900000)}`
  );
  const [fullName, setFullName] = useState(contact?.full_name || '');
  const [jobTitle, setJobTitle] = useState(
    contact?.job_title || (initialCategory === 'individual' ? 'عميل فردي (تصوير فيديوهات)' : '')
  );
  const [phoneNumber, setPhoneNumber] = useState(contact?.phone_number || '');
  const [whatsappNumber, setWhatsappNumber] = useState(contact?.whatsapp_number || '');
  const [businessPhone, setBusinessPhone] = useState(contact?.business_phone || '');
  const [companyPhone, setCompanyPhone] = useState(contact?.company_phone || '');
  const [email, setEmail] = useState(contact?.email || '');
  const [socialProfileLink, setSocialProfileLink] = useState(contact?.social_profile_link || '');

  // 2. Business & Clinic Fields
  const [businessName, setBusinessName] = useState(contact?.business_name || '');
  const [medicalSpecialty, setMedicalSpecialty] = useState(contact?.medical_specialty || '');
  const [clinicAddress, setClinicAddress] = useState(contact?.clinic_address || '');
  const [city, setCity] = useState(contact?.city || '');
  const [district, setDistrict] = useState(contact?.district || '');
  const [branchCount, setBranchCount] = useState(contact?.branch_count?.toString() || '1');
  const [website, setWebsite] = useState(contact?.website || '');
  const [googleMaps, setGoogleMaps] = useState(contact?.google_maps || '');
  const [businessInstagram, setBusinessInstagram] = useState(contact?.business_instagram || '');
  const [businessFacebook, setBusinessFacebook] = useState(contact?.business_facebook || '');
  const [companyId, setCompanyId] = useState(contact?.company_id || '');
  const [createNewEntity, setCreateNewEntity] = useState(false);

  // 3. Campaign & Pipeline Fields
  const [sourcePlatform, setSourcePlatform] = useState(contact?.source_platform || 'Meta Ads');
  const [adId, setAdId] = useState(contact?.ad_id || 'AD-CAMPAIGN-01');
  const [leadStatus, setLeadStatus] = useState<LeadStatus>(
    contact?.lead_status || defaultLeadStatus || 'جديد'
  );
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>(
    (contact?.activity_status as ActivityStatus) || 'معاودة الاتصال'
  );
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>(
    contact?.meeting_status || 'محجوز'
  );
  const [ownerId, setOwnerId] = useState(contact?.contact_owner_id || '');
  const [meetingDate, setMeetingDate] = useState(
    contact?.meeting_date ? contact.meeting_date.slice(0, 16) : ''
  );
  const [followUpDate, setFollowUpDate] = useState(
    contact?.follow_up_date ? contact.follow_up_date.slice(0, 10) : ''
  );

  const [submitting, setSubmitting] = useState(false);

  // Filter clinics vs companies from list
  const clinicsList = companies.filter(
    (c) => c.industry === 'عيادة طبية' || c.industry === 'مركز طبي' || c.company_name.includes('عياد')
  );
  const generalCompaniesList = companies.filter(
    (c) => !(c.industry === 'عيادة طبية' || c.industry === 'مركز طبي' || c.company_name.includes('عياد'))
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      let finalCompanyId = companyId || null;

      // If user typed a new clinic/company name and wants it saved as a persistent organization
      if (createNewEntity && businessName.trim()) {
        try {
          const newCompRes = await apiFetch<{ data: CrmCompany }>(
            `/api/crm/workspaces/${activeWorkspace.id}/companies`,
            {
              method: 'POST',
              body: JSON.stringify({
                company_name: businessName.trim(),
                industry: clientCategory === 'individual' ? 'براند شخصي' : clientCategory === 'clinic' ? 'عيادة طبية' : 'شركة تجارية',
                city: city || null,
                address: clinicAddress || null,
                phone: phoneNumber || businessPhone || null,
                website: website || null,
              }),
            }
          );
          if (newCompRes?.data?.id) {
            finalCompanyId = newCompRes.data.id;
          }
        } catch (compErr) {
          console.warn('[Auto-create company/clinic note]', compErr);
        }
      }

      const payload: Record<string, any> = {
        lead_id: leadId || `LEAD-${Date.now()}`,
        full_name: fullName,
        job_title: jobTitle || (clientCategory === 'individual' ? 'عميل فردي' : null),
        phone_number: phoneNumber,
        whatsapp_number: whatsappNumber || null,
        business_phone: businessPhone || null,
        company_phone: companyPhone || null,
        email: email || null,
        social_profile_link: socialProfileLink || '-',
        business_name: businessName || (clientCategory === 'individual' ? 'عميل فردي مستقل' : null),
        medical_specialty: clientCategory === 'clinic' ? medicalSpecialty || 'طبيب' : null,
        clinic_address: clinicAddress || null,
        city: city || null,
        district: district || null,
        branch_count: branchCount ? Number(branchCount) : 1,
        website: website || null,
        google_maps: googleMaps || null,
        business_instagram: businessInstagram || null,
        business_facebook: businessFacebook || null,
        company_id: finalCompanyId,
        source_platform: sourcePlatform || 'Meta Ads',
        ad_id: adId || '-',
        lead_status: leadStatus,
        activity_status: activityStatus,
        meeting_status: meetingStatus,
        contact_owner_id: ownerId || null,
        meeting_date: meetingDate || null,
        follow_up_date: followUpDate || null,
      };

      let result: any = null;
      if (contact) {
        result = await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${contact.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        result = await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      onSuccess(result?.data);
    } catch (err: any) {
      const msg = err.message || 'فشل حفظ بيانات العميل';
      if (msg.includes('مسبقاً') || msg.includes('DUPLICATE') || msg.includes('duplicate')) {
        setDuplicateError(msg);
      } else {
        alert(`خطأ: ${msg}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-ink">
              {contact ? 'تعديل بيانات العميل الشاملة' : 'إضافة عميل محتمل جديد (25 حقل)'}
            </h3>
            <p className="text-xs text-muted">استيفاء بيانات هوية العميل والعيادة والحملة الإعلانية</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface/80">
            <X className="h-5 w-5" />
          </button>
        </div>

        {duplicateError && (
          <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-bold text-rose-600 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>{duplicateError}</span>
            </div>
            <button
              type="button"
              onClick={() => setDuplicateError(null)}
              className="text-rose-500 hover:text-rose-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Category Selector: Individual vs Clinic Doctor vs Company Client */}
        <div className="mb-4 rounded-2xl border border-line bg-surface/50 p-2">
          <div className="text-[11px] font-bold text-muted mb-1.5 px-1">تصنيف العميل المطلوب إضافته:</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => {
                setClientCategory('individual');
                if (!jobTitle) setJobTitle('براند شخصي (صانع محتوى / تصوير)');
                if (!businessName) setBusinessName('براند شخصي');
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-3 text-xs font-bold transition border ${
                clientCategory === 'individual'
                  ? 'border-sky-500 bg-sky-600 text-white shadow-xs'
                  : 'border-line bg-surface text-muted hover:text-ink'
              }`}
            >
              <span className="flex items-center gap-1">
                <span>✨ براند شخصي</span>
              </span>
              <span className="text-[10px] opacity-80 font-normal">صناع محتوى، علامات تجارية شخصية، أفراد</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setClientCategory('clinic');
                if (!medicalSpecialty) setMedicalSpecialty('أسنان');
                if (!businessName) setBusinessName('عيادة تخصصية');
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-3 text-xs font-bold transition border ${
                clientCategory === 'clinic'
                  ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                  : 'border-line bg-surface text-muted hover:text-ink'
              }`}
            >
              <span className="flex items-center gap-1">
                <span>🩺 عيادة / دكتور بعيادة</span>
              </span>
              <span className="text-[10px] opacity-80 font-normal">ربط الطبيب بعيادة ومراكز طبية</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setClientCategory('company');
                if (!businessName) setBusinessName('شركة');
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 px-3 text-xs font-bold transition border ${
                clientCategory === 'company'
                  ? 'border-amber-500 bg-amber-500 text-white shadow-xs'
                  : 'border-line bg-surface text-muted hover:text-ink'
              }`}
            >
              <span className="flex items-center gap-1">
                <span>🏢 شركة / عميل بشركة</span>
              </span>
              <span className="text-[10px] opacity-80 font-normal">حسابات المنشآت والشركات التجارية</span>
            </button>
          </div>
        </div>

        {/* Modal Form Step Tabs */}
        <div className="flex border-b border-line gap-2 mb-4 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveFormTab('identity')}
            className={`pb-2.5 px-3 border-b-2 transition ${
              activeFormTab === 'identity'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            1. هوية العميل والاتصال
          </button>
          <button
            type="button"
            onClick={() => setActiveFormTab('business')}
            className={`pb-2.5 px-3 border-b-2 transition ${
              activeFormTab === 'business'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            2. بيانات المنشأة والعيادة
          </button>
          <button
            type="button"
            onClick={() => setActiveFormTab('pipeline')}
            className={`pb-2.5 px-3 border-b-2 transition ${
              activeFormTab === 'pipeline'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            3. الحملة ومسار المبيعات
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* STEP 1: IDENTITY */}
          {activeFormTab === 'identity' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">
                    Lead ID (معرف العميل) *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={leadId}
                      onChange={(e) => setLeadId(e.target.value)}
                      required
                      placeholder="LEAD-101"
                      className="w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => setLeadId(`LEAD-${Math.floor(100000 + Math.random() * 900000)}`)}
                      className="rounded-xl border border-line bg-surface/50 px-3 text-[11px] font-bold text-muted hover:text-ink"
                    >
                      توليد
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">الاسم بالكامل (Full Name) *</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="د. محمد مصطفى..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">المسمى الوظيفي (Job Title)</label>
                  <input
                    type="text"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    placeholder="استشاري جراحة، مدير طبي..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">البريد الإلكتروني (Email Address)</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="doctor@clinic.com"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">رقم الهاتف الأساسي *</label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    required
                    placeholder="010xxxxxxxx"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">رقم واتساب (WhatsApp Number)</label>
                  <input
                    type="text"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="010xxxxxxxx"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">هاتف العمل (Business Phone)</label>
                  <input
                    type="text"
                    value={businessPhone}
                    onChange={(e) => setBusinessPhone(e.target.value)}
                    placeholder="02xxxxxxxx"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">هاتف الشركة (Company Phone)</label>
                  <input
                    type="text"
                    value={companyPhone}
                    onChange={(e) => setCompanyPhone(e.target.value)}
                    placeholder="02xxxxxxxx"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-ink"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-muted mb-1">
                  رابط الملف التعريفي (Social Profile Link / LinkedIn) *
                </label>
                <input
                  type="text"
                  value={socialProfileLink}
                  onChange={(e) => setSocialProfileLink(e.target.value)}
                  required
                  placeholder="https://linkedin.com/in/... أو https://facebook.com/..."
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setActiveFormTab('business')}
                  className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600"
                >
                  التالي: بيانات المنشأة ←
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: BUSINESS & CLINIC */}
          {activeFormTab === 'business' && (
            <div className="space-y-4">
              {clientCategory === 'individual' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800">
                  <span className="font-bold">👤 عميل فردي / مستقل:</span>
                  <span className="mr-1">
                    هذا العميل مستقل ولا يرتبط بعيادة أو شركة (مثل صانع محتوى أو شخص يريد تصوير فيديوهات). يمكنك إدخال تفاصيل المشروع أو المتابعة مباشرة.
                  </span>
                </div>
              )}

              {clientCategory === 'clinic' && (
                <div className="rounded-2xl border border-line bg-surface/50 p-3.5 space-y-3">
                  <div>
                    <label className="block font-medium text-muted mb-1">
                      العيادة الطبية المرتبطة (ربط دكتور بعيادة مسجلة)
                    </label>
                    <select
                      value={companyId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCompanyId(val);
                        if (val) {
                          const selected = clinicsList.find((c) => c.id === val);
                          if (selected) {
                            setBusinessName(selected.company_name);
                            if (selected.city) setCity(selected.city);
                            if (selected.address) setClinicAddress(selected.address);
                            if (selected.phone) setBusinessPhone(selected.phone);
                            if (selected.website) setWebsite(selected.website);
                          }
                          setCreateNewEntity(false);
                        }
                      }}
                      className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                    >
                      <option value="">-- إنشاء عيادة جديدة (أدخل بياناتها أدناه) --</option>
                      {clinicsList.map((cl) => (
                        <option key={cl.id} value={cl.id}>
                          🏥 {cl.company_name} ({cl.city || 'عيادة مسجلة'})
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted mt-1">
                      💡 يمكنك اختيار عيادة مسجلة مسبقاً لربط أكثر من دكتور بنفس العيادة.
                    </p>
                  </div>

                  {!companyId && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createNewEntity}
                        onChange={(e) => setCreateNewEntity(e.target.checked)}
                        className="rounded accent-amber-500"
                      />
                      <span>حفظ كعيادة جديدة في صفحة المنشآت لربط أطباء آخرين بها مستقبلاً</span>
                    </label>
                  )}
                </div>
              )}

              {clientCategory === 'company' && (
                <div className="rounded-2xl border border-line bg-surface/50 p-3.5 space-y-3">
                  <div>
                    <label className="block font-medium text-muted mb-1">
                      الشركة أو المنشأة التجارية المرتبطة
                    </label>
                    <select
                      value={companyId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCompanyId(val);
                        if (val) {
                          const selected = generalCompaniesList.find((c) => c.id === val);
                          if (selected) {
                            setBusinessName(selected.company_name);
                            if (selected.city) setCity(selected.city);
                            if (selected.address) setClinicAddress(selected.address);
                          }
                          setCreateNewEntity(false);
                        }
                      }}
                      className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                    >
                      <option value="">-- إنشاء شركة جديدة (أدخل بياناتها أدناه) --</option>
                      {generalCompaniesList.map((comp) => (
                        <option key={comp.id} value={comp.id}>
                          🏢 {comp.company_name} ({comp.industry || 'شركة مسجلة'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {!companyId && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={createNewEntity}
                        onChange={(e) => setCreateNewEntity(e.target.checked)}
                        className="rounded accent-amber-500"
                      />
                      <span>حفظ كشركة جديدة في صفحة المنشآت لربط موظفين آخرين بها</span>
                    </label>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">
                    {clientCategory === 'clinic'
                      ? 'اسم العيادة أو المركز الطبي *'
                      : clientCategory === 'individual'
                      ? 'اسم النشاط / المشروع الفردي'
                      : 'اسم الشركة أو المؤسسة *'}
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder={
                      clientCategory === 'clinic'
                        ? 'مثال: عيادات النخبة للأسنان'
                        : clientCategory === 'individual'
                        ? 'مثال: مشروع تصوير تيك توك / صانع محتوى'
                        : 'مثال: شركة النور للاستشارات'
                    }
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">
                    {clientCategory === 'clinic' ? 'التخصص الطبي (Medical Specialty) *' : 'مجال العمل / الخدمة'}
                  </label>
                  <input
                    type="text"
                    value={medicalSpecialty}
                    onChange={(e) => setMedicalSpecialty(e.target.value)}
                    placeholder={
                      clientCategory === 'clinic'
                        ? 'أسنان، جلدية، جراحة عامة، باطنة...'
                        : 'تصوير فيديو، إنتاج، تسويق...'
                    }
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">المدينة (City)</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="القاهرة، الجيزة، الإسكندرية..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">الحي / المنطقة (District)</label>
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="المعادي، التجمع، المهندسين..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">عدد الفروع (Branch Count)</label>
                  <input
                    type="number"
                    value={branchCount}
                    onChange={(e) => setBranchCount(e.target.value)}
                    min="1"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-muted mb-1">
                  {clientCategory === 'clinic' ? 'عنوان العيادة التفصيلي' : 'العنوان أو الموقع'}
                </label>
                <input
                  type="text"
                  value={clinicAddress}
                  onChange={(e) => setClinicAddress(e.target.value)}
                  placeholder="شارع التسعين الشمالي، مجمع العيادات الطبي..."
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">الموقع الإلكتروني (Website)</label>
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">رابط خرائط جوجل (Google Maps)</label>
                  <input
                    type="url"
                    value={googleMaps}
                    onChange={(e) => setGoogleMaps(e.target.value)}
                    placeholder="https://maps.google.com/..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">إنستغرام النشاط (Instagram)</label>
                  <input
                    type="text"
                    value={businessInstagram}
                    onChange={(e) => setBusinessInstagram(e.target.value)}
                    placeholder="@username"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">فيسبوك النشاط (Facebook)</label>
                  <input
                    type="text"
                    value={businessFacebook}
                    onChange={(e) => setBusinessFacebook(e.target.value)}
                    placeholder="fb.com/..."
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  />
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setActiveFormTab('identity')}
                  className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
                >
                  ← السابق
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFormTab('pipeline')}
                  className="rounded-xl bg-amber-500 px-5 py-2 font-bold text-white shadow-sm hover:bg-amber-600"
                >
                  التالي: الحملة ومسار المبيعات ←
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: CAMPAIGN & PIPELINE */}
          {activeFormTab === 'pipeline' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">منصة المصدر الإعلاني *</label>
                  <select
                    value={sourcePlatform}
                    onChange={(e) => setSourcePlatform(e.target.value)}
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                  >
                    <option value="Meta Ads">إعلانات ميتا (Meta Ads)</option>
                    <option value="Google Ads">إعلانات جوجل (Google Ads)</option>
                    <option value="TikTok Ads">إعلانات تيك توك (TikTok)</option>
                    <option value="LinkedIn">لينكدإن (LinkedIn)</option>
                    <option value="Direct Traffic">زيارة مباشرة (Direct)</option>
                    <option value="Referral">ترشيح / إحالة (Referral)</option>
                    <option value="Organic Search">بحث طبيعي (SEO)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">معرف الإعلان (Ad ID) *</label>
                  <input
                    type="text"
                    value={adId}
                    onChange={(e) => setAdId(e.target.value)}
                    required
                    placeholder="AD-10293847"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 font-mono text-ink"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">حالة العميل (Lead Status)</label>
                  <select
                    value={leadStatus}
                    onChange={(e) => setLeadStatus(e.target.value as LeadStatus)}
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold"
                  >
                    <option value="جديد">جديد (New)</option>
                    <option value="قيد المتابعة">قيد المتابعة (In Progress)</option>
                    <option value="تم الفوز">تم الفوز / عميل (Won)</option>
                    <option value="خاسر">خاسر (Lost)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">حالة النشاط (Activity Status)</label>
                  <select
                    value={activityStatus}
                    onChange={(e) => setActivityStatus(e.target.value as ActivityStatus)}
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  >
                    <option value="معاودة الاتصال">معاودة الاتصال (Call back)</option>
                    <option value="مهتم">مهتم (Interested)</option>
                    <option value="اهتمام مستقبلي">اهتمام مستقبلي (Future Interest)</option>
                    <option value="غير مهتم">غير مهتم (Not Interested)</option>
                    <option value="اجتماع">اجتماع (Meeting)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">حالة الاجتماع (Meeting Status)</label>
                  <select
                    value={meetingStatus}
                    onChange={(e) => setMeetingStatus(e.target.value as MeetingStatus)}
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
                  >
                    <option value="محجوز">محجوز (Booked)</option>
                    <option value="لم يحضر">لم يحضر (No show)</option>
                    <option value="حضر">حضر (Show up)</option>
                    <option value="ملغي">ملغي (Cancelled)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-muted mb-1">مسؤول المبيعات (Contact Owner)</label>
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
                <div>
                  <label className="block font-medium text-muted mb-1">تاريخ ووقت الاجتماع (Meeting Date)</label>
                  <input
                    type="datetime-local"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-muted mb-1">تاريخ المتابعة (Follow-up Date)</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => setActiveFormTab('business')}
                  className="rounded-xl border border-line px-4 py-2 text-muted hover:bg-surface/80"
                >
                  ← السابق
                </button>
                <div className="flex gap-2">
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
                    className="rounded-xl bg-amber-500 px-6 py-2.5 font-bold text-white shadow-md hover:bg-amber-600 transition"
                  >
                    {submitting ? 'جاري الحفظ...' : contact ? 'حفظ التعديلات' : 'إنشاء وحفظ العميل'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
