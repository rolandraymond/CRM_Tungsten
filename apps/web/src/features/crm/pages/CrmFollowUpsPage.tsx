import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import { useCrmLang } from '../useCrmLang';
import type { CrmActivity, CrmContact } from '../types';
import {
  Clock,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Circle,
  Check,
  Plus,
  MessageCircle,
  Phone,
  User,
  X,
  ExternalLink,
} from 'lucide-react';

export default function CrmFollowUpsPage() {
  const { activeWorkspace, apiFetch } = useCrm();
  const { dir, tr, fmtNum, fmtDate } = useCrmLang();

  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const loadFollowUps = useCallback(async () => {
    if (!activeWorkspace) {
      setLoading(false);
      return;
    }
    if (activities.length === 0) {
      setLoading(true);
    }
    try {
      const [actRes, contRes] = await Promise.all([
        apiFetch<{ data: CrmActivity[] }>(
          `/api/crm/workspaces/${activeWorkspace.id}/activities?activity_type=متابعة`
        ),
        apiFetch<{ data: CrmContact[] }>(
          `/api/crm/workspaces/${activeWorkspace.id}/contacts?limit=100`
        ),
      ]);
      setActivities(actRes.data || []);
      setContacts(contRes.data || []);
    } catch (err: any) {
      console.error('[Load Follow-ups Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadFollowUps();
  }, [loadFollowUps]);

  async function handleToggle(id: string) {
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities/${id}/toggle-complete`, {
        method: 'POST',
      });
      void loadFollowUps();
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  const overdue = useMemo(() => {
    return activities.filter((a) => {
      if (a.completion_status === 'مكتمل' || !a.due_date) return false;
      return a.due_date.slice(0, 10) < todayStr;
    });
  }, [activities, todayStr]);

  const dueToday = useMemo(() => {
    return activities.filter((a) => {
      if (a.completion_status === 'مكتمل' || !a.due_date) return false;
      return a.due_date.slice(0, 10) === todayStr;
    });
  }, [activities, todayStr]);

  const upcoming = useMemo(() => {
    return activities.filter((a) => {
      if (a.completion_status === 'مكتمل') return false;
      if (!a.due_date) return true;
      return a.due_date.slice(0, 10) > todayStr;
    });
  }, [activities, todayStr]);

  const completed = useMemo(() => {
    return activities.filter((a) => a.completion_status === 'مكتمل');
  }, [activities]);

  function formatDateTime(dt?: string | null) {
    if (!dt) return null;
    const dObj = new Date(dt);
    const dateStr = fmtDate(dt);
    const timeStr = dObj.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return { dateStr, timeStr };
  }

  function renderGroup(
    title: string,
    list: CrmActivity[],
    icon: any,
    borderClass: string,
    bgBadge: string,
    emptyMessage: string
  ) {
    const IconComp = icon;
    return (
      <div className={`rounded-2xl border ${borderClass} bg-surface p-5 shadow-sm`}>
        <div className="flex items-center justify-between border-b border-line pb-3 mb-3">
          <div className="flex items-center gap-2">
            <IconComp className="h-4 w-4" />
            <h3 className="text-sm font-bold text-ink">{title}</h3>
          </div>
          <span className={`rounded-md px-2.5 py-0.5 text-xs font-bold ${bgBadge}`}>
            {list.length}
          </span>
        </div>

        {list.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted">{emptyMessage}</div>
        ) : (
          <div className="divide-y divide-line/60">
            {list.map((item) => {
              const dtFormatted = formatDateTime(item.due_date || item.performed_at || item.created_at);
              const cleanPhone = (item.crm_contacts?.phone_number || '').replace(/\D/g, '');

              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0 text-xs transition hover:bg-surface/40 p-2 rounded-xl"
                >
                  <div className="flex items-start gap-3 flex-1 min-w-[260px]">
                    <button
                      onClick={() => handleToggle(item.id)}
                      className="mt-0.5 text-muted hover:text-emerald-500 transition shrink-0"
                      title={item.completion_status === 'مكتمل' ? 'إعادة فتح المتابعة' : 'إتمام المتابعة'}
                    >
                      {item.completion_status === 'مكتمل' ? (
                        <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-white" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4
                          className={`font-bold text-sm ${
                            item.completion_status === 'مكتمل' ? 'line-through text-muted' : 'text-ink'
                          }`}
                        >
                          {item.title}
                        </h4>
                        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                          {item.activity_type}
                        </span>
                      </div>

                      {item.details && (
                        <p className={`text-muted text-xs leading-relaxed ${item.completion_status === 'مكتمل' ? 'line-through' : ''}`}>
                          {item.details}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted">
                        {item.crm_contacts?.full_name && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3 text-muted" />
                            <span>العميل:</span>
                            {item.contact_id ? (
                              <Link
                                to={`/crm/contacts/${item.contact_id}`}
                                className="font-bold text-amber-600 hover:underline flex items-center gap-0.5"
                              >
                                <span>{item.crm_contacts.full_name}</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </Link>
                            ) : (
                              <strong className="text-ink">{item.crm_contacts.full_name}</strong>
                            )}
                          </div>
                        )}

                        {item.crm_contacts?.phone_number && (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-ink">({item.crm_contacts.phone_number})</span>
                            {cleanPhone && (
                              <a
                                href={`https://wa.me/${cleanPhone.startsWith('0') ? '2' + cleanPhone : cleanPhone}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded hover:bg-emerald-500/20 transition"
                              >
                                <MessageCircle className="h-3 w-3" />
                                <span>واتساب</span>
                              </a>
                            )}
                            <a
                              href={`tel:${item.crm_contacts.phone_number}`}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-500/10 px-2 py-0.5 rounded hover:bg-blue-500/20 transition"
                            >
                              <Phone className="h-3 w-3" />
                              <span>اتصال</span>
                            </a>
                          </div>
                        )}

                        {/* Date & Time (التاريخ والساعة) */}
                        {dtFormatted && (
                          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink shadow-2xs">
                            <Calendar className="h-3 w-3 text-amber-500" />
                            <span>{dtFormatted.dateStr}</span>
                            <span className="text-line">•</span>
                            <Clock className="h-3 w-3 text-blue-500" />
                            <span className="font-bold text-amber-600">{dtFormatted.timeStr}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggle(item.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        item.completion_status === 'مكتمل'
                          ? 'bg-surface border border-line text-muted hover:text-ink'
                          : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border border-emerald-500/20'
                      }`}
                    >
                      {item.completion_status === 'مكتمل' ? tr('إعادة فتح', 'Reopen') : tr('إتمام المتابعة', 'Mark Done')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6" dir={dir}>
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveTab('all')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === 'all'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'border border-line bg-surface/50 text-muted hover:text-ink'
            }`}
          >
            {tr(`جميع المتابعات النشطة (${fmtNum(overdue.length + dueToday.length + upcoming.length)})`, `All Active Follow-ups (${fmtNum(overdue.length + dueToday.length + upcoming.length)})`)}
          </button>
          <button
            onClick={() => setActiveTab('today')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === 'today'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'border border-line bg-surface/50 text-muted hover:text-ink'
            }`}
          >
            {tr(`مستحقة اليوم (${fmtNum(dueToday.length)})`, `Due Today (${fmtNum(dueToday.length)})`)}
          </button>
          <button
            onClick={() => setActiveTab('overdue')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === 'overdue'
                ? 'bg-rose-500 text-white shadow-sm'
                : 'border border-line bg-surface/50 text-muted hover:text-ink'
            }`}
          >
            {tr(`متأخرة (${fmtNum(overdue.length)})`, `Overdue (${fmtNum(overdue.length)})`)}
          </button>
          <button
            onClick={() => setActiveTab('upcoming')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === 'upcoming'
                ? 'bg-blue-500 text-white shadow-sm'
                : 'border border-line bg-surface/50 text-muted hover:text-ink'
            }`}
          >
            {tr(`قادمة (${fmtNum(upcoming.length)})`, `Upcoming (${fmtNum(upcoming.length)})`)}
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === 'completed'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'border border-line bg-surface/50 text-muted hover:text-ink'
            }`}
          >
            {tr(`المكتملة (${fmtNum(completed.length)})`, `Completed (${fmtNum(completed.length)})`)}
          </button>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" />
          <span>{tr('جدولة متابعة جديدة', 'Schedule Follow-up')}</span>
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-xs text-muted">{tr('جاري تحميل سجل المتابعات...', 'Loading follow-ups...')}</div>
      ) : (
        <div className="space-y-6">
          {(activeTab === 'all' || activeTab === 'overdue') &&
            renderGroup(
              tr('متابعات متأخرة تحتاج اهتماماً عاجلاً', 'Overdue Follow-ups Requiring Attention'),
              overdue,
              AlertTriangle,
              'border-rose-500/30',
              'bg-rose-500/10 text-rose-600',
              tr('لا توجد متابعات متأخرة حالياً، رائع!', 'No overdue follow-ups right now!')
            )}

          {(activeTab === 'all' || activeTab === 'today') &&
            renderGroup(
              tr('متابعات مستحقة اليوم', 'Due Today'),
              dueToday,
              Clock,
              'border-amber-500/30',
              'bg-amber-500/10 text-amber-600',
              tr('لا توجد متابعات مستحقة لليوم', 'No follow-ups due today')
            )}

          {(activeTab === 'all' || activeTab === 'upcoming') &&
            renderGroup(
              tr('متابعات قادمة مجدولة', 'Upcoming Scheduled Follow-ups'),
              upcoming,
              Calendar,
              'border-blue-500/30',
              'bg-blue-500/10 text-blue-600',
              tr('لا توجد متابعات مجدولة قادمة', 'No upcoming follow-ups scheduled')
            )}

          {(activeTab === 'all' || activeTab === 'completed') &&
            renderGroup(
              tr('المتابعات المكتملة', 'Completed Follow-ups'),
              completed,
              Check,
              'border-emerald-500/30',
              'bg-emerald-500/10 text-emerald-600',
              tr('لا توجد متابعات مكتملة بعد', 'No completed follow-ups yet')
            )}
        </div>
      )}

      {/* Modal: Schedule Follow-up */}
      {showAddModal && (
        <AddFollowUpModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            void loadFollowUps();
          }}
          contacts={contacts}
        />
      )}
    </div>
  );
}

function AddFollowUpModal({
  onClose,
  onSuccess,
  contacts,
}: {
  onClose: () => void;
  onSuccess: () => void;
  contacts: CrmContact[];
}) {
  const { activeWorkspace, apiFetch } = useCrm();

  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30);
    return d.toISOString().slice(0, 16);
  });
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          activity_type: 'متابعة',
          title,
          details: details || null,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          contact_id: contactId || null,
          completion_status: 'قيد الانتظار',
        }),
      });

      if (contactId && dueDate) {
        // Also update contact follow_up_date
        await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/contacts/${contactId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            follow_up_date: new Date(dueDate).toISOString(),
            activity_status: 'معاودة الاتصال',
          }),
        }).catch(() => {});
      }

      onSuccess();
    } catch (err: any) {
      alert(`خطأ في جدولة المتابعة: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
          <h3 className="text-sm font-bold text-ink">جدولة متابعة جديدة مع عميل</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-muted mb-1">عنوان المتابعة *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: معاودة الاتصال لمناقشة العرض المالي، تأكيد موعد الزيارة"
              required
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink outline-none focus:border-amber-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-muted mb-1">العميل المستهدف</label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink outline-none focus:border-amber-500"
              >
                <option value="">-- اختر العميل --</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} ({c.phone_number || ''})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-muted mb-1">تاريخ ووقت المتابعة (التاريخ والساعة) *</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">تفاصيل وملاحظات المتابعة</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="ما الذي تم الاتفاق عليه أو ما المطلوب مناقشته مع العميل..."
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2 text-xs font-semibold text-muted hover:bg-surface/80"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {submitting ? 'جاري الحفظ...' : 'تأكيد وحفظ المتابعة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
