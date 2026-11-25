import { useEffect, useState, useCallback } from 'react';
import { useCrm } from '../CrmContext';
import { useCrmLang } from '../useCrmLang';
import {
  BarChart3,
  Trophy,
  PieChart,
} from 'lucide-react';

export default function CrmAnalyticsPage() {
  const { activeWorkspace, apiFetch } = useCrm();
  const { ar, dir, tr, fmtNum, fmtCurrency } = useCrmLang();

  const [analytics, setAnalytics] = useState<{
    platforms: Record<string, { total: number; converted: number }>;
    repPerformance: Array<{
      name: string;
      dealsCount: number;
      totalValue: number;
      wonCount: number;
      wonValue: number;
    }>;
  } | null>(null);

  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    if (!analytics) {
      setLoading(true);
    }
    try {
      const res = await apiFetch<any>(
        `/api/crm/workspaces/${activeWorkspace.id}/analytics`
      );
      setAnalytics(res);
    } catch (err: any) {
      console.error('[Load Analytics Error]', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="py-20 text-center text-xs text-muted" dir={dir}>
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent mb-2" />
        <div>{tr('جاري تحليل البيانات وإعداد التقارير...', 'Analyzing data & preparing reports...')}</div>
      </div>
    );
  }

  const platforms = analytics?.platforms || {};
  const reps = analytics?.repPerformance || [];

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">{tr('التقارير وتحليلات الأداء', 'Performance Reports & Analytics')}</h3>
            <p className="text-xs text-muted">
              {tr(
                'قياس كفاءة الحملات الإعلانية ومصادر العملاء، ومتابعة أداء مسؤولي المبيعات',
                'Measure campaign & channel effectiveness and track sales rep performance'
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Source Platforms Effectiveness */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
            <div className="flex items-center gap-2">
              <PieChart className="h-4 w-4 text-amber-500" />
              <h4 className="text-sm font-bold text-ink">{tr('فاعلية القنوات الإعلانية والمصادر', 'Channels & Source Effectiveness')}</h4>
            </div>
          </div>

          {Object.keys(platforms).length === 0 ? (
            <div className="py-12 text-center text-xs text-muted">{tr('لا توجد بيانات كافية', 'Not enough data yet')}</div>
          ) : (
            <div className="space-y-3">
              {Object.entries(platforms).map(([platform, stat]) => {
                const rate = stat.total > 0 ? Math.round((stat.converted / stat.total) * 100) : 0;
                return (
                  <div key={platform} className="rounded-xl border border-line/60 bg-surface/40 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">{platform}</span>
                      <span className="font-mono font-bold text-amber-500">{fmtNum(rate)}% {tr('تحويل', 'Conv.')}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                      <span>{tr('إجمالي العملاء:', 'Total Leads:')} <strong className="font-mono text-ink">{fmtNum(stat.total)}</strong></span>
                      <span>{tr('العملاء المؤهلون/المحولون:', 'Qualified / Converted:')} <strong className="font-mono text-emerald-600">{fmtNum(stat.converted)}</strong></span>
                    </div>
                    {/* Progress bar */}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                      <div
                        className="h-full bg-amber-500 transition-all duration-500"
                        style={{ width: `${rate}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sales Rep Performance Leaderboard */}
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-emerald-500" />
              <h4 className="text-sm font-bold text-ink">{tr('أداء مسؤولي المبيعات (Sales Leaderboard)', 'Sales Leaderboard')}</h4>
            </div>
          </div>

          {reps.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted">{tr('لا توجد صفقات مسجلة لأعضاء الفريق', 'No deals recorded for team members')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className={`w-full text-xs ${ar ? 'text-right' : 'text-left'}`}>
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="pb-2 font-semibold">{tr('المسؤول', 'Rep')}</th>
                    <th className="pb-2 font-semibold">{tr('الصفقات', 'Deals')}</th>
                    <th className="pb-2 font-semibold">{tr('الرابحة', 'Won')}</th>
                    <th className="pb-2 font-semibold">{tr('قيمة الصفقات الرابحة', 'Won Value')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {reps.map((rep, idx) => (
                    <tr key={idx} className="transition hover:bg-surface/50">
                      <td className="py-2.5 font-bold text-ink flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/10 text-[10px] font-bold text-amber-600">
                          {idx + 1}
                        </span>
                        <span>{rep.name}</span>
                      </td>
                      <td className="py-2.5 font-mono text-muted">{fmtNum(rep.dealsCount)}</td>
                      <td className="py-2.5 font-mono font-bold text-emerald-600">{fmtNum(rep.wonCount)}</td>
                      <td className="py-2.5 font-mono font-bold text-amber-500">
                        {fmtCurrency(rep.wonValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
