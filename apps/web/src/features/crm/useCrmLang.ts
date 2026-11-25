import { useTranslation } from 'react-i18next';

const LEAD_STATUS_EN: Record<string, string> = {
  'جديد': 'New',
  'قيد المتابعة': 'In Progress',
  'عقد': 'Contract',
  'تم الفوز': 'Won',
  'عميل': 'Client',
  'خاسر': 'Lost',
};

const DEAL_STAGE_EN: Record<string, string> = {
  'مكالمة': 'Call',
  'زيارة': 'Visit',
  'عرض سعر': 'Proposal',
  'عقد': 'Contract',
  'عميل': 'Active Client',
  'فقدان العميل': 'Churned',
  'خسارة مغلقة': 'Closed Lost',
  'غير مؤهل': 'Disqualified',
};

const ACTIVITY_STATUS_EN: Record<string, string> = {
  'معاودة الاتصال': 'Call Back',
  'مهتم': 'Interested',
  'اهتمام مستقبلي': 'Future Interest',
  'غير مهتم': 'Not Interested',
  'اجتماع': 'Meeting',
};

const ACTIVITY_TYPE_EN: Record<string, string> = {
  'مكالمة': 'Call',
  'اجتماع': 'Meeting',
  'ملاحظة': 'Note',
  'مهمة': 'Task',
  'متابعة': 'Follow-up',
};

const MEETING_STATUS_EN: Record<string, string> = {
  'محجوز': 'Booked',
  'حضر': 'Showed Up',
  'لم يحضر': 'No Show',
  'ملغي': 'Cancelled',
};

const COMPLETION_STATUS_EN: Record<string, string> = {
  'قيد الانتظار': 'Pending',
  'مكتمل': 'Completed',
  'ملغي': 'Cancelled',
};

export function useCrmLang() {
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language ?? 'ar').startsWith('ar');
  const dir: 'rtl' | 'ltr' = ar ? 'rtl' : 'ltr';

  const tr = (arText: string, enText: string) => (ar ? arText : enText);

  // Always format numbers with Western/English digits (0-9)
  const fmtNum = (val: number | string | null | undefined) => {
    const n = Number(val ?? 0);
    return Number.isFinite(n) ? n.toLocaleString('en-US') : '0';
  };

  const fmtCurrency = (val: number | string | null | undefined, currency?: string | null) => {
    const num = fmtNum(val);
    if (currency && currency !== 'EGP' && currency !== 'ج.م') {
      return `${num} ${currency}`;
    }
    return `${num} ${ar ? 'ج.م' : 'EGP'}`;
  };

  const fmtDate = (dateStr?: string | null, withTime = false) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    const locale = ar ? 'ar-EG-u-nu-latn' : 'en-US';
    return withTime
      ? d.toLocaleString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : d.toLocaleDateString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  };

  const labelLeadStatus = (s?: string | null) => (!s ? '—' : ar ? s : LEAD_STATUS_EN[s] || s);
  const labelDealStage = (s?: string | null) => (!s ? '—' : ar ? s : DEAL_STAGE_EN[s] || s);
  const labelActivityStatus = (s?: string | null) => (!s ? '—' : ar ? s : ACTIVITY_STATUS_EN[s] || s);
  const labelActivityType = (s?: string | null) => (!s ? '—' : ar ? s : ACTIVITY_TYPE_EN[s] || s);
  const labelMeetingStatus = (s?: string | null) => (!s ? '—' : ar ? s : MEETING_STATUS_EN[s] || s);
  const labelCompletionStatus = (s?: string | null) => (!s ? '—' : ar ? s : COMPLETION_STATUS_EN[s] || s);

  return {
    ar,
    dir,
    tr,
    fmtNum,
    fmtCurrency,
    fmtDate,
    labelLeadStatus,
    labelDealStage,
    labelActivityStatus,
    labelActivityType,
    labelMeetingStatus,
    labelCompletionStatus,
  };
}
