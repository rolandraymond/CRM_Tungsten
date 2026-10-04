import { useTranslation } from 'react-i18next';
import { Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Lead } from './types';

export default function LeadCard({ lead }: { lead: Lead }) {
  const { t, i18n } = useTranslation();
  const name = lead.contact?.full_name || t('leads.customer');
  const date = new Date(lead.created_at);
  const isNew = lead.contact_type_at_creation === 'new_contact';

  return (
    <article className="glass relative min-w-0 p-5 transition hover:border-ink/40">
      <Link
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        to={`/leads/${lead.id}`}
        aria-label={name}
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-xs text-[#242424] ${
            isNew ? 'bg-lavender' : 'bg-coral'
          }`}
        >
          {t(isNew ? 'leads.newContact' : 'leads.existingContact')}
        </span>

        <time className="text-xs text-muted" dateTime={lead.created_at}>
          {Number.isNaN(date.getTime())
            ? '—'
            : new Intl.DateTimeFormat(
                i18n.resolvedLanguage === 'ar' ? 'ar-EG' : 'en-GB',
                { dateStyle: 'medium' },
              ).format(date)}
        </time>
      </div>

      <h3 className="break-words text-lg font-semibold" dir="auto">
        {name}
      </h3>

      <p className="mt-2 text-sm text-muted" dir="auto">
        {lead.requested_service_name_snapshot}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-xs text-muted">
        <span dir="auto">{lead.source.replaceAll('_', ' ')}</span>

        {lead.contact?.phone && (
          <a
            className="relative z-10 inline-flex items-center gap-1.5 text-ink hover:underline"
            href={`tel:${lead.contact.phone}`}
            aria-label={t('leads.call', { name })}
            dir="ltr"
          >
            <Phone size={12} aria-hidden="true" />
            {lead.contact.phone}
          </a>
        )}
      </div>
    </article>
  );
}