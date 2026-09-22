/**
 * Unicode sanitization helper to prevent PostgreSQL / Supabase JSON syntax errors
 * (e.g. "Unicode low surrogate must follow a high surrogate" / "invalid input syntax for type json").
 */

/**
 * Safely truncates and cleans a string without slicing through UTF-16 surrogate pairs
 * (such as emojis or bold mathematical unicode fonts frequently used on Facebook).
 */
export function sanitizeUnicode(str: string | null | undefined, maxLength?: number): string {
  if (!str) return '';

  // Convert string to array of code points so surrogate pairs are never sliced in half
  let chars = Array.from(String(str));
  if (maxLength && chars.length > maxLength) {
    chars = chars.slice(0, maxLength);
  }
  let result = chars.join('');

  // Use toWellFormed() if available in runtime
  if (typeof (result as any).toWellFormed === 'function') {
    result = (result as any).toWellFormed();
  }

  // Regex fallback: remove any orphan high surrogate or orphan low surrogate
  result = result.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

  // Strip null bytes which PostgreSQL text fields reject
  result = result.replace(/\0/g, '');

  return result;
}

/**
 * Recursively sanitizes all string values in an object or array to ensure well-formed UTF-16
 * before sending to PostgreSQL / Supabase via JSON.
 */
export function deepSanitizeUnicode<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return sanitizeUnicode(val) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map(item => deepSanitizeUnicode(item)) as unknown as T;
  }
  if (typeof val === 'object' && !(val instanceof Date) && !(val instanceof RegExp)) {
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      cleaned[k] = deepSanitizeUnicode(v);
    }
    return cleaned as T;
  }
  return val;
}
