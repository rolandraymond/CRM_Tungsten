import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Workspace, WorkspaceRole } from './types';
import { supabase } from '../../lib/supabase';

interface CrmContextType {
  token: string;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isPlatformAdmin: boolean;
  userRole: WorkspaceRole | null;
  isTungstenInternal: boolean;
  isLoading: boolean;
  error: string | null;
  refreshWorkspaces: () => Promise<void>;
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  invalidateCache: (prefix?: string) => void;
}

const CrmContext = createContext<CrmContextType | null>(null);

// In-memory cache for blazing-fast instant tab switching
const apiCache = new Map<string, { data: any; ts: number }>();

export function CrmProvider({
  token,
  userId,
  isClinicUser = false,
  children,
}: {
  token: string;
  userId?: string;
  isClinicUser?: boolean;
  children: React.ReactNode;
}) {
  const cacheKeyWorkspaces = userId ? `tungsten_cached_workspaces_${userId}` : 'tungsten_cached_workspaces';
  const cacheKeyActiveWs = userId ? `tungsten_active_workspace_id_${userId}` : 'tungsten_active_workspace_id';

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => {
    if (isClinicUser) return [];
    try {
      const cached = localStorage.getItem(cacheKeyWorkspaces);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => {
    if (isClinicUser) return '';
    return localStorage.getItem(cacheKeyActiveWs) || '';
  });
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When switching users or clinic user status, clear caches and reset state immediately
  useEffect(() => {
    apiCache.clear();
    if (isClinicUser) {
      setWorkspaces([]);
      setActiveWorkspaceId('');
      setIsPlatformAdmin(false);
      return;
    }
    try {
      const cached = localStorage.getItem(cacheKeyWorkspaces);
      setWorkspaces(cached ? JSON.parse(cached) : []);
    } catch {
      setWorkspaces([]);
    }
    setActiveWorkspaceId(localStorage.getItem(cacheKeyActiveWs) || '');
  }, [userId, isClinicUser, cacheKeyWorkspaces, cacheKeyActiveWs]);

  const invalidateCache = useCallback((prefix?: string) => {
    if (!prefix) {
      apiCache.clear();
    } else {
      for (const key of apiCache.keys()) {
        if (key.includes(prefix)) {
          apiCache.delete(key);
        }
      }
    }
  }, []);

  const apiFetch = useCallback(
    async <T,>(endpoint: string, options: RequestInit = {}): Promise<T> => {
      const method = (options.method || 'GET').toUpperCase();
      const isGet = method === 'GET';

      // Serve from cache if available and fresh (30 seconds)
      if (isGet) {
        const cached = apiCache.get(endpoint);
        if (cached && Date.now() - cached.ts < 30000) {
          return cached.data as T;
        }
      } else {
        // Clear cache on mutations (POST, PATCH, DELETE)
        apiCache.clear();
      }

      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }

      const res = await fetch(endpoint, {
        ...options,
        headers,
      });

      if (!res.ok) {
        let errMessage = `HTTP error ${res.status}`;
        try {
          const body = await res.json();
          if (body.error) errMessage = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
        } catch {
          // ignore json error
        }
        if (res.status === 401 && !window.location.pathname.includes('/login')) {
          void supabase.auth.signOut().finally(() => {
            window.location.href = '/login';
          });
        }
        throw new Error(errMessage);
      }

      const data = (await res.json()) as T;
      if (isGet) {
        apiCache.set(endpoint, { data, ts: Date.now() });
      }
      return data;
    },
    [token]
  );

  const loadWorkspaces = useCallback(async () => {
    if (isClinicUser) {
      setWorkspaces([]);
      setActiveWorkspaceId('');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<{
        is_platform_admin: boolean;
        workspaces: Workspace[];
      }>('/api/crm/workspaces');

      const wsList = result.workspaces || [];
      setWorkspaces(wsList);
      try {
        localStorage.setItem(cacheKeyWorkspaces, JSON.stringify(wsList));
      } catch {}
      setIsPlatformAdmin(result.is_platform_admin || false);

      // Select active workspace using functional updater to avoid dependency loop
      setActiveWorkspaceId((prevId) => {
        if (wsList.length === 0) return '';
        const exists = wsList.find((w) => w.id === prevId);
        if (exists) return prevId;
        const internal = wsList.find((w) => w.workspace_type === 'tungsten_internal') || wsList[0];
        try {
          localStorage.setItem(cacheKeyActiveWs, internal.id);
        } catch {}
        return internal.id;
      });
    } catch (err: any) {
      console.error('[CRM Load Workspaces Failed]', err);
      setError(err.message || 'فشل تحميل مساحات العمل');
    } finally {
      setIsLoading(false);
    }
  }, [apiFetch, isClinicUser, cacheKeyWorkspaces, cacheKeyActiveWs]);

  useEffect(() => {
    if (!isClinicUser) {
      void loadWorkspaces();
    }
  }, [loadWorkspaces, isClinicUser]);

  const handleSetActiveWorkspaceId = (id: string) => {
    setActiveWorkspaceId(id);
    try {
      localStorage.setItem(cacheKeyActiveWs, id);
    } catch {}
    // Clear cache when user deliberately switches workspace
    apiCache.clear();
  };

  const activeWorkspace = isClinicUser ? null : (workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null);
  const userRole = isClinicUser ? null : (activeWorkspace?.user_role || (isPlatformAdmin ? 'platform_admin' : null));
  const isTungstenInternal = !isClinicUser && activeWorkspace?.workspace_type === 'tungsten_internal';

  return (
    <CrmContext.Provider
      value={{
        token,
        workspaces,
        activeWorkspace,
        setActiveWorkspaceId: handleSetActiveWorkspaceId,
        isPlatformAdmin,
        userRole,
        isTungstenInternal,
        isLoading,
        error,
        refreshWorkspaces: loadWorkspaces,
        apiFetch,
        invalidateCache,
      }}
    >
      {children}
    </CrmContext.Provider>
  );
}

export function useCrm() {
  const context = useContext(CrmContext);
  if (!context) {
    throw new Error('useCrm must be used within a CrmProvider');
  }
  return context;
}
