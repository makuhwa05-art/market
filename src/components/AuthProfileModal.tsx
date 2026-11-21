import React, { useEffect, useState } from 'react';
import { Camera, LogOut, User as UserIcon, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ZIMBABWE_LOCATIONS } from '../types';
import { compressImageFile } from '../utils/imageCompression';
import { formatZimbabwePhoneDisplay, isValidZimbabwePhone, normalizeZimbabwePhone } from '../utils/whatsapp';

interface AuthProfileModalProps {
  isOpen: boolean;
  initialMode?: 'login' | 'register' | 'profile';
  promptMessage?: string;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

export function AuthProfileModal({
  isOpen,
  initialMode = 'login',
  promptMessage,
  onClose,
  onAuthSuccess,
}: AuthProfileModalProps) {
  const { user, setSession, updateUser, logout, authHeaders } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(
    initialMode === 'register' ? 'register' : 'login'
  );

  // Login state
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register / Edit profile state
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [city, setCity] = useState(user?.city ?? 'Harare');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState<string | null>(user?.avatar ?? null);
  const [avatarInfo, setAvatarInfo] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSuccessMsg('');
    setAvatarInfo('');
    if (user) {
      setFullName(user.fullName);
      setPhone(user.phone);
      setCity(user.city);
      setAvatar(user.avatar);
    } else {
      setMode(initialMode === 'register' ? 'register' : 'login');
    }
  }, [isOpen, user, initialMode]);

  if (!isOpen) return null;

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const { dataUrl, sizeKb } = await compressImageFile(file, {
        maxDimension: 320,
        quality: 0.72,
      });
      setAvatar(dataUrl);
      setAvatarInfo(`Compressed to ${sizeKb} KB`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process profile picture.');
    } finally {
      e.target.value = '';
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isValidZimbabwePhone(loginPhone)) {
      setError('Enter a valid Zimbabwe phone number (e.g. 0771234567).');
      return;
    }
    if (!loginPassword) {
      setError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: loginPhone, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not sign in.');
        return;
      }
      setSession(data.token, data.user);
      setLoginPassword('');
      onAuthSuccess?.();
      onClose();
    } catch {
      setError('Network error while signing in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (fullName.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!isValidZimbabwePhone(phone)) {
      setError('Enter a valid Zimbabwe WhatsApp number (e.g. 0771234567).');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone,
          city,
          password,
          avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed.');
        return;
      }
      setSession(data.token, data.user);
      setPassword('');
      onAuthSuccess?.();
      onClose();
    } catch {
      setError('Network error while creating account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (fullName.trim().length < 2) {
      setError('Full name is required.');
      return;
    }
    if (!isValidZimbabwePhone(phone)) {
      setError('Please enter a valid Zimbabwe WhatsApp number.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone,
          city,
          avatar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not update profile.');
        return;
      }
      updateUser(data.user);
      setSuccessMsg('Profile saved.');
    } catch {
      setError('Network error while updating profile.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">
            {user ? 'Your Profile' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {promptMessage && !user && (
            <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
              {promptMessage}
            </p>
          )}

          {error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5" role="alert">
              {error}
            </p>
          )}

          {successMsg && (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">
              {successMsg}
            </p>
          )}

          {user ? (
            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                  {avatar ? (
                    <img src={avatar} alt={fullName} className="w-full h-full object-cover" />
                  ) : (
                    <UserIcon className="w-7 h-7 text-slate-400" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="inline-flex items-center gap-2 min-h-[40px] px-3.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer">
                    <Camera className="w-4 h-4" aria-hidden="true" />
                    {avatar ? 'Change Photo' : 'Add Profile Photo'}
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="sr-only" />
                  </label>
                  {avatar && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvatar(null);
                        setAvatarInfo('');
                      }}
                      className="block text-xs text-slate-500 hover:text-red-600"
                    >
                      Remove photo
                    </button>
                  )}
                  {avatarInfo && <p className="text-xs text-slate-500">{avatarInfo}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Phone / WhatsApp Number
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="077 123 4567"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
                {phone && (
                  <p className="mt-1 text-xs text-slate-500 tabular-nums">
                    WhatsApp format: {formatZimbabwePhoneDisplay(normalizeZimbabwePhone(phone))}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Location</label>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                >
                  {ZIMBABWE_LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[46px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {submitting ? 'Saving...' : 'Save Profile'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-medium text-slate-700"
                >
                  <LogOut className="w-4 h-4" aria-hidden="true" />
                  Sign Out
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                  }}
                  className={`min-h-[40px] rounded-md text-xs font-semibold transition-colors ${
                    mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError('');
                  }}
                  className={`min-h-[40px] rounded-md text-xs font-semibold transition-colors ${
                    mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Phone / WhatsApp Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={loginPhone}
                      onChange={(e) => setLoginPhone(e.target.value)}
                      placeholder="e.g. 0771234567"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                    <input
                      type="password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[46px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    {submitting ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                      {avatar ? (
                        <img src={avatar} alt="Profile preview" className="w-full h-full object-cover" />
                      ) : (
                        <UserIcon className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                    <label className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer">
                      <Camera className="w-4 h-4" aria-hidden="true" />
                      Optional Profile Photo
                      <input type="file" accept="image/*" onChange={handleAvatarUpload} className="sr-only" />
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Tatenda Moyo"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Phone / WhatsApp Number
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 0771234567"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                    {phone && (
                      <p className="mt-1 text-xs text-slate-500 tabular-nums">
                        Saves as {formatZimbabwePhoneDisplay(normalizeZimbabwePhone(phone))}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Location</label>
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    >
                      {ZIMBABWE_LOCATIONS.map((loc) => (
                        <option key={loc} value={loc}>
                          {loc}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full min-h-[46px] rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
                  >
                    {submitting ? 'Creating account...' : 'Create Account'}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
