import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  Download,
  Eye,
  Flag,
  FolderTree,
  LayoutDashboard,
  Layers,
  Lock,
  LogOut,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AdminAccount,
  HouseListing,
  JobListing,
  MarketListing,
  SponsorshipPayment,
  SponsorshipPlan,
  UserProfile,
} from '../types';
import { ZIMBABWE_LOCATIONS } from '../types';
import { formatShortDate, formatZimbabwePhoneDisplay } from '../utils/whatsapp';

type AdminSection =
  | 'overview'
  | 'users'
  | 'verification'
  | 'listings'
  | 'sponsorships'
  | 'reports'
  | 'categories'
  | 'admins'
  | 'logs';

interface OverviewResponse {
  stats: {
    totalUsers: number;
    verifiedUsers: number;
    pendingVerificationUsers: number;
    suspendedUsers: number;
    totalJobs: number;
    totalMarket: number;
    totalHouses: number;
    pendingListings: number;
    approvedListings: number;
    rejectedListings: number;
    activeSponsorships: number;
    pendingPayments: number;
    confirmedPayments: number;
    expiredSponsorships: number;
    sponsorshipRevenueUsd: number;
    openReports: number;
  };
  recentLogs: AuditLogRow[];
}

interface AdminListingItem {
  type: 'job' | 'market' | 'house';
  id: number;
  userId: number | null;
  authorName: string;
  title: string;
  subtitle: string;
  location: string;
  priceLabel: string;
  whatsapp: string;
  approvalStatus: string;
  moderationReason: string | null;
  lifecycleStatus: string;
  isSponsored: boolean;
  sponsoredUntil: string | null;
  expiresAt: string | null;
  createdAt: string;
  raw: Record<string, unknown>;
}

interface AdminReportItem {
  id: number;
  listingType: 'job' | 'market' | 'house';
  listingId: number;
  listingTitle: string;
  reporterName: string;
  reason: string;
  details: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  resolutionNote: string | null;
  createdAt: string;
}

interface CategoryItem {
  id: number;
  section: 'job' | 'market' | 'house';
  name: string;
  isActive: boolean;
}

interface AuditLogRow {
  id: number;
  actorType: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  summary: string;
  createdAt: string;
}

interface ActiveSponsoredSummary {
  type: 'job' | 'market' | 'house';
  id: number;
  title: string;
  authorName: string;
  approvalStatus: string;
  sponsoredUntil: string | null;
}

const ROLE_DEFAULTS: Record<string, string[]> = {
  super_admin: [
    'manage_users',
    'verify_users',
    'moderate_ads',
    'manage_sponsorships',
    'manage_payments',
    'manage_reports',
    'manage_categories',
    'manage_admins',
    'view_logs',
    'manage_settings',
  ],
  moderator: ['moderate_ads', 'manage_reports'],
  user_manager: ['manage_users', 'verify_users'],
  sponsorship_manager: ['manage_sponsorships', 'manage_payments'],
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-ZW', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminDashboard({ onExitAdmin }: { onExitAdmin: () => void }) {
  // Admin Bearer token & profile kept strictly in React memory
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<AdminAccount | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [viaEnv, setViaEnv] = useState(false);

  // Login / Bootstrap form state
  const [username, setUsername] = useState('superadmin');
  const [adminFullName, setAdminFullName] = useState('Super Administrator');
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Section & UI state
  const [section, setSection] = useState<AdminSection>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  // Overview state
  const [overview, setOverview] = useState<OverviewResponse | null>(null);

  // Users & Verification state
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userVerificationFilter, setUserVerificationFilter] = useState('all');
  const [inspectedUser, setInspectedUser] = useState<{
    user: UserProfile;
    jobs: JobListing[];
    market: MarketListing[];
    houses: HouseListing[];
  } | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserCity, setNewUserCity] = useState('Harare');
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserPhone, setEditUserPhone] = useState('');
  const [editUserWhatsapp, setEditUserWhatsapp] = useState('');
  const [editUserCity, setEditUserCity] = useState('Harare');
  const [verifyNoteByUser, setVerifyNoteByUser] = useState<Record<number, string>>({});

  // Listings Moderation state
  const [listings, setListings] = useState<AdminListingItem[]>([]);
  const [listingTypeFilter, setListingTypeFilter] = useState<'all' | 'jobs' | 'market' | 'houses'>('all');
  const [listingApprovalFilter, setListingApprovalFilter] = useState('all');
  const [listingSearch, setListingSearch] = useState('');
  const [previewListing, setPreviewListing] = useState<AdminListingItem | null>(null);
  const [moderationDialog, setModerationDialog] = useState<{
    item: AdminListingItem;
    decision: 'reject' | 'request_correction';
  } | null>(null);
  const [moderationReason, setModerationReason] = useState('');
  const [editingListing, setEditingListing] = useState<AdminListingItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLifecycle, setEditLifecycle] = useState('active');

  // Sponsorships & Payments state
  const [sponsorshipData, setSponsorshipData] = useState<{
    summary: {
      pendingPayments: number;
      confirmedPayments: number;
      expiredSponsorships: number;
      activeSponsoredPosts: number;
      totalRevenueUsd: number;
    };
    plans: SponsorshipPlan[];
    payments: SponsorshipPayment[];
    activeListings: ActiveSponsoredSummary[];
  } | null>(null);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanDays, setNewPlanDays] = useState('7');
  const [newPlanPrice, setNewPlanPrice] = useState('5');
  const [paymentNoteById, setPaymentNoteById] = useState<Record<number, string>>({});

  // Reports state
  const [reports, setReports] = useState<AdminReportItem[]>([]);

  // Categories state
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [newCatSection, setNewCatSection] = useState<'job' | 'market' | 'house'>('job');
  const [newCatName, setNewCatName] = useState('');

  // Administrators state (Super Admin)
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [newAdminUsername, setNewAdminUsername] = useState('');
  const [newAdminFullName, setNewAdminFullName] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'moderator' | 'user_manager' | 'sponsorship_manager' | 'super_admin'>('moderator');
  const [newAdminPerms, setNewAdminPerms] = useState<string[]>(ROLE_DEFAULTS.moderator);

  // Logs & Settings state
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [listingExpiryDays, setListingExpiryDays] = useState('30');

  useEffect(() => {
    fetch('/api/admin/status')
      .then((r) => r.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        setViaEnv(Boolean(data.viaEnv));
      })
      .catch(() => {
        setAuthError('Unable to reach server.');
      })
      .finally(() => setStatusLoading(false));
  }, []);

  const hasPerm = useCallback(
    (perm: string): boolean => {
      if (!currentAdmin) return false;
      if (currentAdmin.role === 'super_admin') return true;
      return currentAdmin.permissions.includes(perm);
    },
    [currentAdmin]
  );

  const adminHeaders = useCallback((): Record<string, string> => {
    return adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
  }, [adminToken]);

  const loadSectionData = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError('');
    try {
      if (section === 'overview') {
        const res = await fetch('/api/admin/overview', { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load overview');
        setOverview(data);
      } else if (section === 'users' || section === 'verification') {
        const params = new URLSearchParams();
        if (userSearch.trim()) params.set('q', userSearch.trim());
        const verFilter =
          section === 'verification'
            ? userVerificationFilter === 'all'
              ? 'all'
              : userVerificationFilter
            : 'all';
        if (verFilter !== 'all') params.set('verification', verFilter);
        const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load users');
        setUsers(data.users ?? []);
      } else if (section === 'listings') {
        const params = new URLSearchParams({
          type: listingTypeFilter,
          approval: listingApprovalFilter,
        });
        if (listingSearch.trim()) params.set('q', listingSearch.trim());
        const res = await fetch(`/api/admin/listings?${params.toString()}`, { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load advertisements');
        setListings(data.items ?? []);
      } else if (section === 'sponsorships') {
        const res = await fetch('/api/admin/sponsorships', { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load sponsorship dashboard');
        setSponsorshipData(data);
      } else if (section === 'reports') {
        const res = await fetch('/api/admin/reports', { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load reports');
        setReports(data.reports ?? []);
      } else if (section === 'categories') {
        const res = await fetch('/api/admin/categories', { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load categories');
        setCategories(data.categories ?? []);
      } else if (section === 'admins') {
        const res = await fetch('/api/admin/admins', { headers: adminHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load administrators');
        setAdminAccounts(data.admins ?? []);
        setAllPermissions(data.allPermissions ?? ROLE_DEFAULTS.super_admin);
      } else if (section === 'logs') {
        const reqs: Promise<Response>[] = [];
        const canLogs = hasPerm('view_logs');
        const canSettings = hasPerm('manage_settings');
        if (canLogs) reqs.push(fetch('/api/admin/logs', { headers: adminHeaders() }));
        if (canSettings) reqs.push(fetch('/api/admin/settings', { headers: adminHeaders() }));
        const results = await Promise.all(reqs);
        let idx = 0;
        if (canLogs) {
          const d = await results[idx++].json();
          setLogs(d.logs ?? []);
        }
        if (canSettings) {
          const d = await results[idx++].json();
          setPaymentInstructions(d.paymentInstructions ?? '');
          setListingExpiryDays(String(d.listingExpiryDays ?? 30));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading admin data');
    } finally {
      setLoading(false);
    }
  }, [
    adminToken,
    section,
    userSearch,
    userVerificationFilter,
    listingTypeFilter,
    listingApprovalFilter,
    listingSearch,
    adminHeaders,
    hasPerm,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadSectionData();
    }, 100);
    return () => clearTimeout(timer);
  }, [loadSectionData]);

  // Auth Handlers
  const handleAdminBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (passcode.trim().length < 8) {
      setAuthError('Super Admin password must be at least 8 characters.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          fullName: adminFullName.trim(),
          passcode: passcode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Setup failed.');
        return;
      }
      setAdminToken(data.token);
      setCurrentAdmin(data.admin);
      setConfigured(true);
      setPasscode('');
      setConfirmPasscode('');
    } catch {
      setAuthError('Network error during setup.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim().toLowerCase(),
          passcode: passcode.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Invalid credentials.');
        return;
      }
      setAdminToken(data.token);
      setCurrentAdmin(data.admin);
      setSection('overview');
      setPasscode('');
    } catch {
      setAuthError('Network error signing in.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  // User Actions
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        fullName: newUserName,
        email: newUserEmail,
        phone: newUserPhone,
        whatsapp: newUserPhone,
        city: newUserCity,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not create user.');
      return;
    }
    setCreateUserOpen(false);
    setNewUserName('');
    setNewUserEmail('');
    setNewUserPhone('');
    setNotice(`Created user profile for ${data.user.fullName}.`);
    loadSectionData();
  };

  const handleSaveEditedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError('');
    const res = await fetch(`/api/admin/users/${editingUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        fullName: editUserName,
        phone: editUserPhone,
        whatsapp: editUserWhatsapp,
        city: editUserCity,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to update user.');
      return;
    }
    setEditingUser(null);
    setNotice(`Updated user ${data.user.fullName}.`);
    loadSectionData();
  };

  const handleToggleUserStatus = async (userRow: UserProfile) => {
    const nextStatus = userRow.accountStatus === 'suspended' ? 'active' : 'suspended';
    const res = await fetch(`/api/admin/users/${userRow.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ accountStatus: nextStatus }),
    });
    if (res.ok) {
      setNotice(`${userRow.fullName} is now ${nextStatus}.`);
      loadSectionData();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to update user status.');
    }
  };

  const handleChangeVerification = async (
    userRow: UserProfile,
    verificationStatus: 'verified' | 'unverified' | 'pending' | 'suspended'
  ) => {
    const note = verifyNoteByUser[userRow.id] ?? '';
    const res = await fetch(`/api/admin/users/${userRow.id}/verification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ verificationStatus, note }),
    });
    if (res.ok) {
      setNotice(`Verification for ${userRow.fullName} updated to "${verificationStatus}".`);
      loadSectionData();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to update verification.');
    }
  };

  const handleDeleteUser = async (userId: number) => {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (res.ok) {
      setConfirmDeleteKey(null);
      setInspectedUser(null);
      setNotice('User account and associated listings removed.');
      loadSectionData();
    }
  };

  const handleInspectUser = async (userId: number) => {
    const res = await fetch(`/api/admin/users/${userId}`, { headers: adminHeaders() });
    if (res.ok) {
      const data = await res.json();
      setInspectedUser(data);
    }
  };

  // Listing Moderation Actions
  const handleModerateListing = async (
    item: AdminListingItem,
    decision: 'approve' | 'reject' | 'request_correction',
    reason?: string
  ) => {
    const res = await fetch(`/api/admin/listings/${item.type}/${item.id}/moderate`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ decision, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Moderation action failed.');
      return;
    }
    setModerationDialog(null);
    setModerationReason('');
    setNotice(`"${item.title}" marked as ${data.approvalStatus}. Author notified.`);
    loadSectionData();
  };

  const handleSaveEditedListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingListing) return;
    const res = await fetch(`/api/admin/listings/${editingListing.type}/${editingListing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        title: editTitle,
        description: editDescription,
        lifecycleStatus: editLifecycle,
      }),
    });
    if (res.ok) {
      setEditingListing(null);
      setNotice('Listing changes saved.');
      loadSectionData();
    }
  };

  const handleDeleteListing = async (type: string, id: number) => {
    const res = await fetch(`/api/admin/listings/${type}/${id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (res.ok) {
      setConfirmDeleteKey(null);
      setPreviewListing(null);
      setNotice('Advertisement deleted.');
      loadSectionData();
    }
  };

  const handlePurgeExpired = async () => {
    const res = await fetch('/api/admin/listings/expired', {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    const data = await res.json();
    if (res.ok) {
      setNotice(`Removed ${data.removed ?? 0} expired advertisement(s).`);
      loadSectionData();
    }
  };

  // Sponsorship & Payment Actions
  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/sponsorship-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        name: newPlanName,
        durationDays: Number(newPlanDays),
        priceUsd: Number(newPlanPrice),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to add sponsorship plan.');
      return;
    }
    setNewPlanName('');
    setNotice(`Added sponsorship plan "${data.plan.name}".`);
    loadSectionData();
  };

  const handleTogglePlan = async (plan: SponsorshipPlan) => {
    const res = await fetch(`/api/admin/sponsorship-plans/${plan.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ isActive: !plan.isActive }),
    });
    if (res.ok) {
      loadSectionData();
    }
  };

  const handleProcessPayment = async (payment: SponsorshipPayment, action: 'confirm' | 'reject') => {
    const adminNote = paymentNoteById[payment.id] ?? '';
    const res = await fetch(`/api/admin/payments/${payment.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ action, adminNote }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || 'Could not process payment.');
      return;
    }
    setNotice(
      action === 'confirm'
        ? `Confirmed $${payment.amountUsd} payment and activated ${payment.durationDays}-day sponsorship for "${payment.listingTitle}".`
        : `Rejected payment reference "${payment.paymentReference}".`
    );
    loadSectionData();
  };

  // Reports Actions
  const handleReportStatus = async (reportId: number, status: 'resolved' | 'dismissed') => {
    const res = await fetch(`/api/admin/reports/${reportId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      loadSectionData();
    }
  };

  // Categories Actions
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ section: newCatSection, name: newCatName }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not create category.');
      return;
    }
    setNewCatName('');
    setNotice(`Added category "${data.category.name}".`);
    loadSectionData();
  };

  const handleDeleteCategory = async (id: number) => {
    const res = await fetch(`/api/admin/categories/${id}`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    if (res.ok) loadSectionData();
  };

  // Administrators Actions
  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        username: newAdminUsername,
        fullName: newAdminFullName,
        password: newAdminPassword,
        role: newAdminRole,
        permissions: newAdminPerms,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not create administrator.');
      return;
    }
    setNewAdminUsername('');
    setNewAdminFullName('');
    setNewAdminPassword('');
    setNotice(`Created ${data.admin.role} account "${data.admin.username}".`);
    loadSectionData();
  };

  const handleToggleAdminActive = async (acc: AdminAccount) => {
    const res = await fetch(`/api/admin/admins/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ isActive: !acc.isActive }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not update administrator.');
      return;
    }
    loadSectionData();
  };

  const handleToggleAdminPermission = async (acc: AdminAccount, perm: string) => {
    const nextPerms = acc.permissions.includes(perm)
      ? acc.permissions.filter((p) => p !== perm)
      : [...acc.permissions, perm];
    const res = await fetch(`/api/admin/admins/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({ permissions: nextPerms }),
    });
    if (res.ok) loadSectionData();
  };

  // Settings & Backup
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...adminHeaders() },
      body: JSON.stringify({
        paymentInstructions,
        listingExpiryDays: Number(listingExpiryDays) || 30,
      }),
    });
    if (res.ok) {
      setNotice('Platform settings saved.');
    }
  };

  const handleDownloadBackup = async () => {
    const res = await fetch('/api/admin/export-backup', { headers: adminHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market_jobs_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setNotice('Database backup snapshot exported.');
  };

  // Unauthenticated / First-run Super Admin Bootstrap Gate
  if (!adminToken || !currentAdmin) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
                <Lock className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">Administrator Console</h1>
                <p className="text-xs text-slate-500">MARKET &amp; JOBS Zimbabwe Control</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onExitAdmin}
              className="min-h-[38px] px-3 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              Site
            </button>
          </div>

          {statusLoading ? (
            <p className="text-sm text-slate-500 py-4">Checking administrator status...</p>
          ) : !configured ? (
            <form onSubmit={handleAdminBootstrap} className="space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                No Super Admin exists yet. Claim your initial Super Admin account to manage users, approvals, verifications, sponsorships, and staff admins.
              </p>
              {authError && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                  {authError}
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Super Admin Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={adminFullName}
                  onChange={(e) => setAdminFullName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Super Admin Password (8+ chars)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPasscode}
                  onChange={(e) => setConfirmPasscode(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full min-h-[46px] rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {authSubmitting ? 'Creating Super Admin...' : 'Claim Super Admin Access'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <p className="text-sm text-slate-600">
                {viaEnv
                  ? 'Sign in with your configured SUPER_ADMIN_USERNAME & ADMIN_PASSCODE or assigned staff admin account.'
                  : 'Sign in with your administrator username and password.'}
              </p>
              {authError && (
                <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                  {authError}
                </p>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="superadmin"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="Enter password"
                  className="w-full min-h-[44px] px-3.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full min-h-[46px] rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-60"
              >
                {authSubmitting ? 'Signing In...' : 'Sign In to Admin Dashboard'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
  }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" />, visible: true },
    { id: 'users', label: 'Users', icon: <Users className="w-4 h-4" />, visible: hasPerm('manage_users') },
    {
      id: 'verification',
      label: 'Verification',
      icon: <BadgeCheck className="w-4 h-4" />,
      visible: hasPerm('verify_users'),
    },
    {
      id: 'listings',
      label: 'Ads Moderation',
      icon: <Layers className="w-4 h-4" />,
      visible: hasPerm('moderate_ads'),
    },
    {
      id: 'sponsorships',
      label: 'Sponsorships & Pay',
      icon: <Megaphone className="w-4 h-4" />,
      visible: hasPerm('manage_sponsorships') || hasPerm('manage_payments'),
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: <Flag className="w-4 h-4" />,
      visible: hasPerm('manage_reports'),
    },
    {
      id: 'categories',
      label: 'Categories',
      icon: <FolderTree className="w-4 h-4" />,
      visible: hasPerm('manage_categories'),
    },
    {
      id: 'admins',
      label: 'Administrators',
      icon: <ShieldCheck className="w-4 h-4" />,
      visible: hasPerm('manage_admins'),
    },
    {
      id: 'logs',
      label: 'Logs & Settings',
      icon: <Settings className="w-4 h-4" />,
      visible: hasPerm('view_logs') || hasPerm('manage_settings'),
    },
  ];

  const visibleNav = navItems.filter((n) => n.visible);
  const sectionTitle = visibleNav.find((n) => n.id === section)?.label ?? 'Overview';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
          <span className="font-display text-sm font-extrabold tracking-tight text-slate-900">
            MARKET &amp; JOBS Admin
          </span>
        </div>
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-900 truncate">{currentAdmin.fullName}</p>
          <p className="text-[11px] text-emerald-700 font-semibold uppercase tracking-wider">
            {currentAdmin.role.replace('_', ' ')}
          </p>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Admin sections">
          {visibleNav.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSection(item.id);
                  setNotice('');
                  setError('');
                }}
                className={`w-full min-h-[40px] px-3 rounded-lg flex items-center gap-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-200 space-y-1.5">
          <button
            type="button"
            onClick={onExitAdmin}
            className="w-full min-h-[40px] px-3 rounded-lg flex items-center gap-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Return to Public Site
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminToken(null);
              setCurrentAdmin(null);
            }}
            className="w-full min-h-[40px] px-3 rounded-lg flex items-center gap-2 text-xs font-semibold text-red-600 hover:bg-red-50"
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-slate-400 font-medium hidden sm:inline">Admin</span>
            <span className="text-slate-300 hidden sm:inline">/</span>
            <span className="font-bold text-slate-900 truncate">{sectionTitle}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onExitAdmin}
              className="lg:hidden min-h-[38px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 whitespace-nowrap"
            >
              Public Site
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminToken(null);
                setCurrentAdmin(null);
              }}
              className="lg:hidden min-h-[38px] px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold whitespace-nowrap"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Mobile Nav */}
        <div className="lg:hidden bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-1.5 overflow-x-auto">
          {visibleNav.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                section === item.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <main className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto space-y-5">
          {notice && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm text-emerald-900">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="text-xs font-semibold text-emerald-800 hover:underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* OVERVIEW */}
          {section === 'overview' && overview && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Users</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.stats.totalUsers}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.stats.verifiedUsers} verified · {overview.stats.suspendedUsers} suspended
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Listings Breakdown</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.stats.totalJobs + overview.stats.totalMarket + overview.stats.totalHouses}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.stats.totalJobs} Jobs · {overview.stats.totalMarket} Market · {overview.stats.totalHouses} Houses
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Approval Queue</p>
                  <p className="text-2xl font-bold text-amber-700 mt-1 tabular-nums">
                    {overview.stats.pendingListings} pending
                  </p>
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.stats.approvedListings} approved · {overview.stats.rejectedListings} rejected
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Sponsorship Revenue</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
                    ${overview.stats.sponsorshipRevenueUsd.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    {overview.stats.activeSponsorships} active · {overview.stats.pendingPayments} pending pay
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Pending Verification Requests</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.stats.pendingVerificationUsers}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Confirmed / Expired Sponsorships</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                    {overview.stats.confirmedPayments} active / {overview.stats.expiredSponsorships} expired
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Open Suspicious Ad Reports</p>
                  <p
                    className={`text-xl font-bold mt-1 tabular-nums ${
                      overview.stats.openReports > 0 ? 'text-red-600' : 'text-slate-900'
                    }`}
                  >
                    {overview.stats.openReports}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">Recent Audit Activity</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {overview.recentLogs.map((log) => (
                    <div key={log.id} className="px-4 py-3 flex items-center justify-between gap-3">
                      <p className="text-xs sm:text-sm text-slate-800">{log.summary}</p>
                      <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* USERS */}
          {section === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[240px] max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search name, phone, email, or city..."
                    className="w-full min-h-[42px] pl-10 pr-3.5 rounded-lg bg-white border border-slate-200 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCreateUserOpen((p) => !p)}
                  className="min-h-[42px] px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  Add User
                </button>
              </div>

              {createUserOpen && (
                <form
                  onSubmit={handleCreateUser}
                  className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-5 gap-3"
                >
                  <input
                    type="text"
                    required
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Full Name"
                    className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                  />
                  <input
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                  />
                  <input
                    type="tel"
                    required
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    placeholder="0771234567"
                    className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                  />
                  <select
                    value={newUserCity}
                    onChange={(e) => setNewUserCity(e.target.value)}
                    className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    {ZIMBABWE_LOCATIONS.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="min-h-[40px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                  >
                    Create Profile
                  </button>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">WhatsApp</th>
                      <th className="py-3 px-4">City</th>
                      <th className="py-3 px-4">Verification</th>
                      <th className="py-3 px-4">Account</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/75">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{u.fullName}</div>
                          <div className="text-xs text-slate-400">{u.email}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-600 tabular-nums whitespace-nowrap">
                          {formatZimbabwePhoneDisplay(u.whatsapp || u.phone)}
                        </td>
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{u.city || '—'}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs font-semibold capitalize">
                          <span
                            className={
                              u.verificationStatus === 'verified'
                                ? 'text-emerald-700'
                                : u.verificationStatus === 'pending'
                                  ? 'text-amber-700'
                                  : u.verificationStatus === 'suspended'
                                    ? 'text-red-600'
                                    : 'text-slate-500'
                            }
                          >
                            {u.verificationStatus}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs font-semibold">
                          <span
                            className={
                              u.accountStatus === 'suspended' ? 'text-red-600' : 'text-emerald-700'
                            }
                          >
                            {u.accountStatus === 'suspended' ? 'Suspended' : 'Active'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleInspectUser(u.id)}
                              className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium"
                            >
                              Inspect
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingUser(u);
                                setEditUserName(u.fullName);
                                setEditUserPhone(u.phone);
                                setEditUserWhatsapp(u.whatsapp);
                                setEditUserCity(u.city || 'Harare');
                              }}
                              className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleUserStatus(u)}
                              className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium inline-flex items-center gap-1"
                            >
                              {u.accountStatus === 'suspended' ? (
                                <>
                                  <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
                                  Reactivate
                                </>
                              ) : (
                                <>
                                  <UserX className="w-3.5 h-3.5 text-amber-600" />
                                  Suspend
                                </>
                              )}
                            </button>
                            {confirmDeleteKey === `user:${u.id}` ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u.id)}
                                className="min-h-[34px] px-2.5 rounded-md bg-red-600 text-white text-xs font-semibold"
                              >
                                Confirm
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteKey(`user:${u.id}`)}
                                className="min-h-[34px] px-2.5 rounded-md text-red-600 hover:bg-red-50 text-xs font-medium"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VERIFICATION QUEUE */}
          {section === 'verification' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'pending', 'verified', 'unverified', 'suspended'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setUserVerificationFilter(status)}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold border capitalize ${
                      userVerificationFilter === status
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {users.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">No accounts match this verification filter.</p>
                ) : (
                  users.map((u) => (
                    <div key={u.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{u.fullName}</span>
                          <span className="text-xs font-semibold capitalize text-emerald-700">
                            ({u.verificationStatus})
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {u.email} · {formatZimbabwePhoneDisplay(u.whatsapp || u.phone)} · {u.city || 'No city'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={verifyNoteByUser[u.id] ?? u.verificationNote ?? ''}
                          onChange={(e) =>
                            setVerifyNoteByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                          placeholder="Verification note..."
                          className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-xs w-44"
                        />
                        {u.verificationStatus !== 'verified' && (
                          <button
                            type="button"
                            onClick={() => handleChangeVerification(u, 'verified')}
                            className="min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <BadgeCheck className="w-3.5 h-3.5" />
                            Verify
                          </button>
                        )}
                        {u.verificationStatus === 'verified' && (
                          <button
                            type="button"
                            onClick={() => handleChangeVerification(u, 'unverified')}
                            className="min-h-[36px] px-3 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* LISTINGS MODERATION (JOBS / MARKET / HOUSES) */}
          {section === 'listings' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
                  <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      value={listingSearch}
                      onChange={(e) => setListingSearch(e.target.value)}
                      placeholder="Search title, author, city..."
                      className="w-full min-h-[40px] pl-9 pr-3 rounded-lg bg-white border border-slate-200 text-sm"
                    />
                  </div>
                  <select
                    value={listingTypeFilter}
                    onChange={(e) =>
                      setListingTypeFilter(e.target.value as 'all' | 'jobs' | 'market' | 'houses')
                    }
                    className="min-h-[40px] px-3 rounded-lg bg-white border border-slate-200 text-sm"
                  >
                    <option value="all">All Types</option>
                    <option value="jobs">Jobs</option>
                    <option value="market">Market</option>
                    <option value="houses">Houses</option>
                  </select>
                  <select
                    value={listingApprovalFilter}
                    onChange={(e) => setListingApprovalFilter(e.target.value)}
                    className="min-h-[40px] px-3 rounded-lg bg-white border border-slate-200 text-sm"
                  >
                    <option value="all">All Approval States</option>
                    <option value="pending">Pending Approval</option>
                    <option value="approved">Approved</option>
                    <option value="correction_requested">Corrections Requested</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handlePurgeExpired}
                  className="min-h-[40px] px-3.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold whitespace-nowrap"
                >
                  Remove Expired Ads
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {listings.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">
                    {loading ? 'Loading listings...' : 'No advertisements match your filters.'}
                  </p>
                ) : (
                  listings.map((item) => (
                    <div
                      key={`${item.type}:${item.id}`}
                      className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold uppercase tracking-wider text-slate-500">
                            {item.type}
                          </span>
                          <span>·</span>
                          <span
                            className={`font-semibold uppercase ${
                              item.approvalStatus === 'approved'
                                ? 'text-emerald-700'
                                : item.approvalStatus === 'rejected'
                                  ? 'text-red-600'
                                  : 'text-amber-700'
                            }`}
                          >
                            {item.approvalStatus.replace('_', ' ')}
                          </span>
                          {item.isSponsored && (
                            <>
                              <span>·</span>
                              <span className="font-bold text-amber-800">SPONSORED</span>
                            </>
                          )}
                          <span>·</span>
                          <span className="text-slate-500 capitalize">{item.lifecycleStatus}</span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 truncate">{item.title}</h3>
                        <p className="text-xs text-slate-500 tabular-nums">
                          {item.subtitle} · {item.location} · {item.priceLabel} · by {item.authorName} on{' '}
                          {formatDateTime(item.createdAt)}
                        </p>
                        {item.moderationReason && (
                          <p className="text-xs text-amber-900">Reason: {item.moderationReason}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewListing(item)}
                          className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium inline-flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview
                        </button>
                        {item.approvalStatus !== 'approved' && (
                          <button
                            type="button"
                            onClick={() => handleModerateListing(item, 'approve')}
                            className="min-h-[34px] px-2.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Approve
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setModerationDialog({ item, decision: 'request_correction' });
                            setModerationReason('');
                          }}
                          className="min-h-[34px] px-2.5 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold"
                        >
                          Request Fix
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModerationDialog({ item, decision: 'reject' });
                            setModerationReason('');
                          }}
                          className="min-h-[34px] px-2.5 rounded-md border border-red-200 hover:bg-red-50 text-red-700 text-xs font-semibold"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingListing(item);
                            setEditTitle(item.title);
                            setEditDescription(String(item.raw.description ?? ''));
                            setEditLifecycle(item.lifecycleStatus);
                          }}
                          className="min-h-[34px] px-2.5 rounded-md border border-slate-200 hover:bg-slate-100 text-xs font-medium"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteKey === `${item.type}:${item.id}` ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteListing(item.type, item.id)}
                            className="min-h-[34px] px-2.5 rounded-md bg-red-600 text-white text-xs font-semibold"
                          >
                            Confirm Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteKey(`${item.type}:${item.id}`)}
                            className="min-h-[34px] px-2.5 rounded-md text-red-600 hover:bg-red-50 text-xs font-medium"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SPONSORSHIPS & PAYMENTS */}
          {section === 'sponsorships' && sponsorshipData && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Pending Payments</p>
                  <p className="text-xl font-bold text-amber-700 mt-1 tabular-nums">
                    {sponsorshipData.summary.pendingPayments}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Confirmed</p>
                  <p className="text-xl font-bold text-emerald-700 mt-1 tabular-nums">
                    {sponsorshipData.summary.confirmedPayments}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Active Sponsored</p>
                  <p className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
                    {sponsorshipData.summary.activeSponsoredPosts}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-500">Expired</p>
                  <p className="text-xl font-bold text-slate-500 mt-1 tabular-nums">
                    {sponsorshipData.summary.expiredSponsorships}
                  </p>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 col-span-2 lg:col-span-1">
                  <p className="text-xs font-semibold text-slate-500">Total Revenue</p>
                  <p className="text-xl font-bold text-emerald-800 mt-1 tabular-nums">
                    ${sponsorshipData.summary.totalRevenueUsd.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Sponsorship Plans Manager */}
              {hasPerm('manage_sponsorships') && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                  <h2 className="text-sm font-bold text-slate-900">Sponsorship Pricing &amp; Durations</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {sponsorshipData.plans.map((plan) => (
                      <div
                        key={plan.id}
                        className="p-3 rounded-lg border border-slate-200 flex items-center justify-between gap-2"
                      >
                        <div>
                          <p className="text-sm font-bold text-slate-900">{plan.name}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {plan.durationDays} days · ${plan.priceUsd} USD
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleTogglePlan(plan)}
                          className={`min-h-[32px] px-2.5 rounded-md text-xs font-semibold ${
                            plan.isActive
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {plan.isActive ? 'Active' : 'Disabled'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleCreatePlan} className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-100">
                    <input
                      type="text"
                      required
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder="Plan name (e.g. 60-Day Pro)"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-xs"
                    />
                    <input
                      type="number"
                      min="1"
                      required
                      value={newPlanDays}
                      onChange={(e) => setNewPlanDays(e.target.value)}
                      placeholder="Days"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-xs"
                    />
                    <input
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={newPlanPrice}
                      onChange={(e) => setNewPlanPrice(e.target.value)}
                      placeholder="Price USD"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-xs"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
                    >
                      Add Plan
                    </button>
                  </form>
                </div>
              )}

              {/* Sponsorship Payments Verification Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <h2 className="text-sm font-bold text-slate-900">Sponsorship Payments Queue</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {sponsorshipData.payments.length === 0 ? (
                    <p className="p-6 text-center text-sm text-slate-500">No payment requests submitted yet.</p>
                  ) : (
                    sponsorshipData.payments.map((pay) => (
                      <div
                        key={pay.id}
                        className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className={`font-bold uppercase ${
                                pay.status === 'confirmed'
                                  ? 'text-emerald-700'
                                  : pay.status === 'rejected'
                                    ? 'text-red-600'
                                    : pay.status === 'expired'
                                      ? 'text-slate-500'
                                      : 'text-amber-700'
                              }`}
                            >
                              {pay.status}
                            </span>
                            <span>·</span>
                            <span className="font-semibold text-slate-900 tabular-nums">
                              ${pay.amountUsd} USD ({pay.durationDays} days)
                            </span>
                            <span>·</span>
                            <span className="text-slate-500">{pay.paymentMethod}</span>
                          </div>
                          <h3 className="text-sm font-bold text-slate-900">
                            {pay.listingTitle}{' '}
                            <span className="text-xs font-normal text-slate-500">({pay.listingType} #{pay.listingId})</span>
                          </h3>
                          <p className="text-xs text-slate-500 tabular-nums">
                            Ref: <strong className="text-slate-800">{pay.paymentReference}</strong> · User:{' '}
                            {pay.userName} ({formatZimbabwePhoneDisplay(pay.userPhone || '')})
                            {pay.expiresAt ? ` · Expires ${formatShortDate(pay.expiresAt)}` : ''}
                          </p>
                        </div>

                        {pay.status === 'pending' && hasPerm('manage_payments') && (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={paymentNoteById[pay.id] ?? ''}
                              onChange={(e) =>
                                setPaymentNoteById((prev) => ({ ...prev, [pay.id]: e.target.value }))
                              }
                              placeholder="Optional note..."
                              className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-xs w-40"
                            />
                            <button
                              type="button"
                              onClick={() => handleProcessPayment(pay, 'confirm')}
                              className="min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Confirm &amp; Activate
                            </button>
                            <button
                              type="button"
                              onClick={() => handleProcessPayment(pay, 'reject')}
                              className="min-h-[36px] px-3 rounded-lg border border-red-200 hover:bg-red-50 text-red-700 text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {sponsorshipData.activeListings.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200">
                    <h2 className="text-sm font-bold text-slate-900">Currently Active Sponsored Listings</h2>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {sponsorshipData.activeListings.map((s) => (
                      <div key={`${s.type}:${s.id}`} className="px-4 py-3 flex items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-bold uppercase text-slate-500 mr-2">{s.type}</span>
                          <span className="font-semibold text-slate-900">{s.title}</span>
                          <span className="text-slate-500"> · {s.authorName} ({s.approvalStatus})</span>
                        </div>
                        <span className="text-slate-600 tabular-nums">
                          Expires {formatShortDate(s.sponsoredUntil)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* REPORTS */}
          {section === 'reports' && (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {reports.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500">No suspicious listing reports submitted.</p>
              ) : (
                reports.map((rep) => (
                  <div key={rep.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-semibold uppercase ${
                            rep.status === 'open'
                              ? 'text-red-600'
                              : rep.status === 'resolved'
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {rep.status}
                        </span>
                        <span>·</span>
                        <span className="uppercase text-slate-500">{rep.listingType}</span>
                        <span>·</span>
                        <span className="text-slate-400">{formatDateTime(rep.createdAt)}</span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{rep.listingTitle}</h3>
                      <p className="text-xs text-slate-600">
                        <strong>Reason:</strong> {rep.reason}
                        {rep.details ? ` — "${rep.details}"` : ''} (by {rep.reporterName})
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {rep.status === 'open' && (
                        <>
                          {hasPerm('moderate_ads') && (
                            <button
                              type="button"
                              onClick={() => handleDeleteListing(rep.listingType, rep.listingId)}
                              className="min-h-[36px] px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                            >
                              Delete Ad
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleReportStatus(rep.id, 'resolved')}
                            className="min-h-[36px] px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold"
                          >
                            Resolve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReportStatus(rep.id, 'dismissed')}
                            className="min-h-[36px] px-3 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* CATEGORIES */}
          {section === 'categories' && (
            <div className="space-y-4">
              <form
                onSubmit={handleAddCategory}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-2.5"
              >
                <select
                  value={newCatSection}
                  onChange={(e) => setNewCatSection(e.target.value as 'job' | 'market' | 'house')}
                  className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="job">Jobs Category</option>
                  <option value="market">Market Category</option>
                  <option value="house">House Type</option>
                </select>
                <input
                  type="text"
                  required
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="Category name..."
                  className="flex-1 min-w-[200px] min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                />
                <button
                  type="submit"
                  className="min-h-[40px] px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Category
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(['job', 'market', 'house'] as const).map((sec) => (
                  <div key={sec} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      {sec === 'job' ? 'Job Categories' : sec === 'market' ? 'Market Categories' : 'House Types'}
                    </h3>
                    <div className="divide-y divide-slate-100">
                      {categories
                        .filter((c) => c.section === sec)
                        .map((c) => (
                          <div key={c.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                            <span className="text-slate-800">{c.name}</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(c.id)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ADMINISTRATORS & PERMISSIONS (SUPER ADMIN) */}
          {section === 'admins' && (
            <div className="space-y-5">
              {currentAdmin.role === 'super_admin' && (
                <form
                  onSubmit={handleCreateAdmin}
                  className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
                >
                  <h2 className="text-sm font-bold text-slate-900">Create Administrator Account</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <input
                      type="text"
                      required
                      value={newAdminUsername}
                      onChange={(e) => setNewAdminUsername(e.target.value)}
                      placeholder="Username"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <input
                      type="text"
                      required
                      value={newAdminFullName}
                      onChange={(e) => setNewAdminFullName(e.target.value)}
                      placeholder="Full Name"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      placeholder="Password (8+ chars)"
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm"
                    />
                    <select
                      value={newAdminRole}
                      onChange={(e) => {
                        const r = e.target.value as typeof newAdminRole;
                        setNewAdminRole(r);
                        setNewAdminPerms(ROLE_DEFAULTS[r] ?? []);
                      }}
                      className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
                    >
                      <option value="moderator">Moderator</option>
                      <option value="user_manager">User Manager</option>
                      <option value="sponsorship_manager">Sponsorship Manager</option>
                      <option value="super_admin">Super Admin</option>
                    </select>
                  </div>

                  {newAdminRole !== 'super_admin' && (
                    <div className="flex flex-wrap gap-2">
                      {(allPermissions.length ? allPermissions : ROLE_DEFAULTS.super_admin).map((perm) => {
                        const checked = newAdminPerms.includes(perm);
                        return (
                          <label
                            key={perm}
                            className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                              checked
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-700 border-slate-200'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setNewAdminPerms((prev) =>
                                  prev.includes(perm)
                                    ? prev.filter((p) => p !== perm)
                                    : [...prev, perm]
                                )
                              }
                              className="sr-only"
                            />
                            {perm}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="min-h-[42px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                  >
                    Create Admin Account
                  </button>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {adminAccounts.map((acc) => (
                  <div key={acc.id} className="p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {acc.fullName}{' '}
                          <span className="text-xs font-normal text-slate-500">(@{acc.username})</span>
                        </p>
                        <p className="text-xs font-semibold uppercase text-emerald-700">
                          {acc.role.replace('_', ' ')} · {acc.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                      {currentAdmin.role === 'super_admin' && acc.id !== currentAdmin.id && (
                        <button
                          type="button"
                          onClick={() => handleToggleAdminActive(acc)}
                          className="min-h-[34px] px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          {acc.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(allPermissions.length ? allPermissions : ROLE_DEFAULTS.super_admin).map((perm) => {
                        const enabled = acc.role === 'super_admin' || acc.permissions.includes(perm);
                        return (
                          <button
                            key={perm}
                            type="button"
                            disabled={currentAdmin.role !== 'super_admin' || acc.role === 'super_admin'}
                            onClick={() => handleToggleAdminPermission(acc, perm)}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium border ${
                              enabled
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-slate-50 text-slate-400 border-slate-200'
                            }`}
                          >
                            {perm}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AUDIT LOGS, SETTINGS & BACKUP */}
          {section === 'logs' && (
            <div className="space-y-5">
              {hasPerm('manage_settings') && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">Platform Settings &amp; Backup</h2>
                      <p className="text-xs text-slate-500">
                        Configure sponsorship payment instructions, default listing expiry, or export a JSON snapshot.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadBackup}
                      className="min-h-[40px] px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      Export JSON Backup
                    </button>
                  </div>

                  <form onSubmit={handleSaveSettings} className="space-y-3 pt-2 border-t border-slate-100">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Sponsorship Payment Instructions
                      </label>
                      <textarea
                        rows={2}
                        value={paymentInstructions}
                        onChange={(e) => setPaymentInstructions(e.target.value)}
                        className="w-full p-3 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Default Listing Expiry (Days)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={listingExpiryDays}
                          onChange={(e) => setListingExpiryDays(e.target.value)}
                          className="min-h-[40px] px-3 rounded-lg border border-slate-300 text-xs w-32"
                        />
                      </div>
                      <button
                        type="submit"
                        className="min-h-[40px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                      >
                        Save Settings
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {hasPerm('view_logs') && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-slate-500" />
                    <h2 className="text-sm font-bold text-slate-900">Security &amp; Audit Log</h2>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
                    {logs.map((log) => (
                      <div key={log.id} className="px-4 py-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-800">{log.summary}</p>
                          <p className="text-xs text-slate-400">
                            {log.actorType.toUpperCase()} · {log.actorName} · {log.action}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {formatDateTime(log.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Inspect User Modal */}
      {inspectedUser && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setInspectedUser(null)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">User Inspection</h3>
              <button
                type="button"
                onClick={() => setInspectedUser(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-sm">
              <div>
                <p className="font-bold text-slate-900 text-base">{inspectedUser.user.fullName}</p>
                <p className="text-xs text-slate-500">
                  {inspectedUser.user.email} · {formatZimbabwePhoneDisplay(inspectedUser.user.whatsapp || inspectedUser.user.phone)} · {inspectedUser.user.city}
                </p>
                <p className="text-xs font-semibold mt-1">
                  Verification: {inspectedUser.user.verificationStatus} · Account: {inspectedUser.user.accountStatus}
                </p>
              </div>
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="text-xs font-bold uppercase text-slate-500">
                  Listings ({inspectedUser.jobs.length + inspectedUser.market.length + inspectedUser.houses.length})
                </p>
                {inspectedUser.jobs.map((j) => (
                  <div key={`j-${j.id}`} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <strong>Job:</strong> {j.title} ({j.approvalStatus})
                  </div>
                ))}
                {inspectedUser.market.map((m) => (
                  <div key={`m-${m.id}`} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <strong>Market:</strong> {m.title} ({m.approvalStatus})
                  </div>
                ))}
                {inspectedUser.houses.map((h) => (
                  <div key={`h-${h.id}`} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                    <strong>House:</strong> {h.title} ({h.approvalStatus})
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setEditingUser(null)}
        >
          <form
            onSubmit={handleSaveEditedUser}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Edit User Profile</h3>
              <button type="button" onClick={() => setEditingUser(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <input
              type="text"
              required
              value={editUserName}
              onChange={(e) => setEditUserName(e.target.value)}
              placeholder="Full Name"
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm"
            />
            <input
              type="tel"
              required
              value={editUserPhone}
              onChange={(e) => setEditUserPhone(e.target.value)}
              placeholder="Phone"
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm"
            />
            <input
              type="tel"
              required
              value={editUserWhatsapp}
              onChange={(e) => setEditUserWhatsapp(e.target.value)}
              placeholder="WhatsApp"
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm"
            />
            <select
              value={editUserCity}
              onChange={(e) => setEditUserCity(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
            >
              {ZIMBABWE_LOCATIONS.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-lg bg-slate-900 text-white text-sm font-semibold"
            >
              Save User Changes
            </button>
          </form>
        </div>
      )}

      {/* Preview Listing Modal */}
      {previewListing && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setPreviewListing(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 max-h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Advertisement Preview</h3>
              <button type="button" onClick={() => setPreviewListing(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 text-sm">
              <p className="text-xs font-bold uppercase text-slate-500">
                {previewListing.type} · {previewListing.approvalStatus}
              </p>
              <h4 className="text-lg font-bold text-slate-900">{previewListing.title}</h4>
              <p className="text-xs text-slate-500">
                {previewListing.subtitle} · {previewListing.location} · {previewListing.priceLabel}
              </p>
              <p className="text-slate-700 whitespace-pre-line">
                {String(previewListing.raw.description ?? '')}
              </p>
              {typeof previewListing.raw.requirements === 'string' && (
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500 mt-2">Requirements</p>
                  <p className="text-slate-700 whitespace-pre-line">
                    {previewListing.raw.requirements}
                  </p>
                </div>
              )}
              {Array.isArray(previewListing.raw.photos) && previewListing.raw.photos.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {(previewListing.raw.photos as string[]).map((src, i) => (
                    <img
                      key={i}
                      src={src}
                      alt=""
                      className="w-24 h-20 object-cover rounded-lg border border-slate-200"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  handleModerateListing(previewListing, 'approve');
                  setPreviewListing(null);
                }}
                className="min-h-[38px] px-3.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold"
              >
                Approve Listing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject / Request Corrections Modal */}
      {moderationDialog && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setModerationDialog(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleModerateListing(
                moderationDialog.item,
                moderationDialog.decision,
                moderationReason
              );
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {moderationDialog.decision === 'reject'
                  ? 'Reject Advertisement'
                  : 'Request Corrections'}
              </h3>
              <button type="button" onClick={() => setModerationDialog(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <p className="text-xs text-slate-600">
              Provide a clear reason for <strong>{moderationDialog.item.title}</strong>. This will be sent to the author as a notification.
            </p>
            <textarea
              required
              rows={3}
              value={moderationReason}
              onChange={(e) => setModerationReason(e.target.value)}
              placeholder="Explain what needs to be fixed or why this ad cannot be approved..."
              className="w-full p-3 rounded-lg border border-slate-300 text-sm"
            />
            <button
              type="submit"
              className="w-full min-h-[42px] rounded-lg bg-slate-900 text-white text-sm font-semibold"
            >
              Send Decision &amp; Notify User
            </button>
          </form>
        </div>
      )}

      {/* Edit Listing Modal */}
      {editingListing && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setEditingListing(null)}
        >
          <form
            onSubmit={handleSaveEditedListing}
            onClick={(e) => e.stopPropagation()}
            className="bg-white w-full max-w-md rounded-2xl border border-slate-200 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Edit Advertisement</h3>
              <button type="button" onClick={() => setEditingListing(null)}>
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm"
            />
            <textarea
              required
              rows={3}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="w-full p-3 rounded-lg border border-slate-300 text-sm"
            />
            <select
              value={editLifecycle}
              onChange={(e) => setEditLifecycle(e.target.value)}
              className="w-full min-h-[42px] px-3 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="active">Active</option>
              <option value="filled">Filled (Jobs)</option>
              <option value="sold">Sold (Market)</option>
              <option value="rented">Rented (Houses)</option>
              <option value="expired">Expired</option>
            </select>
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-lg bg-slate-900 text-white text-sm font-semibold"
            >
              Save Changes
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
