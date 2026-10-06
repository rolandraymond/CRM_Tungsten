import { useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';

import type { Lead, WorkspaceContext } from '../leads/types';
import { canCreateLeads, lanes } from '../leads/types';
import LeadCard from '../leads/LeadCard';
import QueryState from '../../components/QueryState';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import OverviewBookingCard from './OverviewBookingCard';
import type { OverviewBooking } from './OverviewBookingCard';

const liveTables = ['leads', 'appointments', 'clinic_ads'] as const;

type Dashboard = {
  data: {
    counts: {
      total: number;
      new: number;
      follow: number;
      converted: number;
      uninterested: number;
      active_ads: number;
    };
    recent_leads: Lead[];
    server_now: string;
    today: string;
    upcoming_bookings: OverviewBooking[];
    booking_reminders: OverviewBooking[];
    booking_reminders_total: number;
  };
};

export default function OverviewPage() {
  const { t, i18n } = useTranslation();
  const { token, clinic, isAdmin } =
    useOutletContext<WorkspaceContext>();

  const ar = (
    i18n.resolvedLanguage ?? i18n.language
  ).startsWith('ar');

  const canFollowUp =
    Boolean(isAdmin)
    || [
      'platform_admin',
      'clinic_manager',
      'clinic_customer_service',
      'moderator',
    ].includes(clinic.role);

  const query = useGet<Dashboard>(
    `/api/dashboard?clinic_id=${encodeURIComponent(clinic.id)}`,
    token,
  );

  useClinicChanges(clinic.id, liveTables, query.retry);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === 'visible'
        && !document.querySelector('dialog[open]')
      ) {
        query.retry();
      }
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [query.retry]);

  const data = query.data?.data;

  const counts = data?.counts ?? {
    total: 0,
    new: 0,
    follow: 0,
    converted: 0,
    uninterested: 0,
    active_ads: 0,
  };

  const stats = [
    { key: 'total', value: counts.total },
    { key: 'new', value: counts.new },
    { key: 'follow', value: counts.follow },
    { key: 'activeAds', value: counts.active_ads },
  ];

  const confirmedBookings = data?.upcoming_bookings.filter(
    booking => booking.status === 'confirmed',
  ) ?? [];

  return (
    <>
      <p className="eyebrow">
        {t('overview.eyebrow')}
      </p>

      <h1 className="mt-3 text-4xl font-normal tracking-tight sm:text-5xl">
        {t('overview.title')}
      </h1>

      <p className="mt-3 text-muted">
        {t('overview.subtitle')}
      </p>

      {query.error || !data ? (
        <div className="mt-6">
          <QueryState
            error={query.error}
            retry={query.retry}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(stat => (
              <article key={stat.key} className="glass p-6">
                <p className="text-sm text-muted">
                  {t(`overview.${stat.key}`)}
                </p>

                <strong className="mt-5 block text-5xl font-normal tracking-tight">
                  {stat.value}
                </strong>

                <span
                  className="mt-4 inline-block size-2 rounded-full bg-lavender"
                  aria-hidden="true"
                />
              </article>
            ))}
          </section>

          <section className="glass p-6">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl">
                {t('overview.pipeline')}
              </h2>

              <Link to="/leads" className="control">
                {t('overview.open')}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>

            <div className="space-y-5">
              {lanes.map(lane => {
                const count =
                  lane.key === 'progress'
                    ? counts.follow
                    : lane.key === 'new'
                      ? counts.new
                      : lane.key === 'converted'
                        ? counts.converted
                        : counts.uninterested;

                return (
                  <div key={lane.key}>
                    <div className="mb-2 flex justify-between text-sm">
                      <span>{t(`leads.${lane.key}`)}</span>
                      <span>{count}</span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${lane.color}`}
                        style={{
                          width: `${
                            counts.total
                              ? count / counts.total * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid min-w-0 gap-6 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl">
                  {t('overview.recent')}
                </h2>

                {canCreateLeads(clinic.role) && (
                  <Link to="/leads/new" className="control">
                    {t('leads.create')}
                  </Link>
                )}
              </div>

              <div className="grid min-w-0 gap-3">
                {data.recent_leads.length ? (
                  data.recent_leads.map(lead => (
                    <LeadCard key={lead.id} lead={lead} />
                  ))
                ) : (
                  <p className="glass p-6 text-muted">
                    {t('overview.noLeads')}
                  </p>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl">
                  {ar
                    ? 'حجوزات تحتاج متابعة'
                    : 'Bookings requiring follow-up'}

                  <span className="ms-2 text-sm text-muted">
                    ({data.booking_reminders_total})
                  </span>
                </h2>

                {canFollowUp && (
                  <Link to="/booking/follow-up" className="control">
                    {ar ? 'كل المتابعات' : 'All follow-ups'}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </Link>
                )}
              </div>

              <p className="mb-4 text-sm leading-relaxed text-muted">
                {ar
                  ? 'مرتبة حسب الأولوية. الأحمر للحالات المستحقة أو القريبة من الزيارة، والأسود للمراجعة بعد 3 محاولات.'
                  : 'Ordered by priority. Red marks due or urgent cases; black marks manual review after 3 attempts.'}
              </p>

              <div className="grid min-w-0 gap-4">
                {data.booking_reminders.length ? (
                  data.booking_reminders.map(booking => (
                    <OverviewBookingCard
                      key={booking.id}
                      booking={booking}
                      serverNow={data.server_now}
                      onRefresh={query.retry}
                    />
                  ))
                ) : (
                  <p className="glass rounded-3xl p-6 text-muted">
                    {ar
                      ? 'مفيش حجوزات بانتظار التأكيد.'
                      : 'No bookings are awaiting confirmation.'}
                  </p>
                )}
              </div>

              {data.booking_reminders_total
                > data.booking_reminders.length && (
                <p className="mt-3 text-sm text-muted">
                  {ar
                    ? 'معروض أول 20 حجز حسب الأولوية. باقي الحالات في صفحة المتابعات.'
                    : 'Showing the first 20 bookings by priority. Other cases are available in Follow-up.'}
                </p>
              )}

              <h3 className="mb-4 mt-7 text-lg">
                {ar
                  ? 'حجوزات مؤكدة قادمة'
                  : 'Upcoming confirmed bookings'}
              </h3>

              <div className="grid min-w-0 gap-4">
                {confirmedBookings.length ? (
                  confirmedBookings.map(booking => (
                    <OverviewBookingCard
                      key={booking.id}
                      booking={booking}
                      serverNow={data.server_now}
                      onRefresh={query.retry}
                    />
                  ))
                ) : (
                  <p className="glass rounded-3xl p-6 text-muted">
                    {ar
                      ? 'مفيش حجوزات مؤكدة في ملخص الحجوزات القادمة.'
                      : 'No confirmed bookings in the upcoming summary.'}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}