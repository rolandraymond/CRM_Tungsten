import React, { useEffect, useState, useCallback } from 'react';
import { useCrm } from '../CrmContext';
import type { WorkspaceMember, WorkspaceRole } from '../types';
import {
  UserPlus,
  Trash2,
  Edit2,
  X,
} from 'lucide-react';

export default function CrmTeamPage() {
  const { activeWorkspace, apiFetch, userRole, isPlatformAdmin, isTungstenInternal } = useCrm();

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [editingMember, setEditingMember] = useState<WorkspaceMember | null>(null);

  const loadMembers = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    if (members.length === 0) {
      setLoading(true);
    }
    try {
      const res = await apiFetch<{ data: WorkspaceMember[] }>(
        `/api/crm/workspaces/${activeWorkspace.id}/members`
      );
      setMembers(res.data || []);
    } catch (err: any) {
      console.error('[Load Members Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function handleRemoveMember(memberUserId: string) {
    if (!window.confirm('هل أنت متأكد من إزالة هذا العضو من مساحة العمل؟')) return;
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/members/${memberUserId}`, {
        method: 'DELETE',
      });
      void loadMembers();
    } catch (err: any) {
      alert(`فشل الحذف: ${err.message}`);
    }
  }

  const roleBadgeMap: Record<WorkspaceRole, { label: string; class: string }> = {
    owner: { label: 'Tungsten Owner (المالك الرئيسي)', class: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    manager: { label: 'مدير مبيعات (Manager)', class: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
    sales: { label: 'مسؤول مبيعات (Sales Rep)', class: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    company_owner: { label: 'مالك الشركة (Company Owner)', class: 'bg-purple-500/10 text-purple-600 border-purple-500/20' },
    company_manager: { label: 'مدير الشركة (Company Manager)', class: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20' },
    platform_admin: { label: 'مدير المنصة (Platform Admin)', class: 'bg-rose-500/10 text-rose-600 border-rose-500/20' },
  };

  const managers = members.filter((m) => m.role === 'manager' || m.role === 'owner' || m.role === 'company_owner');

  // Only Owner, Moderator, or Platform Admin can add or edit accounts. Sales Manager cannot add/edit accounts!
  const canManageTeam =
    userRole === 'owner' ||
    userRole === 'company_owner' ||
    (userRole as any) === 'moderator' ||
    isPlatformAdmin;

  return (
    <div className="space-y-6">
      {/* Team Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-ink">أعضاء وهيكل مساحة العمل</h3>
          <p className="text-xs text-muted">
            إدارة صلاحيات الفريق، والتبعية الهرمية بين المدراء ومسؤولي المبيعات
          </p>
        </div>

        {canManageTeam && (
          <button
            onClick={() => setShowAddMemberModal(true)}
            className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
          >
            <UserPlus className="h-4 w-4" />
            <span>إضافة عضو جديد</span>
          </button>
        )}
      </div>

      {/* Members Table */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-line bg-surface/70 text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">العضو</th>
                <th className="px-4 py-3 font-semibold">الدور والصلاحية</th>
                <th className="px-4 py-3 font-semibold">المدير المسؤول (Manager)</th>
                <th className="px-4 py-3 font-semibold">الحالة</th>
                <th className="px-4 py-3 font-semibold">تاريخ الانضمام</th>
                {canManageTeam && <th className="px-4 py-3 font-semibold text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    جاري تحميل الأعضاء...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted">
                    لا يوجد أعضاء مسجلين
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.user_id} className="transition hover:bg-surface/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 font-bold">
                          {member.full_name?.slice(0, 1) || 'U'}
                        </div>
                        <div>
                          <div className="font-bold text-ink">{member.full_name}</div>
                          <div className="text-[11px] text-muted">{member.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md border px-2.5 py-0.5 text-[10px] font-bold ${
                          roleBadgeMap[member.role]?.class || 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {roleBadgeMap[member.role]?.label || member.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {member.role === 'sales' ? (
                        member.manager_name ? (
                          <span className="font-bold text-ink">{member.manager_name}</span>
                        ) : (
                          <span className="text-rose-500 font-medium">غير معين لمدير</span>
                        )
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          member.is_active
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                      >
                        {member.is_active ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(member.created_at).toLocaleDateString('ar-EG')}
                    </td>
                    {canManageTeam && (
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setEditingMember(member)}
                            className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-amber-500"
                            title="تعديل الدور أو المدير"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          {member.role !== 'owner' && member.role !== 'company_owner' && (
                            <button
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="rounded-lg p-1.5 text-muted hover:bg-surface/80 hover:text-rose-500"
                              title="إزالة"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add Team Member */}
      {showAddMemberModal && (
        <AddMemberModal
          onClose={() => setShowAddMemberModal(false)}
          onSuccess={() => {
            setShowAddMemberModal(false);
            void loadMembers();
          }}
          isInternal={isTungstenInternal}
          managers={managers}
        />
      )}

      {/* Modal: Edit Member */}
      {editingMember && (
        <EditMemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSuccess={() => {
            setEditingMember(null);
            void loadMembers();
          }}
          isInternal={isTungstenInternal}
          managers={managers}
        />
      )}

    </div>
  );
}

function AddMemberModal({
  onClose,
  onSuccess,
  isInternal,
  managers,
}: {
  onClose: () => void;
  onSuccess: () => void;
  isInternal: boolean;
  managers: WorkspaceMember[];
}) {
  const { activeWorkspace, apiFetch } = useCrm();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<string>(isInternal ? 'sales' : 'company_manager');
  const [managerId, setManagerId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/members`, {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          role,
          manager_id: role === 'sales' ? managerId || null : null,
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
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
          <h3 className="text-sm font-bold text-ink">إضافة عضو جديد للفريق</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface/80">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-muted mb-1">البريد الإلكتروني *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="user@example.com"
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">الاسم بالكامل *</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              placeholder="مثال: أحمد محمود"
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
            />
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">كلمة المرور المؤقتة</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">الدور والصلاحية *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold text-amber-500"
            >
              {isInternal ? (
                <>
                  <option value="sales">مسؤول مبيعات (Sales Rep)</option>
                  <option value="manager">مدير مبيعات (Manager)</option>
                </>
              ) : (
                <>
                  <option value="sales">مسؤول مبيعات (Sales Rep / موظف مبيعات)</option>
                  <option value="company_manager">مدير الشركة (Company Manager)</option>
                  <option value="company_owner">مالك الشركة (Company Owner)</option>
                </>
              )}
            </select>
          </div>

          {role === 'sales' && (
            <div>
              <label className="block font-medium text-muted mb-1">المدير المسؤول المباشر (Manager) *</label>
              <select
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                required
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              >
                <option value="">-- اختر المدير المسؤول --</option>
                {managers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.email})
                  </option>
                ))}
              </select>
            </div>
          )}

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
              {submitting ? 'جاري الإضافة...' : 'إضافة العضو'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditMemberModal({
  member,
  onClose,
  onSuccess,
  isInternal,
  managers,
}: {
  member: WorkspaceMember;
  onClose: () => void;
  onSuccess: () => void;
  isInternal: boolean;
  managers: WorkspaceMember[];
}) {
  const { activeWorkspace, apiFetch } = useCrm();

  const [role, setRole] = useState(member.role);
  const [managerId, setManagerId] = useState(member.manager_id || '');
  const [isActive, setIsActive] = useState(member.is_active);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/members/${member.user_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          role,
          manager_id: role === 'sales' ? managerId || null : null,
          is_active: isActive,
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
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl" dir="rtl">
        <h3 className="text-sm font-bold text-ink mb-2">تعديل بيانات وصلاحيات العضو</h3>
        <p className="text-xs text-muted mb-4">{member.full_name} ({member.email})</p>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-muted mb-1">الدور والصلاحية</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold text-amber-500"
            >
              {isInternal ? (
                <>
                  <option value="sales">مسؤول مبيعات (Sales Rep)</option>
                  <option value="manager">مدير مبيعات (Manager)</option>
                  <option value="owner">Tungsten Owner</option>
                </>
              ) : (
                <>
                  <option value="sales">مسؤول مبيعات (Sales Rep / موظف مبيعات)</option>
                  <option value="company_manager">مدير الشركة (Company Manager)</option>
                  <option value="company_owner">مالك الشركة (Company Owner)</option>
                </>
              )}
            </select>
          </div>

          {role === 'sales' && (
            <div>
              <label className="block font-medium text-muted mb-1">المدير المسؤول (Manager)</label>
              <select
                value={managerId}
                onChange={(e) => setManagerId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink"
              >
                <option value="">-- بدون مدير --</option>
                {managers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name} ({m.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-line text-amber-500"
              />
              <span className="font-medium text-ink">الحساب نشط في مساحة العمل</span>
            </label>
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
              {submitting ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
