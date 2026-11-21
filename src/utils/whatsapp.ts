/**
 * Converts Zimbabwean phone numbers into standard international +263 format.
 * Examples:
 * - "0771234567" -> "+263771234567"
 * - "771234567" -> "+263771234567"
 * - "263771234567" -> "+263771234567"
 * - "+263 77 123 4567" -> "+263771234567"
 */
export function normalizeZimbabwePhone(input: string): string {
  const cleaned = input.replace(/[^\d+]/g, '');
  if (!cleaned) return '';

  let digits = cleaned.replace(/^\+/, '');

  if (digits.startsWith('00263')) {
    digits = digits.slice(2);
  }

  if (digits.startsWith('263')) {
    const rest = digits.slice(3);
    if (rest.startsWith('0')) {
      digits = '263' + rest.slice(1);
    }
  } else if (digits.startsWith('0') && digits.length >= 9) {
    digits = '263' + digits.slice(1);
  } else if (/^[78]\d{8}$/.test(digits)) {
    digits = '263' + digits;
  } else if (/^[1-9]\d{6,9}$/.test(digits) && !digits.startsWith('263')) {
    digits = '263' + digits;
  }

  return digits ? `+${digits}` : '';
}

export function isValidZimbabwePhone(input: string): boolean {
  const normalized = normalizeZimbabwePhone(input);
  return /^\+263\d{8,10}$/.test(normalized);
}

export function formatZimbabwePhoneDisplay(phone: string): string {
  const normalized = normalizeZimbabwePhone(phone);
  if (normalized.startsWith('+263') && normalized.length === 13) {
    return `+263 ${normalized.slice(4, 6)} ${normalized.slice(6, 9)} ${normalized.slice(9)}`;
  }
  return normalized || phone;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const normalized = normalizeZimbabwePhone(phone);
  const digitsOnly = normalized.replace(/^\+/, '');
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

export function buildJobWhatsAppMessage(title: string, company: string, location: string): string {
  return `Hello, I am applying for the ${title} position at ${company} (${location}) listed on MARKET & JOBS.`;
}

export function buildMarketWhatsAppMessage(
  title: string,
  price: number,
  currency: string,
  location: string
): string {
  return `Hello, I am interested in "${title}" (${currency} ${price}) in ${location} listed on MARKET & JOBS. Is it still available?`;
}

export function buildHouseWhatsAppMessage(
  title: string,
  suburb: string,
  city: string,
  price: number
): string {
  return `Hello, I am interested in renting "${title}" in ${suburb}, ${city} ($${price}/month) listed on MARKET & JOBS. Is it available for viewing?`;
}

export function formatTimeAgo(timestampMs: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(timestampMs).toLocaleDateString('en-ZW', {
    day: 'numeric',
    month: 'short',
  });
}
