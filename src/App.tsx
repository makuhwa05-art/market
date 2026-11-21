import { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  Home,
  MapPin,
  Plus,
  Search,
  ShoppingBag,
  User as UserIcon,
  X,
} from 'lucide-react';
import { AuthProfileModal } from './components/AuthProfileModal';
import { DetailModal, type DetailSelection } from './components/DetailModal';
import { HouseCard, JobCard, MarketCard } from './components/ListingCards';
import { PostModal, type EditTarget } from './components/PostModal';
import { AuthProvider, useAuth } from './context/AuthContext';
import {
  HOUSE_TYPES,
  JOB_CATEGORIES,
  MARKET_CATEGORIES,
  ZIMBABWE_LOCATIONS,
} from './types';
import type { HouseListing, JobListing, MarketListing, TabType } from './types';

function MainApp() {
  const { user, authHeaders } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('jobs');

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [onlyMine, setOnlyMine] = useState(false);

  // Feed data state
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [marketItems, setMarketItems] = useState<MarketListing[]>([]);
  const [houses, setHouses] = useState<HouseListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authPrompt, setAuthPrompt] = useState<string | undefined>(undefined);
  const [postModalOpen, setPostModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);
  const [resumePostAfterAuth, setResumePostAfterAuth] = useState(false);

  // Reset category filter when switching tabs
  const handleSelectTab = (tab: TabType) => {
    setActiveTab(tab);
    setCategoryFilter('All');
  };

  useEffect(() => {
    if (!user && onlyMine) {
      setOnlyMine(false);
    }
  }, [user, onlyMine]);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (locationFilter !== 'All') params.set('location', locationFilter);
      if (categoryFilter !== 'All') {
        params.set(activeTab === 'houses' ? 'propertyType' : 'category', categoryFilter);
      }
      if (onlyMine && user) params.set('mine', 'true');

      const endpoint =
        activeTab === 'jobs'
          ? '/api/jobs'
          : activeTab === 'market'
            ? '/api/market'
            : '/api/houses';

      const res = await fetch(`${endpoint}?${params.toString()}`, {
        headers: onlyMine && user ? authHeaders() : {},
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not load listings.');
        return;
      }

      if (activeTab === 'jobs') {
        setJobs(data.items ?? []);
      } else if (activeTab === 'market') {
        setMarketItems(data.items ?? []);
      } else {
        setHouses(data.items ?? []);
      }
    } catch {
      setError('Unable to reach server. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, searchQuery, locationFilter, categoryFilter, onlyMine, user, authHeaders]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchFeed();
    }, 150);
    return () => clearTimeout(timer);
  }, [fetchFeed]);

  const handleDeleteListing = async (type: TabType, id: string) => {
    const endpoint =
      type === 'jobs'
        ? `/api/jobs/${id}`
        : type === 'market'
          ? `/api/market/${id}`
          : `/api/houses/${id}`;
    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Failed to delete listing.');
      return;
    }
    fetchFeed();
  };

  const openNewPostModal = () => {
    setEditTarget(null);
    setPostModalOpen(true);
  };

  const openEditModal = (target: EditTarget) => {
    setDetailSelection(null);
    setEditTarget(target);
    setPostModalOpen(true);
  };

  const categoryOptions =
    activeTab === 'jobs'
      ? JOB_CATEGORIES
      : activeTab === 'market'
        ? MARKET_CATEGORIES
        : HOUSE_TYPES;

  const activeItemsCount =
    activeTab === 'jobs'
      ? jobs.length
      : activeTab === 'market'
        ? marketItems.length
        : houses.length;

  const sectionHeading =
    activeTab === 'jobs'
      ? 'Jobs in Zimbabwe'
      : activeTab === 'market'
        ? 'Market & Services'
        : 'Houses & Rooms for Rent';

  const searchPlaceholder =
    activeTab === 'jobs'
      ? 'Search job title, company, or skill...'
      : activeTab === 'market'
        ? 'Search products, services, solar, phones...'
        : 'Search suburb, cottage, room, flat...';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Sticky Compact Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-13 sm:h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand Title */}
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setLocationFilter('All');
              setCategoryFilter('All');
              setOnlyMine(false);
            }}
            className="font-display text-base sm:text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded"
          >
            MARKET &amp; JOBS
          </button>

          {/* Zone 2: Desktop Primary Tabs (ONLY 3: Jobs, Market, Houses) */}
          <nav className="hidden md:flex items-center gap-7 h-full" aria-label="Main navigation">
            <button
              type="button"
              onClick={() => handleSelectTab('jobs')}
              className={`h-full inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'jobs'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Briefcase className="w-4 h-4" aria-hidden="true" />
              Jobs
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('market')}
              className={`h-full inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'market'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShoppingBag className="w-4 h-4" aria-hidden="true" />
              Market
            </button>
            <button
              type="button"
              onClick={() => handleSelectTab('houses')}
              className={`h-full inline-flex items-center gap-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'houses'
                  ? 'border-emerald-700 text-emerald-800'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              Houses
            </button>
          </nav>

          {/* Zone 3: Account & + POST */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setAuthPrompt(undefined);
                setAuthModalOpen(true);
              }}
              aria-label={user ? 'Open profile' : 'Sign in or register'}
              className="min-h-[40px] px-2.5 sm:px-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs sm:text-sm font-medium text-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.fullName}
                  className="w-6 h-6 rounded-full object-cover shrink-0"
                />
              ) : (
                <UserIcon className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
              )}
              <span className="max-w-[96px] truncate">
                {user ? user.fullName.split(' ')[0] : 'Sign In'}
              </span>
            </button>

            <button
              type="button"
              onClick={openNewPostModal}
              className="min-h-[40px] px-3.5 sm:px-4 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs sm:text-sm font-bold tracking-wide transition-all whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              POST
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-24 md:pb-12 space-y-5">
        {/* Heading + Result Summary */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {sectionHeading}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Connect directly via WhatsApp across Zimbabwe · Newest posts first
            </p>
          </div>
          {!loading && (
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              {activeItemsCount} {activeItemsCount === 1 ? 'listing' : 'listings'}
            </span>
          )}
        </div>

        {/* Search & Location Filter Bar */}
        <section aria-label="Search and filters" className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-7 relative">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label="Search listings"
                className="w-full min-h-[44px] pl-10 pr-9 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="sm:col-span-3 relative">
              <MapPin
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                aria-label="Filter by Zimbabwe location"
                className="w-full min-h-[44px] pl-10 pr-3 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700"
              >
                <option value="All">All Zimbabwe</option>
                {ZIMBABWE_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    setAuthPrompt('Sign in to view and manage your own posts.');
                    setAuthModalOpen(true);
                    return;
                  }
                  setOnlyMine((prev) => !prev);
                }}
                className={`w-full min-h-[44px] px-3 rounded-lg border text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                  onlyMine
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                My Posts
              </button>
            </div>
          </div>

          {/* Interactive Category Filter Row */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {categoryOptions.map((cat) => {
              const active = categoryFilter === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </section>

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-red-700">{error}</p>
            <button
              type="button"
              onClick={fetchFeed}
              className="min-h-[38px] px-3 rounded-lg bg-white border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeleton */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {[1, 2, 3].map((idx) => (
              <div
                key={idx}
                className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 animate-pulse"
              >
                {activeTab !== 'jobs' && <div className="aspect-[4/3] bg-slate-100 rounded-lg" />}
                <div className="h-5 bg-slate-100 rounded w-3/4" />
                <div className="h-4 bg-slate-100 rounded w-1/2" />
                <div className="h-10 bg-slate-100 rounded w-full" />
              </div>
            ))}
          </div>
        ) : activeItemsCount === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-3">
            <p className="text-base font-semibold text-slate-900">No matching listings found</p>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              Try clearing your search or location filter, or be the first to post in this section.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
              {(searchQuery || locationFilter !== 'All' || categoryFilter !== 'All' || onlyMine) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setLocationFilter('All');
                    setCategoryFilter('All');
                    setOnlyMine(false);
                  }}
                  className="min-h-[44px] px-4 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"
                >
                  Clear Filters
                </button>
              )}
              <button
                type="button"
                onClick={openNewPostModal}
                className="min-h-[44px] px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                POST NOW
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {activeTab === 'jobs' &&
              jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  isOwner={Boolean(user && job.userId === user.id)}
                  onSelect={() => setDetailSelection({ type: 'job', item: job })}
                  onEdit={() => openEditModal({ type: 'job', item: job })}
                  onDelete={() => handleDeleteListing('jobs', job.id)}
                />
              ))}

            {activeTab === 'market' &&
              marketItems.map((item) => (
                <MarketCard
                  key={item.id}
                  item={item}
                  isOwner={Boolean(user && item.userId === user.id)}
                  onSelect={() => setDetailSelection({ type: 'market', item })}
                  onEdit={() => openEditModal({ type: 'market', item })}
                  onDelete={() => handleDeleteListing('market', item.id)}
                />
              ))}

            {activeTab === 'houses' &&
              houses.map((house) => (
                <HouseCard
                  key={house.id}
                  house={house}
                  isOwner={Boolean(user && house.userId === user.id)}
                  onSelect={() => setDetailSelection({ type: 'house', item: house })}
                  onEdit={() => openEditModal({ type: 'house', item: house })}
                  onDelete={() => handleDeleteListing('houses', house.id)}
                />
              ))}
          </div>
        )}
      </main>

      {/* Mobile Fixed Bottom Navigation (ONLY 3 TABS: Jobs, Market, Houses) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-3 h-full">
          <button
            type="button"
            onClick={() => handleSelectTab('jobs')}
            className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'jobs' ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Briefcase className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-semibold leading-none">Jobs</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('market')}
            className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'market' ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <ShoppingBag className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-semibold leading-none">Market</span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('houses')}
            className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${
              activeTab === 'houses' ? 'text-emerald-800' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Home className="w-5 h-5" aria-hidden="true" />
            <span className="text-[11px] font-semibold leading-none">Houses</span>
          </button>
        </div>
      </nav>

      {/* Modals */}
      <DetailModal
        selection={detailSelection}
        currentUserId={user?.id ?? null}
        onClose={() => setDetailSelection(null)}
        onEdit={(sel) => openEditModal(sel)}
      />

      <PostModal
        isOpen={postModalOpen}
        editTarget={editTarget}
        defaultTab={activeTab}
        onClose={() => {
          setPostModalOpen(false);
          setEditTarget(null);
        }}
        onRequireAuth={() => {
          setResumePostAfterAuth(true);
          setPostModalOpen(false);
          setAuthPrompt('Sign in or register to publish your listing.');
          setAuthModalOpen(true);
        }}
        onSaved={(tab) => {
          setActiveTab(tab);
          setCategoryFilter('All');
          setOnlyMine(false);
          fetchFeed();
        }}
      />

      <AuthProfileModal
        isOpen={authModalOpen}
        promptMessage={authPrompt}
        onClose={() => {
          setAuthModalOpen(false);
          setAuthPrompt(undefined);
          setResumePostAfterAuth(false);
        }}
        onAuthSuccess={() => {
          if (resumePostAfterAuth) {
            setResumePostAfterAuth(false);
            setPostModalOpen(true);
          }
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
