import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import Preferences from '../../components/Preferences';
import ChoiceSelect from '../../components/ChoiceSelect';
import {
  UserCheck,
  UserPlus,
  CheckCircle2,
  XCircle,
  Briefcase,
  Layers,
  ArrowRight,
  Plus,
  Trash2,
  RefreshCw,
  Users,
  Stethoscope,
  Building2,
  ShieldCheck,
  Phone,
} from 'lucide-react';

type BrandEntity = {
  id: string;
  company_name: string;
  industry: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  company_owner_id: string | null;
  workspace_id?: string | null;
};

type Workspace = {
  id: string;
  name: string;
  workspace_type: string;
  domain: string | null;
  is_active: boolean;
};

type Membership = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  is_active: boolean;
};

type BrandService = {
  brand_id: string;
  service_id: string;
  is_active: boolean;
};

type UserItem = {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
};

type ServiceItem = {
  id: string;
  service_name: string;
  service_code: string;
  is_active: boolean;
};

type BrandsSetupData = {
  data: {
    brands: BrandEntity[];
    workspaces: Workspace[];
    memberships: Membership[];
    brand_services: BrandService[];
    services: ServiceItem[];
    users: UserItem[];
  };
};

const BRAND_ROLES = [
  { value: 'brand_owner', label: 'مالك البراند (Brand Owner - وصول وإدارة كاملة)' },
  { value: 'brand_manager', label: 'مدير البراند (Brand Manager - إدارة ومتابعة العمليات)' },
  { value: 'content_creator', label: 'صانع محتوى / المتحدث (Content Creator - مقابل الطبيب)' },
  { value: 'videographer_editor', label: 'مصور ومونتير (Videographer & Editor - إنتاج المحتوى)' },
  { value: 'customer_service', label: 'خدمة عملاء ومتابعة (Customer Service & Leads)' },
  { value: 'sales', label: 'مسؤول مبيعات البراند (Brand Sales Rep)' },
  { value: 'moderator', label: 'منسق عام (Brand Moderator)' },
] as const;

const BRAND_ROLE_LABELS: Record<string, string> = {
  brand_owner: 'مالك البراند (Brand Owner)',
  brand_manager: 'مدير البراند (Brand Manager)',
  content_creator: 'صانع محتوى / المتحدث (Talent)',
  videographer_editor: 'مصور ومونتير (Video Editor)',
  customer_service: 'خدمة عملاء ومتابعة (Customer Service)',
  sales: 'مسؤول مبيعات (Sales Rep)',
  moderator: 'منسق عام (Moderator)',
  owner: 'مالك البراند (Brand Owner)',
  manager: 'مدير العمليات (Operations Manager)',
};

export default function IndividualAccountsSetupPage({ token }: { token: string }) {
  const query = useGet<BrandsSetupData>('/api/admin/individuals-setup', token);
  const data = query.data?.data;

  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const lock = useRef(false);

  // New staff form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<string>('brand_owner');

  // New service form state
  const [serviceName, setServiceName] = useState('');

  // Selected brand
  const brand =
    data?.brands.find(b => b.id === selectedBrandId) ||
    data?.brands[0] ||
    null;

  // Workspace for selected brand
  const brandWorkspace = data?.workspaces.find(
    w => w.id === brand?.workspace_id || w.name === brand?.company_name
  );

  // Memberships for selected brand's workspace
  const brandMemberships = brandWorkspace
    ? (data?.memberships.filter(m => m.workspace_id === brandWorkspace.id) || [])
    : [];

  // Active services map for selected brand
  const activeServiceIds = new Set(
    (data?.brand_services || [])
      .filter(bs => bs.brand_id === brand?.id && bs.is_active)
      .map(bs => bs.service_id)
  );

  const userMap = new Map((data?.users || []).map(u => [u.id, u]));

  // Brand Owner user
  const brandOwnerMember = brandMemberships.find(m => m.role === 'brand_owner' || m.role === 'owner');
  const brandOwnerUser = brandOwnerMember ? userMap.get(brandOwnerMember.user_id) : (brand?.company_owner_id ? userMap.get(brand.company_owner_id) : null);

  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 6000);
  };

  // Add team member or owner to brand
  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!brand) {
      showNotice('error', 'يرجى اختيار براند أولاً');
      return;
    }
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setNotice(null);

    try {
      const res = await fetch('/api/admin/individuals-setup/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: brand.id,
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          password,
          role,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'فشل إنشاء الحساب');
      }

      showNotice('success', `تم إنشاء الحساب بنجاح وتعيينه للبراند كـ (${BRAND_ROLE_LABELS[role] || role})`);
      setFullName('');
      setEmail('');
      setPassword('');
      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'تعذر إضافة الموظف للبراند');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Update membership role or active state
  async function handleUpdateMembership(workspaceId: string, userId: string, newRole: string, isActive: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/individuals-setup/membership', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          user_id: userId,
          role: newRole,
          is_active: isActive,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'فشل تحديث الصلاحية');
      }

      showNotice('success', 'تم حفظ التعديلات بنجاح');
      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'حدث خطأ أثناء الحفظ');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Remove member from brand
  async function handleRemoveMember(workspaceId: string, userId: string) {
    if (!window.confirm('هل أنت متأكد من إزالة هذا العضو من فريق البراند؟')) return;
    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/individuals-setup/membership', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace_id: workspaceId, user_id: userId }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'فشل إزالة العضو');
      }

      showNotice('success', 'تمت إزالة العضو بنجاح');
      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'تعذر إزالة العضو');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Toggle service for brand (equivalent to clinic_services)
  async function handleToggleService(serviceId: string, currentActive: boolean) {
    if (!brand) return;
    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/individuals-setup/services/assign', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: brand.id,
          service_id: serviceId,
          is_active: !currentActive,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'فشل تحديث الخدمة');
      }

      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'تعذر تحديث حالة الخدمة للبراند');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Add custom service to catalog
  async function handleAddService(e: React.FormEvent) {
    e.preventDefault();
    const name = serviceName.trim();
    if (!name) return;

    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/individuals-setup/services', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ service_name: name }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'فشل إضافة الخدمة');
      }

      showNotice('success', `تمت إضافة خدمة "${name}" إلى دليل خدمات البراند بنجاح`);
      setServiceName('');
      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'تعذر إضافة الخدمة');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="page-backdrop min-h-dvh p-4 sm:p-8" dir="rtl">
      <div className="mx-auto max-w-6xl">
        {/* Navigation Bar */}
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/crm/dashboard"
              className="control flex items-center gap-1.5 text-xs font-bold bg-surface hover:bg-surface/80"
            >
              <ArrowRight size={14} />
              <span>العودة للوحة التحكم (CRM)</span>
            </Link>

            {/* Quick Switcher Tabs */}
            <Link
              to="/admin/setup"
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink transition flex items-center gap-1.5"
            >
              <Stethoscope size={14} />
              <span>العملاء والخدمات (العيادات)</span>
            </Link>

            <Link
              to="/admin/companies-setup"
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink transition flex items-center gap-1.5"
            >
              <Building2 size={14} />
              <span>حسابات وموظفي الشركات</span>
            </Link>

            <span className="rounded-xl px-3 py-1.5 text-xs font-bold bg-amber-500 text-white shadow-sm flex items-center gap-1.5">
              <UserCheck size={14} />
              <span>حسابات وخدمات البراندات الشخصية</span>
            </span>

            <Link
              to="/admin/team"
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink transition flex items-center gap-1.5"
            >
              <Users size={14} />
              <span>فريق عمل العيادات</span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="control flex items-center gap-1.5 text-xs font-bold"
              disabled={busy || query.loading}
              onClick={() => query.retry()}
              title="تحديث البيانات"
            >
              <RefreshCw size={14} className={query.loading ? 'animate-spin' : ''} />
              <span>تحديث</span>
            </button>
            <Preferences />
          </div>
        </header>

        {/* Page Title & Overview */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2 text-ink">
              <UserCheck className="text-amber-500" size={28} />
              <span>إدارة حسابات وخدمات وفريق عمل البراندات الشخصية</span>
            </h1>
            <p className="text-sm text-muted mt-1">
              نفس استراتيجية ونظام العيادات: إنشاء حساب لصاحب البراند، تخصيص وتفعيل الخدمات، وإضافة حسابات وصلاحيات فريق العمل لكل براند
            </p>
          </div>

          <Link
            to="/crm/companies"
            className="control text-xs font-bold text-amber-600 hover:text-amber-700 bg-amber-500/10 border-amber-500/30 flex items-center gap-1.5"
          >
            <Plus size={14} />
            <span>+ إضافة براند شخصي جديد</span>
          </Link>
        </div>

        {notice && (
          <div
            className={`mb-6 rounded-2xl p-4 text-sm font-medium flex items-center gap-2 shadow-sm ${
              notice.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-700 border border-rose-500/20'
            }`}
            role="status"
          >
            {notice.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <span>{notice.message}</span>
          </div>
        )}

        {!data ? (
          <QueryState error={query.error} retry={query.retry} />
        ) : (data.brands || []).length === 0 ? (
          <div className="glass p-12 text-center rounded-2xl">
            <UserCheck className="mx-auto text-muted mb-3" size={48} />
            <h3 className="text-lg font-bold text-ink mb-1">لا يوجد براندات مسجلة حتى الآن</h3>
            <p className="text-sm text-muted mb-4">
              يمكنك إضافة براند شخصي جديد من قسم "الشركات والعيادات" لتتمكن من إنشاء حسابه وإضافة فريقه وتخصيص خدماته
            </p>
            <Link to="/crm/companies" className="control bg-amber-500! text-white! font-bold inline-flex items-center gap-2">
              <Plus size={16} />
              <span>إضافة براند جديد الآن</span>
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Top Bar: Brand Selector */}
            <div className="lg:col-span-12 glass p-5 rounded-2xl shadow-sm border border-line">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-64 flex-1">
                  <ChoiceSelect
                    label="اختر البراند لإدارة حسابه وخدماته وفريق عمله:"
                    value={brand?.id || ''}
                    disabled={busy}
                    onChange={setSelectedBrandId}
                    options={data.brands.map(b => ({
                      value: b.id,
                      label: `${b.company_name} ${b.city ? `(${b.city})` : ''} • الحالة: نشط`,
                    }))}
                  />
                </div>

                {brand && (
                  <div className="flex flex-wrap items-center gap-3 text-xs bg-surface/60 rounded-xl p-3 border border-line">
                    <span className="font-bold text-ink flex items-center gap-1.5">
                      <UserCheck size={14} className="text-amber-500" />
                      <span>{brand.company_name}</span>
                    </span>
                    {brand.phone && (
                      <span className="text-muted flex items-center gap-1" dir="ltr">
                        <Phone size={12} />
                        <span>{brand.phone}</span>
                      </span>
                    )}
                    <span className="font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      مساحة العمل: {brandWorkspace?.name || brand.company_name}
                    </span>
                    <span className="text-muted">
                      الأعضاء: {brandMemberships.length} عضو
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Left Column: Brand Owner Account & Brand Team Staff (7 cols) */}
            <div className="lg:col-span-7 grid gap-6">
              {/* Card 1: Brand Owner Account Status */}
              <section className="glass p-5 rounded-2xl shadow-sm border border-line">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
                    <ShieldCheck className="text-amber-500" size={20} />
                    <span>حساب صاحب البراند (Brand Owner)</span>
                  </h2>
                  <span className="text-xs text-muted">{brand?.company_name}</span>
                </div>

                {brandOwnerUser ? (
                  <div className="rounded-xl border border-line bg-surface/60 p-4">
                    <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs mb-1">
                      <CheckCircle2 size={16} />
                      <span>تم تفعيل حساب مالك البراند:</span>
                    </div>
                    <p className="font-mono text-xs text-ink ps-6 font-bold" dir="ltr">
                      {brandOwnerUser.email}
                    </p>
                    <p className="text-[11px] text-muted ps-6 mt-1">
                      الاسم: {brandOwnerUser.full_name} · يمتلك وصولاً كاملاً لإدارة مساحة عمل البراند وفريقه وعملائه.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-4">
                    <div className="flex items-center gap-2 text-amber-700 font-bold text-xs mb-1">
                      <UserPlus size={16} />
                      <span>صاحب هذا البراند لا يمتلك حساب دخول مسجل حتى الآن</span>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      يمكنك إنشاء وتفعيل حساب مالك البراند مباشرة من خلال النموذج أدناه باختيار دور "مالك البراند".
                    </p>
                  </div>
                )}
              </section>

              {/* Card 2: Brand Team Accounts & Memberships (Identical to Clinic/Company Team) */}
              <section className="glass p-5 rounded-2xl shadow-sm border border-line">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
                    <Users className="text-amber-500" size={20} />
                    <span>فريق عمل وموظفي البراند ({brandMemberships.length})</span>
                  </h2>
                  <span className="text-xs text-muted">صلاحيات وهيكل الفريق</span>
                </div>

                {/* Form to Add New Member to Brand Team */}
                <form onSubmit={handleAddMember} className="mb-6 rounded-xl border border-line bg-surface/60 p-4">
                  <h3 className="text-xs font-bold text-ink mb-3 flex items-center gap-1.5">
                    <UserPlus size={15} className="text-amber-500" />
                    <span>إضافة عضو جديد لفريق البراند (صاحب البراند، صانع محتوى، مونتير، متابعة)</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs font-bold text-ink block mb-1">الاسم بالكامل *</label>
                      <input
                        type="text"
                        className="field w-full text-xs"
                        required
                        placeholder="مثال: د. حسام (صانع المحتوى)"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-ink block mb-1">البريد الإلكتروني *</label>
                      <input
                        type="email"
                        className="field w-full text-xs"
                        required
                        dir="ltr"
                        placeholder="member@brand.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-ink block mb-1">كلمة المرور المؤقتة *</label>
                      <input
                        type="password"
                        className="field w-full text-xs"
                        required
                        minLength={8}
                        dir="ltr"
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-ink block mb-1">الدور والصلاحية *</label>
                      <select
                        className="field w-full text-xs font-bold text-amber-600"
                        value={role}
                        onChange={e => setRole(e.target.value)}
                      >
                        {BRAND_ROLES.map(r => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={busy || !fullName.trim() || !email.trim() || !password}
                      className="control bg-amber-500! text-white! font-bold text-xs py-2 px-4 shadow-sm"
                    >
                      + إضافة العضو لفريق البراند
                    </button>
                  </div>
                </form>

                {/* Team Members List */}
                <h3 className="text-xs font-bold text-ink mb-2">أعضاء وموظفي البراند الحاليين:</h3>
                {brandMemberships.length === 0 ? (
                  <p className="text-xs text-muted text-center py-6 border border-dashed border-line rounded-xl">
                    لا يوجد أعضاء مضافين لهذا البراند حتى الآن. استخدم النموذج أعلاه لإضافة صاحب البراند وموظفيه.
                  </p>
                ) : (
                  <div className="grid gap-2.5">
                    {brandMemberships.map(mem => {
                      const u = userMap.get(mem.user_id);
                      return (
                        <div
                          key={mem.id || mem.user_id}
                          className="rounded-xl border border-line bg-surface/70 p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-ink block">
                              {u?.full_name || 'عضو الفريق'}
                            </span>
                            <span className="text-[11px] text-muted font-mono" dir="ltr">
                              {u?.email || mem.user_id}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Role selector dropdown */}
                            <select
                              className="field text-xs py-1 px-2 font-bold text-amber-600"
                              disabled={busy}
                              value={mem.role}
                              onChange={e =>
                                handleUpdateMembership(
                                  mem.workspace_id,
                                  mem.user_id,
                                  e.target.value,
                                  mem.is_active
                                )
                              }
                            >
                              {BRAND_ROLES.map(r => (
                                <option key={r.value} value={r.value}>
                                  {r.label.split(' - ')[0]}
                                </option>
                              ))}
                            </select>

                            {/* Active switch */}
                            <label className="flex items-center gap-1 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={mem.is_active}
                                disabled={busy}
                                onChange={e =>
                                  handleUpdateMembership(
                                    mem.workspace_id,
                                    mem.user_id,
                                    mem.role,
                                    e.target.checked
                                  )
                                }
                              />
                              <span className={mem.is_active ? 'text-emerald-600 font-bold' : 'text-muted'}>
                                {mem.is_active ? 'نشط' : 'معطل'}
                              </span>
                            </label>

                            <button
                              type="button"
                              className="control text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5"
                              disabled={busy}
                              onClick={() => handleRemoveMember(mem.workspace_id, mem.user_id)}
                              title="إزالة العضو"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Right Column: Brand Services & Catalog (5 cols - like Clinic Services) */}
            <div className="lg:col-span-5 grid gap-6">
              {/* Services Management (Identical to Clinic Services in /admin/setup) */}
              <section className="glass p-5 rounded-2xl shadow-sm border border-line">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
                    <Layers className="text-amber-500" size={20} />
                    <span>خدمات وباقات البراند ({activeServiceIds.size})</span>
                  </h2>
                </div>

                <p className="text-xs text-muted mb-3">
                  حدد الخدمات المتاحة لهذا البراند أو أضف خدمات جديدة (مثل نظام خدمات العيادات تماماً):
                </p>

                <div className="grid gap-2 max-h-72 overflow-y-auto mb-4 pe-1">
                  {(data.services || []).map(srv => {
                    const isActiveForBrand = activeServiceIds.has(srv.id);
                    return (
                      <div
                        key={srv.id}
                        className={`rounded-xl border p-2.5 flex items-center justify-between gap-2 transition ${
                          isActiveForBrand
                            ? 'border-amber-500/40 bg-amber-500/5'
                            : 'border-line bg-surface/40 opacity-75'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-ink block">{srv.service_name}</span>
                          <span className="text-[10px] text-muted font-mono">{srv.service_code}</span>
                        </div>

                        <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={isActiveForBrand}
                            disabled={busy}
                            onChange={() => handleToggleService(srv.id, isActiveForBrand)}
                            className="rounded text-amber-500"
                          />
                          <span className={isActiveForBrand ? 'text-amber-700 font-bold' : 'text-muted'}>
                            {isActiveForBrand ? 'مفعلة' : 'غير مفعلة'}
                          </span>
                        </label>
                      </div>
                    );
                  })}
                </div>

                {/* Form to add custom service */}
                <form onSubmit={handleAddService} className="pt-3 border-t border-line">
                  <label className="text-xs font-bold text-ink block mb-1">
                    إضافة خدمة أو باقة جديدة للدليل:
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="field flex-1 text-xs"
                      required
                      placeholder="مثال: باقة تصوير 10 فيديوهات ريلز ومونتاج"
                      value={serviceName}
                      onChange={e => setServiceName(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={busy || !serviceName.trim()}
                      className="control bg-amber-500! text-white! font-bold text-xs shrink-0"
                    >
                      + إضافة خدمة
                    </button>
                  </div>
                </form>
              </section>

              {/* Brand Overview Card */}
              {brand && (
                <section className="glass p-5 rounded-2xl shadow-sm border border-line text-xs">
                  <h3 className="text-sm font-bold text-ink mb-3 pb-2 border-b border-line flex items-center gap-2">
                    <Briefcase size={16} className="text-amber-500" />
                    <span>ملخص بيانات البراند</span>
                  </h3>
                  <div className="grid gap-2">
                    <div className="flex justify-between">
                      <span className="text-muted">اسم البراند:</span>
                      <span className="font-bold text-ink">{brand.company_name}</span>
                    </div>
                    {brand.phone && (
                      <div className="flex justify-between">
                        <span className="text-muted">الهاتف:</span>
                        <span className="font-mono text-ink" dir="ltr">{brand.phone}</span>
                      </div>
                    )}
                    {brand.city && (
                      <div className="flex justify-between">
                        <span className="text-muted">المدينة:</span>
                        <span className="text-ink">{brand.city}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted">مساحة العمل:</span>
                      <span className="font-mono text-ink">{brandWorkspace?.domain || 'client_brand'}</span>
                    </div>
                    <div className="pt-2 border-t border-line flex justify-end">
                      <Link
                        to="/crm/companies"
                        className="text-xs font-bold text-amber-600 hover:text-amber-700 inline-flex items-center gap-1"
                      >
                        <span>إدارة المنشآت والبراندات في CRM</span>
                        <ArrowRight size={13} className="rotate-180" />
                      </Link>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
