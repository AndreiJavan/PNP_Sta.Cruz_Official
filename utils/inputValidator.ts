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

// Common keyboard cluster mash patterns
const KEYBOARD_CLUSTERS = [
  /^[asd]+$/i,
  /^[qwe]+$/i,
  /^[zxc]+$/i,
  /^[jkl]+$/i,
  /^[uiop]+$/i,
  /^[bnm]+$/i,
  /^[fgh]+$/i
];

const SHORT_MASH_SEQS = [
  'asd', 'dsa', 'sda', 'das', 'qwe', 'ewq', 'qwer', 'rewq',
  'zxc', 'cxz', 'zxcv', 'vcxz', 'jkl', 'lkj', 'iop', 'poi', 'poiuy',
  'dfg', 'gfd', 'fgh', 'hgf', 'ghj', 'hjk', 'xcv', 'cvb', 'vbn', 'bnm', 'mnb',
  'wer', 'ert', 'rty', 'tyu', 'yui', 'uio'
];

const LONG_MASH_SEQS = [
  'qwerty', 'qwert', 'asdfg', 'asdf', 'zxcvb', 'zxcv', 'poiuy', 'lkjhg', 'mnbvc'
];

/**
 * Determines whether a word or string appears to be meaningless gibberish,
 * unworkable mash, or made-up keyboard mashing.
 *
 * Rules:
 * 1. Must contain at least one vowel (or legitimate romanized abbreviation like "PLT", "PMAJ", "MPS", "PNP", "PO1", "PSI", "Brgy")
 * 2. Cannot exceed 4 consecutive consonants without a vowel.
 * 3. Cannot contain 3+ identical consecutive characters (e.g. "aaaa", "zzzz").
 * 4. Cannot consist purely of repetitive keyboard mash like "asdasdasd", "qwertyqwerty", "zxcvzxcv", "asda", "asd".
 */
export function isWorkableWord(word: string): boolean {
  const clean = word.trim();
  if (clean.length === 0) return false;

  // Accepted police / military / legal acronyms, titles, and abbreviations
  const recognizedAcronyms = new Set([
    'PNP', 'MPS', 'PMAJ', 'PLT', 'PCOL', 'PLTCOL', 'PCMS', 'PSMS', 'PMSg', 'PSSg', 'PCpl', 'Pat',
    'PO1', 'PO2', 'PO3', 'SPO1', 'SPO2', 'SPO3', 'SPO4', 'RIR', 'PSI', 'RA', 'PD', 'BP', 'RPC',
    'VAWC', 'WCPD', 'BFP', 'BJMP', 'AFP', 'LGU', 'MDRRMO', 'RHU', 'DILG', 'NBI', 'CIDG', 'SWAT',
    'EOD', 'K9', 'TOC', 'PCR', 'CPICRS', 'BRGY', 'ST', 'STA', 'STO', 'SAN', 'DR', 'ATTY', 'MR',
    'MS', 'MRS', 'JR', 'SR'
  ]);
  const upper = clean.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (recognizedAcronyms.has(upper)) {
    return true;
  }

  // Single letter cannot be a standalone workable word (initials in names are handled separately)
  if (clean.length === 1) {
    return /^[\dI]$/i.test(clean);
  }

  // Double letter words
  if (clean.length === 2) {
    if (/^[\d]+$/.test(clean) || /^[ivx]+$/i.test(clean)) return true;
    const cleanAlpha = clean.replace(/[^a-zA-ZñÑ]/g, '');
    if (cleanAlpha.length === 2) {
      return VOWEL_REGEX.test(cleanAlpha);
    }
    return false;
  }

  // Purely numeric tokens, years, RA/statute numbers, Roman numerals (e.g. "2002", "7610", "9165", "10591", "RA9165", "III")
  if (/^[\d\.\-\/]+$/.test(clean) || /^[ivxlcdm]+$/i.test(clean)) {
    return true;
  }

  // Check for repeated identical characters (e.g. "aaa", "zzzz")
  if (REPEATING_CHAR_REGEX.test(clean)) {
    return false;
  }

  // Check for repeated substrings (e.g. "asdasd", "ababab", "qweqwe")
  if (/(.{2,4})\1+/i.test(clean)) {
    return false;
  }

  const lettersOnly = clean.replace(/[^a-zA-ZñÑ]/g, '').toLowerCase();

  // Pure keyboard cluster mash (e.g. "asd", "asda", "qwe", "zxc", "jkl")
  if (lettersOnly.length >= 3 && KEYBOARD_CLUSTERS.some(r => r.test(lettersOnly))) {
    return false;
  }

  // Keyboard sequences
  if (lettersOnly.length <= 4 && SHORT_MASH_SEQS.some(seq => lettersOnly.includes(seq))) {
    return false;
  }
  if (LONG_MASH_SEQS.some(seq => lettersOnly.includes(seq))) {
    return false;
  }

  // Pure alphabetical words with 3 or more letters must have at least one vowel
  if (lettersOnly.length >= 3 && !VOWEL_REGEX.test(lettersOnly)) {
    return false;
  }

  // Low character diversity
  if (lettersOnly.length >= 5) {
    const uniqueChars = new Set(lettersOnly.split(''));
    if (uniqueChars.size <= 2 || (lettersOnly.length >= 7 && uniqueChars.size <= 3) || (lettersOnly.length >= 10 && uniqueChars.size <= 4)) {
      return false;
    }
  }

  // Check for excessive consecutive consonants (4 or more consecutive consonants is almost always mash)
  const CONSONANT_CLUSTER_REGEX = /[bcdfghjklmnpqrstvwxz]{4,}/i;
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
 * - Every word in the name must pass the workable word test (rejects "asdasdasd asda asd a", "asdfghjk", "zzzzz")
 */
export function isValidPersonName(name: unknown, minLength = 2, maxLength = 60): { valid: boolean; error?: string } {
  const normalized = normalizeWhitespace(name);
  if (!normalized || normalized.length < minLength) {
    return { valid: false, error: `Name cannot be empty or blank spaces (minimum ${minLength} characters).` };
  }
  if (normalized.length > maxLength) {
    return { valid: false, error: `Name cannot exceed ${maxLength} characters.` };
  }

  // Allows letters (including ñ/Ñ and accented vowels), spaces, dots, hyphens, single quotes, parentheses, slashes
  const nameRegex = /^[a-zA-ZñÑáéíóúÁÉÍÓÚ\s\.\-'\(\)\/]+$/;
  if (!nameRegex.test(normalized)) {
    return { valid: false, error: 'Name contains invalid characters. Use letters, spaces, hyphens, and periods only.' };
  }

  const lettersOnly = normalized.replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ]/g, '').toLowerCase();
  if (lettersOnly.length < 2) {
    return { valid: false, error: 'Name must contain at least 2 alphabet letters.' };
  }

  // Enforce overall character diversity across the entire name
  const uniqueLetters = new Set(lettersOnly.split(''));
  if (lettersOnly.length >= 6 && uniqueLetters.size <= 2) {
    return { valid: false, error: 'Name contains repetitive characters and does not appear to be genuine.' };
  }
  if (lettersOnly.length >= 8 && uniqueLetters.size <= 3) {
    return { valid: false, error: 'Name contains repetitive characters or keyboard mash.' };
  }
  if (lettersOnly.length >= 14 && uniqueLetters.size <= 4) {
    return { valid: false, error: 'Name contains repetitive characters or keyboard mash.' };
  }

  // Check word count
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0) {
    return { valid: false, error: 'Name cannot be blank spaces.' };
  }
  if (words.length > 6) {
    return { valid: false, error: 'Full name must not exceed 6 words.' };
  }

  // Check repeating identical words (e.g. "asd asd asd")
  if (words.length >= 2 && words.every(w => w.toLowerCase() === words[0].toLowerCase())) {
    return { valid: false, error: 'Name cannot consist of repeated identical words.' };
  }

  for (const word of words) {
    // Single letter with dot is a valid middle initial (e.g. "S.", "P.")
    if (/^[a-zA-ZñÑ]\.$/.test(word)) {
      continue;
    }

    // Bare single letter without dot is rejected
    if (/^[a-zA-ZñÑ]$/.test(word)) {
      return { valid: false, error: `Single letter "${word}" must be an initial followed by a period (e.g. "${word.toUpperCase()}.").` };
    }

    // Strip punctuation for workable test
    const cleanWord = word.replace(/[\.\-'\(\)\/]/g, '');
    if (cleanWord.length === 0) {
      return { valid: false, error: `"${word}" is not a valid name word.` };
    }
    if (!isWorkableWord(cleanWord)) {
      return { valid: false, error: `"${word}" does not appear to be a valid name or recognizable word.` };
    }
  }

  return { valid: true };
}

/**
 * Validates an email address.
 * Rejects empty/blank spaces, invalid formats, or lengths exceeding 100 characters.
 */
export function isValidEmail(email: unknown, isRequired = true): { valid: boolean; error?: string } {
  if (email === undefined || email === null || email === '') {
    if (!isRequired) return { valid: true };
    return { valid: false, error: 'Email address cannot be empty or blank spaces.' };
  }
  if (typeof email !== 'string') {
    return { valid: false, error: 'Email address must be a string.' };
  }
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    if (!isRequired) return { valid: true };
    return { valid: false, error: 'Email address cannot be empty or blank spaces.' };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Email address must not exceed 100 characters.' };
  }
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: 'Please provide a valid email address (e.g. officer@pnp.gov.ph).' };
  }
  return { valid: true };
}

/**
 * Validates a password.
 * Checks for minimum length of 8, max 64, and ensures it is not composed purely of whitespace.
 */
export function isValidPassword(password: unknown, isRequired = true): { valid: boolean; error?: string } {
  if (password === undefined || password === null || password === '') {
    if (!isRequired) return { valid: true };
    return { valid: false, error: 'Password cannot be empty or blank spaces.' };
  }
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string.' };
  }
  const trimmed = password.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Password cannot consist solely of blank spaces.' };
  }
  if (trimmed.length < 8 || trimmed.length > 64) {
    return { valid: false, error: 'Password must be between 8 and 64 characters.' };
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

/**
 * Validates a tactical hotline agency / organization name.
 * Rejects pure spacing, empty strings, repetitive characters, and keyboard mash.
 */
export function isValidHotlineAgency(name: unknown, minLength = 2, maxLength = 40): { valid: boolean; error?: string; normalized?: string } {
  const normalized = normalizeWhitespace(name);
  if (!normalized || normalized.length < minLength) {
    return { valid: false, error: `Agency name cannot be empty or blank spaces (minimum ${minLength} characters).` };
  }
  if (normalized.length > maxLength) {
    return { valid: false, error: `Agency name cannot exceed ${maxLength} characters.` };
  }

  const nameRegex = /^[a-zA-Z0-9ñÑáéíóúÁÉÍÓÚ\s\.\-&/]+$/;
  if (!nameRegex.test(normalized)) {
    return { valid: false, error: 'Agency name contains invalid characters. Use letters, numbers, spaces, dots, hyphens, and slashes only.' };
  }

  const lettersOnly = normalized.replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ]/g, '').toLowerCase();
  if (lettersOnly.length < 2) {
    return { valid: false, error: 'Agency name must contain at least 2 alphabet letters.' };
  }

  const unique = new Set(lettersOnly.split(''));
  if (lettersOnly.length >= 6 && unique.size <= 2) {
    return { valid: false, error: 'Agency name contains repetitive characters and does not appear to be genuine.' };
  }
  if (lettersOnly.length >= 8 && unique.size <= 3) {
    return { valid: false, error: 'Agency name contains repetitive characters or keyboard mash (e.g. "asdasdasd").' };
  }
  if (lettersOnly.length >= 14 && unique.size <= 4) {
    return { valid: false, error: 'Agency name contains repetitive characters or keyboard mash.' };
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length > 6) {
    return { valid: false, error: 'Agency name must not exceed 6 words.' };
  }
  if (words.length >= 2 && words.every(w => w.toLowerCase() === words[0].toLowerCase())) {
    return { valid: false, error: 'Agency name cannot consist of repeated identical words.' };
  }

  for (const word of words) {
    if (/^[a-zA-ZñÑ]\.$/.test(word)) continue;
    if (/^[a-zA-ZñÑ]$/.test(word)) {
      return { valid: false, error: `Single letter "${word}" in agency name must be an initial followed by a period (e.g. "${word.toUpperCase()}.").` };
    }
    const cleanWord = word.replace(/[\.\-&/]/g, '');
    if (cleanWord.length === 0) continue;
    if (!isWorkableWord(cleanWord)) {
      return { valid: false, error: `"${word}" does not appear to be a valid organization or agency name.` };
    }
  }

  return { valid: true, normalized };
}

/**
 * Validates an emergency hotline category designation.
 * Rejects pure spacing, empty strings, and keyboard mash.
 */
export function isValidHotlineCategory(category: unknown, minLength = 2, maxLength = 30): { valid: boolean; error?: string; normalized?: string } {
  const normalized = normalizeWhitespace(category);
  if (!normalized || normalized.length < minLength) {
    return { valid: false, error: `Category cannot be empty or blank spaces (minimum ${minLength} characters).` };
  }
  if (normalized.length > maxLength) {
    return { valid: false, error: `Category cannot exceed ${maxLength} characters.` };
  }

  const catRegex = /^[a-zA-ZñÑáéíóúÁÉÍÓÚ\s\.\-&/]+$/;
  if (!catRegex.test(normalized)) {
    return { valid: false, error: 'Category contains invalid characters.' };
  }

  const lettersOnly = normalized.replace(/[^a-zA-ZñÑáéíóúÁÉÍÓÚ]/g, '').toLowerCase();
  if (lettersOnly.length < 2) {
    return { valid: false, error: 'Category must contain at least 2 alphabet letters.' };
  }

  const unique = new Set(lettersOnly.split(''));
  if (lettersOnly.length >= 5 && unique.size <= 2) {
    return { valid: false, error: 'Category contains repetitive characters or keyboard mash.' };
  }
  if (lettersOnly.length >= 8 && unique.size <= 3) {
    return { valid: false, error: 'Category contains repetitive characters or keyboard mash.' };
  }

  const words = normalized.split(' ').filter(Boolean);
  if (words.length > 4) {
    return { valid: false, error: 'Category must not exceed 4 words.' };
  }

  for (const word of words) {
    const cleanWord = word.replace(/[\.\-&/]/g, '');
    if (cleanWord.length === 0) continue;
    if (!isWorkableWord(cleanWord)) {
      return { valid: false, error: `"${word}" does not appear to be a recognizable category name.` };
    }
  }

  return { valid: true, normalized };
}

/**
 * Validates an emergency hotline contact number.
 * Ensures input contains valid digits (3 to 12 digits) and is not purely repeating fake numbers (e.g. 00000000000).
 */
export function isValidHotlineContactNumber(number: unknown): { valid: boolean; error?: string; normalized?: string } {
  const clean = String(number || '').trim().replace(/[\s\-\(\)\.]/g, '');
  if (!clean) {
    return { valid: false, error: 'Contact number cannot be empty or blank spaces.' };
  }
  if (!/^\d+$/.test(clean)) {
    return { valid: false, error: 'Contact number must contain numeric digits only (no characters or special symbols).' };
  }
  if (clean.length < 3 || clean.length > 12) {
    return { valid: false, error: 'Contact number must be between 3 and 12 digits.' };
  }
  if (/^0+$/.test(clean)) {
    return { valid: false, error: 'Contact number cannot consist solely of zeroes.' };
  }
  if (clean.length >= 6 && /^(\d)\1+$/.test(clean)) {
    return { valid: false, error: 'Contact number cannot consist of repeating identical digits (e.g. 00000000000).' };
  }
  return { valid: true, normalized: clean };
}


