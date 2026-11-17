import React, { useEffect, useState } from 'react';
import { useCrm } from '../CrmContext';
import {
  Settings,
  Save,
} from 'lucide-react';

export default function CrmSettingsPage() {
  const {
    activeWorkspace,
    apiFetch,
    userRole,
    isPlatformAdmin,
    workspaces,
    refreshWorkspaces,
  } = useCrm();

  const [name, setName] = useState(activeWorkspace?.name || '');
  const [domain, setDomain] = useState(activeWorkspace?.domain || '');
  const [isActive, setIsActive] = useState(activeWorkspace?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (activeWorkspace) {
      setName(activeWorkspace.name);
      setDomain(activeWorkspace.domain || '');
      setIsActive(activeWorkspace.is_active);
    }
  }, [activeWorkspace]);

  const canEditSettings =
    userRole === 'owner' ||
    userRole === 'company_owner' ||
    isPlatformAdmin;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setSuccessMsg('');
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          domain: domain.trim() || null,
          is_active: isActive,
        }),
      });
      setSuccessMsg('تم حفظ إعدادات مساحة العمل بنجاح!');
      await refreshWorkspaces();
    } catch (err: any) {
      alert(`فشل الحفظ: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleOtherWorkspace(wsId: string, currentStatus: boolean) {
    try {
      await apiFetch(`/api/crm/workspaces/${wsId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !currentStatus }),
      });
      await refreshWorkspaces();
    } catch (err: any) {
      alert(`فشل تحديث الحالة: ${err.message}`);
    }
  }

  return (
    <div className="space-y-6">
      {/* Active Workspace Form */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-line pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">إعدادات مساحة العمل (Workspace Settings)</h3>
              <p className="text-xs text-muted">
                إدارة الاسم والنطاق وحالة التفعيل لمساحة العمل الحالية
              </p>
            </div>
          </div>
        </div>

        {successMsg && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-600">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-xs max-w-xl">
          <div>
            <label className="block font-medium text-muted mb-1">اسم مساحة العمل</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEditSettings}
              required
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-bold disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">النطاق الإلكتروني (Domain)</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={!canEditSettings}
              placeholder="company.com"
              className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink font-mono disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block font-medium text-muted mb-1">نوع مساحة العمل (غير قابل للتعديل)</label>
            <input
              type="text"
              value={activeWorkspace?.workspace_type === 'tungsten_internal' ? 'مساحة Tungsten الداخلية (tungsten_internal)' : 'شركة خارجية (client_company)'}
              disabled
              className="w-full rounded-xl border border-line bg-surface/40 p-2.5 text-muted font-mono"
            />
          </div>

          <div className="border-t border-line/60 pt-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={!canEditSettings}
                className="rounded border-line text-amber-500"
              />
              <span className="font-bold text-ink">
                مساحة العمل نشطة (Active Workspace)
              </span>
            </label>
            <p className="text-[11px] text-muted mt-1">
              تعطيل مساحة العمل يمنع جميع الأعضاء من الوصول إلى البيانات التشغيلية فوراً بموجب سياسات RLS.
            </p>
          </div>

          {canEditSettings && (
            <div className="pt-2">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}</span>
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Platform Admin All-Workspaces Directory */}
      {isPlatformAdmin && (
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-ink">إدارة كافة مساحات العمل في المنصة (Platform Admin Overview)</h3>
            <p className="text-xs text-muted">
              عرض والتحكم بحالة تفعيل كافة مساحات الشركات الخارجية ومساحة Tungsten
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="pb-2 font-semibold">اسم مساحة العمل</th>
                  <th className="pb-2 font-semibold">النوع</th>
                  <th className="pb-2 font-semibold">النطاق</th>
                  <th className="pb-2 font-semibold">الحالة</th>
                  <th className="pb-2 font-semibold text-center">التحكم</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {workspaces.map((ws) => (
                  <tr key={ws.id} className="transition hover:bg-surface/50">
                    <td className="py-2.5 font-bold text-ink">{ws.name}</td>
                    <td className="py-2.5 font-mono text-muted text-[11px]">
                      {ws.workspace_type}
                    </td>
                    <td className="py-2.5 font-mono text-muted text-[11px]">
                      {ws.domain || '—'}
                    </td>
                    <td className="py-2.5">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          ws.is_active
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                      >
                        {ws.is_active ? 'نشطة' : 'معطلة'}
                      </span>
                    </td>
                    <td className="py-2.5 text-center">
                      <button
                        onClick={() => handleToggleOtherWorkspace(ws.id, ws.is_active)}
                        className={`rounded-lg px-3 py-1 text-[11px] font-bold transition ${
                          ws.is_active
                            ? 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'
                            : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
                        }`}
                      >
                        {ws.is_active ? 'تعطيل' : 'تفعيل'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
