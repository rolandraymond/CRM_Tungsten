import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import type { CrmAuditLog } from '../types';
import {
  History,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Users,
  Filter,
} from 'lucide-react';

export default function CrmAuditLogsPage() {
  const { activeWorkspace, apiFetch } = useCrm();
  const navigate = useNavigate();

  const [logs, setLogs] = useState<CrmAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const [tableFilter, setTableFilter] = useState('');

  const loadAuditLogs = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ data: CrmAuditLog[] }>(
        `/api/crm/workspaces/${activeWorkspace.id}/audit-logs?limit=100`
      );
      setLogs(res.data || []);
    } catch (err: any) {
      console.error('[Load Audit Logs Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadAuditLogs();
  }, [loadAuditLogs]);

  const filteredLogs = logs.filter((log) => {
    if (!tableFilter) return true;
    return log.entity_type?.toLowerCase().includes(tableFilter.toLowerCase());
  });

  const actionLabels: Record<string, { label: string; color: string }> = {
    STAGE_CHANGE: { label: 'تغيير مرحلة الباكدج/الصفقة', color: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
    INSERT: { label: 'إنشاء سجل جديد', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
    UPDATE: { label: 'تحديث بيانات السجل', color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
    DELETE: { label: 'حذف سجل', color: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
    TRANSFER_OWNERSHIP: { label: 'نقل مسؤولية المبيعات', color: 'bg-purple-500/10 text-purple-600 border-purple-500/30' },
    WORKSPACE_ACTIVATED: { label: 'تفعيل مساحة العمل', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
    WORKSPACE_DEACTIVATED: { label: 'تعطيل مساحة العمل', color: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
  };

  const entityLabels: Record<string, string> = {
    crm_deals: 'الصفقات والباكدجات (Deals)',
    crm_contacts: 'العملاء المحتملون (Contacts)',
    crm_companies: 'الشركات (Companies)',
    crm_activities: 'الأنشطة والمهام (Activities)',
    crm_workspace_members: 'أعضاء الفريق (Members)',
  };

  function getLogSummary(log: CrmAuditLog) {
    const nv = log.new_values || {};
    const ov = log.old_values || {};

    if (log.entity_type === 'crm_deals') {
      const dealName = nv.deal_name || ov.deal_name || 'صفقة';
      const amount = Number(nv.deal_amount || ov.deal_amount || 0).toLocaleString('ar-EG');
      if (log.action === 'STAGE_CHANGE') {
        return {
          title: dealName,
          desc: `تم تغيير مرحلة الصفقة من [${ov.deal_stage || '—'}] إلى [${nv.deal_stage || '—'}] • قيمة الباكدج: ${amount} ج.م`,
          targetRoute: '/crm/deals',
        };
      }
      return {
        title: dealName,
        desc: `صفقة بقيمة ${amount} ج.م • المرحلة: ${nv.deal_stage || ov.deal_stage || '—'}`,
        targetRoute: '/crm/deals',
      };
    }

    if (log.entity_type === 'crm_contacts') {
      const name = nv.full_name || ov.full_name || 'عميل';
      const status = nv.lead_status || ov.lead_status || 'جديد';
      const phone = nv.phone_number || ov.phone_number || '';
      return {
        title: name,
        desc: `عميل محتمل • الحالة: [${status}] • الهاتف: ${phone || '—'}`,
        targetRoute: '/crm/contacts',
      };
    }

    if (log.entity_type === 'crm_activities') {
      const title = nv.title || ov.title || 'نشاط';
      const type = nv.activity_type || ov.activity_type || 'مهمة';
      const status = nv.completion_status || ov.completion_status || 'قيد الانتظار';
      return {
        title,
        desc: `نشاط من نوع [${type}] • حالة الإنجاز: [${status}]`,
        targetRoute: '/crm/activities',
      };
    }

    return {
      title: log.entity_type || 'سجل',
      desc: `تم تنفيذ عملية ${log.action} على السجل`,
      targetRoute: null,
    };
  }

  return (
    <div className="space-y-4">
      {/* Informative Guidance Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs shadow-sm">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-amber-600 shrink-0" />
          <div>
            <div className="font-bold text-ink">سجل التدقيق الأمني العام لكافة عمليات النظام (System Audit Log)</div>
            <p className="text-muted mt-0.5">
              هذا السجل يعرض التتبع الشامل لعمليات قاعدة البيانات. للاطلاع على **بروفايل عميل محدد** والباكدج والهستوري المخصص له، يرجى فتح قسم **العملاء**.
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/crm/contacts')}
          className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 font-bold text-white shadow-sm hover:bg-amber-600 transition"
        >
          <Users className="h-4 w-4" />
          <span>فتح قائمة بروفايل العملاء والباكدجات ←</span>
        </button>
      </div>

      {/* Header & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-ink">سجل حركات النظام والصفقات (Audit Trail)</h3>
          <p className="text-xs text-muted">
            إجمالي {filteredLogs.length} حركة مسجلة تلقائياً
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted" />
          <select
            value={tableFilter}
            onChange={(e) => setTableFilter(e.target.value)}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-ink outline-none"
          >
            <option value="">جميع الأقسام والسجلات</option>
            <option value="crm_deals">الصفقات والباكدجات (Deals)</option>
            <option value="crm_contacts">العملاء (Contacts)</option>
            <option value="crm_activities">الأنشطة (Activities)</option>
            <option value="crm_companies">الشركات (Companies)</option>
          </select>
        </div>
      </div>

      {/* Human-Friendly Audit Log Table */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-line bg-surface/70 text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">التاريخ والتوقيت</th>
                <th className="px-4 py-3 font-semibold">نوع العملية</th>
                <th className="px-4 py-3 font-semibold">القسم / الجدول</th>
                <th className="px-4 py-3 font-semibold">تفاصيل السجل والتغيير (Summary)</th>
                <th className="px-4 py-3 font-semibold text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-muted">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                      <span>جاري تحميل سجل التدقيق...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-muted">
                    لا توجد حركات مسجلة حالياً
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  const actionInfo = actionLabels[log.action] || {
                    label: log.action,
                    color: 'bg-surface border-line text-ink',
                  };
                  const summary = getLogSummary(log);

                  return (
                    <React.Fragment key={log.id}>
                      <tr className="transition hover:bg-surface/60 group">
                        <td className="px-4 py-3 font-mono text-muted text-[11px] whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('ar-EG', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-lg border px-2.5 py-1 text-[11px] font-bold ${actionInfo.color}`}
                          >
                            {actionInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-ink">
                          {entityLabels[log.entity_type] || log.entity_type}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-ink text-xs">{summary.title}</div>
                          <div className="text-[11px] text-muted mt-0.5 leading-relaxed">{summary.desc}</div>
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            {summary.targetRoute && (
                              <button
                                onClick={() => navigate(summary.targetRoute)}
                                className="inline-flex items-center gap-1 rounded-xl bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-600 hover:bg-amber-500/20 transition"
                                title="عرض السجل والبروفايل"
                              >
                                <span>عرض</span>
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            )}

                            <button
                              onClick={() => setExpandedId(isExpanded ? null : log.id)}
                              className="inline-flex items-center gap-1 rounded-xl border border-line px-2.5 py-1 text-[11px] font-bold text-muted hover:text-ink hover:bg-surface/80 transition"
                            >
                              <span>{isExpanded ? 'إخفاء' : 'التفاصيل'}</span>
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Clean Human-Friendly Diff Viewer */}
                      {isExpanded && (
                        <tr className="bg-surface/40">
                          <td colSpan={5} className="p-4">
                            <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs space-y-3">
                              <div className="font-bold text-ink text-xs flex items-center justify-between">
                                <span>مقارنة القيم المسجلة للعملية:</span>
                                {log.performed_by && (
                                  <span className="text-[11px] font-mono text-muted">
                                    معرف المنفذ: {log.performed_by}
                                  </span>
                                )}
                              </div>

                              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 text-xs">
                                {/* Previous Values Card */}
                                <div className="rounded-xl border border-line/80 bg-rose-500/5 p-3">
                                  <div className="font-bold text-rose-600 mb-2">البيانات السابقة (قبل التعديل):</div>
                                  {!log.old_values ? (
                                    <div className="text-muted text-[11px]">لا توجد بيانات سابقة (سجل جديد)</div>
                                  ) : (
                                    <div className="space-y-1.5 text-[11px]">
                                      {Object.entries(log.old_values).map(([k, v]) => (
                                        <div key={k} className="flex justify-between border-b border-line/40 pb-1">
                                          <span className="text-muted font-medium">{k}:</span>
                                          <span className="font-mono text-ink font-semibold max-w-[200px] truncate">
                                            {v !== null && v !== undefined ? String(v) : '—'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* New Values Card */}
                                <div className="rounded-xl border border-line/80 bg-emerald-500/5 p-3">
                                  <div className="font-bold text-emerald-600 mb-2">البيانات المحدثة (بعد التعديل):</div>
                                  {!log.new_values ? (
                                    <div className="text-muted text-[11px]">تم حذف السجل</div>
                                  ) : (
                                    <div className="space-y-1.5 text-[11px]">
                                      {Object.entries(log.new_values).map(([k, v]) => (
                                        <div key={k} className="flex justify-between border-b border-line/40 pb-1">
                                          <span className="text-muted font-medium">{k}:</span>
                                          <span className="font-mono text-emerald-600 font-bold max-w-[200px] truncate">
                                            {v !== null && v !== undefined ? String(v) : '—'}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
