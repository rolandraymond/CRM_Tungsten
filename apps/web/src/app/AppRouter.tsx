import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../features/auth/useSession';
import LoginPage from '../features/auth/LoginPage';
import AppLayout from '../layouts/AppLayout';
import OverviewPage from '../features/overview/OverviewPage';
import LeadsPage from '../features/leads/LeadsPage';
import CreateLeadPage from '../features/leads/CreateLeadPage';
import LeadDetailPage from '../features/leads/LeadDetailPage';
import AdminSetupPage from '../features/admin/AdminSetupPage';
import CompanyAccountsSetupPage from '../features/admin/CompanyAccountsSetupPage';
import IndividualAccountsSetupPage from '../features/admin/IndividualAccountsSetupPage';
import TeamPage from '../features/admin/TeamPage';
import AdminAdsPage from '../features/admin/AdminAdsPage';
import { useGet } from '../hooks/useGet';
import QueryState from '../components/QueryState';
import ChatsPage from '../features/chats/ChatsPage';
import BookingSettingsPage from '../features/booking/BookingSettingsPage';
import BookingCalendarPage from '../features/booking/BookingCalendarPage';
import BookingSetupPage from '../features/booking/BookingSetupPage';
import {
  CrmProvider,
  CrmLayout,
  CrmDashboardPage,
  CrmContactsPage,
  CrmContactDetailPage,
  CrmCompaniesPage,
  CrmDealsPage,
  CrmActivitiesPage,
  CrmMeetingsPage,
  CrmFollowUpsPage,
  CrmTeamPage,
  CrmAnalyticsPage,
  CrmSocialLensIntegrationPage,
} from '../features/crm';

export default function AppRouter() {
  const { ready, session, error } = useSession();
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
  }>(
    session ? '/api/admin/status' : null,
    session?.access_token ?? '',
  );

  const isOwner = Boolean(
    adminStatus.data?.is_owner ||
    adminStatus.data?.is_admin ||
    adminStatus.data?.is_company_owner ||
    adminStatus.data?.is_brand_owner
  );
  const isManager = Boolean(
    adminStatus.data?.is_manager ||
    adminStatus.data?.is_company_manager ||
    adminStatus.data?.is_brand_manager
  );
  const isSales = Boolean(adminStatus.data?.is_sales);
  const isClientCompany = Boolean(adminStatus.data?.is_client_company);
  const isClientBrand = Boolean(
    adminStatus.data?.is_client_brand ||
    adminStatus.data?.is_brand_owner ||
    adminStatus.data?.is_brand_manager
  );
  const isClinicUser = Boolean(adminStatus.data?.is_clinic_user) ||
    Boolean(
      adminStatus.data &&
      !isOwner &&
      !isManager &&
      !isSales &&
      !isClientCompany &&
      !isClientBrand &&
      adminStatus.data.clinic_name
    );
  const isCrmUser = !isClinicUser && Boolean(isOwner || isManager || isSales || isClientCompany || isClientBrand);

  function setupPage(page: React.ReactNode) {
    if (!session) return <Navigate to="/login" replace />;

    if (adminStatus.error) {
      return <QueryState error retry={adminStatus.retry} />;
    }

    if (!adminStatus.data) return <QueryState />;

    const canAccess =
      adminStatus.data.is_admin ||
      adminStatus.data.is_owner;

    return canAccess ? page : <Navigate to={isSales ? '/crm/contacts' : '/crm/dashboard'} replace />;
  }

  function ownerOnlyPage(page: React.ReactNode) {
    if (!session) return <Navigate to="/login" replace />;

    if (adminStatus.error) {
      return <QueryState error retry={adminStatus.retry} />;
    }

    if (!adminStatus.data) return <QueryState />;

    return isOwner ? page : <Navigate to="/overview" replace />;
  }

  if (!ready || error || (session && !adminStatus.data && !adminStatus.error)) {
    return (
      <main
        className="grid min-h-dvh place-items-center p-6"
        role={error ? 'alert' : 'status'}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
          <p className="text-xs font-semibold text-muted">جاري تحميل لوحة التحكم...</p>
        </div>
      </main>
    );
  }

  if (session && adminStatus.error) {
    return (
      <main className="grid min-h-dvh place-items-center p-6" dir="rtl">
        <div className="glass max-w-md w-full rounded-3xl p-8 text-center space-y-4">
          <p className="text-base font-bold text-danger">تعذّر الاتصال بخادم البيانات (API)</p>
          <p className="text-xs text-muted">
            تأكد من تشغيل السيرفر الخلفي (Port 3001) ثم أعد المحاولة.
          </p>
          <button
            type="button"
            onClick={adminStatus.retry}
            className="control mx-auto justify-center bg-amber-500! text-white! font-bold"
          >
            إعادة المحاولة
          </button>
        </div>
      </main>
    );
  }

  const defaultLandingPath = isClinicUser
    ? '/overview'
    : isSales
    ? '/crm/contacts'
    : isOwner || isManager
    ? '/crm/dashboard'
    : '/overview';

  return (
    <Routes>
      <Route
        path="/login"
        element={
          session ? (
            <Navigate to={defaultLandingPath} replace />
          ) : (
            <LoginPage />
          )
        }
      />

      <Route
        path="/admin/setup"
        element={setupPage(
          session && (
            <AdminSetupPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      <Route
        path="/admin/companies-setup"
        element={setupPage(
          session && (
            <CompanyAccountsSetupPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      <Route
        path="/admin/individuals-setup"
        element={setupPage(
          session && (
            <IndividualAccountsSetupPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      <Route
        path="/admin/ads"
        element={ownerOnlyPage(
          session && (
            <AdminAdsPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      <Route
        path="/admin/team"
        element={ownerOnlyPage(
          session && (
            <TeamPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      {/* Main Authenticated Layout wrapped in CrmProvider */}
      <Route
        element={
          session ? (
            <CrmProvider
              token={session.access_token}
              userId={session.user.id}
              isClinicUser={isClinicUser}
            >
              <AppLayout
                key={`${session.user.id}_${isClinicUser ? 'clinic' : 'crm'}`}
                session={session}
                isAdmin={isOwner}
                isClinicUser={isClinicUser}
              />
            </CrmProvider>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      >
        {/* Clinic Routes */}
        <Route
          path="/overview"
          element={
            isSales ? (
              <Navigate to="/crm/contacts" replace />
            ) : isCrmUser ? (
              <Navigate to="/crm/dashboard" replace />
            ) : (
              <OverviewPage />
            )
          }
        />
        <Route
          path="/leads"
          element={
            isCrmUser ? (
              <Navigate to="/crm/contacts" replace />
            ) : (
              <LeadsPage />
            )
          }
        />
        <Route path="/leads/new" element={<CreateLeadPage />} />
        <Route path="/leads/:leadId" element={<LeadDetailPage />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/tungsten/clients" element={<Navigate to="/crm/contacts" replace />} />

        {/* Tungsten Enterprise CRM Routes */}
        <Route
          path="/crm"
          element={
            isClinicUser ? (
              <Navigate to="/overview" replace />
            ) : (
              <CrmLayout />
            )
          }
        >
          <Route
            index
            element={<Navigate to={isSales ? '/crm/contacts' : '/crm/dashboard'} replace />}
          />
          <Route
            path="dashboard"
            element={isSales ? <Navigate to="/crm/contacts" replace /> : <CrmDashboardPage />}
          />
          <Route path="contacts" element={<CrmContactsPage />} />
          <Route path="contacts/:id" element={<CrmContactDetailPage />} />
          <Route path="all-contacts" element={<Navigate to="/crm/contacts" replace />} />
          <Route path="all-contacts/:id" element={<CrmContactDetailPage />} />
          <Route
            path="companies"
            element={isSales ? <Navigate to="/crm/contacts" replace /> : <CrmCompaniesPage />}
          />
          <Route path="leads" element={<Navigate to="/crm/contacts" replace />} />
          <Route path="pipeline" element={<Navigate to="/crm/contacts" replace />} />
          <Route path="deals" element={<CrmDealsPage initialMode="deals" initialView="table" />} />
          <Route path="activities" element={<CrmActivitiesPage />} />
          <Route path="meetings" element={<CrmMeetingsPage />} />
          <Route path="follow-ups" element={<CrmFollowUpsPage />} />
          <Route
            path="team"
            element={isSales ? <Navigate to="/crm/contacts" replace /> : <CrmTeamPage />}
          />
          <Route
            path="sociallens"
            element={isSales ? <Navigate to="/crm/contacts" replace /> : <CrmSocialLensIntegrationPage />}
          />
          <Route
            path="analytics"
            element={isSales ? <Navigate to="/crm/contacts" replace /> : <CrmAnalyticsPage />}
          />
          <Route path="chats" element={<Navigate to="/chats" replace />} />
          <Route
            path="audit-logs"
            element={<Navigate to={isSales ? '/crm/contacts' : '/crm/dashboard'} replace />}
          />
          <Route
            path="settings"
            element={<Navigate to={isSales ? '/crm/contacts' : '/crm/dashboard'} replace />}
          />
        </Route>

        <Route path="/booking/settings" element={<BookingSetupPage />} />
        <Route path="/booking/setup" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/doctors" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/devices" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/service-requirements" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/legacy-settings" element={<BookingSettingsPage />} />
        <Route path="/booking/calendar" element={<BookingCalendarPage />} />
        <Route path="/booking/follow-up" element={<Navigate to="/leads" replace />} />
      </Route>

      <Route
        path="*"
        element={<Navigate to={session ? defaultLandingPath : '/login'} replace />}
      />
    </Routes>
  );
}
