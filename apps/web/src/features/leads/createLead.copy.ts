const en = {
  title: 'Create lead',
  back: 'Back to leads',
  name: 'Client name',
  phone: 'Phone number',
  service: 'Service',
  source: 'Source',
  ad: 'Ad',
  unknown: 'Ad not identified',
  choose: 'Choose a service',
  notes: 'Notes',
  save: 'Save lead',
  saving: 'Saving…',
  retry: 'Retry saving',

  phoneHint:
    'Egypt: 01012345678, or an international number starting with +.',

  invalid:
    'Enter a name, a valid phone number, and a service.',

  noServices:
    'No active services are available for this clinic. Ask an administrator to configure them.',

  limited:
    'Only the first 200 services and active ads are shown.',

  uncertain:
    'The save result is not confirmed. Retry this same request before creating another lead.',

  forbidden:
    'Your account cannot create leads for this clinic.',

  rejected:
    'Check the fields. The selected service or ad may no longer be available.',

  conflict:
    'This request conflicts with an existing record.',

  login:
    'Your session has expired. Sign in again.',

  storage:
    'Allow session storage in this browser before saving.',

  sources: {
    paid_instagram: 'Instagram — paid ad',
    paid_facebook: 'Facebook — paid ad',
    tiktok: 'TikTok',
    whatsapp: 'WhatsApp',
    organic_instagram: 'Instagram — organic',
    organic_facebook: 'Facebook — organic',
    website: 'Website',
    other: 'Other',
  },
};

const ar: typeof en = {
  title: 'إضافة عميل',
  back: 'رجوع للعملاء',
  name: 'اسم العميل',
  phone: 'رقم التليفون',
  service: 'الخدمة',
  source: 'المصدر',
  ad: 'الإعلان',
  unknown: 'الإعلان غير محدد',
  choose: 'اختار الخدمة',
  notes: 'ملاحظات',
  save: 'حفظ العميل',
  saving: 'جاري الحفظ…',
  retry: 'إعادة محاولة الحفظ',

  phoneHint:
    'رقم مصري زي 01012345678، أو رقم دولي بيبدأ بـ +.',

  invalid:
    'اكتب الاسم ورقم صحيح واختار الخدمة.',

  noServices:
    'مفيش خدمات نشطة متاحة للعيادة. اطلب من المسؤول يضيفها.',

  limited:
    'المعروض أول 200 خدمة وإعلان نشط فقط.',

  uncertain:
    'نتيجة الحفظ لسه مش مؤكدة. أعد نفس المحاولة قبل ما تضيف العميل مرة تانية.',

  forbidden:
    'حسابك مش مسموح له يضيف عملاء للعيادة دي.',

  rejected:
    'راجع البيانات. ممكن الخدمة أو الإعلان مبقوش متاحين.',

  conflict:
    'الطلب متعارض مع سجل موجود بالفعل.',

  login:
    'الجلسة انتهت. سجّل دخول تاني.',

  storage:
    'اسمح بتخزين بيانات الجلسة في المتصفح قبل الحفظ.',

  sources: {
    paid_instagram: 'إنستجرام — إعلان مدفوع',
    paid_facebook: 'فيسبوك — إعلان مدفوع',
    tiktok: 'تيك توك',
    whatsapp: 'واتساب',
    organic_instagram: 'إنستجرام — بدون إعلان',
    organic_facebook: 'فيسبوك — بدون إعلان',
    website: 'الموقع',
    other: 'مصدر تاني',
  },
};

export const createLeadCopy = { en, ar };