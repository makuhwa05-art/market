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

export const JOB_CATEGORIES = [
  'All',
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

export const MARKET_CATEGORIES = [
  'All',
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

export interface UserProfile {
  id: string;
  fullName: string;
  phone: string;
  city: string;
  avatar: string | null;
  createdAt: number;
}

export interface JobListing {
  id: string;
  userId: string;
  authorName: string;
  title: string;
  company: string;
  description: string;
  requirements: string;
  salary: string | null;
  category: string;
  location: string;
  whatsapp: string;
  createdAt: number;
}

export interface MarketListing {
  id: string;
  userId: string;
  authorName: string;
  title: string;
  price: number;
  currency: 'USD' | 'ZiG';
  description: string;
  category: string;
  location: string;
  photos: string[];
  whatsapp: string;
  createdAt: number;
}

export interface HouseListing {
  id: string;
  userId: string;
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
  createdAt: number;
}
