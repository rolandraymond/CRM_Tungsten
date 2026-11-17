import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, UserPlus, Award, CheckCheck, ExternalLink } from 'lucide-react';
import { useCrm } from '../features/crm/CrmContext';

interface NotificationItem {
  id: string;
  contact_id: string;
  lead_id?: string;
  full_name: string;
  phone?: string;
  type: 'client_added' | 'client_won';
  title: string;
  subtitle: string;
  source: string;
  created_at: string;
  is_won?: boolean;
}

export default function NotificationBell() {
  const { activeWorkspace, apiFetch } = useCrm();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Storage key for read notifications
  const readKey = activeWorkspace ? `crm_notifs_read_${activeWorkspace.id}` : 'crm_notifs_read';

  const getReadIds = useCallback((): Set<string> => {
    try {
      const stored = localStorage.getItem(readKey);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }, [readKey]);

  const saveReadIds = useCallback((ids: Set<string>) => {
    try {
      localStorage.setItem(readKey, JSON.stringify(Array.from(ids)));
    } catch {
      // ignore
    }
  }, [readKey]);

  const fetchNotifications = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      setLoading(true);
      const res = await apiFetch<{
        notifications: NotificationItem[];
        total: number;
        is_owner: boolean;
      }>(`/api/crm/workspaces/${activeWorkspace.id}/notifications`);

      const items = res.notifications || [];
      setNotifications(items);

      const readIds = getReadIds();
      const unread = items.filter((n) => !readIds.has(n.id)).length;
      setUnreadCount(unread);
    } catch (err) {
      console.warn('[NotificationBell] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, apiFetch, getReadIds]);

  // Initial fetch and 25-second poll
  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(() => {
      void fetchNotifications();
    }, 25000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleMarkAllAsRead = () => {
    const allIds = new Set(notifications.map((n) => n.id));
    saveReadIds(allIds);
    setUnreadCount(0);
  };

  const handleItemClick = (item: NotificationItem) => {
    const readIds = getReadIds();
    readIds.add(item.id);
    saveReadIds(readIds);
    setUnreadCount((prev) => Math.max(0, prev - 1));
    setIsOpen(false);

    if (item.contact_id) {
      navigate(`/crm/contacts/${item.contact_id}`);
    }
  };

  const formatTimeAgo = (isoDate: string) => {
    try {
      const d = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'الآن';
      if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
      if (diffHours < 24) return `منذ ${diffHours} ساعة`;
      return `منذ ${diffDays} يوم`;
    } catch {
      return '';
    }
  };

  const readIds = getReadIds();

  return (
    <div className="relative" ref={dropdownRef} dir="rtl">
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) {
            void fetchNotifications();
          }
        }}
        title="الإشعارات (تنبيهات إضافة العميل)"
        className={`relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
          isOpen
            ? 'border-amber-500 bg-amber-500/15 text-amber-500 shadow-sm'
            : 'border-line bg-surface text-muted hover:border-amber-500/40 hover:text-ink'
        }`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -end-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute end-0 top-full z-50 mt-2 w-80 sm:w-96 rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-surface/50">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Bell className="h-3.5 w-3.5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-ink">الإشعارات والتنبيهات</h4>
                <p className="text-[10px] text-muted">
                  {unreadCount > 0 ? `${unreadCount} إشعار جديد لم يُقرأ` : 'تمت قراءة كافة الإشعارات'}
                </p>
              </div>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-amber-500 hover:bg-amber-500/10 transition"
              >
                <CheckCheck className="h-3 w-3" />
                <span>تحديد الكل كمقروء</span>
              </button>
            )}
          </div>

          {/* List of notifications */}
          <div className="max-h-80 overflow-y-auto divide-y divide-line/60">
            {loading && notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted">جاري تحميل الإشعارات...</div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted">
                <Bell className="mx-auto h-7 w-7 text-muted/40 mb-2" />
                <p>لا توجد إشعارات جديدة في مساحة العمل</p>
              </div>
            ) : (
              notifications.map((item) => {
                const isRead = readIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`flex items-start gap-3 p-3.5 transition cursor-pointer hover:bg-surface/80 ${
                      !isRead ? 'bg-amber-500/[0.04]' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                        item.is_won
                          ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                      }`}
                    >
                      {item.is_won ? <Award className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs font-bold text-ink truncate leading-snug">
                          {item.full_name}
                        </p>
                        <span className="text-[10px] text-muted whitespace-nowrap">
                          {formatTimeAgo(item.created_at)}
                        </span>
                      </div>

                      <p className="text-[11px] text-muted truncate mt-0.5">
                        {item.title}
                      </p>

                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {item.lead_id && (
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-surface border border-line text-amber-500">
                            {item.lead_id}
                          </span>
                        )}
                        <span className="text-[10px] text-muted">
                          {item.subtitle}
                        </span>
                      </div>
                    </div>

                    {/* Unread dot */}
                    {!isRead && (
                      <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0 self-center" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-line px-3 py-2 bg-surface/50 text-center">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                navigate('/crm/contacts');
              }}
              className="text-[11px] font-bold text-amber-500 hover:underline flex items-center justify-center gap-1 w-full py-1"
            >
              <span>عرض كل العملاء في الـ CRM</span>
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
