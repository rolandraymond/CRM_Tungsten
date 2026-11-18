import { useEffect, useState, useCallback } from 'react';
import { useCrm } from '../CrmContext';
import { useCrmLang } from '../useCrmLang';
import type { DashboardData, DealStage } from '../types';
import { DEAL_STAGES } from '../types';
import {
  TrendingUp,
  DollarSign,
  Trophy,
  Users,
  CheckCircle2,
  Calendar,
  Clock,
  ArrowUpRight,
  Activity as ActivityIcon,
  PhoneCall,
  UserCheck,
  CheckSquare,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';

export default function CrmDashboardPage() {
  const { activeWorkspace, apiFetch, isLoading: isCrmLoading } = useCrm();
  const { ar, dir, tr, fmtNum, fmtCurrency, fmtDate, labelDealStage, labelMeetingStatus, labelActivityType, labelCompletionStatus } = useCrmLang();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    setError(null);
    try {
      const res = await apiFetch<DashboardData>(`/api/crm/workspaces/${activeWorkspace.id}/dashboard`);
      setData(res);
      setError(null);
    } catch (err: any) {
      console.error('[Dashboard Error]', err);
      setError(err.message || 'فشل تحميل بيانات لوحة التحكم');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleToggleActivity(activityId: string) {
    if (!activeWorkspace) return;
    try {
      await apiFetch(`/api/crm/workspaces/${activeWorkspace.id}/activities/${activityId}/toggle-complete`, {
        method: 'POST',
      });
      void loadDashboard();
    } catch (err) {
      console.error('Failed to toggle activity', err);
    }
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-rose-600">
        <p className="font-semibold">{error}</p>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            void loadDashboard();
          }}
          className="mt-3 rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-600"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (loading || isCrmLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  const { metrics, stageDistribution, upcomingMeetings, pendingTasks, recentActivities } = data;

  const stageColors: Record<DealStage, string> = {
    'مكالمة': 'bg-blue-500',
    'زيارة': 'bg-cyan-500',
    'عرض سعر': 'bg-indigo-500',
    'عقد': 'bg-amber-500',
    'عميل': 'bg-emerald-500',
    'خسارة مغلقة': 'bg-rose-500',
    'غير مؤهل': 'bg-gray-400',
    'فقدان العميل': 'bg-rose-700',
  };

  return (
    <div className="space-y-6" dir={dir}>
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Pipeline Value */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">{tr('قيمة مسار الصفقات (Pipeline Value)', 'Pipeline Value')}</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-ink font-mono">
              {fmtNum(metrics.pipelineValue)}
            </span>
            <span className="text-xs font-bold text-muted">{tr('ج.م', 'EGP')}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {tr(`إجمالي ${fmtNum(metrics.totalDeals)} صفقة نشطة`, `Total ${fmtNum(metrics.totalDeals)} active deals`)}
          </div>
        </div>

        {/* Won Value */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">{tr('الصفقات الرابحة (عملاء)', 'Won Deals Value')}</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
              <Trophy className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-600 font-mono">
              {fmtNum(metrics.wonValue)}
            </span>
            <span className="text-xs font-bold text-muted">{tr('ج.م', 'EGP')}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {tr(`${fmtNum(metrics.wonDeals)} صفقات مغلقة بنجاح`, `${fmtNum(metrics.wonDeals)} closed won deals`)}
          </div>
        </div>

        {/* Win Rate */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">{tr('معدل التحويل (Win Rate)', 'Win Rate')}</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-ink font-mono">{fmtNum(metrics.winRate)}%</span>
            <span className="text-xs font-bold text-emerald-500">
              <ArrowUpRight className="inline h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {tr('من إجمالي الصفقات المحسومة', 'Of all closed deals')}
          </div>
        </div>

        {/* Total Contacts */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">{tr('إجمالي العملاء المحتملين', 'Total Leads')}</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 text-purple-500">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-ink font-mono">{fmtNum(metrics.totalContacts)}</span>
            <span className="text-xs font-bold text-muted">{tr('عميل / ليد', 'Leads')}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {tr('مسجلين في مساحة العمل', 'Registered in workspace')}
          </div>
        </div>
      </div>

      {/* 8-Stage Pipeline Breakdown */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink">{tr('مراحل الصفقات (Deal Pipeline)', 'Deal Pipeline')}</h3>
            <p className="text-xs text-muted">{tr('توزيع الصفقات على المراحل المعتمدة', 'Distribution of deals across pipeline stages')}</p>
          </div>
          <NavLink
            to="/crm/deals"
            className="flex items-center gap-1 text-xs font-bold text-amber-500 hover:text-amber-600"
          >
            <span>{tr('فتح الصفقات المعتمدة', 'Open Won Deals')}</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </NavLink>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {DEAL_STAGES.map((stage) => {
            const stageData = stageDistribution[stage] || { count: 0, total: 0 };
            return (
              <div
                key={stage}
                className="flex flex-col justify-between rounded-xl border border-line/60 bg-surface/50 p-3 transition hover:border-amber-500/40"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 rounded-full ${stageColors[stage]}`} />
                    <span className="text-xs font-bold text-ink truncate">{labelDealStage(stage)}</span>
                  </div>
                  <div className="mt-2 text-lg font-black text-ink font-mono">{fmtNum(stageData.count)}</div>
                </div>
                <div className="mt-2 border-t border-line/40 pt-1 text-[10px] text-muted font-mono">
                  {fmtCurrency(stageData.total)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two Column Grid: Meetings & Tasks / Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming Meetings & Follow-ups */}
        <div className="space-y-6">
          {/* Upcoming Meetings */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-bold text-ink">{tr('الاجتماعات القادمة', 'Upcoming Meetings')}</h3>
              </div>
              <NavLink to="/crm/meetings" className="text-xs font-bold text-amber-500 hover:underline">
                {tr('عرض الكل', 'View All')}
              </NavLink>
            </div>

            {upcomingMeetings.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">{tr('لا توجد اجتماعات مجدولة حالياً', 'No scheduled meetings')}</div>
            ) : (
              <div className="divide-y divide-line/60">
                {upcomingMeetings.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div>
                      <div className="text-xs font-bold text-ink">{m.title}</div>
                      <div className="text-[11px] text-muted">
                        {tr('العميل:', 'Client:')} {m.crm_contacts?.full_name || tr('غير محدد', 'Unassigned')} •{' '}
                        {m.crm_contacts?.phone_number || ''}
                      </div>
                    </div>
                    <div className={ar ? 'text-left' : 'text-right'}>
                      <span className="inline-block rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                        {labelMeetingStatus(m.meeting_status || 'محجوز')}
                      </span>
                      <div className="text-[10px] text-muted mt-1 font-mono">
                        {m.due_date ? fmtDate(m.due_date) : tr('قريباً', 'Soon')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Tasks */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-bold text-ink">{tr('المهام والمتابعات المعلقة', 'Pending Tasks & Follow-ups')}</h3>
              </div>
              <NavLink to="/crm/activities" className="text-xs font-bold text-amber-500 hover:underline">
                {tr('عرض الكل', 'View All')}
              </NavLink>
            </div>

            {pendingTasks.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted">{tr('لا توجد مهام معلقة', 'No pending tasks')}</div>
            ) : (
              <div className="divide-y divide-line/60">
                {pendingTasks.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleToggleActivity(t.id)}
                        className="h-5 w-5 rounded border border-line hover:border-emerald-500 flex items-center justify-center text-transparent hover:text-emerald-500 transition"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                      <div>
                        <div className="text-xs font-bold text-ink">{t.title}</div>
                        <div className="text-[11px] text-muted">
                          {t.crm_contacts?.full_name ? `${tr('العميل:', 'Client:')} ${t.crm_contacts.full_name}` : labelActivityType(t.activity_type)}
                        </div>
                      </div>
                    </div>
                    <div className="text-[10px] font-semibold text-muted font-mono">
                      {t.due_date ? fmtDate(t.due_date) : tr('غير محدد', 'Unset')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Activities Feed */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-purple-500" />
              <h3 className="text-sm font-bold text-ink">{tr('آخر الأنشطة والعمليات', 'Recent Activities')}</h3>
            </div>
            <NavLink to="/crm/activities" className="text-xs font-bold text-amber-500 hover:underline">
              {tr('سجل الأنشطة', 'Activity Log')}
            </NavLink>
          </div>

          {recentActivities.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted">{tr('لم يتم تسجيل أي أنشطة بعد', 'No activities logged yet')}</div>
          ) : (
            <div className="space-y-3">
              {recentActivities.map((act: any) => (
                <div
                  key={act.id}
                  className="flex items-start gap-3 rounded-xl border border-line/60 bg-surface/30 p-3 text-xs"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                    {act.activity_type === 'مكالمة' && <PhoneCall className="h-3.5 w-3.5" />}
                    {act.activity_type === 'اجتماع' && <Calendar className="h-3.5 w-3.5" />}
                    {act.activity_type === 'مهمة' && <CheckSquare className="h-3.5 w-3.5" />}
                    {act.activity_type === 'متابعة' && <Clock className="h-3.5 w-3.5" />}
                    {act.activity_type === 'ملاحظة' && <UserCheck className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">{act.title}</span>
                      <span className="text-[10px] text-muted font-mono">
                        {new Date(act.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {act.details && <p className="mt-1 text-[11px] text-muted">{act.details}</p>}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                      <span>{tr('النوع:', 'Type:')} {labelActivityType(act.activity_type)}</span>
                      {act.crm_contacts?.full_name && <span>• {tr('العميل:', 'Client:')} {act.crm_contacts.full_name}</span>}
                      <span>• {tr('الحالة:', 'Status:')} {labelCompletionStatus(act.completion_status)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
