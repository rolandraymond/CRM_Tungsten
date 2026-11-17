import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import Preferences from '../../components/Preferences';
import ChoiceSelect from '../../components/ChoiceSelect';
import {
  Building2,
  UserPlus,
  ShieldCheck,
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
  UserCheck,
} from 'lucide-react';

type Company = {
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
  is_active: boolean;
};

type Membership = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'company_owner' | 'company_manager' | 'sales' | 'owner' | 'manager';
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

type CompaniesSetupData = {
  data: {
    companies: Company[];
    all_companies: Company[];
    workspaces: Workspace[];
    memberships: Membership[];
    users: UserItem[];
    services: ServiceItem[];
  };
};

const ROLE_LABELS: Record<string, string> = {
  company_owner: 'مالك الشركة (Owner - وصول وإدارة كاملة)',
  company_manager: 'مدير الشركة (Manager - إدارة الفريق والصفقات)',
  sales: 'مسؤول مبيعات (Sales - رؤية العملاء والصفقات)',
  owner: 'مالك الشركة (Owner)',
  manager: 'مدير العمليات (Operations Manager)',
};

export default function CompanyAccountsSetupPage({ token }: { token: string }) {
  const query = useGet<CompaniesSetupData>('/api/admin/companies-setup', token);
  const data = query.data?.data;

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const lock = useRef(false);

  // New employee form state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'company_owner' | 'company_manager' | 'sales'>('company_owner');

  // New service form state
  const [serviceName, setServiceName] = useState('');

  // Selected company
  const company =
    data?.companies.find(c => c.id === selectedCompanyId) ||
    data?.companies[0] ||
    null;

  // Find workspace for this company
  const companyWorkspace = data?.workspaces.find(
    w => w.name === company?.company_name || w.id === company?.workspace_id
  );

  // Members for this company workspace
  const companyMemberships = companyWorkspace
    ? (data?.memberships.filter(m => m.workspace_id === companyWorkspace.id) || [])
    : [];

  const userMap = new Map((data?.users || []).map(u => [u.id, u]));

  // Auto-clear notices
  const showNotice = (type: 'success' | 'error', message: string) => {
    setNotice({ type, message });
    setTimeout(() => setNotice(null), 6000);
  };

  // Add new employee / user to company
  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (!company) {
      showNotice('error', 'يرجى اختيار شركة أولاً');
      return;
    }
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setNotice(null);

    try {
      const res = await fetch('/api/admin/companies-setup/users', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_id: company.id,
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

      showNotice('success', `تم إنشاء الحساب بنجاح وتعيين الصلاحية (${ROLE_LABELS[role] || role})`);
      setFullName('');
      setEmail('');
      setPassword('');
      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'تعذر إضافة الموظف للشركة');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Update membership role or active status
  async function handleUpdateMembership(workspaceId: string, userId: string, newRole: any, isActive: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/companies-setup/membership', {
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

  // Remove member from company workspace
  async function handleRemoveMember(workspaceId: string, userId: string) {
    if (!window.confirm('هل أنت متأكد من إزالة هذا الموظف من الشركة؟')) return;
    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/companies-setup/membership', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspace_id: workspaceId, user_id: userId }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'فشل إزالة الموظف');
      }

      showNotice('success', 'تمت إزالة الموظف بنجاح');
      query.retry();
    } catch (err: any) {
      showNotice('error', err.message || 'تعذر إزالة الموظف');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Add custom service for company
  async function handleAddService(e: React.FormEvent) {
    e.preventDefault();
    const name = serviceName.trim();
    if (!name) return;

    if (lock.current) return;
    lock.current = true;
    setBusy(true);

    try {
      const res = await fetch('/api/admin/companies-setup/services', {
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

      showNotice('success', `تمت إضافة خدمة "${name}" إلى دليل خدمات الشركات بنجاح`);
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

            <span className="rounded-xl px-3 py-1.5 text-xs font-bold bg-amber-500 text-white shadow-sm flex items-center gap-1.5">
              <Building2 size={14} />
              <span>حسابات وموظفي الشركات</span>
            </span>

            <Link
              to="/admin/individuals-setup"
              className="rounded-xl px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface hover:text-ink transition flex items-center gap-1.5"
            >
              <UserCheck size={14} />
              <span>حسابات وموظفي الأفراد</span>
            </Link>

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
              <Building2 className="text-amber-500" size={28} />
              <span>إدارة حسابات وموظفي الشركات</span>
            </h1>
            <p className="text-sm text-muted mt-1">
              إدارة الشركات التجارية، إنشاء حسابات الموظفين والمدراء، تعيين الصلاحيات، وتخصيص الباقات والخدمات
            </p>
          </div>

          <Link
            to="/crm/companies"
            className="control text-xs font-bold text-amber-600 hover:text-amber-700 bg-amber-500/10 border-amber-500/30 flex items-center gap-1.5"
          >
            <Plus size={14} />
            <span>+ إضافة شركة جديدة من صفحة الشركات</span>
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
        ) : data.companies.length === 0 ? (
          <div className="glass p-12 text-center rounded-2xl">
            <Building2 className="mx-auto text-muted mb-3" size={48} />
            <h3 className="text-lg font-bold text-ink mb-1">لا توجد شركات تجارية مسجلة حتى الآن</h3>
            <p className="text-sm text-muted mb-4">
              يمكنك إضافة شركة تجارية جديدة من صفحة الشركات والعيادات للبدء في إدارة حساباتها وموظفيها
            </p>
            <Link to="/crm/companies" className="control bg-amber-500! text-white! font-bold inline-flex items-center gap-2">
              <Plus size={16} />
              <span>إضافة شركة جديدة الآن</span>
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-12">
            {/* Top Bar: Company Selector Card */}
            <div className="lg:col-span-12 glass p-5 rounded-2xl shadow-sm border border-line">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-64 flex-1">
                  <ChoiceSelect
                    label="اختر الشركة لإدارة حساباتها وموظفيها:"
                    value={company?.id || ''}
                    disabled={busy}
                    onChange={setSelectedCompanyId}
                    options={data.companies.map(c => ({
                      value: c.id,
                      label: `${c.company_name} ${c.city ? `(${c.city})` : ''} ${c.industry ? `• ${c.industry}` : ''}`,
                    }))}
                  />
                </div>

                {company && (
                  <div className="flex flex-wrap items-center gap-3 text-xs bg-surface/60 rounded-xl p-3 border border-line">
                    <span className="font-bold text-ink flex items-center gap-1.5">
                      <Briefcase size={14} className="text-amber-500" />
                      <span>{company.company_name}</span>
                    </span>
                    {company.industry && (
                      <span className="text-muted">النشاط: {company.industry}</span>
                    )}
                    {company.phone && (
                      <span className="text-muted" dir="ltr">{company.phone}</span>
                    )}
                    {company.city && (
                      <span className="text-muted">المدينة: {company.city}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Left Column: Accounts & Staff for Company (7 cols) */}
            <div className="lg:col-span-7 grid gap-6">
              {/* Form to Add Employee / User */}
              <section className="glass p-5 rounded-2xl shadow-sm border border-line">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
                    <UserPlus className="text-amber-500" size={20} />
                    <span>إضافة موظف / حساب جديد للشركة</span>
                  </h2>
                  <span className="text-xs text-muted">
                    {company?.company_name}
                  </span>
                </div>

                <form onSubmit={handleAddEmployee}>
                  <fieldset disabled={busy} className="grid gap-3.5">
                    <div>
                      <label className="text-xs font-bold text-ink block mb-1">
                        اسم الموظف / ممثل الشركة:
                      </label>
                      <input
                        className="field w-full text-xs"
                        required
                        placeholder="مثال: م. أحمد رضوان"
                        value={fullName}
                        onChange={e => setFullName(e.target.value)}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold text-ink block mb-1">
                          البريد الإلكتروني (لتسجيل الدخول):
                        </label>
                        <input
                          type="email"
                          className="field w-full text-xs"
                          required
                          dir="ltr"
                          placeholder="employee@company.com"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold text-ink block mb-1">
                          كلمة المرور:
                        </label>
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
                    </div>

                    <div>
                      <ChoiceSelect
                        label="الصلاحية والدور في الشركة:"
                        value={role}
                        disabled={busy}
                        onChange={v => setRole(v as any)}
                        options={[
                          { value: 'company_owner', label: ROLE_LABELS.company_owner },
                          { value: 'company_manager', label: ROLE_LABELS.company_manager },
                          { value: 'sales', label: ROLE_LABELS.sales },
                        ]}
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={busy || !fullName.trim() || !email.trim() || !password}
                      className="control justify-center bg-amber-500! text-white! font-bold text-xs py-2.5 mt-2 flex items-center gap-1.5 shadow-sm hover:bg-amber-600 transition"
                    >
                      <UserPlus size={16} />
                      <span>+ إنشاء الحساب وربطه بالشركة فوراً</span>
                    </button>
                  </fieldset>
                </form>
              </section>

              {/* List of Existing Accounts & Members */}
              <section className="glass p-5 rounded-2xl shadow-sm border border-line">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
                    <ShieldCheck className="text-amber-500" size={20} />
                    <span>حسابات وموظفي الشركة الحاليين ({companyMemberships.length})</span>
                  </h2>
                </div>

                {companyMemberships.length === 0 ? (
                  <p className="text-sm text-muted text-center py-6">
                    لا يوجد موظفون أو حسابات مرتبطة بهذه الشركة حتى الآن. استخدم النموذج أعلاه لإنشاء حساب جديد.
                  </p>
                ) : (
                  <div className="grid gap-3">
                    {companyMemberships.map(mem => {
                      const u = userMap.get(mem.user_id);
                      return (
                        <div
                          key={mem.id || mem.user_id}
                          className="rounded-xl border border-line bg-surface/70 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs"
                        >
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-ink">
                              {u?.full_name || 'موظف في الشركة'}
                            </h4>
                            <p className="text-xs text-muted font-mono" dir="ltr">
                              {u?.email || mem.user_id}
                            </p>
                            <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-700 border border-amber-500/20">
                              {ROLE_LABELS[mem.role] || mem.role}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Role selector */}
                            <select
                              className="field text-xs py-1 px-2"
                              disabled={busy}
                              value={mem.role}
                              onChange={e =>
                                handleUpdateMembership(
                                  mem.workspace_id,
                                  mem.user_id,
                                  e.target.value as any,
                                  mem.is_active
                                )
                              }
                            >
                              <option value="company_owner">مالك الشركة</option>
                              <option value="company_manager">مدير الشركة</option>
                              <option value="sales">مسؤول مبيعات</option>
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
                              title="إزالة الموظف"
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

            {/* Right Column: Services & Packages for Company (5 cols) */}
            <div className="lg:col-span-5 grid gap-6">
              {/* Services Management */}
              <section className="glass p-5 rounded-2xl shadow-sm border border-line">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <h2 className="text-lg font-bold flex items-center gap-2 text-ink">
                    <Layers className="text-amber-500" size={20} />
                    <span>باقات وخدمات الشركات</span>
                  </h2>
                </div>

                <p className="text-xs text-muted mb-4">
                  الخدمات والباقات الرقمية المفعلة في النظام التي يمكن تقديمها لعملاء الشركات:
                </p>

                <div className="grid gap-2 max-h-72 overflow-y-auto mb-5 pe-1">
                  {data.services.map(srv => (
                    <div
                      key={srv.id}
                      className="rounded-xl border border-line bg-surface/50 p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-ink block">{srv.service_name}</span>
                        <span className="text-[10px] text-muted font-mono">{srv.service_code}</span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-700">
                        متاح للتعاقد
                      </span>
                    </div>
                  ))}
                </div>

                {/* Form to add custom service */}
                <form onSubmit={handleAddService} className="pt-3 border-t border-line">
                  <label className="text-xs font-bold text-ink block mb-1">
                    إضافة خدمة أو باقة مخصصة جديدة:
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="field flex-1 text-xs"
                      required
                      placeholder="مثال: باقة التسويق الرقمي وإدارة السوشيال ميديا"
                      value={serviceName}
                      onChange={e => setServiceName(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={busy || !serviceName.trim()}
                      className="control bg-amber-500! text-white! font-bold text-xs shrink-0"
                    >
                      + إضافة
                    </button>
                  </div>
                </form>
              </section>

              {/* Company Info Summary */}
              {company && (
                <section className="glass p-5 rounded-2xl shadow-sm border border-line text-xs">
                  <h3 className="text-sm font-bold text-ink mb-3 pb-2 border-b border-line flex items-center gap-2">
                    <Briefcase size={16} className="text-amber-500" />
                    <span>ملخص بيانات الشركة</span>
                  </h3>
                  <div className="grid gap-2">
                    <div className="flex justify-between">
                      <span className="text-muted">الاسم:</span>
                      <span className="font-bold text-ink">{company.company_name}</span>
                    </div>
                    {company.industry && (
                      <div className="flex justify-between">
                        <span className="text-muted">المجال / النشاط:</span>
                        <span className="font-medium text-ink">{company.industry}</span>
                      </div>
                    )}
                    {company.phone && (
                      <div className="flex justify-between">
                        <span className="text-muted">الهاتف:</span>
                        <span className="font-mono text-ink" dir="ltr">{company.phone}</span>
                      </div>
                    )}
                    {company.city && (
                      <div className="flex justify-between">
                        <span className="text-muted">المدينة:</span>
                        <span className="text-ink">{company.city}</span>
                      </div>
                    )}
                    {company.address && (
                      <div className="flex justify-between">
                        <span className="text-muted">العنوان:</span>
                        <span className="text-ink">{company.address}</span>
                      </div>
                    )}
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
