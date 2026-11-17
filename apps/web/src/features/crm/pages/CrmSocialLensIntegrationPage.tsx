import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from '../CrmContext';
import {
  Webhook,
  Copy,
  Check,
  RefreshCw,
  Send,
  User,
  ArrowRight,
  Sparkles,
  Code2,
  ExternalLink,
  Award,
  UserCheck,
  Radio,
  Zap,
} from 'lucide-react';

interface WebhookLog {
  id: string;
  workspace_id: string;
  timestamp: string;
  event: string;
  status: 'success' | 'error';
  status_code: number;
  contact_id?: string;
  contact_name?: string;
  lead_id?: string;
  deal_id?: string;
  sales_rep?: string;
  is_won: boolean;
  lead_status: string;
  deal_stage: string;
  message: string;
  payload: any;
}

export default function CrmSocialLensIntegrationPage() {
  const { activeWorkspace, apiFetch } = useCrm();

  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Test Simulator State
  const [testScenario, setTestScenario] = useState<'new_lead' | 'update_lead' | 'activate_client'>('activate_client');
  const [testLeadName, setTestLeadName] = useState('د. حسام الدين عبد الله');
  const [testPhone, setTestPhone] = useState('01023456789');
  const [testEmail, setTestEmail] = useState('dr.hossam@example.com');
  const [testClinic, setTestClinic] = useState('مركز النخبة لجراحة وتجميل الأسنان');
  const [testSalesRep, setTestSalesRep] = useState('Peter Fahmy');
  const [testAmount, setTestAmount] = useState('35000');
  const [testNotes, setTestNotes] = useState('تم التواصل مع الدكتور والاتفاق على الباقة السنوية بعد الجلسة التعريفية.');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  const [docTab, setDocTab] = useState<'activate' | 'create' | 'update'>('activate');

  const webhookUrl = `${window.location.protocol}//${window.location.hostname}:3001/api/crm/webhooks/sociallens${
    activeWorkspace ? `?workspace_id=${activeWorkspace.id}` : ''
  }`;
  const webhookSecret = 'sl_live_sec_tungsten_2026_x89a';

  const copyToClipboard = (text: string, type: 'url' | 'secret') => {
    void navigator.clipboard.writeText(text);
    if (type === 'url') {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  const loadLogs = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoadingLogs(true);
    try {
      const res = await apiFetch<{ logs: WebhookLog[] }>(
        `/api/crm/webhooks/sociallens/logs?workspace_id=${activeWorkspace.id}`
      );
      setLogs(res.logs || []);
    } catch {
      // ignore
    } finally {
      setLoadingLogs(false);
    }
  }, [activeWorkspace, apiFetch]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  // Execute Simulated Test Webhook
  const handleRunTest = async () => {
    setTesting(true);
    setTestResult(null);

    const isWon = testScenario === 'activate_client';
    const isNew = testScenario === 'new_lead';

    const testPayload = {
      event: isWon ? 'client.activated' : (isNew ? 'lead.created' : 'lead.updated'),
      workspace_id: activeWorkspace?.id,
      lead: {
        lead_id: `SL-${testScenario === 'activate_client' ? 'WON' : 'LEAD'}-${Math.floor(1000 + Math.random() * 9000)}`,
        full_name: testLeadName,
        phone_number: testPhone,
        email: testEmail,
        business_name: testClinic,
        medical_specialty: 'تجميل وجراحة الأسنان',
        clinic_address: 'ميدان التحرير، وسط البلد، القاهرة',
        social_profile_link: 'https://youtube.com/@HalalChef',
        source_platform: 'SocialLens (Instagram Ads)',
        ad_id: 'SL-AD-CAMPAIGN-77',
        lead_status: isWon ? 'عميل نشط' : (isNew ? 'جديد' : 'قيد المتابعة'),
        deal_stage: isWon ? 'عميل' : (isNew ? 'مكالمة' : 'عرض سعر'),
        deal_amount: Number(testAmount) || (isWon ? 22450 : 25000),
        sales_rep: testSalesRep,
        contact_owner: testSalesRep,
        change_reason: isWon
          ? 'تم اعتماد وتفعيل العميل رسمياً وتوقيع العقد وتثبيت مخرجات الخطة المشترك بها (SL-OFFER-MWGIGNAP-8068)'
          : testNotes,
        notes: testNotes,
        plan: isWon
          ? {
              plan_name: 'الباقة الأساسية (Starter)',
              plan_tier: 'starter',
              plan_code: 'SL-OFFER-MWGIGNAP-8068',
              pricing_location: 'تسعير القاهرة',
              price: 22450,
              billing_cycle: 'شهرياً',
              status: 'مشترك بها (معتمدة)',
              badge: 'باقة معتمدة ونشطة',
              description: 'باقة موجهة خصيصاً لاستهداف أضعف نقطة في حسابك (معدل التفاعل وحفظ المحتوى Engagement & Saves) لضمان إيقاف التراجع بأقل استثمار مالي.',
              strategy_goal: '🎯 إيقاف هبوط الحساب ورفع مؤشر معدل التفاعل وحفظ المحتوى (Engagement & Saves) ليظهر أول تحسن ملموس في الفحص القادم.',
              diagnostics: {
                account: 'HalalChef@',
                platform: 'YouTube',
                engagement_rate: '0.5%',
                analysis_date: '14 نوفمبر',
                status_label: 'أداء متوسط بإمكانات واعدة',
              },
              services: [
                {
                  id: '1',
                  title: 'منشورات كاروسيل تفاعلية',
                  quantity: 3,
                  unit_price: 3150,
                  total_price: 9450,
                  description: '3 منشورات كاروسيل تعليمية مكثفة لرفع معدل حفظ المحتوى (Saves) وزيادة وقت التصفح',
                },
                {
                  id: '2',
                  title: 'إدارة الحسابات والصفحات (فيسبوك)',
                  quantity: 1,
                  unit_price: 5000,
                  total_price: 5000,
                  description: 'إدارة صفحة فيسبوك وضبط مواعيد النشر المثالية لمنع تراجع الحساب في الخوارزميات.',
                },
                {
                  id: '3',
                  title: 'خدمة الردود والمتابعة',
                  quantity: 1,
                  unit_price: 8000,
                  total_price: 8000,
                  description: 'خدمة الردود والمتابعة للعملاء والتفاعل السريع.',
                },
              ],
            }
          : undefined,
        history: isWon
          ? [
              {
                type: 'مكالمة',
                title: 'مكالمة أولية للتعريف بخدمات SocialLens وربط المنصات',
                details: 'تم الحديث مع العميل وتحديد موعد عرض النظام',
                author: testSalesRep,
                timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
              },
              {
                type: 'اجتماع',
                title: 'جلسة تقديم العرض المالي وخطة مخرجات الباقة الأساسية',
                details: 'حضر العميل وأبدى موافقته على عرض SL-OFFER-MWGIGNAP-8068 بقيمة 22,450 ج.م شهرياً',
                author: testSalesRep,
                timestamp: new Date(Date.now() - 86400000).toISOString(),
              },
            ]
          : undefined,
      },
    };

    try {
      const targetEndpoint = `/api/crm/webhooks/sociallens${
        activeWorkspace ? `?workspace_id=${activeWorkspace.id}` : ''
      }`;
      const res = await fetch(targetEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-webhook-secret': webhookSecret,
        },
        body: JSON.stringify(testPayload),
      });
      const data = await res.json();
      setTestResult({
        ok: res.ok,
        status: res.status,
        data,
      });
      void loadLogs();
    } catch (err: any) {
      setTestResult({
        ok: false,
        status: 500,
        data: { error: err.message },
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/30">
            <Webhook className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-ink">
                الربط البرمجي مع SocialLens (Webhook Integration)
              </h1>
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                متصل وجاهز للاستقبال
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              استقبال العملاء المحتملين وتحديث حالاتهم وترقيتهم تلقائياً إلى الصفقات المعتمدة (Deals) فور تفعيلهم كعملاء نشطين.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadLogs()}
            disabled={loadingLogs}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface/50 px-3 py-2 text-xs font-bold text-muted hover:text-ink transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
            <span>تحديث السجل</span>
          </button>
          <Link
            to="/crm/deals"
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <Award className="h-4 w-4" />
            <span>الصفقات المعتمدة (Deals)</span>
          </Link>
          <Link
            to="/crm/leads"
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
          >
            <UserCheck className="h-4 w-4" />
            <span>مسار الليدز (Leads)</span>
          </Link>
        </div>
      </div>

      {/* Grid: Webhook Settings & Simulator */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column (5 cols): Webhook Credentials & Info */}
        <div className="space-y-4 lg:col-span-5">
          {/* Webhook URL Box */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-black text-ink flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span>بيانات الربط مع SocialLens</span>
            </h3>

            <div>
              <label className="block text-[11px] font-bold text-muted mb-1.5">
                رابط الويب هوك الخاص بك (Webhook URL):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="w-full rounded-xl border border-line bg-surface/60 px-3 py-2 text-xs font-mono text-ink outline-none selection:bg-amber-500 selection:text-white"
                  dir="ltr"
                />
                <button
                  onClick={() => copyToClipboard(webhookUrl, 'url')}
                  className="flex shrink-0 items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-600"
                  title="نسخ الرابط"
                >
                  {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span>{copiedUrl ? 'تم النسخ' : 'نسخ'}</span>
                </button>
              </div>
              <p className="text-[10px] text-muted mt-1">
                ضع هذا الرابط في قسم الويب هوك (Webhooks / Integrations) في لوحة تحكم SocialLens.
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-muted mb-1.5">
                مفتاح الأمان السري (Webhook Secret Token):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={webhookSecret}
                  className="w-full rounded-xl border border-line bg-surface/60 px-3 py-2 text-xs font-mono text-muted outline-none"
                  dir="ltr"
                />
                <button
                  onClick={() => copyToClipboard(webhookSecret, 'secret')}
                  className="flex shrink-0 items-center gap-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-bold text-muted hover:text-ink transition"
                >
                  {copiedSecret ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  <span>{copiedSecret ? 'تم النسخ' : 'نسخ'}</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-line/60 bg-surface/30 p-3 text-[11px] text-muted space-y-1.5">
              <div className="flex items-center justify-between">
                <span>طريقة الإرسال (HTTP Method):</span>
                <span className="font-mono font-bold text-ink">POST</span>
              </div>
              <div className="flex items-center justify-between">
                <span>نوع المحتوى (Content-Type):</span>
                <span className="font-mono font-bold text-ink">application/json</span>
              </div>
              <div className="flex items-center justify-between">
                <span>الترقية التلقائية:</span>
                <span className="font-bold text-emerald-600">نقل العميل للديلز فور اعتماده</span>
              </div>
              <div className="flex items-center justify-between">
                <span>سجل المتابعة (History):</span>
                <span className="font-bold text-blue-600">حفظ من تابع مع العميل في البروفايل</span>
              </div>
            </div>
          </div>

          {/* Workflow Explanation Banner */}
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-transparent p-5 shadow-sm space-y-3">
            <h4 className="text-xs font-black text-amber-600 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" />
              <span>كيف تعمل المزامنة الذكية؟</span>
            </h4>
            <ul className="space-y-2 text-xs text-muted leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-[10px] font-bold text-amber-600">
                  1
                </span>
                <span>
                  <strong>وصول الليد:</strong> عند وصول عميل جديد من إعلانات SocialLens، يظهر فوراً في <strong>مسار العملاء المحتملين (Leads)</strong>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-[10px] font-bold text-blue-600">
                  2
                </span>
                <span>
                  <strong>المتابعة والمبيعات:</strong> أي تغيير في حالة العميل من موقع السيلز ينعكس فوراً مع تسجيل مسؤول المتابعة (Peter, Hany...).
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-[10px] font-bold text-emerald-600">
                  3
                </span>
                <span>
                  <strong>الترقية إلى عميل نشط:</strong> فور تحول الحالة إلى «عميل نشط» أو «تم الفوز»، ينتقل العميل تلقائياً إلى <strong>الصفقات المعتمدة (Deals)</strong>، ويتم تسجيل تاريخ العملية والهيستوري ومن تابع معه داخل بروفايله.
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right Column (7 cols): Interactive Live Tester */}
        <div className="space-y-4 lg:col-span-7">
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h3 className="text-xs font-black text-ink flex items-center gap-2">
                  <Send className="h-4 w-4 text-emerald-500" />
                  <span>محاكي واختبار الويب هوك التفاعلي (Interactive Tester)</span>
                </h3>
                <p className="text-[11px] text-muted">
                  جرّب إرسال أحداث فورية من SocialLens للتحقق من ترقية العميل وظهوره في البروفايل والديلز:
                </p>
              </div>

              {/* Scenario Toggle Pills */}
              <div className="flex items-center gap-1 rounded-xl border border-line bg-surface/50 p-1">
                <button
                  type="button"
                  onClick={() => setTestScenario('activate_client')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    testScenario === 'activate_client'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  🏆 ترقية لعميل نشط (للديلز)
                </button>
                <button
                  type="button"
                  onClick={() => setTestScenario('new_lead')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    testScenario === 'new_lead'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  📥 ليد جديد (للمسار)
                </button>
                <button
                  type="button"
                  onClick={() => setTestScenario('update_lead')}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                    testScenario === 'update_lead'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  🔄 تحديث حالة
                </button>
              </div>
            </div>

            {/* Test Form Fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">اسم العميل / الدكتور</label>
                <input
                  type="text"
                  value={testLeadName}
                  onChange={(e) => setTestLeadName(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-amber-500 font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-amber-500 font-mono"
                  dir="ltr"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">اسم العيادة / الشركة</label>
                <input
                  type="text"
                  value={testClinic}
                  onChange={(e) => setTestClinic(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">
                  مسؤول المتابعة / السيلز (مين تابع معاه) *
                </label>
                <input
                  type="text"
                  value={testSalesRep}
                  onChange={(e) => setTestSalesRep(e.target.value)}
                  placeholder="مثال: Peter Fahmy أو Hany Fathy"
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-amber-500 font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-muted mb-1">
                  قيمة الصفقة / العقد (ج.م)
                </label>
                <input
                  type="number"
                  value={testAmount}
                  onChange={(e) => setTestAmount(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-amber-500 font-mono font-black outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-muted mb-1">
                  ملاحظات وتفاصيل التحديث من منصة SocialLens
                </label>
                <textarea
                  rows={2}
                  value={testNotes}
                  onChange={(e) => setTestNotes(e.target.value)}
                  className="w-full rounded-xl border border-line bg-surface p-2.5 text-ink outline-none focus:border-amber-500 text-xs"
                />
              </div>
            </div>

            {/* Run Button */}
            <div className="flex items-center justify-between border-t border-line pt-3">
              <div className="text-[11px] text-muted">
                {testScenario === 'activate_client' ? (
                  <span className="text-emerald-600 font-bold">
                    🚀 سيتم تفعيل العميل ونقله إلى صفحة الصفقات المعتمدة (Deals) فوراً.
                  </span>
                ) : (
                  <span>سيتم حفظ الليد في مسار العملاء المحتملين (Leads).</span>
                )}
              </div>

              <button
                type="button"
                onClick={handleRunTest}
                disabled={testing}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-5 py-2 text-xs font-bold text-white shadow-md transition hover:opacity-95 disabled:opacity-50"
              >
                {testing ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span>إرسال تجربة فورية عبر Webhook</span>
              </button>
            </div>

            {/* Test Result Display Box */}
            {testResult && (
              <div
                className={`rounded-2xl border p-4 text-xs transition ${
                  testResult.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-rose-500/40 bg-rose-500/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        testResult.ok ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <strong className={testResult.ok ? 'text-emerald-700' : 'text-rose-700'}>
                      {testResult.ok
                        ? '✅ نجح الاتصال وتنفيذ الحدث بنجاح (HTTP 200 OK)'
                        : `❌ فشل الاتصال (HTTP ${testResult.status})`}
                    </strong>
                  </div>
                  {testResult.data?.data?.contact_id && (
                    <Link
                      to={`/crm/contacts/${testResult.data.data.contact_id}`}
                      className="flex items-center gap-1 rounded-xl bg-white/80 px-3 py-1 font-bold text-emerald-700 shadow-sm hover:bg-white"
                    >
                      <span>عرض بروفايل العميل والهيستوري الآن</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>

                <p className="mt-2 text-muted leading-relaxed">
                  {testResult.data?.message || JSON.stringify(testResult.data)}
                </p>

                {testResult.data?.data && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-lg bg-surface/70 px-2 py-0.5 font-bold">
                      حالة العميل: {testResult.data.data.lead_status}
                    </span>
                    <span className="rounded-lg bg-surface/70 px-2 py-0.5 font-bold">
                      مرحلة الصفقة: {testResult.data.data.deal_stage}
                    </span>
                    <span className="rounded-lg bg-surface/70 px-2 py-0.5 font-bold">
                      المسؤول / من تابع معه: {testResult.data.data.sales_rep}
                    </span>
                    {testResult.data.data.is_won && (
                      <span className="rounded-lg bg-emerald-600 text-white px-2 py-0.5 font-bold">
                        🏆 تم النقل للديلز بنجاح
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Live Webhook Log Feed */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-500 animate-pulse" />
            <h3 className="text-xs font-black text-ink">
              سجل استلام أحداث الـ Webhook المباشر (Incoming Events Log)
            </h3>
            <span className="rounded-full bg-black/10 px-2 py-0.2 text-[10px] font-bold text-ink">
              {logs.length} حدث مسجل
            </span>
          </div>

          <button
            onClick={() => void loadLogs()}
            className="text-xs font-bold text-amber-500 hover:text-amber-600 flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            <span>تحديث</span>
          </button>
        </div>

        {logs.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted">
            لم يتم استلام أي أحداث Webhook بعد. يمكنك الضغط على زر التجربة بالأعلى لاختبار وصول البيانات وتحديث العميل.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-line bg-surface/60 text-muted">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">التاريخ والتوقيت</th>
                  <th className="px-3 py-2.5 font-semibold">نوع الحدث (Event)</th>
                  <th className="px-3 py-2.5 font-semibold">العميل</th>
                  <th className="px-3 py-2.5 font-semibold">من تابع معه (السيلز)</th>
                  <th className="px-3 py-2.5 font-semibold">حالة العميل / المرحلة</th>
                  <th className="px-3 py-2.5 font-semibold">النتيجة</th>
                  <th className="px-3 py-2.5 font-semibold text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface/50 transition">
                    <td className="px-3 py-2.5 text-muted font-mono whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleTimeString('ar-EG', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}{' '}
                      {new Date(log.timestamp).toLocaleDateString('ar-EG')}
                    </td>
                    <td className="px-3 py-2.5 font-bold font-mono text-[11px] text-indigo-600">
                      {log.event}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-ink">
                      {log.contact_name || log.lead_id || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3 text-muted" />
                        <span>{log.sales_rep || '—'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            log.is_won
                              ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-600 border border-amber-500/30'
                          }`}
                        >
                          {log.lead_status}
                        </span>
                        <span className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-bold">
                          {log.deal_stage}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          log.status === 'success'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-rose-500/10 text-rose-600'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            log.status === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {log.status === 'success' ? 'تمت المعالجة بنجاح' : 'خطأ'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {log.contact_id ? (
                        <Link
                          to={`/crm/contacts/${log.contact_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink hover:border-amber-500 hover:text-amber-500 transition"
                          title="عرض بروفايل العميل"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>فتح البروفايل</span>
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Integration Documentation & JSON Schemas */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-amber-500" />
            <h3 className="text-xs font-black text-ink">
              نماذج حمولة البيانات (JSON Payload Specifications for SocialLens)
            </h3>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setDocTab('activate')}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                docTab === 'activate' ? 'bg-emerald-600 text-white' : 'text-muted hover:text-ink'
              }`}
            >
              1. تفعيل العميل كعميل نشط (للديلز)
            </button>
            <button
              onClick={() => setDocTab('create')}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                docTab === 'create' ? 'bg-amber-500 text-white' : 'text-muted hover:text-ink'
              }`}
            >
              2. إرسال ليد جديد (للمسار)
            </button>
            <button
              onClick={() => setDocTab('update')}
              className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                docTab === 'update' ? 'bg-blue-600 text-white' : 'text-muted hover:text-ink'
              }`}
            >
              3. تحديث حالة ومتابعة
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-line/60 bg-black/85 p-4 text-xs font-mono text-emerald-400 overflow-x-auto" dir="ltr">
          <pre>
            {docTab === 'activate'
              ? JSON.stringify(
                  {
                    event: 'client.activated',
                    lead: {
                      lead_id: 'SL-99482',
                      full_name: 'د. كريم الشافعي',
                      phone_number: '01012345678',
                      email: 'dr.karim@example.com',
                      business_name: 'مركز الشافعي للجلدية والليزر',
                      lead_status: 'عميل نشط',
                      deal_stage: 'عميل',
                      deal_amount: 22450,
                      sales_rep: 'Peter Fahmy',
                      change_reason: 'تم الاتفاق وتوقيع العقد بعد زيارة العيادة وتقديم العرض المالي وتثبيت الباقة',
                      plan: {
                        plan_name: 'الباقة الأساسية (Starter)',
                        plan_tier: 'starter',
                        plan_code: 'SL-OFFER-MWGIGNAP-8068',
                        pricing_location: 'تسعير القاهرة',
                        price: 22450,
                        billing_cycle: 'شهرياً',
                        status: 'مشترك بها (معتمدة)',
                        strategy_goal: '🎯 إيقاف هبوط الحساب ورفع مؤشر معدل التفاعل وحفظ المحتوى',
                        diagnostics: {
                          account: 'HalalChef@',
                          platform: 'YouTube',
                          engagement_rate: '0.5%',
                          analysis_date: '14 نوفمبر',
                        },
                        services: [
                          {
                            title: 'منشورات كاروسيل تفاعلية',
                            quantity: 3,
                            unit_price: 3150,
                            total_price: 9450,
                            description: '3 منشورات كاروسيل تعليمية مكثفة لرفع معدل حفظ المحتوى',
                          },
                          {
                            title: 'إدارة الحسابات والصفحات (فيسبوك)',
                            quantity: 1,
                            unit_price: 5000,
                            total_price: 5000,
                            description: 'إدارة صفحة فيسبوك وضبط مواعيد النشر المثالية',
                          },
                          {
                            title: 'خدمة الردود والمتابعة',
                            quantity: 1,
                            unit_price: 8000,
                            total_price: 8000,
                            description: 'خدمة الردود والمتابعة للعملاء والتفاعل السريع',
                          },
                        ],
                      },
                      history: [
                        {
                          type: 'مكالمة',
                          title: 'مكالمة هاتفية أولية',
                          details: 'تم الحديث مع الدكتور وتحديد موعد زيارة',
                          author: 'Peter Fahmy',
                          timestamp: '2026-11-14T10:00:00Z',
                        },
                        {
                          type: 'اجتماع',
                          title: 'زيارة مقر العيادة وتوقيع الاتفاقية',
                          details: 'تم توقيع العقد السنوي واعتماد العميل رسمياً',
                          author: 'Peter Fahmy',
                          timestamp: '2026-11-14T14:30:00Z',
                        },
                      ],
                    },
                  },
                  null,
                  2
                )
              : docTab === 'create'
              ? JSON.stringify(
                  {
                    event: 'lead.created',
                    lead: {
                      lead_id: 'SL-88391',
                      full_name: 'د. منى زكي',
                      phone_number: '01123456789',
                      email: 'mona.zaki@example.com',
                      business_name: 'عيادات د. منى زكي لطب الأسنان',
                      medical_specialty: 'طب وجراحة الأسنان',
                      clinic_address: 'شارع الثورة، مصر الجديدة',
                      social_profile_link: 'https://instagram.com/dr.monazaki',
                      source_platform: 'SocialLens (Meta Ads)',
                      ad_id: 'CAMPAIGN-104',
                      lead_status: 'جديد',
                      deal_stage: 'مكالمة',
                      deal_amount: 25000,
                      sales_rep: 'Peter Fahmy',
                      notes: 'مهتمة بالاشتراك السنوي لإدارة حجز المواعيد والعملاء',
                    },
                  },
                  null,
                  2
                )
              : JSON.stringify(
                  {
                    event: 'lead.updated',
                    lead: {
                      lead_id: 'SL-88391',
                      lead_status: 'قيد المتابعة',
                      activity_status: 'مهتم',
                      deal_stage: 'عرض سعر',
                      sales_rep: 'Hany Fathy',
                      notes: 'تم إرسال عرض الأسعار ومتابعة الرد تمهيداً لإبرام العقد',
                    },
                  },
                  null,
                  2
                )}
          </pre>
        </div>
      </div>
    </div>
  );
}
