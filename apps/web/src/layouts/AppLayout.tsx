import { useState } from 'react';
import type { AuthSession as Session } from '../lib/auth-client';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LogOut,
  LayoutDashboard,
  Users,
  Building2,
  CheckSquare,
  Calendar,
  Clock,
  ShieldCheck,
  Shield,
  BarChart3,
  MessageSquare,
  CalendarDays,
  Wrench,
  AlertTriangle,
  Lock,
  UserCheck,
  Award,
  Sparkles,
} from 'lucide-react';

import { authClient } from '../lib/auth-client';
import { useGet } from '../hooks/useGet';
import type {
  Clinic,
  WorkspaceContext,
} from '../features/leads/types';
import { useCrm } from '../features/crm/CrmContext';

import Brand from '../components/Brand';
import Preferences from '../components/Preferences';
import NotificationBell from '../components/NotificationBell';
import QueryState from '../components/QueryState';
import ChoiceSelect from '../components/ChoiceSelect';

export default function AppLayout({
  session,
  isAdmin,
  isClinicUser = false,
}: {
  session: Session;
  isAdmin: boolean;
  isClinicUser?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const location = useLocation();

  const token = session.access_token;

  const me = useGet<{
    user: { id: string; email: string | null };
  }>('/api/auth/me', token);

  const clinics = useGet<{ data: Clinic[] }>(
    me.data ? '/api/clinics' : null,
    token,
  );

  const adminStatus = useGet<{
    is_admin: boolean;
    is_owner: boolean;
    is_manager: boolean;
    is_sales: boolean;
    is_company_owner?: boolean;
    is_company_manager?: boolean;
    is_client_company?: boolean;
    is_brand_owner?: boolean;
    is_brand_manager?: boolean;
    is_client_brand?: boolean;
    is_clinic_user?: boolean;
    clinic_name?: string | null;
    clinic_role?: string | null;
    internal_role: string | null;
  }>(token ? '/api/admin/status' : null, token);

  const {
    activeWorkspace,
    userRole: crmUserRole,
  } = useCrm();

  const isClientBrand = Boolean(
    activeWorkspace?.workspace_type === 'client_brand' ||
    activeWorkspace?.workspace_type === 'brand' ||
    adminStatus.data?.is_client_brand ||
    adminStatus.data?.is_brand_owner ||
    adminStatus.data?.is_brand_manager ||
    crmUserRole === 'brand_owner' ||
    crmUserRole === 'brand_manager' ||
    crmUserRole === 'content_creator' ||
    crmUserRole === 'videographer_editor'
  );

  const isBrandOwner = Boolean(
    adminStatus.data?.is_brand_owner ||
    crmUserRole === 'brand_owner' ||
    (crmUserRole === 'owner' && isClientBrand)
  );

  const isBrandManager = Boolean(
    adminStatus.data?.is_brand_manager ||
    crmUserRole === 'brand_manager' ||
    (crmUserRole === 'manager' && isClientBrand)
  );

  const effectiveClinicUser = !isClientBrand && Boolean(
    isClinicUser ||
    adminStatus.data?.is_clinic_user ||
    (adminStatus.data &&
     !adminStatus.data.is_admin &&
     !adminStatus.data.is_owner &&
     !adminStatus.data.is_manager &&
     !adminStatus.data.is_sales &&
     !adminStatus.data.is_company_owner &&
     !adminStatus.data.is_company_manager &&
     !adminStatus.data.is_client_company &&
     !adminStatus.data.is_client_brand &&
     !adminStatus.data.is_brand_owner &&
     !adminStatus.data.is_brand_manager &&
     adminStatus.data.clinic_name)
  );

  const isPlatformAdmin = !effectiveClinicUser && Boolean(adminStatus.data?.is_admin);
  const isCompanyOwner = !effectiveClinicUser && !isClientBrand && Boolean(
    adminStatus.data?.is_company_owner ||
    crmUserRole === 'company_owner' ||
    (crmUserRole === 'owner' && activeWorkspace?.workspace_type === 'client_company')
  );
  const isCompanyManager = !effectiveClinicUser && !isClientBrand && Boolean(
    adminStatus.data?.is_company_manager ||
    crmUserRole === 'company_manager' ||
    (crmUserRole === 'manager' && activeWorkspace?.workspace_type === 'client_company')
  );
  const isTungstenOwner = !effectiveClinicUser && !isClientBrand && !isCompanyOwner && Boolean(
    (adminStatus.data?.is_owner || adminStatus.data?.is_admin || isAdmin) &&
    activeWorkspace?.workspace_type !== 'client_company' &&
    activeWorkspace?.workspace_type !== 'client_brand'
  );
  const isTungstenManager = !effectiveClinicUser && !isClientBrand && !isCompanyManager && Boolean(
    adminStatus.data?.is_manager &&
    activeWorkspace?.workspace_type !== 'client_company' &&
    activeWorkspace?.workspace_type !== 'client_brand'
  );
  const isSales = !effectiveClinicUser && Boolean(adminStatus.data?.is_sales || crmUserRole === 'sales');

  const isClientCompany = !effectiveClinicUser && !isClientBrand && Boolean(
    activeWorkspace?.workspace_type === 'client_company' ||
    adminStatus.data?.is_client_company ||
    isCompanyOwner ||
    isCompanyManager
  );

  const isOwner = !effectiveClinicUser && (isPlatformAdmin || isTungstenOwner || isCompanyOwner || isBrandOwner);
  const isManager = !effectiveClinicUser && (isTungstenManager || isCompanyManager || isBrandManager);
  const isCrmUser = !effectiveClinicUser && (isOwner || isManager || isSales || isClientCompany || isClientBrand || Boolean(crmUserRole));

  const canAccessSetup = isTungstenOwner || isTungstenManager || isPlatformAdmin;
  const canAccessInternalClients = isCrmUser;

  const [selectedId, setSelectedId] = useState(() => {
    try {
      return localStorage.getItem('tungsten_selected_clinic_id') || '';
    } catch {
      return '';
    }
  });
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  const handleClinicChange = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem('tungsten_selected_clinic_id', id);
    } catch {}
  };

  const clinic =
    clinics.data?.data.find(item => item.id === selectedId)
    ?? clinics.data?.data[0]
    ?? (canAccessInternalClients
      ? { id: '00000000-0000-0000-0000-000000000000', name: 'Tungsten HQ', role: 'platform_admin' as const }
      : undefined);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function signOut() {
    setBusy(true);
    setError(false);

    try {
      try {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith('tungsten_')) {
            localStorage.removeItem(key);
          }
        });
      } catch {}

      const result = await authClient.auth.signOut();
      setError(Boolean(result.error));
      window.location.href = '/login';
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const roleLabelMap: Record<string, string> = {
    owner: isClientBrand
      ? (ar ? 'مالك البراند (Brand Owner)' : 'Brand Owner')
      : isClientCompany
      ? (ar ? 'مالك الشركة (Company Owner)' : 'Company Owner')
      : (ar ? 'مالك Tungsten (Owner)' : 'Tungsten Owner'),
    manager: isClientBrand
      ? (ar ? 'مدير البراند (Brand Manager)' : 'Brand Manager')
      : isClientCompany
      ? (ar ? 'مدير الشركة (Company Manager)' : 'Company Manager')
      : (ar ? 'مدير مبيعات (Manager)' : 'Sales Manager'),
    sales: ar ? 'مسؤول مبيعات (Sales)' : 'Sales Rep',
    company_owner: ar ? 'مالك الشركة (Company Owner)' : 'Company Owner',
    company_manager: ar ? 'مدير الشركة (Company Manager)' : 'Company Manager',
    brand_owner: ar ? 'مالك البراند (Brand Owner)' : 'Brand Owner',
    brand_manager: ar ? 'مدير البراند (Brand Manager)' : 'Brand Manager',
    content_creator: ar ? 'صانع محتوى (Content Creator)' : 'Content Creator',
    videographer_editor: ar ? 'مصور ومونتير (Video Editor)' : 'Video Editor',
    customer_service: ar ? 'خدمة عملاء (Customer Service)' : 'Customer Service',
    moderator: ar ? 'مشرف / موديريتور (Moderator)' : 'Moderator',
    platform_admin: ar ? 'مالك Tungsten (Owner)' : 'Platform Admin',
  };

  const clinicRoleRaw = adminStatus.data?.clinic_role || clinic?.role;
  const clinicRoleDisplay = clinicRoleRaw === 'doctor'
    ? (ar ? 'طبيب العيادة' : 'Clinic Doctor')
    : clinicRoleRaw === 'admin'
    ? (ar ? 'مدير العيادة' : 'Clinic Manager')
    : (ar ? 'طاقم العيادة' : 'Clinic Staff');

  const currentRoleDisplay = effectiveClinicUser
    ? clinicRoleDisplay
    : isPlatformAdmin || isTungstenOwner
    ? (ar ? 'مالك Tungsten (Owner)' : 'Tungsten Owner')
    : isBrandOwner
    ? (ar ? 'مالك البراند (Brand Owner)' : 'Brand Owner')
    : isBrandManager
    ? (ar ? 'مدير البراند (Brand Manager)' : 'Brand Manager')
    : isCompanyOwner
    ? (ar ? 'مالك الشركة (Company Owner)' : 'Company Owner')
    : isCompanyManager
    ? (ar ? 'مدير الشركة (Company Manager)' : 'Company Manager')
    : isTungstenManager
    ? (ar ? 'مدير مبيعات (Manager)' : 'Sales Manager')
    : isSales
    ? (ar ? 'مسؤول مبيعات (Sales)' : 'Sales Rep')
    : (crmUserRole ? roleLabelMap[crmUserRole] || crmUserRole : '');

  // Master definition of Top Navigation Tabs
  type RoleType = 'owner' | 'manager' | 'sales' | 'company_owner' | 'company_manager' | 'brand_owner' | 'brand_manager' | 'clinic';
  const currentUserRoleKey: RoleType = effectiveClinicUser
    ? 'clinic'
    : isBrandOwner
    ? 'brand_owner'
    : isBrandManager
    ? 'brand_manager'
    : isCompanyOwner
    ? 'company_owner'
    : isCompanyManager
    ? 'company_manager'
    : isTungstenOwner || isPlatformAdmin
    ? 'owner'
    : isTungstenManager
    ? 'manager'
    : isSales
    ? 'sales'
    : isCrmUser
    ? (isClientBrand ? 'brand_owner' : isClientCompany ? 'company_owner' : 'owner')
    : 'clinic';

  interface NavItem {
    id: string;
    to: string;
    label: string;
    icon: any;
    exact?: boolean;
    badge?: string;
    roles: RoleType[];
  }

  // Core CRM Tabs + Context-aware role filtering
  const allNavItems: NavItem[] = [
    {
      id: 'overview',
      to: isCrmUser ? '/crm/dashboard' : '/overview',
      label: ar ? 'نظرة عامة' : 'Overview',
      icon: LayoutDashboard,
      exact: true,
      roles: ['owner', 'manager', 'company_owner', 'company_manager', 'brand_owner', 'brand_manager', 'clinic'],
    },
    {
      id: 'contacts',
      to: isCrmUser ? '/crm/contacts' : '/leads',
      label: isCrmUser
        ? (ar ? 'العملاء المحتملون (Leads Pipeline)' : 'Leads Pipeline')
        : (ar ? 'كل العملاء' : 'All Clients'),
      icon: isCrmUser ? UserCheck : Users,
      roles: ['owner', 'manager', 'company_owner', 'company_manager', 'brand_owner', 'brand_manager', 'sales', 'clinic'],
    },
    {
      id: 'companies',
      to: '/crm/companies',
      label: ar ? 'الشركات والعيادات' : 'Companies & Clinics',
      icon: Building2,
      roles: ['owner', 'manager'],
    },
    {
      id: 'deals',
      to: '/crm/deals',
      label: ar ? 'الصفقات المعتمدة (Won Deals)' : 'Won Deals',
      icon: Award,
      roles: ['owner', 'manager', 'company_owner', 'company_manager', 'brand_owner', 'brand_manager', 'sales'],
    },
    {
      id: 'activities',
      to: '/crm/activities',
      label: ar ? 'الأنشطة' : 'Activities',
      icon: CheckSquare,
      roles: ['owner', 'manager', 'company_owner', 'company_manager', 'brand_owner', 'brand_manager', 'sales'],
    },
    {
      id: 'meetings',
      to: '/crm/meetings',
      label: ar ? 'الاجتماعات' : 'Meetings',
      icon: Calendar,
      roles: ['owner', 'manager', 'company_owner', 'company_manager', 'brand_owner', 'brand_manager', 'sales'],
    },
    {
      id: 'follow-ups',
      to: '/crm/follow-ups',
      label: ar ? 'المتابعات' : 'Follow-ups',
      icon: Clock,
      roles: ['owner', 'manager', 'company_owner', 'company_manager', 'brand_owner', 'brand_manager', 'sales'],
    },
    {
      id: 'team',
      to: '/crm/team',
      label: ar ? 'إدارة الفريق' : 'Team Management',
      icon: ShieldCheck,
      roles: ['owner', 'company_owner', 'brand_owner', 'manager', 'brand_manager'],
    },
    {
      id: 'analytics',
      to: '/crm/analytics',
      label: ar ? 'التحليلات' : 'Analytics',
      icon: BarChart3,
      roles: ['owner', 'company_owner', 'brand_owner', 'manager', 'company_manager', 'brand_manager'],
    },
  ];

  // Filter tabs according to current user's role
  const visibleNavItems = allNavItems.filter((item) =>
    item.roles.includes(currentUserRoleKey)
  );

  return (
    <div className="page-backdrop min-h-dvh p-2 sm:p-4 xl:p-6" dir={ar ? 'rtl' : 'ltr'}>
      <div className="workspace-frame relative z-10 mx-auto min-h-[calc(100dvh-48px)] max-w-[1720px] rounded-3xl p-3 sm:p-6">
        {/* ========================================================================= */}
        {/* TOP HEADER: BRAND, WORKSPACE SELECTOR, USER INFO, PREFERENCES, LOGOUT */}
        {/* ========================================================================= */}
        <header className="flex flex-col gap-3 border-b border-line pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left: Brand & Badge */}
            <div className="flex items-center gap-3">
              <Brand />
              {isCrmUser && (
                <span className="hidden sm:inline-flex rounded-xl bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-bold text-amber-600 shadow-sm">
                  Tungsten CRM
                </span>
              )}
              {effectiveClinicUser && (
                <span className="hidden sm:inline-flex rounded-xl bg-purple-500/10 border border-purple-500/30 px-2.5 py-1 text-xs font-bold text-purple-600 shadow-sm">
                  {ar ? 'عيادات تنجستين' : 'Tungsten Clinics'}
                </span>
              )}
            </div>

            {/* Right: Workspace Switcher, Role Badge, Preferences, Logout */}
            <div className="flex items-center gap-3">
              {/* Workspace Indicator (Fixed per company/brand account, no unwanted switching) */}
              {isCrmUser && activeWorkspace && (
                <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink shadow-sm">
                  {isClientBrand ? (
                    <Sparkles className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
                  ) : isClientCompany ? (
                    <Building2 className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <Shield className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  )}
                  <span className="truncate max-w-[160px]">{activeWorkspace.name}</span>
                </div>
              )}

              {/* Clinic Name Indicator */}
              {effectiveClinicUser && (
                <div className="flex items-center gap-1.5 rounded-xl border border-purple-500/20 bg-purple-500/5 px-3 py-1.5 text-xs font-bold text-purple-700 shadow-sm">
                  <Building2 className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                  <span className="truncate max-w-[180px]">
                    {adminStatus.data?.clinic_name || clinic?.name || 'العيادة'}
                  </span>
                </div>
              )}

              {/* User Role Badge */}
              {currentRoleDisplay && (
                <span className="hidden lg:inline-flex rounded-xl bg-surface border border-line px-2.5 py-1 text-xs font-bold text-ink shadow-sm">
                  {currentRoleDisplay}
                </span>
              )}

              <p className="hidden xl:block max-w-[180px] truncate text-xs text-muted" dir="ltr">
                {me.data?.user.email}
              </p>

              {/* Notification Bell (Client Added & Pipeline Updates) */}
              {isCrmUser && <NotificationBell />}

              <Preferences />

              <button
                type="button"
                className="control"
                disabled={busy}
                onClick={() => void signOut()}
                aria-label={t('common.signOut')}
                title={t('common.signOut')}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* PRIMARY TOP NAVIGATION: FULLY VISIBLE WRAPPED TABS (NO HORIZONTAL SCROLL) */}
          {/* ========================================================================= */}
          <nav
            className="flex w-full flex-wrap items-center gap-1.5 py-1"
            aria-label="Main Navigation"
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isItemActive = item.exact
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to);

              return (
                <NavLink
                  key={item.id}
                  to={item.to}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                    isItemActive
                      ? 'bg-amber-500 text-white shadow-sm ring-1 ring-amber-600/30'
                      : 'text-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${
                      isItemActive ? 'text-white' : 'text-muted'
                    }`}
                  />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            {/* Preserved Clinic System Tabs (Chats & Booking Calendar & Admin) */}
            {!isClientCompany && (isOwner || !isCrmUser) && (
              <NavLink
                to="/chats"
                className={({ isActive }) =>
                  `rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-surface text-ink shadow-sm border border-line'
                      : 'text-muted hover:bg-surface hover:text-ink'
                  }`
                }
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted" />
                <span>{ar ? 'المحادثات' : 'Chats'}</span>
              </NavLink>
            )}

            {!isClientCompany && clinic && clinic.id !== '00000000-0000-0000-0000-000000000000' && (isAdmin || clinic.role !== 'doctor') && (
              <NavLink
                to="/booking/calendar"
                className={({ isActive }) =>
                  `rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-surface text-ink shadow-sm border border-line'
                      : 'text-muted hover:bg-surface hover:text-ink'
                  }`
                }
              >
                <CalendarDays className="h-3.5 w-3.5 text-muted" />
                <span>{ar ? 'تقويم الحجوزات' : 'Booking Calendar'}</span>
              </NavLink>
            )}

            {/* Administration Dropdown (Visible ONLY to Owner) */}
            {!isClientCompany && isOwner && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                    adminMenuOpen || location.pathname.startsWith('/admin') || location.pathname.startsWith('/booking/settings')
                      ? 'bg-surface text-ink shadow-sm border border-line'
                      : 'text-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  <Wrench className="h-3.5 w-3.5 text-muted" />
                  <span>{t('common.admin')}</span>
                </button>

                {adminMenuOpen && (
                  <>
                    {/* Invisible backdrop to dismiss dropdown on click outside */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setAdminMenuOpen(false)}
                    />
                    <div className="absolute start-0 top-full z-50 mt-1.5 grid min-w-64 gap-1 rounded-2xl border border-line bg-surface p-2 text-ink shadow-2xl">
                      {canAccessSetup && (
                        <>
                          <NavLink
                            to="/admin/setup"
                            onClick={() => setAdminMenuOpen(false)}
                            className={({ isActive }) =>
                              `rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                                isActive
                                  ? 'bg-amber-500 text-white font-bold'
                                  : 'hover:bg-surface/80 hover:text-amber-500'
                              }`
                            }
                          >
                            {ar ? 'العملاء والخدمات (العيادات الطبية)' : 'Clinics setup'}
                          </NavLink>

                          <NavLink
                            to="/admin/companies-setup"
                            onClick={() => setAdminMenuOpen(false)}
                            className={({ isActive }) =>
                              `rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                                isActive
                                  ? 'bg-amber-500 text-white font-bold'
                                  : 'hover:bg-surface/80 hover:text-amber-500'
                              }`
                            }
                          >
                            {ar ? 'حسابات وخدمات الشركات' : 'Company accounts setup'}
                          </NavLink>

                          <NavLink
                            to="/admin/individuals-setup"
                            onClick={() => setAdminMenuOpen(false)}
                            className={({ isActive }) =>
                              `rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                                isActive
                                  ? 'bg-amber-500 text-white font-bold'
                                  : 'hover:bg-surface/80 hover:text-amber-500'
                              }`
                            }
                          >
                            {ar ? 'حسابات وخدمات البراند الشخصي' : 'Personal Brand accounts setup'}
                          </NavLink>

                          <NavLink
                            to="/admin/team"
                            onClick={() => setAdminMenuOpen(false)}
                            className={({ isActive }) =>
                              `rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                                isActive
                                  ? 'bg-amber-500 text-white font-bold'
                                  : 'hover:bg-surface/80 hover:text-amber-500'
                              }`
                            }
                          >
                            {ar ? 'فريق عمل وموظفي العيادات' : 'Clinic team directory'}
                          </NavLink>
                        </>
                      )}

                      <NavLink
                        to="/booking/settings"
                        onClick={() => setAdminMenuOpen(false)}
                        className={({ isActive }) =>
                          `rounded-xl px-3.5 py-2 text-xs font-medium transition ${
                            isActive
                              ? 'bg-amber-500 text-white font-bold'
                              : 'hover:bg-surface/80 hover:text-amber-500'
                          }`
                        }
                      >
                        {ar ? 'إعدادات مواعيد العيادة' : 'Clinic booking settings'}
                      </NavLink>
                    </div>
                  </>
                )}
              </div>
            )}
          </nav>
        </header>

        {error && (
          <p className="mt-4 text-danger text-xs" role="alert">
            {t('common.signOutError')}
          </p>
        )}

        {/* ========================================================================= */}
        {/* MAIN FULL-WIDTH CONTENT AREA (NO SIDEBAR) */}
        {/* ========================================================================= */}
        <main className="py-5">
          {/* Deactivated Notice */}
          {isCrmUser && activeWorkspace && !activeWorkspace.is_active && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-600">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div>
                <strong>تنبيه:</strong> مساحة العمل هذه معطلة حالياً. تمنع قواعد الأمان (RLS) العمليات التشغيلية حتى إعادة تفعيلها من قبل الإدارة.
              </div>
            </div>
          )}

          {/* Managed Only Notice */}
          {isCrmUser && activeWorkspace?.is_managed_only && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-600">
              <Lock className="h-4 w-4 shrink-0" />
              <div>
                <strong>عزل البيانات التشغيلية:</strong> بصفتك مدير المنصة، يمكنك فقط إدارة البنية التحتية وحالة مساحة العمل هذه. البيانات التشغيلية للشركة معزولة تماماً ولا يمكن الوصول إليها.
              </div>
            </div>
          )}

          {isCrmUser ? (
            <Outlet
              key={activeWorkspace?.id ?? 'crm-root'}
              context={{
                token,
                clinic:
                  clinic || {
                    id: '00000000-0000-0000-0000-000000000000',
                    name: 'Tungsten HQ',
                    role: 'platform_admin',
                  },
                userId: session.user.id,
                isAdmin,
                clinics: clinics.data?.data ?? [],
                onClinicChange: handleClinicChange,
              } satisfies WorkspaceContext}
            />
          ) : me.error ? (
            <QueryState error retry={me.retry} />
          ) : !me.data ? (
            <QueryState />
          ) : clinics.error ? (
            <QueryState error retry={clinics.retry} />
          ) : !clinics.data ? (
            <QueryState />
          ) : !clinic ? (
            <p className="glass p-6 text-xs">{t('common.noClinics')}</p>
          ) : (
            <>
              {/* Clinic bar only for pure clinic staff */}
              {!isCrmUser && clinic && (
                <div className="clinic-bar mb-4">
                  <ChoiceSelect
                    label={t('common.clinic')}
                    value={clinic.id}
                    onChange={handleClinicChange}
                    options={
                      clinics.data.data.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))
                    }
                  />

                  <p className="min-w-0 truncate text-xs text-muted" dir="ltr">
                    {me.data.user.email}
                  </p>
                </div>
              )}

              {/* Outlet directly rendering the active page full-width */}
              <Outlet
                key={clinic?.id ?? 'main-app'}
                context={{
                  token,
                  clinic:
                    clinic || {
                      id: '00000000-0000-0000-0000-000000000000',
                      name: 'Tungsten HQ',
                      role: 'platform_admin',
                    },
                  userId: session.user.id,
                  isAdmin,
                  clinics: clinics.data?.data ?? [],
                  onClinicChange: handleClinicChange,
                } satisfies WorkspaceContext}
              />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
