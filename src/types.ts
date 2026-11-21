export type TabType = 'jobs' | 'market' | 'houses';

export const ZIMBABWE_LOCATIONS = [
  'Harare',
  'Bulawayo',
  'Chitungwiza',
  'Mutare',
  'Gweru',
  'Kwekwe',
  'Kadoma',
  'Masvingo',
  'Chinhoyi',
  'Victoria Falls',
  'Marondera',
  'Norton',
  'Ruwa',
  'Zvishavane',
  'Bindura',
  'Beitbridge',
  'Hwange',
  'Kariba',
  'Other Zimbabwe',
] as const;

export const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Casual',
  'Internship',
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const DEFAULT_JOB_CATEGORIES = [
  'Sales & Retail',
  'Trades & Artisans',
  'Admin & Office',
  'Driving & Logistics',
  'Tech & IT',
  'Hospitality & Catering',
  'Construction & Engineering',
  'Agriculture',
  'Healthcare & Education',
  'Domestic & Care',
] as const;

export const DEFAULT_MARKET_CATEGORIES = [
  'Electronics & Solar',
  'Phones & Computers',
  'Vehicles & Spares',
  'Services & Repairs',
  'Home & Furniture',
  'Farm & Produce',
  'Fashion & Beauty',
  'Building Materials',
  'Other',
] as const;

export const HOUSE_TYPES = [
  'All',
  'House',
  'Room',
  'Flat',
  'Apartment',
  'Cottage',
  'Commercial',
] as const;

export const HOUSE_FACILITIES = [
  'Borehole Water',
  'Solar Backup',
  'ZESA Available',
  'Walled & Gated',
  'Parking Space',
  'Wi-Fi Ready',
  'Fitted Kitchen',
  'En-suite',
  'Prepaid ZESA',
  'Security Guard',
] as const;

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'correction_requested';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'suspended';
export type AccountStatus = 'active' | 'suspended';
export type LifecycleStatus = 'active' | 'filled' | 'sold' | 'rented' | 'expired';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  phone: string;
  whatsapp: string;
  city: string;
  avatar: string | null;
  verificationStatus: VerificationStatus;
  verificationNote: string | null;
  accountStatus: AccountStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  message: string;
  category: 'approval' | 'verification' | 'sponsorship' | 'account' | string;
  isRead: boolean;
  createdAt: string;
}

export interface JobListing {
  id: number;
  userId: number | null;
  authorUid: string;
  authorName: string;
  title: string;
  employer: string;
  description: string;
  requirements: string;
  salary: string | null;
  employmentType: string;
  category: string;
  location: string;
  whatsapp: string;
  approvalStatus: ApprovalStatus;
  moderationReason: string | null;
  lifecycleStatus: LifecycleStatus;
  isSponsored: boolean;
  sponsoredUntil: string | null;
  expiresAt: string | null;
  createdAt: string;
  isVerified?: boolean;
}

export interface MarketListing {
  id: number;
  userId: number | null;
  authorUid: string;
  authorName: string;
  title: string;
  price: number;
  currency: 'USD' | 'ZiG';
  description: string;
  category: string;
  location: string;
  photos: string[];
  whatsapp: string;
  approvalStatus: ApprovalStatus;
  moderationReason: string | null;
  lifecycleStatus: LifecycleStatus;
  isSponsored: boolean;
  sponsoredUntil: string | null;
  expiresAt: string | null;
  createdAt: string;
  isVerified?: boolean;
}

export interface HouseListing {
  id: number;
  userId: number | null;
  authorUid: string;
  authorName: string;
  propertyType: 'House' | 'Room' | 'Flat' | 'Apartment' | 'Cottage' | 'Commercial';
  title: string;
  suburb: string;
  city: string;
  price: number;
  bedrooms: number;
  description: string;
  facilities: string[];
  photos: string[];
  whatsapp: string;
  approvalStatus: ApprovalStatus;
  moderationReason: string | null;
  lifecycleStatus: LifecycleStatus;
  isSponsored: boolean;
  sponsoredUntil: string | null;
  expiresAt: string | null;
  createdAt: string;
  isVerified?: boolean;
}

export interface SponsorshipPlan {
  id: number;
  name: string;
  durationDays: number;
  priceUsd: number;
  isActive: boolean;
}

export interface SponsorshipPayment {
  id: number;
  userId: number;
  userName?: string;
  userPhone?: string;
  listingType: 'job' | 'market' | 'house';
  listingId: number;
  listingTitle: string;
  planId: number | null;
  durationDays: number;
  amountUsd: number;
  paymentMethod: string;
  paymentReference: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'expired';
  adminNote: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface PlatformMeta {
  categories: {
    job: string[];
    market: string[];
    house: string[];
  };
  sponsorshipPlans: SponsorshipPlan[];
  paymentInstructions: string;
}

export interface AdminAccount {
  id: number;
  username: string;
  fullName: string;
  role: 'super_admin' | 'moderator' | 'user_manager' | 'sponsorship_manager';
  permissions: string[];
  isActive?: boolean;
  createdAt?: string;
}
