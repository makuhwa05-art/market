import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import type { NotificationItem, UserProfile } from '../types';

interface AuthContextValue {
  user: UserProfile | null;
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  authError: string;
  signInWithGoogle: () => Promise<UserProfile | null>;
  refreshProfile: () => Promise<void>;
  updateUser: (user: UserProfile) => void;
  markNotificationsRead: () => Promise<void>;
  logout: () => Promise<void>;
  authHeaders: () => Record<string, string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Held strictly in React memory for session security
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const syncWithBackend = useCallback(async (idToken: string): Promise<UserProfile | null> => {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Could not load your account profile.');
    }
    setToken(idToken);
    setUser(data.user);
    setNotifications(data.notifications ?? []);
    setUnreadCount(Number(data.unreadCount ?? 0));
    setAuthError('');
    return data.user as UserProfile;
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setToken(null);
        setUser(null);
        setNotifications([]);
        setUnreadCount(0);
        setLoading(false);
        return;
      }

      try {
        const idToken = await firebaseUser.getIdToken();
        await syncWithBackend(idToken);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Account sign-in failed.');
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [syncWithBackend]);

  const signInWithGoogle = useCallback(async (): Promise<UserProfile | null> => {
    setAuthError('');
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      return await syncWithBackend(idToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in was cancelled or failed.';
      setAuthError(message);
      throw new Error(message);
    }
  }, [syncWithBackend]);

  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;
    const idToken = await current.getIdToken();
    await syncWithBackend(idToken);
  }, [syncWithBackend]);

  const updateUser = useCallback((nextUser: UserProfile) => {
    setUser(nextUser);
  }, []);

  const markNotificationsRead = useCallback(async () => {
    if (!token) return;
    const res = await fetch('/api/auth/notifications/read', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    }
  }, [token]);

  const logout = useCallback(async () => {
    await signOut(auth);
    setToken(null);
    setUser(null);
    setNotifications([]);
    setUnreadCount(0);
    setAuthError('');
  }, []);

  const authHeaders = useCallback((): Record<string, string> => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        notifications,
        unreadCount,
        loading,
        authError,
        signInWithGoogle,
        refreshProfile,
        updateUser,
        markNotificationsRead,
        logout,
        authHeaders,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
