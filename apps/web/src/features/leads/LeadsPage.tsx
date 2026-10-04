import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { canCreateLeads, lanes } from './types';
import type { WorkspaceContext } from './types';
import { useLeads } from './useLeads';
import LeadCard from './LeadCard';
import QueryState from '../../components/QueryState';
import { useClinicChanges } from '../../hooks/useClinicChanges';

const liveTables = ['leads'] as const;

export default function LeadsPage() {
  const { t } = useTranslation();
  const { token, clinic } = useOutletContext<WorkspaceContext>();
  const [page, setPage] = useState(1);
  const query = useLeads(token, clinic.id, page);
  useClinicChanges(clinic.id, liveTables, query.retry);
  const rows = query.data?.data ?? [];

  const unknown = rows.filter(row =>
    !lanes.some(lane => lane.statuses.includes(row.status)),
  );

  return (
    <>
      <p className="eyebrow">{t('leads.eyebrow')}</p>
      <h1 className="mt-3 text-4xl font-normal tracking-tight sm:text-5xl">
        {t('leads.title')}
      </h1>
      <p className="mb-8 mt-3 text-muted">{t('leads.subtitle')}</p>
      {canCreateLeads(clinic.role) && <div className="mb-6 flex justify-end">
    <Link
        to="/leads/new"
        className="control bg-lavender! text-[#242424]!"
    >
        + {t('leads.create')}
    </Link>
    </div>}

      {query.error || !query.data ? (
        <QueryState error={query.error} retry={query.retry} />
      ) : (
        <>
          <div className="grid items-start gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {lanes.map(lane => {
              const items = rows.filter(row =>
                lane.statuses.includes(row.status),
              );

              return (
                <section key={lane.key} className="min-w-0">
                  <div className="mb-4 flex items-center gap-2">
                    <span className={`size-2 rounded-full ${lane.color}`} />
                    <h2 className="text-sm font-semibold">
                      {t(`leads.${lane.key}`)}
                    </h2>
                    <span className="ms-auto text-sm text-muted">
                      {items.length}
                    </span>
                  </div>

                  <div className="grid gap-3">
                    {items.length ? (
                      items.map(lead => (
                        <LeadCard key={lead.id} lead={lead} />
                      ))
                    ) : (
                      <p className="glass p-5 text-sm text-muted">
                        {t('common.empty')}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {unknown.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-3">{t('leads.other')}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {unknown.map(lead => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div className="mt-8 flex items-center justify-center gap-4">
        <button
          type="button"
          className="control"
          disabled={page === 1}
          onClick={() => setPage(value => value - 1)}
        >
          {t('common.previous')}
        </button>

        <span className="text-sm">{t('common.page', { page })}</span>

        <button
          type="button"
          className="control"
          disabled={!query.data?.pagination.has_more || query.error}
          onClick={() => setPage(value => value + 1)}
        >
          {t('common.next')}
        </button>
      </div>
    </>
  );
}
