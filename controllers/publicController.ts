import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { decodeCustomCategory, getStationPersonnelList } from './adminController.js';
import { memoryCache } from '../utils/cache.js';
import { VALID_BARANGAYS } from '../constants/tactical_assets.js';
import { getFaqs, INITIAL_FAQS, FAQItem, generateAutoSuggestedQuestions } from '../services/faqService.js';

// Cached Data Helpers
const getRawBulletinsCached = async (): Promise<any[]> => {
  return memoryCache.getOrSet('bulletins:all', async () => {
    const snap = await db.collection('bulletins').orderBy('created_at', 'desc').get();
    return snap.docs.map((doc: any) => {
      const d = doc.data();
      return decodeCustomCategory({
        id: doc.id,
        ...d,
        photo_paths: parsePhotos(d.photo_path, d.photo_paths),
        video_paths: parseVideos(d.video_path, d.video_paths)
      });
    });
  }, 3 * 60 * 1000); // 3 minutes cache
};

export const getHotlinesCached = async (): Promise<any[]> => {
  return memoryCache.getOrSet('hotlines:all', async () => {
    const snap = await db.collection('hotlines').orderBy('category').get();
    return snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  }, 5 * 60 * 1000); // 5 minutes cache
};

const getPersonnelCached = async (): Promise<any[]> => {
  return getStationPersonnelList();
};

function getFirstParagraph(text: string): string {
  if (!text) return '';
  const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 0) return paragraphs[0];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines[0] || text;
}

export const getAllMapPointsCached = async (): Promise<any[]> => {
  const mapPointsCacheKey = 'map_points:all_unfiltered';
  let incidents = await memoryCache.get<any[]>(mapPointsCacheKey);
  if (!incidents) {
    const mapPointsSnap = await db.collection('map_points').get();
    incidents = mapPointsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .filter((p: any) => {
        const dateStr = String(p.incident_date || '');
        const isPlaceholder = dateStr === 'N/A' ||
          dateStr === '' ||
          dateStr === '2026-04-27T09:22:14.910Z' ||
          p.description === 'Strategic placeholder data';
        return !isPlaceholder;
      });

    // Sort by incident_date descending
    incidents.sort((a: any, b: any) => {
      const dateA = new Date(a.incident_date).getTime();
      const dateB = new Date(b.incident_date).getTime();
      return dateB - dateA;
    });
    await memoryCache.set(mapPointsCacheKey, incidents, 5 * 60 * 1000);
  }
  return incidents;
};

export const getHome = async (req: Request, res: Response) => {
  try {
    const allHotlines = await getHotlinesCached();
    const hotlines = allHotlines.slice(0, 5);

    const bulletins = (await getRawBulletinsCached())
      .filter((b: any) => b.is_archived !== true && b.category !== 'Wanted Person' && b.category !== 'Missing Person');

    // Filter out mock data for public advisory, restrict to target categories (now supports Facebook URL advisories too)
    const allowedAdvisoryCategories = ['Crime Advisory', 'Traffic Advisory', 'Cybercrime Advisory', 'Community Awareness'];
    const filteredBulletins = bulletins.filter((b: any) => !b.id.startsWith('bulletin-') && allowedAdvisoryCategories.includes(b.category));

    // Map "General Announcement" bulletins and Facebook news posts to policeNewsList for news releases
    const policeNewsList = bulletins
      .filter((b: any) => (b.category === 'General Announcement' || (b.facebook_url && !allowedAdvisoryCategories.includes(b.category))) && !b.id.startsWith('bulletin-'))
      .map((b: any) => {
        const bodyText = (b.body && b.body.trim() && b.body !== 'Official Facebook post update from PNP Sta. Cruz, Laguna.') ? b.body.trim() : b.title;
        const firstPara = getFirstParagraph(bodyText);
        return {
          id: b.id,
          headline: b.title,
          description: firstPara,
          fullContent: bodyText,
          urlToImage: normalizeImageUrl((b.photo_paths && b.photo_paths[0]) || b.photo_path || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=800&auto=format&fit=crop'),
          photo_paths: b.photo_paths,
          video_paths: b.video_paths || [],
          facebook_url: b.facebook_url,
          publishedAt: b.created_at || new Date().toISOString(),
          author: b.facebook_url ? b.facebook_url : 'Station Desk'
        };
      });

    // Fetch police incidents (map points) to show on home feed
    const incidents = await getAllMapPointsCached();

    // Fetch active personnel/officers
    let personnel: any[] = [];
    try {
      personnel = await getPersonnelCached();
    } catch (usersErr) {
      console.error('Error fetching personnel for public home:', usersErr);
    }

    res.render('public/home', { title: 'Home', hotlines, bulletins: filteredBulletins, incidents, personnel, policeNewsList, layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading home page');
  }
};

export const getNews = async (req: Request, res: Response) => {
  try {
    const rawBulletins = await getRawBulletinsCached();
    const allowedAdvisoryCategories = ['Crime Advisory', 'Traffic Advisory', 'Cybercrime Advisory', 'Community Awareness'];
    const dbBulletins = rawBulletins.filter((b: any) => b.is_archived !== true && (b.category === 'General Announcement' || (b.facebook_url && !allowedAdvisoryCategories.includes(b.category))) && !b.id.startsWith('bulletin-'));

    const newsList = dbBulletins.map((b: any) => {
      const bodyText = (b.body && b.body.trim() && b.body !== 'Official Facebook post update from PNP Sta. Cruz, Laguna.') ? b.body.trim() : b.title;
      const firstPara = getFirstParagraph(bodyText);
      return {
        id: b.id,
        headline: b.title,
        description: firstPara,
        fullContent: bodyText,
        urlToImage: (b.photo_paths && b.photo_paths[0]) || b.photo_path || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=800&auto=format&fit=crop',
        photo_paths: b.photo_paths,
        video_paths: b.video_paths || [],
        facebook_url: b.facebook_url,
        publishedAt: b.created_at || new Date().toISOString(),
        author: b.facebook_url ? b.facebook_url : 'Station Desk'
      };
    });

    res.render('public/news', { title: 'Station Releases', newsList, layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading News');
  }
};

export const getMap = async (req: Request, res: Response) => {
  try {
    const points = await getAllMapPointsCached();
    // Only pass necessary fields for map rendering to minimize payload transfer
    const lightPoints = points.map((p: any) => ({
      id: p.id,
      incident_type: p.incident_type,
      category: p.category,
      barangay: p.barangay,
      incident_date: p.incident_date,
      date: p.date,
      created_at: p.created_at,
      latitude: p.latitude,
      longitude: p.longitude
    }));
    res.render('public/map', { title: 'Crime Map', hideFooter: true, initialMapPoints: lightPoints, layout: 'layouts/main' });
  } catch (err) {
    console.error('Error in getMap:', err);
    res.render('public/map', { title: 'Crime Map', hideFooter: true, initialMapPoints: [], layout: 'layouts/main' });
  }
};

export const getMapPoints = async (req: Request, res: Response) => {
  const { type, range, barangay } = req.query;
  const cacheKey = `map_points:${type || ''}:${range || ''}:${barangay || ''}`;

  const cachedPoints = await memoryCache.get<any[]>(cacheKey);
  if (cachedPoints) {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.json(cachedPoints);
  }

  let query: any = db.collection('map_points');

  if (type) {
    query = query.where('incident_type', '==', type);
  }

  if (barangay) {
    query = query.where('barangay', '==', barangay);
  }

  if (range) {
    const rangeStr = String(range).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(rangeStr)) {
      query = query.where('incident_date', '==', rangeStr);
    } else {
      const now = new Date();
      let dateLimit;
      if (range === 'currentYear') dateLimit = new Date(now.getFullYear(), 0, 1);
      else if (range === '1month') dateLimit = new Date(now.setMonth(now.getMonth() - 1));
      else if (range === '2months') dateLimit = new Date(now.setMonth(now.getMonth() - 2));
      else if (range === '3months') dateLimit = new Date(now.setMonth(now.getMonth() - 3));
      else if (range === '7days') dateLimit = new Date(now.setDate(now.getDate() - 7));
      else if (range === '30days') dateLimit = new Date(now.setDate(now.getDate() - 30));
      else if (range === '6months') dateLimit = new Date(now.setMonth(now.getMonth() - 6));

      if (dateLimit) {
        query = query.where('incident_date', '>=', dateLimit.toISOString());
      }
    }
  }

  try {
    const snap = await query.get();
    const points = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    await memoryCache.set(cacheKey, points, 3 * 60 * 1000); // 3 minutes cache
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json(points);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching map points' });
  }
};

export const proxyMedia = async (req: Request, res: Response) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  const sendDefaultPlaceholder = () => {
    try {
      const fallbackPath = path.join(process.cwd(), 'public', 'images', 'PNP.jpg');
      if (fs.existsSync(fallbackPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(fallbackPath);
      }
    } catch (_) {}
    return res.redirect(302, '/images/PNP.jpg');
  };

  try {
    const parsed = new URL(targetUrl);
    const isAllowed = parsed.hostname.includes('fbcdn.net') || 
                      parsed.hostname.includes('fbsbx.com') || 
                      parsed.hostname.includes('facebook.com');
    if (!isAllowed) {
      return res.status(403).send('Forbidden media domain');
    }

    const fbRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': '*/*'
      },
      redirect: 'follow'
    });

    if (!fbRes.ok) {
      return sendDefaultPlaceholder();
    }

    const rawContentType = fbRes.headers.get('content-type') || '';
    
    // If Facebook returned an HTML error page or login wall instead of actual binary media
    if (rawContentType.includes('text/html')) {
      return sendDefaultPlaceholder();
    }

    const contentType = rawContentType || (targetUrl.includes('.jpg') ? 'image/jpeg' : targetUrl.includes('.png') ? 'image/png' : targetUrl.includes('.mp4') ? 'video/mp4' : 'application/octet-stream');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const buffer = Buffer.from(await fbRes.arrayBuffer());
    return res.send(buffer);
  } catch (err: any) {
    console.warn('Media proxy non-fatal error:', err?.message || err);
    return sendDefaultPlaceholder();
  }
};

export const normalizeImageUrl = (url: string | undefined): string => {
  if (!url || typeof url !== 'string') return '/images/PNP.jpg';
  let clean = url.trim();
  if (!clean) return '/images/PNP.jpg';

  if (clean.startsWith('/api/media-proxy')) {
    return clean;
  }

  if (clean.includes('lookaside.fbsbx.com') || clean.includes('.fbcdn.net')) {
    return `/api/media-proxy?url=${encodeURIComponent(clean)}`;
  }

  if (clean.startsWith('http://')) {
    clean = clean.replace('http://', 'https://');
  }

  if (clean.startsWith('https://')) {
    return clean;
  }

  if (clean.startsWith('/images/')) {
    return clean;
  }

  const filename = clean.split('/').pop();
  const supabaseUrl = process.env.SUPABASE_URL;

  if (supabaseUrl && filename && filename.includes('.')) {
    const cleanSupabaseUrl = supabaseUrl.replace(/\/$/, '');
    return `${cleanSupabaseUrl}/storage/v1/object/public/bulletins/bulletins/${filename}`;
  }

  return '/images/PNP.jpg';
};

const parsePhotos = (path: string | undefined, existingPaths?: any): string[] => {
  let rawList: string[] = [];
  if (Array.isArray(existingPaths) && existingPaths.length > 0) {
    rawList = existingPaths;
  } else if (path) {
    try {
      const parsed = JSON.parse(path);
      if (Array.isArray(parsed)) rawList = parsed;
      else rawList = [path];
    } catch (e) {
      rawList = [path];
    }
  }

  return rawList.map(url => normalizeImageUrl(url));
};

const parseVideos = (path: string | undefined, existingPaths?: any): string[] => {
  let rawList: string[] = [];
  if (Array.isArray(existingPaths) && existingPaths.length > 0) {
    rawList = existingPaths;
  } else if (path) {
    try {
      const parsed = JSON.parse(path);
      if (Array.isArray(parsed)) rawList = parsed;
      else rawList = [path];
    } catch (e) {}
  }

  return rawList.map(v => {
    if (typeof v === 'string') {
      const clean = v.trim();
      if (clean.startsWith('/api/media-proxy')) return clean;
      if (clean.includes('lookaside.fbsbx.com') || clean.includes('.fbcdn.net')) {
        return `/api/media-proxy?url=${encodeURIComponent(clean)}`;
      }
      return clean;
    }
    return v;
  });
};

export const getBulletins = async (req: Request, res: Response) => {
  const { category, search, page = 1 } = req.query;
  const limit = 50;
  try {
    const rawBulletins = await getRawBulletinsCached();
    
    const allowedAdvisoryCategories = ['Crime Advisory', 'Traffic Advisory', 'Cybercrime Advisory', 'Community Awareness'];
    let bulletins = rawBulletins
      .filter((b: any) => b.is_archived !== true && b.category !== 'Wanted Person' && b.category !== 'Missing Person')
      .filter((b: any) => !b.id.startsWith('bulletin-') && allowedAdvisoryCategories.includes(b.category));

    let activeCategory = category;
    if (!activeCategory || activeCategory === 'All' || !allowedAdvisoryCategories.includes(String(activeCategory))) {
      activeCategory = 'Crime Advisory';
    }

    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s));
    }

    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);
    res.render('public/bulletins', { title: 'Public Advisory', pageTitle: 'Public Advisory', bulletins, category: activeCategory, search, page: Number(page), layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Bulletins');
  }
};

export const getWantedPersons = async (req: Request, res: Response) => {
  const { search, page = 1 } = req.query;
  const limit = 10;
  try {
    const rawBulletins = await getRawBulletinsCached();
    let bulletins = rawBulletins.filter((b: any) => b.is_archived !== true && b.category === 'Wanted Person');
    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s));
    }
    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);
    res.render('public/bulletins', { title: 'Wanted Persons', pageTitle: 'Wanted Persons', bulletins, category: 'Wanted Person', search, page: Number(page), layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Wanted Persons');
  }
};

export const getMissingPersons = async (req: Request, res: Response) => {
  const { search, page = 1 } = req.query;
  const limit = 10;
  try {
    const rawBulletins = await getRawBulletinsCached();
    let bulletins = rawBulletins.filter((b: any) => b.is_archived !== true && b.category === 'Missing Person');
    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s));
    }
    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);
    res.render('public/bulletins', { title: 'Missing Persons', pageTitle: 'Missing Persons', bulletins, category: 'Missing Person', search, page: Number(page), layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Missing Persons');
  }
};

export const getBulletinDetail = async (req: Request, res: Response) => {
  try {
    const cacheKey = `bulletin_detail:${req.params.id}`;
    let bulletin = await memoryCache.get<any>(cacheKey);
    if (!bulletin) {
      const doc = await db.collection('bulletins').doc(req.params.id).get();
      if (!doc.exists) return res.status(404).send('Bulletin not found');
      const d = doc.data();
      bulletin = decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path, d.photo_paths), video_paths: parseVideos(d.video_path, d.video_paths) });
      await memoryCache.set(cacheKey, bulletin, 5 * 60 * 1000);
    }
    res.render('public/bulletin_detail', { title: bulletin.title, bulletin, layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletin detail');
  }
};

export const getAbout = (req: Request, res: Response) => {
  res.render('public/about', { title: 'About', layout: 'layouts/main' });
};

export const getFaq = (req: Request, res: Response) => {
  res.redirect('/?faq=1');
};

export const getFaqsJson = async (req: Request, res: Response) => {
  try {
    const faqs = await getFaqs();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(faqs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
};

export const getIncidents = async (req: Request, res: Response) => {
  res.redirect('/?tab=incidents');
};

export const getHotlines = async (req: Request, res: Response) => {
  try {
    const hotlines = await getHotlinesCached();
    res.render('public/hotlines', { title: 'Emergency Hotlines', hotlines, layout: 'layouts/main' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading hotlines');
  }
};

// Server-side fallback translator using free MyMemory API with paragraph/sentence chunking
async function translateViaMyMemory(text: string): Promise<string> {
  if (!text || typeof text !== 'string') return text;
  const paragraphs = text.split(/\r?\n\r?\n/);
  const translatedParagraphs: string[] = [];

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) {
      translatedParagraphs.push('');
      continue;
    }

    const sentences = trimmedPara.match(/[^.!?]+[.!?]+|\S+/g) || [trimmedPara];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + ' ' + sentence).length > 350) {
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());

    const translatedChunks = await Promise.all(
      chunks.map(async (c) => {
        try {
          const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=en|tl`);
          const data = await res.json() as any;
          if (data?.responseData?.translatedText && !data.responseData.translatedText.includes('QUERY LENGTH LIMIT EXCEEDED')) {
            return data.responseData.translatedText;
          }
        } catch (_) {}
        return c;
      })
    );
    translatedParagraphs.push(translatedChunks.join(' '));
  }

  return translatedParagraphs.join('\n\n');
}

export const translateToTagalog = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text parameter required' });
    }

    // 1. Check cache first to avoid redundant AI API calls
    const cacheKey = `translation:${Buffer.from(text.substring(0, 500)).toString('base64')}`;
    const cachedTranslation = await memoryCache.get<string>(cacheKey);
    if (cachedTranslation) {
      return res.json({ success: true, tagalogText: cachedTranslation, cached: true });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const prompt = `You are an official Filipino translator for Sta. Cruz Municipal Police Station. Translate the following report/bulletin into clear, natural, official Tagalog (Filipino) so it can be spoken out loud via text-to-speech for public accessibility. Return ONLY the translated Tagalog text, with no explanations, notes, or extra formatting:\n\n${text.substring(0, 10000)}`;

    if (openrouterKey) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openrouterKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5000",
            "X-Title": "PNP Sta. Cruz System"
          },
          body: JSON.stringify({
            models: [
              "google/gemini-2.5-flash",
              "google/gemini-2.0-flash-lite-001",
              "meta-llama/llama-3.3-70b-instruct:free",
              "deepseek/deepseek-r1:free"
            ],
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }]
          })
        });
        const data = await response.json() as any;
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const tagalogText = data.choices[0].message.content.trim();
          await memoryCache.set(cacheKey, tagalogText, 24 * 60 * 60 * 1000); // Cache for 24 hours
          return res.json({ success: true, tagalogText });
        } else {
          console.warn('OpenRouter translation returned no choices, falling back to Gemini API:', data);
        }
      } catch (err: any) {
        console.warn('OpenRouter translation error, falling back to Gemini API:', err?.message || err);
      }
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.CHAT_GEMINI_KEY || process.env.PALM_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const geminiModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
        for (const model of geminiModels) {
          try {
            const response = await ai.models.generateContent({
              model,
              contents: prompt
            });
            if (response.text && response.text.trim()) {
              const tagalogText = response.text.trim();
              await memoryCache.set(cacheKey, tagalogText, 24 * 60 * 60 * 1000);
              return res.json({ success: true, tagalogText });
            }
          } catch (modelErr: any) {
            console.warn(`Gemini translation with ${model} failed, trying next:`, modelErr?.message || modelErr);
          }
        }
      } catch (aiErr: any) {
        console.warn('Gemini translation error, falling back to MyMemory API:', aiErr?.message || aiErr);
      }
    }

    // 3. Robust free fallback via MyMemory API
    try {
      const myMemoryTagalog = await translateViaMyMemory(text);
      if (myMemoryTagalog && myMemoryTagalog.trim() && myMemoryTagalog.trim() !== text.trim()) {
        await memoryCache.set(cacheKey, myMemoryTagalog, 24 * 60 * 60 * 1000);
        return res.json({ success: true, tagalogText: myMemoryTagalog });
      }
    } catch (mmErr) {
      console.warn('MyMemory translation error:', mmErr);
    }

    return res.json({ success: true, tagalogText: text });
  } catch (err: any) {
    console.error('Translation endpoint error:', err);
    return res.json({ success: false, tagalogText: req.body.text || '' });
  }
};

export const postSetLanguage = async (req: Request, res: Response) => {
  try {
    const { lang } = req.body;
    const selectedLang = (lang === 'fil' || lang === 'en') ? lang : 'en';

    if (req.session) {
      req.session.language = selectedLang;
      if (req.session.user) {
        req.session.user.language = selectedLang;
        try {
          if (req.session.user.id) {
            await db.collection('users').doc(req.session.user.id).update({
              language: selectedLang,
              updated_at: new Date().toISOString()
            });
          }
        } catch (dbErr) {
          console.warn('Failed to update language in DB:', dbErr);
        }
      }
    }

    res.cookie('cpicrs_lang', selectedLang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
    return res.json({ success: true, language: selectedLang });
  } catch (err: any) {
    console.error('Error setting language:', err);
    return res.status(500).json({ success: false, error: 'Failed to update language' });
  }
};

export interface DatabaseStats {
  totalIncidents: number;
  byBarangay: Record<string, number>;
  topBarangays: { name: string; count: number }[];
  byType: Record<string, number>;
  topTypes: { name: string; count: number }[];
  byBarangayTypes: Record<string, Record<string, number>>;
  summary: string;
}

export const getDatabaseStats = async (): Promise<DatabaseStats> => {
  const cacheKey = 'ai:db_stats_v2';
  const cached = await memoryCache.get<DatabaseStats>(cacheKey);
  if (cached) return cached;

  let incidents: any[] = [];
  try {
    incidents = await getAllMapPointsCached();
  } catch (err) {
    console.warn('Failed to load cached map points for db stats:', err);
  }

  const byBarangay: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byBarangayTypes: Record<string, Record<string, number>> = {};

  if (Array.isArray(incidents)) {
    incidents.forEach((p: any) => {
      const brgy = (p.barangay || '').trim();
      const type = (p.incident_type || p.crime_type || p.category || '').trim();
      if (brgy && brgy !== 'Unspecified') {
        byBarangay[brgy] = (byBarangay[brgy] || 0) + 1;
        if (!byBarangayTypes[brgy]) byBarangayTypes[brgy] = {};
        if (type && type !== 'Unspecified') {
          byBarangayTypes[brgy][type] = (byBarangayTypes[brgy][type] || 0) + 1;
        }
      }
      if (type && type !== 'Unspecified') {
        byType[type] = (byType[type] || 0) + 1;
      }
    });
  }

  const topBarangays = Object.entries(byBarangay)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  let bulletinListText = '• No active bulletins';
  try {
    const bulletins = await getRawBulletinsCached();
    const activeBulletins = (bulletins || []).filter((b: any) => !b.is_archived);
    if (activeBulletins.length > 0) {
      bulletinListText = activeBulletins.slice(0, 5).map((b: any) => `• [${b.category}] ${b.title}`).join('\n');
    }
  } catch (_) {}

  let hotlineListText = '• Station Desk: (049) 501-5971 / 0928-465-3828 / 0998-598-5667 / 911';
  try {
    const hotlines = await getHotlinesCached();
    if (hotlines && hotlines.length > 0) {
      hotlineListText = hotlines.map((h: any) => `• ${h.name || h.title || 'Emergency'}: ${h.number || h.phone || h.contact || 'N/A'}`).join('\n');
    }
  } catch (_) {}

  let personnelCount = 0;
  try {
    const personnel = await getPersonnelCached();
    personnelCount = personnel?.length || 0;
  } catch (_) {}

  const topTypesText = topTypes.length > 0 
    ? topTypes.map(t => `• ${t.name}: ${t.count} reported case(s)`).join('\n') 
    : '• No cases recorded';

  const topBarangaysText = topBarangays.length > 0
    ? topBarangays.slice(0, 10).map(b => `• ${b.name}: ${b.count} case(s)`).join('\n')
    : '• Monitored across all 26 Barangays of Santa Cruz, Laguna';

  const summary = `
=== READ-ONLY DATABASE CONTEXT (Sta. Cruz Municipal Police Station) ===
• Total Logged Crime/Incident Cases: ${incidents.length}
• Active Station Personnel: ${personnelCount}
• Covered Jurisdictions: All 26 Barangays of Santa Cruz, Laguna

[Case Statistics by Category]
${topTypesText}

[Top Incident Locations by Barangay]
${topBarangaysText}

[Active Bulletins & Announcements]
${bulletinListText}

[Emergency Hotlines]
${hotlineListText}
`.trim();

  const stats: DatabaseStats = {
    totalIncidents: incidents.length,
    byBarangay,
    topBarangays,
    byType,
    topTypes,
    byBarangayTypes,
    summary
  };

  await memoryCache.set(cacheKey, stats, 3 * 60 * 1000);
  return stats;
};

const getDatabaseSummaryCached = async (): Promise<string> => {
  const stats = await getDatabaseStats();
  return stats.summary;
};

export interface PublicChatSecurityResult {
  blocked: boolean;
  category?: 'admin_probe' | 'internal_data_probe' | 'command_injection' | 'code_injection' | 'database_probe' | 'jailbreak_attempt';
  reason?: string;
  clientMessage?: string;
}

/**
 * Validates public chat queries against security threats, command injection,
 * scripting, SQL injection, unauthorized administrative probing, and internal data dumps.
 */
export function validatePublicInputSecurity(rawInput: string, isFilipino: boolean = false): PublicChatSecurityResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return { blocked: false };
  }

  const text = rawInput.trim();
  const lower = text.toLowerCase();

  // 1. Administrative Portal, Admin Side & Privilege Escalation Probing
  const adminPatterns = [
    /\b(admin|administrator|superadmin|root|superuser)\s*(side|portal|panel|dashboard|login|access|page|route|account|accounts|password|passwords|pass|creds?|credentials?|session|sessions|privilege|privileges|role|roles|data|datas)\b/i,
    /\b(access|open|enter|reach|login|log\s*in|bypass|hack|crack|escalate|exploit)\s+(to\s+)?(the\s+)?(admin|administrator|superadmin|root|superuser|internal\s+system)\b/i,
    /\b(bypass\s+(auth|login|security|password|permission|restrictions?))\b/i,
    /\b(admin_users|user_accounts|system_admin|admin_panel|admin_dashboard|wp-admin)\b/i,
    /\b(command|coding|code|script)\s+(to|for|in\s+order\s+to)?\s*(access|reach|hack|bypass|enter|dump|view|extract|crack|exploit|infiltrate)\s+(the\s+)?(admin|internal|database|backend|system)\b/i,
    /\b(use|using|run|execute)\s+(a\s+)?(command|coding|code|script)\s+to\s+(access|reach|hack|bypass|enter|dump|view|extract|crack|exploit|infiltrate)\b/i,
    /\b(admin\s+mode|root\s+mode|developer\s+mode|god\s+mode|debug\s+mode)\b/i,
    /\b(how\s+to\s+hack|exploit|penetrate|vulnerability\s+scan)\b/i,
    /\/?(admin\/(login|dashboard|users|settings|incidents|portal))\b/i,
    /\b(sudo|su\s+-|runas|privilege\s+escalat(e|ion))\b/i
  ];

  for (const rx of adminPatterns) {
    if (rx.test(lower)) {
      return {
        blocked: true,
        category: 'admin_probe',
        reason: 'Attempted access or probe of internal administrative portal or privileges',
        clientMessage: isFilipino
          ? '⚠️ **BABALA SA SEGURIDAD NG PNP:**\n\nHindi pinahihintulutan ang pagtatangkang pasukin o siyasatin ang administrative side, internal accounts, o security controls ng estasyon. Ang portal na ito ay eksklusibo para sa opisyal na serbisyong pampubliko ng PNP Sta. Cruz alinsunod sa Republic Act 10175 (Cybercrime Prevention Act of 2012).'
          : '⚠️ **PNP STA. CRUZ CYBER SECURITY NOTICE:**\n\nAccess Denied. Inquiries attempting to access, probe, or interact with administrative interfaces, internal user accounts, or privileged controls are strictly prohibited under Republic Act 10175 (Cybercrime Prevention Act of 2012) and PNP IT Security Policy. This portal is strictly for public citizen assistance.'
      };
    }
  }

  // 2. Internal Data, Secrets, Config & Environment Probing
  const internalDataPatterns = [
    /\b(internal\s+data(s)?|raw\s+database|db\s+dump|dump\s+database|dump\s+db|leak\s+data|export\s+(database|users|tables|records))\b/i,
    /\b(show\s+tables|show\s+databases|list\s+databases|show\s+columns|information_schema|pg_catalog|pg_tables|sqlite_master)\b/i,
    /\b(\.env|dotenv|environment\s+variables?|process\.env|supabase_key|supabase_url|jwt_secret|session_secret|openrouter_api_key|api_key|private_key|secret_key|master_key)\b/i,
    /\b(credentials|passwords?|db_password|db_user|db_host|connection_string|server_config|server_secret)\b/i,
    /\b(\/etc\/passwd|\/etc\/shadow|c:\\windows\\system32|web\.config)\b/i
  ];

  for (const rx of internalDataPatterns) {
    if (rx.test(lower)) {
      return {
        blocked: true,
        category: 'internal_data_probe',
        reason: 'Attempted probe of internal database schema, sensitive data, or environment secrets',
        clientMessage: isFilipino
          ? '⚠️ **BABALA SA SEGURIDAD NG PNP:**\n\nIpinagbabawal ang paghingi o pagsisiyasat ng internal data, server secrets, o database records. Ang lahat ng opisyal na pampublikong datos ng insidente ay bukas at ligtas na makikita sa ating interactive Crime Map.'
          : '⚠️ **PNP STA. CRUZ CYBER SECURITY NOTICE:**\n\nAccess Denied. Inquiries seeking internal server configurations, environment keys, credentials, or raw database structures are strictly prohibited under R.A. 10173 (Data Privacy Act) and R.A. 10175 (Cybercrime Prevention Act). Public crime records are accessible via the Crime Map.'
      };
    }
  }

  // 3. Command Injection & Terminal / Shell Syntax
  const commandPatterns = [
    /\b(cmd(\.exe)?|powershell(\.exe)?|bash|sh|zsh|csh|tcsh)\b/i,
    /\b(whoami|systeminfo|ipconfig|ifconfig|netstat|tasklist|killall|pkill|rm\s+-rf|del\s+\/[fqs]|dir\s+[a-z]:|ls\s+-[a-z]+|cat\s+\/|chmod\s+[0-7]+|chown\s+|curl\s+-[a-z]|wget\s+http|nc\s+-[a-z]|nmap)\b/i,
    /[;&|`]\s*(cat|ls|dir|rm|del|whoami|curl|wget|ping|echo|nc|python|node|bash|sh|powershell)\b/i,
    /\$\([a-z0-9_\-\s]+\)|\`[a-z0-9_\-\s]+\`/i
  ];

  for (const rx of commandPatterns) {
    if (rx.test(text)) {
      return {
        blocked: true,
        category: 'command_injection',
        reason: 'Command injection or terminal execution syntax detected',
        clientMessage: isFilipino
          ? '⚠️ **BABALA SA SEGURIDAD NG PNP:**\n\nMay natukoy na command o terminal execution syntax sa iyong tanong. Ang paggamit ng mga command sa chatbot na ito ay mahigpit na ipinagbabawal at awtomatikong naharang ng seguridad ng himpilan.'
          : '⚠️ **PNP STA. CRUZ CYBER SECURITY NOTICE:**\n\nAccess Denied. System command syntax, shell instructions, or command injection attempts are strictly prohibited on this public portal. Your request has been blocked by PNP Cyber Security filters.'
      };
    }
  }

  // 4. Code Injection, Scripting & XSS Exploits
  const codeInjectionPatterns = [
    /<\s*script\b[^>]*>/i,
    /<\s*\/\s*script\s*>/i,
    /javascript\s*:/i,
    /vbscript\s*:/i,
    /data\s*:\s*text\/html/i,
    /<\s*iframe\b[^>]*>/i,
    /<\s*object\b[^>]*>/i,
    /<\s*embed\b[^>]*>/i,
    /\bon(error|load|click|mouseover|submit|focus|blur|keydown|keyup)\s*=/i,
    /\b(eval|exec|execSync|Function|setTimeout|setInterval)\s*\(/i,
    /\b(document\.cookie|window\.location|document\.location|localStorage|sessionStorage)\b/i,
    /\b(console\.log|alert\(|prompt\(|confirm\()\b/i,
    /<\?php|{{.+}}|{\%.+\%}/i
  ];

  for (const rx of codeInjectionPatterns) {
    if (rx.test(text)) {
      return {
        blocked: true,
        category: 'code_injection',
        reason: 'Scripting, XSS or code injection syntax detected',
        clientMessage: isFilipino
          ? '⚠️ **BABALA SA SEGURIDAD NG PNP:**\n\nMay natukoy na code o script injection sa iyong mensahe. Hindi pinahihintulutan ang pagpapatakbo ng script o code sa public chat interface na ito.'
          : '⚠️ **PNP STA. CRUZ CYBER SECURITY NOTICE:**\n\nAccess Denied. Code injection, scripting, or unauthorized executable payloads are strictly blocked on this interface.'
      };
    }
  }

  // 5. Database SQL Injection Syntax
  const sqlInjectionPatterns = [
    /\b(union(\s+all)?\s+select|select\s+.*?\s+from\s+[a-z0-9_]+|insert\s+into\s+[a-z0-9_]+|delete\s+from\s+[a-z0-9_]+|drop\s+table|alter\s+table|truncate\s+table)\b/i,
    /['"]\s*(or|and)\s+['"]?[0-9a-z]+['"]?\s*=\s*['"]?[0-9a-z]+['"]?/i,
    /['"]\s*;\s*--(.*)?$/m,
    /\bwaitfor\s+delay\s+['"][0-9:]+['"]/i,
    /\bbenchmark\s*\(\s*[0-9]+,/i
  ];

  for (const rx of sqlInjectionPatterns) {
    if (rx.test(text)) {
      return {
        blocked: true,
        category: 'database_probe',
        reason: 'SQL injection or database manipulation syntax detected',
        clientMessage: isFilipino
          ? '⚠️ **BABALA SA SEGURIDAD NG PNP:**\n\nMay natukoy na database query o injection syntax. Hindi pinahihintulutan ang pagsasagawa ng database queries sa pamamagitan ng public FAQ assistant.'
          : '⚠️ **PNP STA. CRUZ CYBER SECURITY NOTICE:**\n\nAccess Denied. Database query manipulation or SQL injection patterns are strictly blocked by station cyber security.'
      };
    }
  }

  // 6. AI Prompt Injection & Jailbreaking Attempts
  const jailbreakPatterns = [
    /\b(ignore\s+(all\s+)?(previous|prior)\s+instructions|disregard\s+(all\s+)?(previous|prior)\s+instructions)\b/i,
    /\b(you\s+are\s+now\s+(dan|an\s+unrestricted|in\s+developer\s+mode|jailbroken))\b/i,
    /\b(reveal\s+(your\s+)?(system\s+prompt|developer\s+instructions|initial\s+prompt))\b/i,
    /\b(bypass\s+(all\s+)?(guardrails|safety\s+filters?|rules))\b/i,
    /\b(act\s+as\s+a\s+hacker|act\s+as\s+system\s+administrator\s+and\s+execute)\b/i
  ];

  for (const rx of jailbreakPatterns) {
    if (rx.test(lower)) {
      return {
        blocked: true,
        category: 'jailbreak_attempt',
        reason: 'AI prompt injection or guardrail bypass attempt detected',
        clientMessage: isFilipino
          ? '⚠️ **BABALA SA SEGURIDAD NG PNP:**\n\nAng assistant na ito ay pinoprotektahan ng opisyal na PNP guardrails. Hindi pinahihintulutan ang mga pagtatangkang i-bypass ang mga patakaran ng system.'
          : '⚠️ **PNP STA. CRUZ CYBER SECURITY NOTICE:**\n\nAccess Denied. Prompt injection, jailbreak attempts, or instructions attempting to override police security protocols are strictly forbidden.'
      };
    }
  }

  return { blocked: false };
}

export const FAQ_KNOWLEDGEBASE = INITIAL_FAQS;

export const chatFaq = async (req: Request, res: Response) => {
  try {
    const { question, userMessage, chatHistory, language } = req.body;
    const query = String(question || userMessage || '').trim();
    const isFilipino = language === 'fil';

    if (!query) {
      return res.status(400).json({ error: 'Question parameter is required' });
    }

    // 0. High-Priority Cyber Security & Access Control Check
    const secCheck = validatePublicInputSecurity(query, isFilipino);
    if (secCheck.blocked) {
      console.warn(`[SECURITY BLOCKED] FAQ chat violation from ${req.ip || 'unknown'} [${secCheck.category}]: "${String(query).slice(0, 80)}"`);
      return res.json({
        success: false,
        inScope: false,
        securityBlocked: true,
        category: secCheck.category,
        reply: secCheck.clientMessage,
        nearQuestions: isFilipino ? [
          "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
          "Paano kumuha ng National Police Clearance (NPCS)?",
          "Paano mag-file ng opisyal na Police Blotter report?",
          "Saan matatagpuan ang estasyon ng pulisya sa Sta. Cruz?"
        ] : [
          "What are the official emergency hotlines for Santa Cruz, Laguna?",
          "How do I apply for a National Police Clearance (NPCS)?",
          "How do I file an official Police Blotter report?",
          "Where is the PNP Santa Cruz Municipal Police Station located?"
        ]
      });
    }

    const qLower = query.toLowerCase();

    // 1. Strict Out-of-Scope Detection
    const explicitOutOfScope = [
      /\b(recipe|cook|cooking|baking|bake|lutong|ulam|cake|pizza|adobo|sinigang)\b/i,
      /\b(capital\s+of|president\s+of|weather|climate|panahon|ulan|bagyo|forecast)\b/i,
      /\b(coding|programming|javascript|python|typescript|html|css|php|react|sql\s+query|debug\s+code)\b/i,
      /\b(nba|football|soccer|basketball|championship|celebrity|movie|actor|actress|taylor\s+swift|bts|kpop)\b/i,
      /\b(horoscope|zodiac|fortune|crypto|bitcoin|ethereum|forex\s+trading|lottery|lotto)\b/i,
      /\b(joke|story|poem|song\s+lyrics|sing\s+a\s+song|kantahan\s+mo\s+ako|tula|kwento)\b/i,
      /\b(math|homework|algebra|calculus|translate\s+this|who\s+made\s+you)\b/i
    ];

    const isExplicitOutOfScope = explicitOutOfScope.some(regex => regex.test(qLower));

    // Common stop words to ignore during word-level matching
    const STOP_WORDS = new Set([
      'the', 'and', 'for', 'are', 'you', 'can', 'how', 'what', 'who', 'why', 'when', 'where',
      'with', 'from', 'that', 'this', 'does', 'have', 'your', 'about', 'some', 'there',
      'ang', 'mga', 'ano', 'may', 'para', 'saan', 'kailan', 'bakit', 'paano', 'sino',
      'iyon', 'iyan', 'nito', 'nila', 'kung', 'nang', 'alam', 'gusto', 'nais', 'ba', 'po',
      'inyo', 'ating', 'isang', 'lahat', 'ibang', 'dito', 'doon'
    ]);

    // Calculate relevance score against FAQ items (dynamically fetched from DB / service)
    const allFaqs = await getFaqs();
    const scoredFaqs = allFaqs.map(faq => {
      let score = 0;
      let keywordMatched = false;
      const titleLower = (faq.title || '').toLowerCase();
      const titleFilLower = (faq.titleFil || '').toLowerCase();
      
      if (titleLower.includes(qLower) || titleFilLower.includes(qLower)) {
        score += 20;
        keywordMatched = true;
      }
      
      (faq.keywords || []).forEach(kw => {
        const kwLower = kw.toLowerCase();
        if (kwLower.length > 2 && qLower.includes(kwLower)) {
          score += 8;
          keywordMatched = true;
        }
      });

      const words = qLower
        .replace(/[^a-z0-9\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w));

      words.forEach(w => {
        const rx = new RegExp(`\\b${w}\\b`, 'i');
        if (rx.test(titleLower) || rx.test(titleFilLower)) score += 3;
        if (rx.test(faq.summaryEn || "") || rx.test(faq.summaryFil || "")) score += 1;
      });

      return { faq, score, keywordMatched };
    }).sort((a, b) => b.score - a.score);

    const bestMatch = scoredFaqs[0];
    const isInScope = !isExplicitOutOfScope && (bestMatch && (bestMatch.keywordMatched || bestMatch.score >= 8));

    if (!isInScope) {
      const outOfScopeMsg = isFilipino
        ? "Hindi ko masasagot ang katanungang iyan. Masasagot ko lamang ang mga katanungan na sakop ng opisyal na PNP Sta. Cruz FAQs at mga serbisyo ng ating estasyon ng pulisya."
        : "I cannot answer that question. I am programmed to only answer questions within the scope of the official PNP Sta. Cruz FAQs and public safety guidelines.";

      const suggestedQuestions = isFilipino
        ? [
            "Paano mag-ulat ng agarang emergency o krimen sa Santa Cruz?",
            "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
            "Paano kumuha ng National Police Clearance (NPCS)?",
            "Paano mag-file ng opisyal na Police Blotter report?"
          ]
        : [
            "How do I report an ongoing emergency or crime in progress in Santa Cruz?",
            "What are the official emergency hotlines for Santa Cruz, Laguna?",
            "How do I apply for a National Police Clearance (NPCS)?",
            "How do I file an official Police Blotter report?"
          ];

      return res.json({
        success: true,
        inScope: false,
        reply: outOfScopeMsg,
        nearQuestions: suggestedQuestions
      });
    }

    // In-scope answer synthesis
    const matchedFaq = bestMatch.faq;
    let answer = isFilipino ? matchedFaq.summaryFil : matchedFaq.summaryEn;
    const nearQuestions = isFilipino ? matchedFaq.nearQuestionsFil : matchedFaq.nearQuestionsEn;

    if (matchedFaq.id === 20) {
      try {
        const stats = await getDatabaseStats();
        if (stats.topBarangays.length > 0) {
          const topList = stats.topBarangays.slice(0, 5).map((b, i) => `• **${i + 1}. Brgy. ${b.name}:** **${b.count}** case(s)`).join('\n');
          answer = isFilipino
            ? `**Mga Barangay na May Pinakamaraming Naitalang Kaso sa Sta. Cruz:**\n\nBatay sa opisyal na talaan ng PNP Sta. Cruz:\n\n${topList}\n\n• **Kabuuang Naitalang Kaso:** **${stats.totalIncidents}** insidente sa 26 na barangay.\n• **MIMPAS Crime Map:** Bisitahin ang **Crime Map** (/map) upang makita ang spatial heatmap at ma-filter ang bawat barangay.\n• **Hotlines:** Tumawag sa **(049) 501-5971** o mag-dial ng **911**.`
            : `**Barangays with the Highest Number of Reported Cases in Sta. Cruz:**\n\nBased on official PNP Sta. Cruz crime records:\n\n${topList}\n\n• **Total Logged Incidents:** **${stats.totalIncidents}** case(s) across all 26 barangays.\n• **Interactive Crime Map:** Visit the **Crime Map** (/map) to view full heatmap density and filter by barangay.\n• **Hotlines:** For emergencies or inquiries, call **(049) 501-5971** or dial **911**.`;
        }
      } catch (_) {}
    }

    return res.json({
      success: true,
      inScope: true,
      faqId: matchedFaq.id,
      topic: isFilipino ? (matchedFaq.titleFil || matchedFaq.title) : matchedFaq.title,
      reply: answer,
      nearQuestions
    });
  } catch (err: any) {
    console.error('FAQ Chatbot error:', err);
    return res.status(500).json({ error: err.message || 'Error processing FAQ question' });
  }
};
