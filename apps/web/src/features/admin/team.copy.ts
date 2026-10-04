const en = {
  
  title: 'Team & clinic access',
  back: 'Back to administration',
  refresh: 'Refresh',
  create: 'Create staff account',
  name: 'Full name',
  email: 'Email',
  password: 'Password',
  passwordHint: 'At least 12 characters.',
  createButton: 'Create account',
  select: 'Staff member',
  choose: 'Choose a staff member',
  access: 'Clinic access',
  active: 'Active membership',
  save: 'Save membership',
  unassigned: 'Not assigned',
  enabled: 'Active',
  disabled: 'Inactive',
  noClinics: 'Activate a clinic from Administration first.',

  created:
    'Account created. Select its clinics and save each membership below.',
  saved: 'Membership saved.',
  failed:
    'Could not confirm the result. Refresh and check before retrying.',
  exists:
    'This email already exists. Refresh and select the existing account.',
  config:
    'Account creation is not configured. Contact your administrator.',
  invalid: 'Check the submitted fields.',
  forbidden: 'Administrator access is required.',
  scope:
    'Disabling a membership removes access to that clinic. Other clinic memberships remain active.',

  roles: {
    moderator: 'Moderator',
    agency_follow_up: 'Agency follow-up',
    clinic_customer_service: 'Clinic customer service',
    doctor: 'Doctor',
    clinic_manager: 'Clinic manager',
  },
};

const ar: typeof en = {
    

  title: 'الفريق وصلاحيات العيادات',
  back: 'رجوع للإدارة',
  refresh: 'تحديث',
  create: 'إنشاء حساب موظف',
  name: 'الاسم بالكامل',
  email: 'الإيميل',
  password: 'كلمة المرور',
  passwordHint: '12 حرف على الأقل.',
  createButton: 'إنشاء الحساب',
  select: 'الموظف',
  choose: 'اختار الموظف',
  access: 'صلاحيات العيادات',
  active: 'عضوية نشطة',
  save: 'حفظ العضوية',
  unassigned: 'غير مضاف',
  enabled: 'نشط',
  disabled: 'متوقف',
  noClinics: 'فعّل عيادة من صفحة الإدارة الأول.',

  created:
    'تم إنشاء الحساب. حدّد عياداته واحفظ العضوية لكل عيادة من تحت.',
  saved: 'تم حفظ العضوية.',
  failed:
    'تعذر تأكيد النتيجة. حدّث البيانات وراجعها قبل إعادة المحاولة.',
  exists:
    'الإيميل موجود بالفعل. حدّث القائمة واختار الحساب الموجود.',
  config: 'إنشاء الحسابات مش متجهز. راجع مسؤول النظام.',
  invalid: 'راجع البيانات اللي دخلتها.',
  forbidden: 'محتاج صلاحية مسؤول.',
  scope:
    'إيقاف العضوية يمنع الوصول للعيادة دي. عضويات الموظف في باقي العيادات بتفضل شغالة.',

  roles: {
    moderator: 'مودريتور',
    agency_follow_up: 'متابعة الوكالة',
    clinic_customer_service: 'خدمة عملاء العيادة',
    doctor: 'دكتور',
    clinic_manager: 'مدير العيادة',
  },
};

export const teamCopy = { en, ar };