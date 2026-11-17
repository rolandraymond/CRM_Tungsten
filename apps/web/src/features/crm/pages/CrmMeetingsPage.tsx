import React, { useEffect, useState, useCallback } from 'react';
import { useCrm } from '../CrmContext';
import type { CrmActivity, CrmContact, MeetingStatus } from '../types';
import {
  Calendar,
  Clock,
  User,
  Phone,
  Plus,
} from 'lucide-react';

export default function CrmMeetingsPage() {
  const { activeWorkspace, apiFetch } = useCrm();

  const [meetings, setMeetings] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  const loadMeetings = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    if (meetings.length === 0) {
      setLoading(true);
    }
    try {
      const parts = ['activity_type=اجتماع'];
      if (statusFilter !== 'all') parts.push(`meeting_status=${encodeURIComponent(statusFilter)}`);
      const qs = `?${parts.join('&')}`;

      const res = await apiFetch<{ data: CrmActivity[] }>(
        `/api/crm/workspaces/${activeWorkspace.id}/activities${qs}`
      );
      setMeetings(res.data || []);
    } catch (err: any) {
      console.error('[Load Meetings Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch, statusFilter]);

  const loadContacts = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const res = await apiFetch<{ data: CrmContact[] }>(
        `/api/crm/workspaces/${activeWorkspace.id}/contacts?limit=100`
      );
      setContacts(res.data || []);
    } catch {
      // ignore
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadMeetings();
    void loadContacts();
  }, [loadMeetings, loadContacts]);

  async function handleUpdateStatus(meetingId: string, status: MeetingStatus) {
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities/${meetingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ meeting_status: status }),
      });
      setMeetings((prev) =>
        prev.map((m) => (m.id === meetingId ? { ...m, meeting_status: status } : m))
      );
    } catch (err: any) {
      alert(`فشل تحديث الحالة: ${err.message}`);
    }
  }

  const statusColors: Record<MeetingStatus, string> = {
    'محجوز': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    'حضر': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    'لم يحضر': 'bg-rose-500/10 text-rose-600 border-rose-500/20',
    'ملغي': 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-line bg-surface/50 px-3 py-2 text-xs font-medium text-ink outline-none"
          >
            <option value="all">جميع حالات الاجتماعات</option>
            <option value="محجوز">محجوز</option>
            <option value="حضر">حضر</option>
            <option value="لم يحضر">لم يحضر</option>
            <option value="ملغي">ملغي</option>
          </select>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" />
          <span>جدولة اجتماع جديد</span>
        </button>
      </div>

      {/* Meetings List */}
      <div className="rounded-2xl border border-line bg-surface shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-xs text-muted">جاري تحميل الاجتماعات...</div>
        ) : meetings.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted">لا توجد اجتماعات مسجلة في هذا القسم</div>
        ) : (
          <div className="divide-y divide-line/60">
            {meetings.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-4 p-4 text-xs transition hover:bg-surface/50"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                    <Calendar className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-ink text-sm">{m.title}</h4>
                    {m.details && <p className="text-muted mt-0.5">{m.details}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-muted text-[11px]">
                      {m.crm_contacts?.full_name && (
                        <div className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5 text-muted" />
                          <span className="font-medium text-ink">{m.crm_contacts.full_name}</span>
                        </div>
                      )}
                      {m.crm_contacts?.phone_number && (
                        <div className="flex items-center gap-1 font-mono">
                          <Phone className="h-3.5 w-3.5 text-muted" />
                          <span>{m.crm_contacts.phone_number}</span>
                        </div>
                      )}
                      {/* Date & Time Display (الوقت والتاريخ لجميع الاجتماعات) */}
                      {(() => {
                        const dt = m.due_date || m.start_date || m.created_at;
                        if (!dt) return null;
                        const dObj = new Date(dt);
                        const dateStr = dObj.toLocaleDateString('ar-EG', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        });
                        const timeStr = dObj.toLocaleTimeString('ar-EG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        });

                        return (
                          <div className="flex items-center gap-2 rounded-lg border border-line/80 bg-surface/80 px-2.5 py-1 text-[11px] font-mono text-ink shadow-2xs">
                            <Calendar className="h-3.5 w-3.5 text-amber-500" />
                            <span className="font-semibold">{dateStr}</span>
                            <span className="text-line">•</span>
                            <Clock className="h-3.5 w-3.5 text-blue-500" />
                            <span className="font-bold text-amber-600">{timeStr}</span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* Status Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-muted text-[11px]">حالة الحضور:</span>
                  <select
                    value={m.meeting_status || 'محجوز'}
                    onChange={(e) => handleUpdateStatus(m.id, e.target.value as MeetingStatus)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold outline-none transition ${
                      statusColors[m.meeting_status || 'محجوز']
                    }`}
                  >
                    <option value="محجوز">محجوز</option>
                    <option value="حضر">حضر</option>
                    <option value="لم يحضر">لم يحضر</option>
                    <option value="ملغي">ملغي</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Schedule Meeting */}
      {showAddModal && (
        <ScheduleMeetingModal
          contacts={contacts}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            void loadMeetings();
          }}
        />
      )}
    </div>
  );
}

function ScheduleMeetingModal({
  contacts,
  onClose,
  onSuccess,
}: {
  contacts: CrmContact[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { activeWorkspace, apiFetch } = useCrm();

  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [contactId, setContactId] = useState('');
  const [meetingStatus, setMeetingStatus] = useState<MeetingStatus>('محجوز');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          activity_type: 'اجتماع',
          title,
          details: details || null,
          due_date: dueDate || null,
          contact_id: contactId || null,
          meeting_status: meetingStatus,
        }),
      });
      onSuccess();
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <h3 className="text-sm font-bold text-ink mb-4 border-b border-line pb-3">جدولة اجتماع جديد</h3>
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-muted mb-1">عنوان الاجتماع *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: جلسة عرض النظام، اجتماع توقيع العقد"
              required
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-muted mb-1">العميل</label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
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
              <label className="block font-medium text-muted mb-1">موعد وتوقيت الاجتماع *</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">حالة الاجتماع</label>
            <select
              value={meetingStatus}
              onChange={(e) => setMeetingStatus(e.target.value as MeetingStatus)}
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            >
              <option value="محجوز">محجوز</option>
              <option value="حضر">حضر</option>
              <option value="لم يحضر">لم يحضر</option>
              <option value="ملغي">ملغي</option>
            </select>
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">الأجندة وملاحظات الاجتماع</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="المكان (أونلاين / مقر العيادة)، المحاور المطلوبة..."
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
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
              {submitting ? 'جاري الجدولة...' : 'تأكيد الحجز'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
