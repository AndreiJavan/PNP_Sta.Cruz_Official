import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

export type Language = 'en' | 'fil';

interface TranslationDictionary {
  [key: string]: any;
}

export function loadDictionaries(): Record<Language, TranslationDictionary> {
  const dicts: Record<Language, TranslationDictionary> = { en: {}, fil: {} };
  try {
    const enPath = path.join(process.cwd(), 'locales', 'en.json');
    const filPath = path.join(process.cwd(), 'locales', 'fil.json');

    if (fs.existsSync(enPath)) {
      dicts.en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    }
    if (fs.existsSync(filPath)) {
      dicts.fil = JSON.parse(fs.readFileSync(filPath, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading locale files:', err);
  }
  return dicts;
}

function getNestedValue(obj: any, pathStr: string): string | null {
  if (!obj || !pathStr) return null;
  const parts = pathStr.split('.');
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return typeof current === 'string' ? current : null;
}

function getCandidateKeys(key: string): string[] {
  if (!key) return [];
  const rawKey = key.trim();
  const candidates: string[] = [rawKey];

  // Convert camelCase to snake_case
  const snakeKey = rawKey.replace(/([A-Z])/g, "_$1").toLowerCase();
  if (snakeKey !== rawKey) candidates.push(snakeKey);

  // Convert snake_case to camelCase
  const camelKey = rawKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  if (camelKey !== rawKey) candidates.push(camelKey);

  // Expand home/hero candidates
  if (rawKey.includes('hero') || rawKey.includes('home')) {
    if (rawKey.includes('prefix') || rawKey.includes('title_prefix') || rawKey.includes('titlePrefix')) {
      candidates.push('home.hero.title_prefix', 'home.hero.titlePrefix', 'home.hero_title_prefix', 'hero.title_prefix', 'hero.titlePrefix');
    }
    if (rawKey.includes('span') || rawKey.includes('title_span') || rawKey.includes('titleSpan')) {
      candidates.push('home.hero.title_span', 'home.hero.titleSpan', 'home.hero_title_span', 'hero.title_span', 'hero.titleSpan');
    }
    if (rawKey.includes('desc') || rawKey.includes('description')) {
      candidates.push('home.hero.description', 'home.hero.desc', 'home.hero_desc', 'hero.description', 'hero.desc');
    }
    if (rawKey.includes('official_portal') || rawKey.includes('officialPortal')) {
      candidates.push('home.official_portal', 'hero.official_portal', 'official_portal');
    }
  }

  // Convert home.hero_x to home.hero.x
  if (rawKey.startsWith('home.hero_')) {
    const sub = rawKey.replace(/^home\.hero_/, '');
    candidates.push(`home.hero.${sub}`);
    candidates.push(`hero.${sub}`);
  }

  // Convert hero.x to home.hero.x and home.hero_x
  if (rawKey.startsWith('hero.')) {
    const sub = rawKey.replace(/^hero\./, '');
    candidates.push(`home.hero.${sub}`);
    candidates.push(`home.hero_${sub}`);
  }

  // Without section
  if (!rawKey.includes('.')) {
    candidates.push(`common.${rawKey}`);
    candidates.push(`actions.${rawKey}`);
    candidates.push(`nav.${rawKey}`);
    candidates.push(`header.${rawKey}`);
  }

  return Array.from(new Set(candidates));
}

function resolveTranslation(key: string, dict: TranslationDictionary, enDict: TranslationDictionary): string | null {
  const candidates = getCandidateKeys(key);

  // 1. Try candidates in target dictionary
  for (const cand of candidates) {
    const val = getNestedValue(dict, cand);
    if (val) return val;
  }

  // 2. Try candidates in English dictionary
  for (const cand of candidates) {
    const val = getNestedValue(enDict, cand);
    if (val) return val;
  }

  return null;
}

export function translate(lang: Language, key: string, params?: Record<string, string | number>, dicts?: Record<Language, TranslationDictionary>): string {
  const activeDicts = dicts || loadDictionaries();
  const dict = activeDicts[lang] || activeDicts.en;
  const enDict = activeDicts.en || {};

  let text = resolveTranslation(key, dict, enDict);

  // 3. Clean fallback formatting if missing completely
  if (!text) {
    const lastPart = key.split('.').pop() || key;
    text = lastPart
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }

  if (params && text) {
    Object.keys(params).forEach(p => {
      text = text!.replace(new RegExp(`{\\s*${p}\\s*}`, 'g'), String(params[p]));
    });
  }

  return text;
}

export const i18nMiddleware = (req: Request, res: Response, next: NextFunction) => {
  let selectedLang: Language = 'en';

  // 1. Query parameter override
  if (req.query.lang === 'fil' || req.query.lang === 'en') {
    selectedLang = req.query.lang as Language;
    if (req.session) {
      req.session.language = selectedLang;
      if (req.session.user) {
        req.session.user.language = selectedLang;
      }
    }
    res.cookie('cpicrs_lang', selectedLang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  } 
  // 2. Cookie preference (highest priority for client toggles)
  else if (req.cookies?.cpicrs_lang === 'fil' || req.cookies?.cpicrs_lang === 'en') {
    selectedLang = req.cookies.cpicrs_lang as Language;
    if (req.session) {
      req.session.language = selectedLang;
    }
  }
  // 3. Logged in user preference
  else if (req.session?.user?.language === 'fil' || req.session?.user?.language === 'en') {
    selectedLang = req.session.user.language as Language;
  }
  // 4. Session preference
  else if (req.session?.language === 'fil' || req.session?.language === 'en') {
    selectedLang = req.session.language as Language;
  }

  const currentDicts = loadDictionaries();

  req.lang = selectedLang;
  res.locals.currentLang = selectedLang;
  res.locals.t = (key: string, params?: Record<string, string | number>) => translate(selectedLang, key, params, currentDicts);
  res.locals.localesJson = JSON.stringify(currentDicts[selectedLang] || currentDicts.en);
  res.locals.allLocalesJson = JSON.stringify(currentDicts);

  next();
};
