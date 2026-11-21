export function normalizeZimbabwePhone(input: string): string {
  const cleaned = String(input || '').replace(/[^\d+]/g, '');
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

export function sanitizeImageValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Allow compressed JPEG/PNG/WebP data URLs up to ~750KB
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    if (trimmed.length > 900_000) return null;
    return trimmed;
  }

  // Allow bundled static local asset paths
  if (/^\/src\/assets\/images\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png|webp)$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function sanitizePhotosArray(input: unknown, maxCount = 4): string[] {
  if (!Array.isArray(input)) return [];
  const valid: string[] = [];
  for (const item of input) {
    const clean = sanitizeImageValue(item);
    if (clean) {
      valid.push(clean);
    }
    if (valid.length >= maxCount) break;
  }
  return valid;
}
