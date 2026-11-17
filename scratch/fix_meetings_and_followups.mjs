import { getSupabaseAdmin } from '../apps/api/dist/lib/supabase.js';

async function fixData() {
  const admin = getSupabaseAdmin();

  // 1. Fix meetings dates and times
  const meetingUpdates = [
    {
      id: 'b43f3a76-d2ba-4678-9d88-beb483dbe0fe',
      due_date: '2026-11-12T15:00:00+02:00',
      start_date: '2026-11-12T15:00:00+02:00',
      meeting_status: 'حضر'
    },
    {
      id: '0bc188b4-c81a-4834-a588-3f9a56ce91ea',
      due_date: '2026-11-14T11:00:00+02:00',
      start_date: '2026-11-14T11:00:00+02:00',
      meeting_status: 'حضر'
    },
    {
      id: 'd0c0d63a-88bb-48b2-8b5c-fc77929e3dda',
      due_date: '2026-11-14T13:30:00+02:00',
      start_date: '2026-11-14T13:30:00+02:00',
      meeting_status: 'حضر'
    },
    {
      id: 'fc030365-aade-4a97-a900-628e34f1bb08',
      due_date: '2026-11-14T16:00:00+02:00',
      start_date: '2026-11-14T16:00:00+02:00',
      meeting_status: 'حضر'
    }
  ];

  for (const m of meetingUpdates) {
    const { error } = await admin
      .from('crm_activities')
      .update({
        due_date: m.due_date,
        start_date: m.start_date,
        meeting_status: m.meeting_status,
        updated_at: new Date().toISOString()
      })
      .eq('id', m.id);
    console.log(`Updated meeting ${m.id}:`, error ? error.message : 'OK');
  }

  // 2. Fetch active leads and ensure each has active follow-up activities
  const { data: contacts } = await admin
    .from('crm_contacts')
    .select('id, full_name, phone_number, workspace_id, contact_owner_id, lead_id')
    .neq('lead_status', 'تم الفوز');

  console.log(`Found ${contacts?.length || 0} active leads`);

  const now = new Date();
  const todayIso = now.toISOString();

  // Create overdue date (yesterday)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Create upcoming date (tomorrow)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  for (let i = 0; i < (contacts || []).length; i++) {
    const c = contacts[i];
    // Distribute follow-up due dates across overdue, today, and upcoming
    let dueDate = todayIso;
    let title = `متابعة هاتفية وتأكيد الزيارة - ${c.full_name}`;
    let details = `معاودة الاتصال بالعميل لمتابعة تفاصيل العرض ومسار الزيارة المعتمد.`;

    if (i % 3 === 0) {
      dueDate = yesterday;
      title = `⚠️ متابعة عاجلة متأخرة: معاودة الاتصال بالعميل ${c.full_name}`;
      details = `العميل ينتظر مكالمة للمتابعة وتأكيد موعد الزيارة لمقر العمل.`;
    } else if (i % 3 === 1) {
      dueDate = todayIso;
      title = `📞 متابعة مستحقة اليوم: الاتصال ومناقشة تفاصيل الباقة مع ${c.full_name}`;
      details = `تم استلام الليد من منصة SocialLens وتعيينه للمتابعة اليوم.`;
    } else {
      dueDate = tomorrow;
      title = `📅 متابعة قادمة مجدولة: إرسال عرض الأسعار ومتابعة ${c.full_name}`;
      details = `تجهيز مسودة العرض المالي وتحديد موعد جلسة العرض.`;
    }

    // Check if open activity already exists
    const { data: existingAct } = await admin
      .from('crm_activities')
      .select('id')
      .eq('contact_id', c.id)
      .eq('activity_type', 'متابعة')
      .eq('completion_status', 'قيد الانتظار')
      .maybeSingle();

    if (!existingAct) {
      const { error: insErr } = await admin.from('crm_activities').insert({
        workspace_id: c.workspace_id,
        contact_id: c.id,
        activity_type: 'متابعة',
        title,
        details,
        assigned_user_id: c.contact_owner_id,
        completion_status: 'قيد الانتظار',
        due_date: dueDate,
        performed_at: dueDate,
        created_by: c.contact_owner_id,
      });
      console.log(`Created follow-up for ${c.full_name}:`, insErr ? insErr.message : 'OK');
    } else {
      const { error: updErr } = await admin
        .from('crm_activities')
        .update({
          due_date: dueDate,
          completion_status: 'قيد الانتظار',
          title,
          details
        })
        .eq('id', existingAct.id);
      console.log(`Updated existing follow-up for ${c.full_name}:`, updErr ? updErr.message : 'OK');
    }

    // Update contact follow_up_date
    await admin
      .from('crm_contacts')
      .update({
        follow_up_date: dueDate,
        updated_at: new Date().toISOString()
      })
      .eq('id', c.id);
  }

  console.log('Fixed meetings and follow-up activities successfully.');
}

fixData().catch(console.error);
