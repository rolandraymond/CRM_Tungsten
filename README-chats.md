# Tungsten CRM — أول مرحلة الشات

اشتغلت على Tungsten-CRM(1).zip، مش مشروع الإعلانات. ده تعديل فعلي على الـ CRM الموجود: استقبال Facebook وInstagram، واجهة محادثات، وردود نصية. مش إعلان إن كل متطلبات المشروع خلصت أو إن Meta اتفعلت للجمهور.

## إيه اللي اتضاف وفين؟

| الملف | التغيير والسبب |
|---|---|
| `supabase/migrations/20261001070000_crm_chats.sql` | قنوات، محادثات، رسائل، RLS، معالجة الأحداث، طابور الردود، منع التكرار، وتوحيد Echo مع نتيجة الإرسال. |
| `apps/api/src/features/chats/chats.routes.ts` | API لعرض شات العيادة، ربط القنوات بواسطة الأدمن، وتسجيل الردود بصلاحيات المستخدم. |
| `apps/api/src/features/chats/chats.worker.ts` | معالجة الأحداث المحفوظة وإرسال الردود في الخلفية. |
| `apps/api/src/features/chats/meta-send.ts` | استدعاء Meta Send API، والتمييز بين فشل واضح ونتيجة غير مؤكدة. |
| `apps/api/src/app.ts` | إضافة `/chats`؛ الـ raw-body webhook ما زال قبل JSON parser. |
| `apps/api/src/server.ts` | تشغيل وإيقاف worker مع الـ API. |
| `apps/web/src/features/chats/ChatsPage.tsx` | قائمة المحادثات، الرسائل، المرفقات كرابط، فورم الرد، وإعداد القنوات للأدمن. |
| `apps/web/src/features/chats/chats.css` | نفس اتجاه التصميم الموجود: كروت فاتحة ولمسات زرقاء وزر أسود، مع دعم dark mode. |
| `apps/web/src/app/AppRouter.tsx` | صفحة `/chats`. |
| `apps/web/src/layouts/AppLayout.tsx` | زر Chats وتمرير صلاحية الأدمن للصفحة. |
| `apps/web/src/features/leads/types.ts` | إضافة `isAdmin` في سياق مساحة العمل. |
| `apps/web/src/hooks/useClinicChanges.ts` | الاشتراك في جداول الشات؛ اسم مستقل لكل subscription حتى شاشة ما توقفش تحديث شاشة تانية. |
| `apps/web/src/i18n/locales/en.ts` و `ar.ts` | اسم زر الشات باللغتين. |
| `package.json` | أوامر setup وbuild واختبارات حقيقية بدل رسالة test الوهمية. |
| `apps/api/.env.example` و `apps/web/.env.example` | أمثلة إعدادات بدون أسرارك. |
| `tests/` | اختبارات توقيع webhook، إرسال Meta بمزود وهمي، واختبارات SQL معزولة. |

## الصلاحيات

| الدور | القراءة | الرد | ربط قناة بالعيادة |
|---|---|---|---|
| platform admin | كل العيادات | نعم | نعم |
| moderator / agency_follow_up | العيادات ذات العضوية النشطة | نعم | لا |
| clinic_customer_service / clinic_manager | العيادات ذات العضوية النشطة | نعم | لا |
| doctor | العيادات ذات العضوية النشطة | لا | لا |
| عضوية غير نشطة | لا | لا | لا |

دي سياسة الشات المطبقة في التعديل ده. صلاحيات leads والحجز الموجودة ما اتغيرتش. RLS بتحمي القراءة من قاعدة البيانات نفسها، والـ RPC بيتحقق من صلاحية الرد. doctor هنا اسم الدور الحالي، مش سماح يشوف عيادات تانية.

## تشغيل التعديل محليًا

1. انقل الملفات الجديدة لمكانها، واستبدل الملفات المعدلة بنسختها الموجودة هنا. مفيش `git apply` أو patch مطلوب.
2. احتفظ بـ `.env` و`.env.local` الموجودين عندك. الأمثلة للتوضيح فقط.
3. النسخة المرفوعة فيها `supabase/config.toml` و`supabase/migrations` في جذر المشروع. شغل من الجذر:

```bash
cd ~/Downloads/Tungsten-CRM/Tungsten-CRM
npx supabase start
npx supabase migration up --local
npm run build
npm run dev
```

لو نسختك المحلية بتستخدم `apps/api/supabase` بدل الجذر، حط الـ migration الجديد جنب باقي الـ migrations المستخدمة وشغله من هناك. ما تنشئش مشروع Supabase تاني. migration up بيطبق التغييرات الجديدة؛ مفيش reset للبيانات.

لو dependencies الفرعية لسه مش متثبتة: من الجذر، `npm install` ثم `npm run setup`. setup بيشغل npm ci داخل apps/api وapps/web، لأن npm install في الجذر وحده ما كانش بيثبتهم.

## ربط صفحة Facebook

1. افتح `http://localhost:5173/chats` بحساب الأدمن.
2. اختار العيادة الصحيحة من القائمة فوق.
3. افتح «إعداد قنوات العيادة»، اختار Facebook، واكتب الاسم وPage ID الحقيقي.
4. ده بيربط القناة بعيادة داخل الـ CRM. لسه لازم callback واشتراك الصفحة يكونوا متظبطين في Meta. اشترك في `messages`، ومعها الأحداث المتاحة اللي محتاجها زي `message_echoes` و`message_reads` و`message_deliveries`.
5. في `apps/api/.env` ضيف إعداد القناة، مستخدمًا Page access token على السيرفر فقط:

```dotenv
META_GRAPH_API_VERSION=v26.0
META_CHAT_CHANNELS_JSON='{"facebook:YOUR_PAGE_ID":{"token":"YOUR_PAGE_ACCESS_TOKEN","endpoint_id":"YOUR_PAGE_ID","host":"facebook"}}'
META_CHAT_SEND_ENABLED=true
```

استبدل placeholders بالقيم الفعلية عندك؛ ما تبعتش التوكن هنا. اعمل restart للـ API بعد تعديل البيئة.

`META_WEBHOOK_VERIFY_TOKEN` للتحقق من callback، `META_APP_SECRET` للتحقق من توقيع POST، وPage access token للإرسال. دول ٣ حاجات مختلفة. ما تغيرش القيم الصحيحة عندك لمجرد إن أمثلة الملف مختلفة.

## ربط Instagram

أضف قناة Instagram بالأدمن، باستخدام Instagram Account ID اللي بيظهر في `entry.id` داخل webhook، مش Page ID في الحقل ده.

تطبيقك الحالي كان بيستخدم صلاحيات Facebook Login زي `instagram_manage_messages`. إعداد الإرسال لهذا المسار يستخدم توكن الصفحة المرتبطة وPage ID في `endpoint_id`:

```dotenv
META_CHAT_CHANNELS_JSON='{"facebook:PAGE_ID":{"token":"PAGE_TOKEN","endpoint_id":"PAGE_ID","host":"facebook"},"instagram:IG_ACCOUNT_ID":{"token":"LINKED_PAGE_TOKEN","endpoint_id":"LINKED_PAGE_ID","host":"facebook"}}'
```

الكود يدعم اختيار `host: "instagram"` لمسار Instagram Login أيضًا، لكن ده له توكن وصلاحيات مختلفة؛ مش مجرد تغيير host في نفس إعداد تطبيق Facebook Login. لازم نثبت المسار الفعلي والاشتراك برسالة حقيقية لكل قناة قبل تشغيلها للعملاء.

## هنشوف النجاح إزاي؟

- رسالة عميل جديدة تظهر في `/chats` داخل العيادة الصحيحة، ويظهر ID العميل. أسماء وصور العملاء مش متجلبة من Meta في المرحلة دي.
- الرد يتسجل «في الانتظار»، وبعد worker يظهر «اتبعتت» لما Meta ترجع message ID. الاختبار الحاسم: الرد يظهر عند العميل نفسه.
- لو مفيش محادثة رغم وجود أحداث خام، افتح SQL Editor المحلي وشغل:

```sql
select received_at, processed_at, attempts, last_error
from public.meta_webhook_inbox
order by received_at desc
limit 20;
```

`CHANNEL_NOT_CONFIGURED` معناها asset ID مش مربوط بقناة نشطة؛ الحدث محفوظ وهيتجرب تاني بعد دقيقة. `ASSET_MISMATCH` معناها recipient/sender مش مطابق للقناة. أحداث القراءة وحدها لا تنشئ رسالة جديدة.

`failed` معناها فشل واضح. `unknown` معناها ممكن Meta استلمت الرد والاتصال انقطع بعد كده؛ راجع inbox Meta قبل أي محاولة جديدة. لا يوجد إعادة إرسال تلقائية للنتيجة غير المؤكدة.

الردود النصية هنا داخل نافذة ٢٤ ساعة، مع فحصها في SQL وفي worker قبل الإرسال. Human Agent أو الرد خارج النافذة محتاج إعداد وصلاحيات مستقلة؛ مش مفعل في هذا التعديل.

## المصطلحات في الكود

- **Normalization**: تحويل payload Meta إلى `chat_conversations` و`chat_messages` في `crm_process_meta_inbox`.
- **Idempotency**: نفس `provider_message_id` لا يتكرر؛ ونفس `request_id` لن ينشئ ردًا ثانيًا في `crm_queue_chat_reply`.
- **Durable Inbox / Outbox**: أحداث وردود محفوظة قبل معالجتها. دي أنماط معمارية بتخلي الشغل قابل للاستكمال بعد توقف السيرفر.
- **Row-Level Security (RLS)**: سياسات القراءة حسب العيادة والعضوية النشطة.
- **Race Condition**: Echo ممكن يوصل قبل نتيجة Send API. `crm_complete_chat_reply` وtransaction/advisory lock يوحّدوا النسختين.
- **SKIP LOCKED**: worker يتخطى صف محجوز بواسطة worker آخر، عشان ما يعالجوش نفس الطلب سوا. الاختبارات المعزولة لا تختبر عملية multi-worker كاملة.
- **HMAC signature**: توقيع يحسبه السيرفر من نفس raw bytes وApp Secret؛ موجود في webhook الحالي، واختبرناه بدون إلغاء التحقق.

## التحقق وحدوده

- Backend وFrontend production build نجحوا.
- ٦ اختبارات HTTP/Meta sender نجحت، وكلها محلية أو بمزود وهمي، بدون إرسال للعملاء.
- ٢٥ فحص قاعدة بيانات نجحوا في PostgreSQL معزول باستخدام PGlite، منها تطبيق جميع migrations، عزل عيادتين، inactive membership، منع doctor من الرد، dedupe، تاريخ الأحداث خارج الترتيب، استرجاع أحداث القنوات غير المربوطة، وEcho قبل النتيجة.
- ESLint للملفات المعدلة نجح. فحص المشروع كله كشف مشكلة موجودة في `AdminAdsPage.tsx` (`set-state-in-effect`)؛ لم نحذف القاعدة أو نخفيها.
- اختبار بصري في متصفح تعذر تشغيله في البيئة دي؛ لم يتم تأكيد الشكل أو سلوك الشاشة بصريًا.
- Supabase Realtime الفعلي، صلاحيات Meta، توكنات الحسابات ووصول الرسائل الحقيقية لم تُختبر من هذا الجهاز.

أوامر اختبارات الرد وwebhook: `npm test`.
لاختبار SQL اختياريًا: ثبّت `@electric-sql/pglite` في بيئة اختبار ثم شغل `node tests/chats-database.mjs` (أو حدد `PGLITE_MODULE` لمسار المكتبة).

## اللي لسه ضمن المشروع

- اختبار Facebook ثم Instagram برسالة حقيقية ورد ظاهر عند العميل، وإكمال متطلبات Meta اللازمة للحسابات المقصودة.
- OAuth/connect flow وتجديد/إلغاء التوكنات بدل الإعداد اليدوي الحالي، ومراقبة الأخطاء والاحتفاظ بالبيانات وحذفها قبل تعميم الخدمة.
- تحويل الشات إلى lead وربطه بسجل العميل، أسماء/صور العملاء، إسناد المحادثات، unread counts وإشعارات المشرف.
- رفع مرفقات والرد عليها، وعرض delivery/read receipts؛ أحداثها الخام محفوظة الآن لكن واجهة الحالة ليست منفذة.
- جدول الأطباء والخدمات والسعة، مواعيد ١ ظهرًا إلى ١ صباحًا، الأحد إجازة، مدة قابلة للتعديل ومنع overbooking، وتعديل/إلغاء/تأجيل الحجز مع التاريخ.
- WhatsApp وTikTok لاحقًا حسب المسار والصلاحيات المدعومة.
