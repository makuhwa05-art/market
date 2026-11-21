export type TabType = 'jobs' | 'market' | 'houses' | 'singles';

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

export const DATING_COUNTRIES = [
  'Zimbabwe',
  'South Africa',
  'Botswana',
  'United Kingdom',
  'United States',
  'Canada',
  'Australia',
  'Other',
] as const;

export const RELATIONSHIP_INTENTIONS = [
  { value: 'dating', label: 'Dating' },
  { value: 'serious_relationship', label: 'Serious Relationship' },
  { value: 'marriage', label: 'Marriage' },
] as const;

export const HIV_STATUS_OPTIONS = ['Prefer not to disclose', 'Negative', 'Positive'] as const;

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
  datingOptIn?: 'unset' | 'yes' | 'no';
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
  category: 'approval' | 'verification' | 'sponsorship' | 'account' | 'dating' | 'payment' | string;
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

export interface DatingPackage {
  id: number;
  slug: string;
  name: string;
  priceUsd: number;
  minSelections: number;
  maxSelections: number | null;
  durationDays: number | null;
  isUnlimited: boolean;
  description: string;
  isActive: boolean;
}

export interface DatingProfilePublic {
  id: number;
  displayName: string;
  age: number;
  gender: 'male' | 'female';
  country: string;
  city: string;
  suburb: string;
  photo: string;
  childrenCount: number | null;
  description: string;
  intention: 'dating' | 'serious_relationship' | 'marriage';
  isVerified: boolean;
  alreadyChosen: boolean;
  hivShared: boolean;
  hivStatus?: string;
  createdAt: string;
}

export interface DatingProfilePrivate {
  id: number;
  userId: number;
  displayName: string;
  age: number;
  gender: 'male' | 'female';
  country: string;
  city: string;
  suburb: string;
  whatsapp: string;
  photo: string;
  childrenCount: number | null;
  hivStatus: string;
  shareHivWithSubscribers: boolean;
  description: string;
  intention: 'dating' | 'serious_relationship' | 'marriage';
  termsAccepted: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  moderationReason: string | null;
  isVisible: boolean;
  isSuspended: boolean;
  createdAt: string;
  updatedAt: string;
  userEmail?: string;
  userFullName?: string;
  verificationStatus?: string;
  accountStatus?: string;
}

export interface DatingSubscription {
  id: number;
  userId: number;
  packageId: number;
  packageName: string;
  amountUsd: number;
  selectionLimit: number | null;
  selectionsUsed: number;
  remainingSelections: number | null;
  isUnlimited: boolean;
  status: 'active' | 'exhausted' | 'expired' | 'refunded';
  startsAt: string;
  expiresAt: string | null;
  createdAt: string;
  userName?: string;
  userEmail?: string;
}

export interface DatingSelectionItem {
  id: number;
  createdAt: string;
  profileId: number;
  displayName: string;
  age: number;
  gender: string;
  country: string;
  city: string;
  suburb: string;
  photo: string;
  intention: string;
  whatsapp: string;
  isVerified: boolean;
}

export interface PaymentCapabilities {
  paynowConfigured: boolean;
  paypalConfigured: boolean;
  paypalMode?: 'sandbox' | 'live';
  manualEnabled: boolean;
}

export interface PaymentTransaction {
  id: number;
  userId: number;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  featureType: 'dating_package' | 'sponsored_job' | 'sponsored_market' | 'sponsored_house';
  targetId: number;
  targetTitle: string;
  planOrPackageId: number | null;
  gateway: 'paynow' | 'paypal' | 'manual';
  amountUsd: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  merchantReference: string;
  gatewayReference: string | null;
  gatewayCaptureId: string | null;
  checkoutUrl: string | null;
  metadataJson: Record<string, unknown>;
  adminNote: string | null;
  refundedAmountUsd: number | null;
  refundReason: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

export interface PlatformMeta {
  categories: {
    job: string[];
    market: string[];
    house: string[];
  };
  sponsorshipPlans: SponsorshipPlan[];
  datingPackages?: DatingPackage[];
  datingEnabled?: boolean;
  datingAllowHivDisclosure?: boolean;
  paymentCapabilities?: PaymentCapabilities;
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
