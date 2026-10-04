import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import type { Lead, WorkspaceContext } from '../leads/types';
import { canCreateLeads, lanes } from '../leads/types';
import LeadCard from '../leads/LeadCard';
import QueryState from '../../components/QueryState';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';

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
    upcoming_bookings: {
      id: string;
      lead_id: string;
      starts_at: string;
      status: 'pending' | 'confirmed';
    }[];
  };
};

export default function OverviewPage() {
  const { t, i18n } = useTranslation();
  const { token, clinic } = useOutletContext<WorkspaceContext>();
  const query = useGet<Dashboard>(
    `/api/dashboard?clinic_id=${encodeURIComponent(clinic.id)}`,
    token,
  );
  useClinicChanges(clinic.id, liveTables, query.retry);

  const data = query.data?.data;
  const counts = data?.counts ?? {
    total: 0, new: 0, follow: 0, converted: 0, uninterested: 0, active_ads: 0,
  };
  const stats = [
    { key: 'total', value: counts.total },
    { key: 'new', value: counts.new },
    { key: 'follow', value: counts.follow },
    { key: 'activeAds', value: counts.active_ads },
  ];

  return (
    <>
      <p className="eyebrow">{t('overview.eyebrow')}</p>
      <h1 className="mt-3 text-4xl font-normal tracking-tight sm:text-5xl">
        {t('overview.title')}
      </h1>
      <p className="mt-3 text-muted">{t('overview.subtitle')}</p>

      {query.error || !data ? (
        <div className="mt-6">
          <QueryState error={query.error} retry={query.retry} />
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(stat => (
              <article key={stat.key} className="glass p-6">
                <p className="text-sm text-muted">{t(`overview.${stat.key}`)}</p>
                <strong className="mt-5 block text-5xl font-normal tracking-tight">
                  {stat.value}
                </strong>
                <span className="mt-4 inline-block size-2 rounded-full bg-lavender" aria-hidden="true" />
              </article>
            ))}
          </section>

          <section className="glass p-6">
            <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl">{t('overview.pipeline')}</h2>
              <Link to="/leads" className="control">
                {t('overview.open')}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="space-y-5">
              {lanes.map(lane => {
                const count = lane.key === 'progress' ? counts.follow
                  : lane.key === 'new' ? counts.new
                    : lane.key === 'converted' ? counts.converted
                      : counts.uninterested;
                return (
                  <div key={lane.key}>
                    <div className="mb-2 flex justify-between text-sm">
                      <span>{t(`leads.${lane.key}`)}</span><span>{count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${lane.color}`}
                        style={{ width: `${counts.total ? count / counts.total * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-xl">{t('overview.recent')}</h2>
                {canCreateLeads(clinic.role) && (
                  <Link to="/leads/new" className="control">{t('leads.create')}</Link>
                )}
              </div>
              <div className="grid gap-3">
                {data.recent_leads.length
                  ? data.recent_leads.map(lead => <LeadCard key={lead.id} lead={lead} />)
                  : <p className="glass p-6 text-muted">{t('overview.noLeads')}</p>}
              </div>
            </div>

            <div>
              <h2 className="mb-4 text-xl">{t('overview.bookings')}</h2>
              <div className="glass divide-y divide-line">
                {data.upcoming_bookings.length ? data.upcoming_bookings.map(booking => {
                  const date = new Date(booking.starts_at);
                  return (
                    <div key={booking.id} className="flex flex-wrap items-center justify-between gap-2 p-5">
                      <time dateTime={booking.starts_at}>
                        {Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(
                          i18n.resolvedLanguage === 'ar' ? 'ar-EG' : 'en-GB',
                          { dateStyle: 'medium', timeStyle: 'short' },
                        ).format(date)}
                      </time>
                      <span className="rounded-full bg-surface px-3 py-1 text-xs">
                        {t(`overview.bookingStatus.${booking.status}`)}
                      </span>
                    </div>
                  );
                }) : <p className="p-6 text-muted">{t('overview.noBookings')}</p>}
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
