/**
 * Input validation and sanitization utility for preventing empty/blank space inputs,
 * unworkable names, keyboard mash, and made-up/gibberish words across CPICRS.
 */

// Common English and Tagalog vowels
const VOWEL_REGEX = /[aeiouyáéíóúàèìòùâêîôûäëïöü]/i;

// Keyboard mash patterns (repeating characters or home-row mash)
const REPEATING_CHAR_REGEX = /(.)\1{3,}/i; // 4 or more identical consecutive characters, e.g. "aaaa", "xxxx"
const REPEATING_SUBSTRING_REGEX = /(.{2,4})\1{3,}/i; // e.g. "asdasdasdasd", "abababab"

/**
 * Normalizes string: collapses multiple whitespace/tabs/newlines into a single space and trims.
 */
export function normalizeWhitespace(str: unknown): string {
  if (typeof str !== 'string') return '';
  return str.replace(/[\s\u00A0\u2000-\u200B\uFEFF]+/g, ' ').trim();
}

/**
 * Checks if a string has meaningful non-blank content.
 * Rejects pure spaces, tabs, zero-width characters, or empty strings.
 */
export function isMeaningfulContent(str: unknown, minLength = 1): boolean {
  const normalized = normalizeWhitespace(str);
  return normalized.length >= minLength;
}

/**
 * Determines whether a word or string appears to be meaningless gibberish,
 * unworkable mash, or made-up keyboard mashing.
 *
 * Rules:
 * 1. Must contain at least one vowel (or legitimate romanized abbreviation like "PLT", "PMAJ", "MPS", "PNP", "PO1", "PSI", "Brgy")
 * 2. Cannot exceed 5 consecutive consonants without a vowel.
 * 3. Cannot contain 4+ identical consecutive characters (e.g. "aaaaa", "zzzzz").
 * 4. Cannot consist purely of repetitive keyboard mash like "asdasdasd", "qwertyqwerty", "zxcvzxcv".
 */
export function isWorkableWord(word: string): boolean {
  const clean = word.trim();
  if (clean.length === 0) return false;

  // Single or double letter tokens (e.g. "I", "II", "IV", "de", "la", "St", "Jr", "Sr")
  if (clean.length <= 2) {
    return /^[a-zA-Z0-9\.\-ñÑ]+$/.test(clean);
  }

  // Purely numeric tokens, years, RA/statute numbers, Roman numerals (e.g. "2002", "7610", "9165", "10591", "RA9165", "III")
  if (/^[\d\.\-\/]+$/.test(clean) || /\d/.test(clean) || /^[ivxlcdm]+$/i.test(clean)) {
    return true;
  }

  // Accepted police / military / legal acronyms and abbreviations
  const recognizedAcronyms = new Set([
    'PNP', 'MPS', 'PMAJ', 'PLT', 'PCOL', 'PLTCOL', 'PCMS', 'PSMS', 'PMSg', 'PSSg', 'PCpl', 'Pat',
    'PO1', 'PO2', 'PO3', 'SPO1', 'SPO2', 'SPO3', 'SPO4', 'RIR', 'PSI', 'RA', 'PD', 'BP', 'RPC',
    'VAWC', 'WCPD', 'BFP', 'BJMP', 'AFP', 'LGU', 'MDRRMO', 'RHU', 'DILG', 'NBI', 'CIDG', 'SWAT',
    'EOD', 'K9', 'TOC', 'PCR', 'CPICRS', 'BRGY', 'ST.', 'STA.', 'STO.', 'SAN'
  ]);
  const upper = clean.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (recognizedAcronyms.has(upper)) {
    return true;
  }

  // Check for repeated identical characters (e.g. "aaaa", "zzzz")
  if (REPEATING_CHAR_REGEX.test(clean)) {
    return false;
  }

  // Check for repeated substrings (e.g. "asdasd", "asdasdadsads", "qweqwe")
  if (/(.{2,4})\1{1,}/i.test(clean)) {
    return false;
  }

  // Pure alphabetical words with 4 or more letters must have at least one vowel
  const lettersOnly = clean.replace(/[^a-zA-ZñÑ]/g, '').toLowerCase();
  if (lettersOnly.length >= 4 && !VOWEL_REGEX.test(lettersOnly)) {
    return false;
  }

  // Low character diversity (e.g. "asdasdadsads" has only 3 unique letters across 12 characters)
  if (lettersOnly.length >= 5) {
    const uniqueChars = new Set(lettersOnly.split(''));
    if (uniqueChars.size <= 2 || (lettersOnly.length >= 7 && uniqueChars.size <= 3)) {
      return false;
    }
  }

  // Common keyboard sequence mash
  const mashSeqs = ['qwerty', 'qwert', 'asdfg', 'asdf', 'zxcvb', 'zxcv', 'poiuy', 'lkjhg', 'mnbvc'];
  if (mashSeqs.some(seq => lettersOnly.includes(seq))) {
    return false;
  }

  // Check for excessive consecutive consonants (5 or more consecutive consonants is almost always mash)
  const CONSONANT_CLUSTER_REGEX = /[bcdfghjklmnpqrstvwxz]{5,}/i;
  if (CONSONANT_CLUSTER_REGEX.test(clean)) {
    return false;
  }

  return true;
}

/**
 * Validates a person's name (e.g. Personnel, Police Officer, Wanted/Missing Person, Admin).
 * - Must have meaningful content
 * - Cannot be pure whitespace or blank
 * - Must consist of valid letters, spaces, hyphens, periods, or apostrophes (supports Filipino characters like ñ/Ñ)
 * - Must have at least 2 characters and at most 60 characters
 * - Every word in the name must pass the workable word test (rejects "asdfghjk", "zzzzz", "xxxxxx")
 */
export function isValidPersonName(name: unknown, minLength = 2, maxLength = 60): { valid: boolean; error?: string } {
  const normalized = normalizeWhitespace(name);
  if (!normalized || normalized.length < minLength) {
    return { valid: false, error: `Name cannot be empty or blank spaces (minimum ${minLength} characters).` };
  }
  if (normalized.length > maxLength) {
    return { valid: false, error: `Name cannot exceed ${maxLength} characters.` };
  }

  // Allows letters (including ñ/Ñ and accented vowels), spaces, dots, hyphens, single quotes, parentheses (for ranks/nicknames)
  const nameRegex = /^[a-zA-ZñÑáéíóúÁÉÍÓÚ\s\.\-'\(\)]+$/;
  if (!nameRegex.test(normalized)) {
    return { valid: false, error: 'Name contains invalid characters. Use letters, spaces, hyphens, and periods only.' };
  }

  // Check each word individually
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0) {
    return { valid: false, error: 'Name cannot be blank spaces.' };
  }

  for (const word of words) {
    // Strip punctuation for workable test
    const cleanWord = word.replace(/[\.\-'\(\)]/g, '');
    if (cleanWord.length > 0 && !isWorkableWord(cleanWord)) {
      return { valid: false, error: `"${word}" does not appear to be a valid name or recognizable word.` };
    }
  }

  return { valid: true };
}

/**
 * Validates headline, title, or agency name.
 * Rejects pure spacing, unworkable characters, and keyboard mash.
 */
export function isValidTitleOrHeadline(text: unknown, minWords = 2, maxWords = 30, maxChars = 200): { valid: boolean; error?: string } {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return { valid: false, error: 'Title / Headline cannot be blank spaces or empty.' };
  }
  if (normalized.length > maxChars) {
    return { valid: false, error: `Title / Headline exceeds maximum limit of ${maxChars} characters.` };
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length < minWords) {
    return { valid: false, error: `Title must contain at least ${minWords} meaningful words.` };
  }
  if (words.length > maxWords) {
    return { valid: false, error: `Title cannot exceed ${maxWords} words.` };
  }

  let unworkableCount = 0;
  for (const word of words) {
    const cleanWord = word.replace(/[^a-zA-Z0-9ñÑ]/g, '');
    if (cleanWord.length >= 4 && !isWorkableWord(cleanWord)) {
      unworkableCount++;
    }
  }

  if (unworkableCount > 0 && unworkableCount >= Math.ceil(words.length / 2)) {
    return { valid: false, error: 'The entered title contains unworkable or unrecognized words.' };
  }

  return { valid: true };
}

/**
 * Validates text narratives, descriptions, and remarks.
 */
export function isValidNarrative(text: unknown, minChars = 5, maxChars = 5000): { valid: boolean; error?: string } {
  const normalized = normalizeWhitespace(text);
  if (!normalized || normalized.length < minChars) {
    return { valid: false, error: `Text cannot be blank spaces (minimum ${minChars} characters required).` };
  }
  if (normalized.length > maxChars) {
    return { valid: false, error: `Text exceeds maximum allowed length of ${maxChars} characters.` };
  }

  // Check that content is not purely repeating symbols or characters
  const words = normalized.split(' ').filter(Boolean);
  let unworkableCount = 0;
  for (const word of words) {
    const cleanWord = word.replace(/[^a-zA-Z0-9ñÑ]/g, '');
    if (cleanWord.length >= 5 && !isWorkableWord(cleanWord)) {
      unworkableCount++;
    }
  }

  if (words.length > 2 && unworkableCount > words.length * 0.6) {
    return { valid: false, error: 'Content contains gibberish or unworkable characters.' };
  }

  return { valid: true };
}

