import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGet } from '../../hooks/useGet';
import { useClinicChanges } from '../../hooks/useClinicChanges';
import QueryState from '../../components/QueryState';
import ChoiceSelect from '../../components/ChoiceSelect';
import type { WorkspaceContext } from '../leads/types';
import './chats.css';

type Channel = {
  id: string;
  name: string;
  platform: 'facebook' | 'instagram';
  asset_id: string;
  is_active: boolean;
};
type Conversation = { id: string; customer_id: string; last_message_at: string; last_customer_message_at: string | null; channel: Channel };
type Message = { id: string; direction: 'incoming' | 'outgoing'; text: string | null; attachments: unknown;
  status: string; failure_code: string | null; sent_by: string | null; occurred_at: string };
type Page<T> = { data: T[]; pagination: { has_more: boolean } };
const tables = ['chat_channels', 'chat_conversations', 'chat_messages'] as const;

function attachmentLinks(value: unknown): { url: string; type: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.payload?.url !== 'string') return [];
    try {
      const url = new URL(item.payload.url);
      return url.protocol === 'https:' ? [{ url: url.href, type: typeof item.type === 'string' ? item.type : 'attachment' }] : [];
    } catch { return []; }
  });
}

function ConversationPanel({ conversation, token, clinicId, canReply, ar, onQueued }: {
  conversation: Conversation; token: string; clinicId: string; canReply: boolean; ar: boolean; onQueued: () => void;
}) {
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ id: string; text: string } | null>(null);
  const locked = useRef(false);
  const thread = useRef<HTMLDivElement>(null);
  const previousLatest = useRef<string | undefined>(undefined);
  const query = useGet<Page<Message>>(`/api/chats/conversations/${conversation.id}/messages?clinic_id=${clinicId}&page=${page}`, token);
  const latestId = query.data?.data[0]?.id;
  useEffect(() => {
    const element = thread.current;
    if (!element || !latestId) return;
    if (!previousLatest.current || element.scrollHeight - element.clientHeight - element.scrollTop < 180) {
      element.scrollTop = element.scrollHeight;
    }
    previousLatest.current = latestId;
  }, [latestId, page]);
  useClinicChanges(clinicId, tables, query.retry);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const windowOpen = conversation.last_customer_message_at !== null && Date.parse(conversation.last_customer_message_at) > now - 86400000;
  const labels: Record<string, string> = ar
    ? { received: 'واردة', queued: 'في الانتظار', sending: 'جاري الإرسال', sent: 'اتبعتت', failed: 'فشل الإرسال', unknown: 'نتيجة الإرسال مش مؤكدة' }
    : { received: 'Received', queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', unknown: 'Send result unknown' };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || !text.trim()) return;
    locked.current = true; setBusy(true); setError('');
    if (!pending.current || pending.current.text !== text.trim()) pending.current = { id: crypto.randomUUID(), text: text.trim() };
    try {
      const response = await fetch(`/api/chats/conversations/${conversation.id}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: clinicId, request_id: pending.current.id, text: pending.current.text }),
      });
      const body = await response.json();
      if (!response.ok) {
        const code = body.error?.code;
        setError(code === 'CHAT_SENDING_DISABLED'
          ? ar ? 'الإرسال لسه مش متفعل من إعدادات السيرفر.' : 'Sending is disabled in the API configuration.'
          : code === 'REPLY_WINDOW_CLOSED'
            ? ar ? 'نافذة الرد خلصت. محتاجين رسالة جديدة من العميل.' : 'Reply window closed. A new customer message is needed.'
            : ar ? 'الرد ماتسجلش. راجع صلاحياتك وإعدادات القناة.' : 'Reply was not queued. Check access and channel settings.');
        return;
      }
      setText(''); pending.current = null; setPage(1); query.retry(); onQueued();
    } catch { setError(ar ? 'الاتصال انقطع. جرّب تاني بنفس النص؛ رقم الطلب بيمنع تكرار الرد.' : 'Connection lost. Retry the same text; the request ID prevents duplicate replies.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <section className="chat-panel">
    <header className="border-b border-line p-5">
      <h2 className="font-semibold" dir="auto">{conversation.customer_id}</h2>
        <p className="mt-2 text-sm font-semibold" dir="auto">
          {ar ? 'الصفحة: ' : 'Page: '}
          {conversation.channel.name}
          {' · '}
          {conversation.channel.platform === 'facebook'
            ? 'Facebook'
            : 'Instagram'}
        </p>

        <p className="mt-1 text-xs text-muted" dir="ltr">
          {conversation.channel.platform === 'facebook'
            ? 'Page ID'
            : 'Instagram Account ID'}
          : {conversation.channel.asset_id}
        </p>
    </header>
    <div ref={thread} className="chat-thread" aria-live="polite" aria-busy={busy}>
      {query.error || !query.data ? <QueryState error={query.error} retry={query.retry} /> : query.data.data.length === 0
        ? <p>{ar ? 'مفيش رسائل لسه.' : 'No messages yet.'}</p>
        : [...query.data.data].reverse().map(message => <article key={message.id}
          className={`chat-bubble ${message.direction === 'outgoing' ? 'chat-outgoing' : 'chat-incoming'}`}>
          {message.text && <p className="whitespace-pre-wrap break-words" dir="auto">{message.text}</p>}
          {attachmentLinks(message.attachments).map((item, index) => <a key={index} className="mt-2 block underline" href={item.url} target="_blank" rel="noreferrer">
            {ar ? 'افتح المرفق' : 'Open attachment'} ({item.type})</a>)}
          {!message.text && attachmentLinks(message.attachments).length === 0 && <p>{ar ? 'مرفق أو نوع رسالة مش مدعوم في العرض.' : 'Attachment or unsupported message type.'}</p>}
          <p className="mt-2 text-xs text-muted">{new Date(message.occurred_at).toLocaleString(ar ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo' })} · {labels[message.status] ?? message.status}</p>
          {message.failure_code && <p className="mt-1 text-xs text-danger" dir="ltr">{message.failure_code}</p>}
        </article>)}
    </div>
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <button type="button" className="control" disabled={!query.data?.pagination.has_more} onClick={() => setPage(p => p + 1)}>{ar ? 'رسائل أقدم' : 'Older messages'}</button>
      <span className="text-sm">{page}</span>
      <button type="button" className="control" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{ar ? 'رسائل أحدث' : 'Newer messages'}</button>
    </div>
    <form onSubmit={event => void submit(event)} className="border-t border-line p-5">
      {!canReply && <p className="mb-3 text-sm text-muted">{ar ? 'دور الدكتور يقدر يشوف الشات. الرد لخدمة العملاء والمودريتور والمدير.' : 'Doctors can read chats. Customer service, moderators and managers can reply.'}</p>}
      {canReply && !windowOpen && <p className="mb-3 text-sm text-muted">{ar ? 'نافذة الرد العادية ٢٤ ساعة من آخر رسالة للعميل.' : 'The standard reply window is 24 hours after the latest customer message.'}</p>}
      <label className="block text-sm" htmlFor="chat-reply">{ar ? 'ردك' : 'Your reply'}</label>
      <textarea id="chat-reply" className="field mt-2 min-h-24 resize-y" maxLength={1000} value={text} dir="auto"
        disabled={!canReply || !windowOpen || !conversation.channel.is_active || busy} onChange={e => setText(e.target.value)} />
      {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
      <button type="submit" className="chat-send mt-3" disabled={busy || !canReply || !windowOpen || !conversation.channel.is_active || !text.trim()}>{ar ? 'إرسال' : 'Send'}</button>
    </form>
  </section>;
}

export default function ChatsPage() {
  const { clinic, token, isAdmin } = useOutletContext<WorkspaceContext>();
  const { i18n } = useTranslation();
  const ar = (i18n.resolvedLanguage ?? i18n.language).startsWith('ar');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const conversations = useGet<Page<Conversation>>(`/api/chats/conversations?clinic_id=${clinic.id}&page=${page}`, token);
  const channels = useGet<{ data: Channel[] }>(`/api/chats/channels?clinic_id=${clinic.id}`, token);
  const retryConversations = conversations.retry;
  const retryChannels = channels.retry;
  const refresh = useCallback(() => { retryConversations(); retryChannels(); }, [retryConversations, retryChannels]);
  useClinicChanges(clinic.id, tables, refresh);
  const current = conversations.data?.data.find(c => c.id === selected) ?? conversations.data?.data[0];
  const [platform, setPlatform] = useState('facebook');
  const [name, setName] = useState('');
  const [asset, setAsset] = useState('');
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState('');
  async function addChannel(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setSetupError('');
    try {
      const response = await fetch('/api/chats/channels', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic_id: clinic.id, platform, asset_id: asset.trim(), name: name.trim() }) });
      if (!response.ok) { setSetupError(response.status === 409 ? ar ? 'القناة مربوطة بالفعل بعيادة. مش هننقل تاريخها لعيادة تانية.' : 'This channel is already bound to a clinic.' : ar ? 'تعذر إضافة القناة.' : 'Could not add channel.'); return; }
      setName(''); setAsset(''); refresh();
    } catch { setSetupError(ar ? 'راجع الاتصال وجرب تاني.' : 'Check your connection and retry.'); }
    finally { setBusy(false); }
  }
  return <>
    <p className="eyebrow">{ar ? 'محادثات العيادة' : 'CLINIC INBOX'}</p>
    <h1 className="mt-3 text-4xl">{ar ? 'الشات' : 'Chats'}</h1>
    <p className="mb-6 mt-3 text-muted">{ar ? 'Facebook وInstagram في مكان واحد — الرسائل بتتحدث تلقائيًا.' : 'Facebook and Instagram in one place. Messages update automatically.'}</p>
    {isAdmin && <details className="glass mb-6 p-5">
      <summary className="cursor-pointer">{ar ? 'إعداد قنوات العيادة' : 'Clinic channel setup'}</summary>
      <p className="my-3 text-sm text-muted">{ar ? 'ربط القناة هنا بيحدد عيادتها. التوكن واشتراك Meta بيتظبطوا على السيرفر؛ الفورم ده مش بيعمل اتصال Meta لوحده.' : 'This binds the channel to this clinic. Configure its token and Meta subscription separately on the server.'}</p>
      <form onSubmit={event => void addChannel(event)} className="grid gap-3 sm:grid-cols-2">
        <ChoiceSelect label={ar ? 'المنصة' : 'Platform'} value={platform} onChange={setPlatform} options={[{ value: 'facebook', label: 'Facebook' }, { value: 'instagram', label: 'Instagram' }]} />
        <label>{ar ? 'اسم القناة' : 'Channel name'}<input className="field mt-2" value={name} onChange={e => setName(e.target.value)} maxLength={200} required /></label>
        <label>{ar ? 'Page ID أو Instagram Account ID الموجود في webhook' : 'Page ID or Instagram Account ID from the webhook'}<input className="field mt-2" dir="ltr" value={asset} onChange={e => setAsset(e.target.value)} pattern="[0-9]+" required /></label>
        <button type="submit" className="chat-send self-end" disabled={busy}>{ar ? 'ربط بالعيادة' : 'Bind to clinic'}</button>
      </form>
      {setupError && <p className="mt-3 text-danger" role="alert">{setupError}</p>}
      <ul className="mt-4 text-sm">{channels.data?.data.map(channel => <li key={channel.id}>{channel.name} · {channel.platform}</li>)}</ul>
    </details>}
    <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="chat-panel p-4" aria-label={ar ? 'المحادثات' : 'Conversations'}>
        {conversations.error || !conversations.data ? <QueryState error={conversations.error} retry={conversations.retry} /> : !conversations.data.data.length
          ? <p className="p-3 text-sm text-muted">{ar ? 'لسه مفيش محادثات. راجع ربط القناة ووصول رسائل حقيقية للـ webhook.' : 'No conversations yet. Check channel setup and incoming webhook messages.'}</p>
          : conversations.data.data.map(item => <button type="button" key={item.id} onClick={() => setSelected(item.id)}
            className={`chat-conversation ${current?.id === item.id ? 'chat-selected' : ''}`} aria-pressed={current?.id === item.id}>
            <span className="block truncate" dir="auto">{item.customer_id}</span>
            <span className="mt-2 block text-sm font-semibold" dir="auto">
                  {ar ? 'الصفحة: ' : 'Page: '}
                  {item.channel.name}
                  {' · '}
                  {item.channel.platform === 'facebook'
                    ? 'Facebook'
                    : 'Instagram'}
                </span>

                <span className="mt-1 block text-xs text-muted" dir="ltr">
                  ID: {item.channel.asset_id}
                </span>
          </button>)}
        <div className="mt-4 flex justify-between gap-2">
          <button type="button" className="control" disabled={page === 1} onClick={() => { setPage(p => p - 1); setSelected(''); }}>{ar ? 'السابق' : 'Previous'}</button>
          <button type="button" className="control" disabled={!conversations.data?.pagination.has_more} onClick={() => { setPage(p => p + 1); setSelected(''); }}>{ar ? 'التالي' : 'Next'}</button>
        </div>
      </aside>
      {current ? <ConversationPanel key={current.id} conversation={current} clinicId={clinic.id} token={token}
        ar={ar} canReply={clinic.role !== 'doctor' || isAdmin === true} onQueued={conversations.retry} />
        : <section className="chat-panel grid min-h-80 place-items-center p-6 text-muted">{ar ? 'اختار محادثة لعرض الرسائل.' : 'Choose a conversation to see messages.'}</section>}
    </div>
  </>;
}
