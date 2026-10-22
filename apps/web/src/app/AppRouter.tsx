import { Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../features/auth/useSession';
import LoginPage from '../features/auth/LoginPage';
import AppLayout from '../layouts/AppLayout';
import OverviewPage from '../features/overview/OverviewPage';
import LeadsPage from '../features/leads/LeadsPage';
import CreateLeadPage from '../features/leads/CreateLeadPage';
import LeadDetailPage from '../features/leads/LeadDetailPage';
import AdminSetupPage from '../features/admin/AdminSetupPage';
import TeamPage from '../features/admin/TeamPage';
import AdminAdsPage from '../features/admin/AdminAdsPage';
import { useGet } from '../hooks/useGet';
import QueryState from '../components/QueryState';
import ChatsPage from '../features/chats/ChatsPage';
import BookingSettingsPage from '../features/booking/BookingSettingsPage';
import BookingCalendarPage from '../features/booking/BookingCalendarPage';
import BookingSetupPage from '../features/booking/BookingSetupPage';


export default function AppRouter() {
  const { t } = useTranslation();
  const { ready, session, error } = useSession();
  const adminStatus = useGet<{ is_admin: boolean }>(
    session ? '/api/admin/status' : null,
    session?.access_token ?? '',
  );

  function adminPage(page: React.ReactNode) {
    if (!session) return <Navigate to="/login" replace />;

    if (adminStatus.error) {
      return <QueryState error retry={adminStatus.retry} />;
    }

    if (!adminStatus.data) return <QueryState />;

    return adminStatus.data.is_admin
      ? page
      : <Navigate to="/overview" replace />;
  }

  if (!ready || error) {
    return (
      <main
        className="grid min-h-dvh place-items-center p-6"
        role={error ? 'alert' : 'status'}
      >
        {t(error ? 'common.sessionError' : 'common.loading')}
      </main>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          session
            ? <Navigate to="/overview" replace />
            : <LoginPage />
        }
      />

      <Route
        path="/admin/setup"
        element={adminPage(
          session && (
            <AdminSetupPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      <Route
        path="/admin/ads"
        element={adminPage(
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
        element={adminPage(
          session && (
            <TeamPage
              key={session.user.id}
              token={session.access_token}
            />
          ),
        )}
      />

      <Route
        element={
          session
            ? (
              <AppLayout
                key={session.user.id}
                session={session}
                isAdmin={adminStatus.data?.is_admin === true}
              />
            )
            : <Navigate to="/login" replace />
        }
      >
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/new" element={<CreateLeadPage />} />
        <Route path="/leads/:leadId" element={<LeadDetailPage />} />
        <Route path="/chats" element={<ChatsPage />} />

        <Route
          path="/booking/settings"
          element={<BookingSetupPage />}
        />

        <Route path="/booking/setup" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/doctors" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/devices" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/service-requirements" element={<Navigate to="/booking/settings" replace />} />
        <Route path="/booking/legacy-settings" element={<BookingSettingsPage />} />

        <Route
          path="/booking/calendar"
          element={<BookingCalendarPage />}
        />
        <Route
  path="/booking/follow-up"
  element={<Navigate to="/leads" replace />}
/>
      </Route>

      <Route
        path="*"
        element={
          <Navigate to={session ? '/overview' : '/login'} replace />
        }
      />
    </Routes>
  );
}
