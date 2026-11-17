import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  User,
  Building2,
  Phone,
  Mail,
  DollarSign,
  Briefcase,
  Calendar,
  Plus,
  Search,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { useGet } from '../../hooks/useGet';
import QueryState from '../../components/QueryState';
import type { WorkspaceContext } from '../leads/types';

export type TungstenClient = {
  id: string;
  client_name: string;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  service_requested: string | null;
  deal_value: number;
  status:
    | 'new'
    | 'contacted'
    | 'qualified'
    | 'proposal'
    | 'negotiation'
    | 'won'
    | 'lost';
  notes: string | null;
  sales_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  creator?: { id: string; full_name: string | null } | null;
  sales_rep?: { id: string; full_name: string | null } | null;
};

const statusLabels: Record<
  string,
  { ar: string; en: string; color: string; bg: string }
> = {
  new: {
    ar: 'جديد',
    en: 'New',
    color: 'text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900',
  },
  contacted: {
    ar: 'تم التواصل',
    en: 'Contacted',
    color: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
  },
  qualified: {
    ar: 'مؤهل',
    en: 'Qualified',
    color: 'text-purple-500',
    bg: 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900',
  },
  proposal: {
    ar: 'عرض سعر',
    en: 'Proposal',
    color: 'text-indigo-500',
    bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900',
  },
  negotiation: {
    ar: 'تفاوض',
    en: 'Negotiation',
    color: 'text-orange-500',
    bg: 'bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-900',
  },
  won: {
    ar: 'كسب الصفقة',
    en: 'Won',
    color: 'text-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900',
  },
  lost: {
    ar: 'خسارة',
    en: 'Lost',
    color: 'text-rose-500',
    bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900',
  },
};

export default function TungstenClientsPage() {
  const { token, userId } = useOutletContext<WorkspaceContext>();
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');

  const statusQuery = useGet<{
    is_admin: boolean;
    is_owner: boolean;
    is_manager: boolean;
    is_sales: boolean;
    internal_role: string | null;
  }>('/api/admin/status', token);

  const query = useGet<{ data: TungstenClient[] }>(
    '/api/internal/clients',
    token,
  );

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [serviceRequested, setServiceRequested] = useState('');
  const [dealValue, setDealValue] = useState<number | ''>('');
  const [status, setStatus] = useState<string>('new');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const isOwner = statusQuery.data?.is_owner || statusQuery.data?.is_admin;
  const isManager = statusQuery.data?.is_manager;
  const isSales = statusQuery.data?.is_sales;

  const roleTitle = isOwner
    ? ar ? 'المالك (Platform Owner)' : 'Platform Owner'
    : isManager
      ? ar ? 'مدير المنصة (Tungsten Manager)' : 'Tungsten Manager'
      : isSales
        ? ar ? 'مسؤول المبيعات (Sales Rep)' : 'Sales Rep'
        : ar ? 'مستخدم داخلي' : 'Internal User';

  const clients = query.data?.data ?? [];

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      const matchSearch =
        !search.trim() ||
        c.client_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.company_name &&
          c.company_name.toLowerCase().includes(search.toLowerCase())) ||
        (c.phone && c.phone.includes(search));

      const matchStatus =
        filterStatus === 'all' || c.status === filterStatus;

      return matchSearch && matchStatus;
    });
  }, [clients, search, filterStatus]);

  async function handleCreateClient(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !clientName.trim()) return;

    setBusy(true);
    setFormError('');

    try {
      let formattedPhone = phone.trim() ? phone.trim() : null;
      if (formattedPhone && !formattedPhone.startsWith('+')) {
        formattedPhone = '+2' + formattedPhone;
      }

      const res = await fetch('/api/internal/clients', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_name: clientName.trim(),
          phone: formattedPhone,
          email: email.trim() || null,
          company_name: companyName.trim() || null,
          service_requested: serviceRequested.trim() || null,
          deal_value: dealValue === '' ? 0 : Number(dealValue),
          status,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError(
          err.error?.message ||
            (ar
              ? 'حدث خطأ أثناء حفظ العميل. تأكد من صحة رقم الهاتف.'
              : 'Error saving client. Please verify phone number format.'),
        );
        return;
      }

      // Reset form
      setClientName('');
      setPhone('');
      setEmail('');
      setCompanyName('');
      setServiceRequested('');
      setDealValue('');
      setStatus('new');
      setNotes('');
      setShowAddForm(false);
      query.retry();
    } catch {
      setFormError(
        ar ? 'فشل الاتصال بالخادم.' : 'Connection failed. Please retry.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(clientId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/internal/clients/${clientId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        query.retry();
      }
    } catch {
      // ignore
    }
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            <ShieldCheck className="size-4 text-lavender" />
            <span>Tungsten Lens & CRM</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            {ar ? 'عملاء Tungsten CRM' : 'Tungsten CRM Clients'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {isOwner || isManager
              ? ar
                ? 'إدارة ومتابعة جميع العملاء والصفقات المضافة بواسطة فريق المبيعات.'
                : 'Manage and track all prospects and deals added by the sales team.'
              : ar
                ? 'العملاء والصفقات المسجلة باسمك ومربوطة بـ Sales ID الخاص بك.'
                : 'Clients and deals registered under your name and Sales ID.'}
          </p>
        </div>

        {/* User Info & Sales ID badge */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface/60 px-4 py-2 text-xs shadow-xs">
            <span className="font-semibold text-ink">{roleTitle}</span>
            <span className="text-muted">|</span>
            <span className="text-muted">Sales ID:</span>
            <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] font-medium dark:bg-white/10">
              {userId.slice(0, 8)}…{userId.slice(-4)}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(userId, 'my-id')}
              className="text-muted hover:text-ink transition"
              title={ar ? 'نسخ المعرّف كاملاً' : 'Copy full UUID'}
            >
              {copiedId === 'my-id' ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm(v => !v)}
            className="control bg-lavender! text-[#242424]! font-semibold"
          >
            <Plus className="size-4" />
            {ar ? 'إضافة عميل جديد' : 'Add New Client'}
          </button>
        </div>
      </div>

      {/* Add Client Form */}
      {showAddForm && (
        <section className="glass rounded-3xl p-6 transition-all duration-200">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">
              {ar ? 'تسجيل عميل جديد في CRM' : 'Register New CRM Client'}
            </h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs text-muted hover:underline"
            >
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>

          <form onSubmit={handleCreateClient} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'اسم العميل *' : 'Client Name *'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={ar ? 'مثال: د. أحمد خالد' : 'e.g. Dr. Ahmed Khaled'}
                  className="field"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  dir="auto"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'رقم الهاتف' : 'Phone Number'}
                </label>
                <input
                  type="text"
                  placeholder="+201012345678"
                  className="field"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <input
                  type="email"
                  placeholder="client@example.com"
                  className="field"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'اسم الشركة / العيادة' : 'Company / Clinic Name'}
                </label>
                <input
                  type="text"
                  placeholder={ar ? 'مركز النخبة الطبي' : 'Elite Medical Center'}
                  className="field"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  dir="auto"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'الخدمة المطلوبة' : 'Requested Service'}
                </label>
                <input
                  type="text"
                  placeholder={ar ? 'باقة CRM المتكاملة' : 'Full CRM Suite'}
                  className="field"
                  value={serviceRequested}
                  onChange={e => setServiceRequested(e.target.value)}
                  dir="auto"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'قيمة الصفقة المتوقعة (ج.م)' : 'Deal Value (EGP)'}
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  className="field"
                  value={dealValue}
                  onChange={e =>
                    setDealValue(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'مرحلة العميل (Status)' : 'Client Stage'}
                </label>
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value)}
                  className="field"
                >
                  {Object.entries(statusLabels).map(([key, item]) => (
                    <option key={key} value={key}>
                      {ar ? item.ar : item.en}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-muted mb-1.5">
                  {ar ? 'ملاحظات وتفاصيل التواصل' : 'Notes & Interaction Details'}
                </label>
                <input
                  type="text"
                  placeholder={
                    ar
                      ? 'ملاحظات المبيعات والخطوة التالية...'
                      : 'Sales notes and next actions...'
                  }
                  className="field"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  dir="auto"
                />
              </div>
            </div>

            {formError && (
              <p className="text-xs text-rose-500 font-semibold">{formError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="control"
                disabled={busy}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busy || !clientName.trim()}
                className="control bg-lavender! text-[#242424]! font-semibold"
              >
                {busy
                  ? ar
                    ? 'جاري الحفظ…'
                    : 'Saving…'
                  : ar
                    ? 'حفظ العميل'
                    : 'Save Client'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="relative min-w-64 flex-1 max-w-md">
          <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={
              ar ? 'البحث بالاسم، الشركة، أو الهاتف…' : 'Search by name, company or phone…'
            }
            className="field ps-10"
            dir="auto"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              filterStatus === 'all'
                ? 'bg-ink text-surface shadow-xs'
                : 'text-muted hover:bg-surface'
            }`}
          >
            {ar ? 'الكل' : 'All'} ({clients.length})
          </button>
          {Object.entries(statusLabels).map(([key, item]) => {
            const count = clients.filter(c => c.status === key).length;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilterStatus(key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                  filterStatus === key
                    ? 'bg-ink text-surface shadow-xs'
                    : 'text-muted hover:bg-surface'
                }`}
              >
                {ar ? item.ar : item.en} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Clients Display */}
      {query.error ? (
        <QueryState error retry={query.retry} />
      ) : !query.data ? (
        <QueryState />
      ) : filteredClients.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center text-muted">
          <p className="text-base font-medium">
            {ar ? 'لم يتم العثور على أي عملاء.' : 'No clients found.'}
          </p>
          <p className="mt-1 text-xs">
            {search || filterStatus !== 'all'
              ? ar
                ? 'جرّب تغيير معايير البحث أو الفلتر.'
                : 'Try adjusting your search query or filter.'
              : ar
                ? 'ابدأ بإضافة أول عميل لك باستخدام الزر أعلاه.'
                : 'Get started by creating your first client with the button above.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredClients.map(client => {
            const currentBadge =
              statusLabels[client.status] ?? statusLabels.new;
            const repName =
              client.sales_rep?.full_name ||
              client.creator?.full_name ||
              (ar ? 'غير محدد' : 'Unassigned');

            return (
              <article
                key={client.id}
                className="glass relative flex flex-col justify-between rounded-3xl p-5 shadow-xs transition hover:shadow-md"
              >
                <div>
                  {/* Top: Status & Date */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-semibold ${currentBadge.bg} ${currentBadge.color}`}
                    >
                      {ar ? currentBadge.ar : currentBadge.en}
                    </span>

                    <span className="flex items-center gap-1 text-[11px] text-muted">
                      <Calendar className="size-3" />
                      {new Date(client.created_at).toLocaleDateString(
                        ar ? 'ar-EG' : 'en-GB',
                        {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        },
                      )}
                    </span>
                  </div>

                  {/* Client Name & Company */}
                  <h3 className="mt-3 text-lg font-bold text-ink" dir="auto">
                    {client.client_name}
                  </h3>

                  {client.company_name && (
                    <p
                      className="flex items-center gap-1.5 text-xs text-muted mt-1"
                      dir="auto"
                    >
                      <Building2 className="size-3.5 shrink-0" />
                      <span>{client.company_name}</span>
                    </p>
                  )}

                  {/* Contact details */}
                  <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-xs">
                    {client.phone && (
                      <p className="flex items-center gap-2 text-ink" dir="ltr">
                        <Phone className="size-3.5 text-muted shrink-0" />
                        <a
                          href={`tel:${client.phone}`}
                          className="hover:underline"
                        >
                          {client.phone}
                        </a>
                      </p>
                    )}

                    {client.email && (
                      <p className="flex items-center gap-2 text-ink truncate" dir="ltr">
                        <Mail className="size-3.5 text-muted shrink-0" />
                        <a
                          href={`mailto:${client.email}`}
                          className="hover:underline truncate"
                        >
                          {client.email}
                        </a>
                      </p>
                    )}

                    {client.service_requested && (
                      <p className="flex items-center gap-2 text-muted" dir="auto">
                        <Briefcase className="size-3.5 text-muted shrink-0" />
                        <span className="truncate">{client.service_requested}</span>
                      </p>
                    )}

                    {Number(client.deal_value) > 0 && (
                      <p className="flex items-center gap-2 font-semibold text-emerald-600 dark:text-emerald-400">
                        <DollarSign className="size-3.5 shrink-0" />
                        <span>
                          {Number(client.deal_value).toLocaleString()}{' '}
                          {ar ? 'ج.م' : 'EGP'}
                        </span>
                      </p>
                    )}
                  </div>

                  {client.notes && (
                    <div className="mt-3 rounded-xl bg-surface/70 p-2.5 text-xs text-muted">
                      <p className="line-clamp-2" dir="auto">
                        {client.notes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Bottom: Sales rep info & Status switcher */}
                <div className="mt-4 border-t border-line pt-3 space-y-2">
                  {/* Sales Rep Badge with UUID */}
                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
                    <div className="flex items-center gap-1.5 truncate">
                      <User className="size-3.5 shrink-0 text-lavender" />
                      <span className="font-medium text-ink truncate">
                        {repName}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 font-mono text-[10px]">
                      <span className="text-muted">ID:</span>
                      <span className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">
                        {client.sales_id.slice(0, 6)}…
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(client.sales_id, client.id)
                        }
                        className="hover:text-ink transition"
                        title={ar ? 'نسخ Sales UUID' : 'Copy Sales UUID'}
                      >
                        {copiedId === client.id ? (
                          <Check className="size-3 text-emerald-500" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Quick status update */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-muted">
                      {ar ? 'تحديث الحالة:' : 'Change Stage:'}
                    </span>
                    <select
                      value={client.status}
                      onChange={e => updateStatus(client.id, e.target.value)}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-semibold text-ink"
                    >
                      {Object.entries(statusLabels).map(([key, item]) => (
                        <option key={key} value={key}>
                          {ar ? item.ar : item.en}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
