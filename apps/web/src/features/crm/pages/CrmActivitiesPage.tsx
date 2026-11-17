import React, { useEffect, useState, useCallback } from 'react';
import { useCrm } from '../CrmContext';
import type { CrmActivity, CrmContact, CrmCompany, CrmDeal, WorkspaceMember, ActivityType } from '../types';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Circle,
  X,
  Calendar,
  Clock,
  User,
  Building2,
} from 'lucide-react';

export default function CrmActivitiesPage() {
  const { activeWorkspace, apiFetch } = useCrm();

  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Aux
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);

  const loadActivities = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    if (activities.length === 0) {
      setLoading(true);
    }
    try {
      const parts = [];
      if (activeTab !== 'all') parts.push(`activity_type=${encodeURIComponent(activeTab)}`);
      if (statusFilter !== 'all') parts.push(`completion_status=${encodeURIComponent(statusFilter)}`);
      const qs = parts.length > 0 ? `?${parts.join('&')}` : '';

      const res = await apiFetch<{ data: CrmActivity[] }>(
        `/api/crm/workspaces/${activeWorkspace.id}/activities${qs}`
      );
      setActivities(res.data || []);
    } catch (err: any) {
      console.error('[Load Activities Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch, activeTab, statusFilter]);

  const loadAux = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [conts, comps, dls, mems] = await Promise.all([
        apiFetch<{ data: CrmContact[] }>(`/api/crm/workspaces/${activeWorkspace.id}/contacts?limit=100`),
        apiFetch<{ data: CrmCompany[] }>(`/api/crm/workspaces/${activeWorkspace.id}/companies`),
        apiFetch<{ data: CrmDeal[] }>(`/api/crm/workspaces/${activeWorkspace.id}/deals`),
        apiFetch<{ data: WorkspaceMember[] }>(`/api/crm/workspaces/${activeWorkspace.id}/members`),
      ]);
      setContacts(conts.data || []);
      setCompanies(comps.data || []);
      setDeals(dls.data || []);
      setMembers(mems.data || []);
    } catch {
      // ignore
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadActivities();
    void loadAux();
  }, [loadActivities, loadAux]);

  async function handleToggle(activityId: string) {
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities/${activityId}/toggle-complete`, {
        method: 'POST',
      });
      void loadActivities();
    } catch (err: any) {
      alert(`خطأ: ${err.message}`);
    }
  }

  async function handleDelete(activityId: string) {
    if (!window.confirm('هل أنت متأكد من حذف هذا النشاط؟')) return;
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities/${activityId}`, {
        method: 'DELETE',
      });
      void loadActivities();
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    }
  }

  const tabOptions = [
    { id: 'all', label: 'الكل' },
    { id: 'مهمة', label: 'مهام' },
    { id: 'مكالمة', label: 'مكالمات' },
    { id: 'اجتماع', label: 'اجتماعات' },
    { id: 'متابعة', label: 'متابعات' },
    { id: 'ملاحظة', label: 'ملاحظات' },
  ];

  return (
    <div className="space-y-4">
      {/* Tabs and Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {tabOptions.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'border border-line bg-surface/50 text-muted hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-line bg-surface/50 px-3 py-1.5 text-xs font-medium text-ink outline-none"
          >
            <option value="all">جميع الحالات</option>
            <option value="قيد الانتظار">قيد الانتظار</option>
            <option value="مكتمل">مكتمل</option>
          </select>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" />
          <span>إضافة نشاط أو مهمة</span>
        </button>
      </div>

      {/* Activities List */}
      <div className="rounded-2xl border border-line bg-surface shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-xs text-muted">جاري تحميل الأنشطة...</div>
        ) : activities.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted">لا توجد أنشطة مسجلة في هذا القسم</div>
        ) : (
          <div className="divide-y divide-line/60">
            {activities.map((act) => {
              const isDone = act.completion_status === 'مكتمل';
              return (
                <div
                  key={act.id}
                  className="flex items-start justify-between p-4 transition hover:bg-surface/50 text-xs"
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleToggle(act.id)}
                      className={`mt-0.5 transition ${isDone ? 'text-emerald-500' : 'text-muted hover:text-ink'}`}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-white" />
                      ) : (
                        <Circle className="h-5 w-5" />
                      )}
                    </button>

                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold text-sm ${isDone ? 'line-through text-muted' : 'text-ink'}`}
                        >
                          {act.title}
                        </span>
                        <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                          {act.activity_type}
                        </span>
                      </div>

                      {act.details && (
                        <p className={`mt-1 text-muted text-xs ${isDone ? 'line-through' : ''}`}>
                          {act.details}
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                        {act.crm_contacts?.full_name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3 text-muted" />
                            <span>العميل: <strong className="text-ink">{act.crm_contacts.full_name}</strong></span>
                          </span>
                        )}
                        {act.crm_companies?.company_name && (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3 text-muted" />
                            <span>الشركة: <strong className="text-ink">{act.crm_companies.company_name}</strong></span>
                          </span>
                        )}
                        {act.crm_deals?.deal_name && (
                          <span>الصفقة: <strong className="text-ink">{act.crm_deals.deal_name}</strong></span>
                        )}

                        {/* Date and Hour/Time (التاريخ والساعة لجميع المهام والأنشطة) */}
                        {(() => {
                          const dt = act.due_date || act.start_date || act.performed_at || act.created_at;
                          if (!dt) return null;
                          const dObj = new Date(dt);
                          const dateStr = dObj.toLocaleDateString('ar-EG', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          });
                          const timeStr = dObj.toLocaleTimeString('ar-EG', {
                            hour: '2-digit',
                            minute: '2-digit',
                          });
                          const isDueDate = Boolean(act.due_date);

                          return (
                            <div className="flex items-center gap-2 rounded-lg border border-line/80 bg-surface/80 px-2.5 py-1 text-[11px] font-mono text-ink shadow-2xs">
                              <Calendar className="h-3.5 w-3.5 text-amber-500" />
                              <span>{dateStr}</span>
                              <span className="text-line">•</span>
                              <Clock className="h-3.5 w-3.5 text-blue-500" />
                              <span className="font-bold text-amber-600">{timeStr}</span>
                              <span className="text-[10px] text-muted">({isDueDate ? 'استحقاق' : 'تسجيل'})</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleDelete(act.id)}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-rose-500 transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Create Activity */}
      {showCreateModal && (
        <ActivityFormModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            void loadActivities();
          }}
          contacts={contacts}
          companies={companies}
          deals={deals}
          members={members}
        />
      )}
    </div>
  );
}

function ActivityFormModal({
  onClose,
  onSuccess,
  contacts,
  companies,
  deals,
  members,
}: {
  onClose: () => void;
  onSuccess: () => void;
  contacts: CrmContact[];
  companies: CrmCompany[];
  deals: CrmDeal[];
  members: WorkspaceMember[];
}) {
  const { activeWorkspace, apiFetch } = useCrm();

  const [activityType, setActivityType] = useState<ActivityType>('مهمة');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [contactId, setContactId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [dealId, setDealId] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({
          activity_type: activityType,
          title,
          details: details || null,
          due_date: dueDate || null,
          contact_id: contactId || null,
          company_id: companyId || null,
          deal_id: dealId || null,
          assigned_user_id: assignedUserId || null,
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
        <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
          <h3 className="text-sm font-bold text-ink">إضافة نشاط أو مهمة جديدة</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium text-muted mb-1">نوع النشاط *</label>
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value as ActivityType)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold text-amber-500"
              >
                <option value="مهمة">مهمة (Task)</option>
                <option value="مكالمة">مكالمة هاتفية (Call)</option>
                <option value="اجتماع">اجتماع (Meeting)</option>
                <option value="متابعة">متابعة (Follow-up)</option>
                <option value="ملاحظة">ملاحظة (Note)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-muted mb-1">تاريخ ووقت الاستحقاق (التاريخ والساعة)</label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              />
            </div>
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">عنوان النشاط / المهمة *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثال: الاتصال لتأكيد موعد العرض، متابعة توقيع العقد"
              required
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">التفاصيل / ملاحظات</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="تفاصيل المكالمة أو ما تم مناقشته..."
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-muted mb-1">ربط بعميل</label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              >
                <option value="">-- اختياري --</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-muted mb-1">ربط بشركة</label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              >
                <option value="">-- اختياري --</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-medium text-muted mb-1">ربط بصفقة</label>
              <select
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              >
                <option value="">-- اختياري --</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.deal_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">تعيين لمسؤول</label>
            <select
              value={assignedUserId}
              onChange={(e) => setAssignedUserId(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            >
              <option value="">-- اختياري (تلقائي الحساب الحالي) --</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </select>
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
              {submitting ? 'جاري الحفظ...' : 'حفظ النشاط'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
