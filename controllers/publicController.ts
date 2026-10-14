import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { db } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { decodeCustomCategory } from './adminController.js';
import { memoryCache } from '../utils/cache.js';
import { VALID_BARANGAYS } from '../constants/tactical_assets.js';

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
  return memoryCache.getOrSet('personnel:active', async () => {
    const usersSnap = await db.collection('users').get();
    return usersSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .filter((u: any) => u.status === 'active');
  }, 5 * 60 * 1000);
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

    // Filter out mock data for public advisory, restrict to target categories, and exclude Facebook URL posts
    const allowedAdvisoryCategories = ['Crime Advisory', 'Traffic Advisory', 'Cybercrime Advisory', 'Community Awareness'];
    const filteredBulletins = bulletins.filter((b: any) => !b.id.startsWith('bulletin-') && allowedAdvisoryCategories.includes(b.category) && !b.facebook_url);

    // Map "General Announcement" bulletins and Facebook URL posts to policeNewsList for news releases
    const policeNewsList = bulletins
      .filter((b: any) => (b.category === 'General Announcement' || b.facebook_url) && !b.id.startsWith('bulletin-'))
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
    const dbBulletins = rawBulletins.filter((b: any) => b.is_archived !== true && (b.category === 'General Announcement' || b.facebook_url) && !b.id.startsWith('bulletin-'));

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
      .filter((b: any) => !b.id.startsWith('bulletin-') && allowedAdvisoryCategories.includes(b.category) && !b.facebook_url);

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

const getDatabaseSummaryCached = async (): Promise<string> => {
  const cacheKey = 'ai:db_summary';
  const cached = await memoryCache.get<string>(cacheKey);
  if (cached) return cached;

  // If Supabase is not configured, return standard station context immediately
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    const defaultSummary = `
=== READ-ONLY DATABASE CONTEXT (Sta. Cruz Municipal Police Station) ===
• Total Logged Crime/Incident Cases: Active database records
• Active Station Personnel: Authorized PNP Sta. Cruz officers
• Covered Jurisdictions: All 26 Barangays of Santa Cruz, Laguna

[Emergency Hotlines]
• Station Desk Hotlines: (049) 501-5971 / 0928-465-3828 / 0998-598-5667
• National Emergency Hotline: 911
• BFP Sta. Cruz Fire Station: +63 967 052 8897
• Red Cross Emergency: +63 2 8790 2300
`.trim();
    await memoryCache.set(cacheKey, defaultSummary, 3 * 60 * 1000);
    return defaultSummary;
  }

  try {
    // 2.5 second timeout safeguard so AI response never hangs
    const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('DB Query Timeout')), 2500));
    const queryPromise = (async () => {
      const mapSnap = await db.collection('map_points').get();
      const mapPoints = mapSnap.docs.map((d: any) => d.data());

      const totalIncidents = mapPoints.length;
      const byType: Record<string, number> = {};
      const byBarangay: Record<string, number> = {};

      mapPoints.forEach((p: any) => {
        const type = (p.incident_type || 'Unspecified').trim();
        const brgy = (p.barangay || 'Unspecified').trim();
        byType[type] = (byType[type] || 0) + 1;
        byBarangay[brgy] = (byBarangay[brgy] || 0) + 1;
      });

      const topTypes = Object.entries(byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `• ${type}: ${count} reported case(s)`)
        .join('\n');

      const topBarangays = Object.entries(byBarangay)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([brgy, count]) => `• ${brgy}: ${count} case(s)`)
        .join('\n');

      const bulletins = await getRawBulletinsCached();
      const activeBulletins = bulletins.filter((b: any) => !b.is_archived);
      const bulletinList = activeBulletins.slice(0, 5).map((b: any) => `• [${b.category}] ${b.title}`).join('\n');

      const hotlines = await getHotlinesCached();
      const hotlineList = hotlines.map((h: any) => `• ${h.name || h.title || 'Emergency'}: ${h.number || h.phone || h.contact || 'N/A'}`).join('\n');

      const personnel = await getPersonnelCached();
      const personnelCount = personnel.length;

      return `
=== READ-ONLY DATABASE CONTEXT (Sta. Cruz Municipal Police Station) ===
• Total Logged Crime/Incident Cases: ${totalIncidents}
• Active Station Personnel: ${personnelCount}
• Active Bulletins/Advisories: ${activeBulletins.length}

[Case Statistics by Category]
${topTypes || '• No cases recorded'}

[Top Incident Locations by Barangay]
${topBarangays || '• No cases recorded'}

[Active Bulletins & Announcements]
${bulletinList || '• No active bulletins'}

[Emergency Hotlines]
${hotlineList || '• Station Desk: (049) 501-5971 / 0998-598-5667 / 911'}
`.trim();
    })();

    const summary = (await Promise.race([queryPromise, timeoutPromise])) as string;
    await memoryCache.set(cacheKey, summary, 3 * 60 * 1000);
    return summary;
  } catch (err) {
    console.warn('Database summary unavailable or timed out, using fallback station context:', err);
    return `
=== READ-ONLY DATABASE CONTEXT (Sta. Cruz Municipal Police Station) ===
• Covered Jurisdiction: Santa Cruz, Laguna (26 Barangays)
• Status: Active 24/7 Mobile & Checkpoint Patrols
[Emergency Hotlines]
• Station Desk: (049) 501-5971 / 0928-465-3828 / 0998-598-5667
• National Emergency: 911
• Fire Station: +63 967 052 8897
`.trim();
  }
};

function generateIntelligentArticleResponse(articleTitle: string, articleContent: string, userMessage: string, dbContext: string): string {
  const q = userMessage.toLowerCase().trim();

  // 1. Check for out-of-scope queries
  const outOfScopePatterns = [
    /\b(recipe|cook|baking|capital of|coding|javascript|python|sports|football|basketball|nba|celebrity|movie|singer|horoscope|crypto|bitcoin)\b/i
  ];
  if (outOfScopePatterns.some(p => p.test(q)) && !q.includes('police') && !q.includes('crime') && !q.includes('safety') && !q.includes('sta. cruz')) {
    return `I am programmed to answer questions that are related only to this article ("${articleTitle}") and official Sta. Cruz public safety information. Please ask a question related to this bulletin or station public safety.`;
  }

  // 2. Emergency hotlines & contact numbers
  if (/\b(hotline|contact|phone|call|number|tawag|telepono|emergency|dial|numero)\b/i.test(q)) {
    return `**Official Sta. Cruz Police & Emergency Hotlines:**\n\n• **Sta. Cruz MPS Station Desk:** (049) 501-5971 / 0928-465-3828 / 0998-598-5667\n• **National Emergency Hotline:** 911\n• **BFP Sta. Cruz Fire Station:** +63 967 052 8897\n• **Philippine Red Cross (Laguna):** +63 2 8790 2300\n• **Station Headquarters Address:** 1153 A. Mabini St., Poblacion, Sta. Cruz, Laguna\n\nFor urgent crimes in progress or life-threatening situations, dial **911** or call the station hotline immediately.`;
  }

  // 3. Summary / Overview / What is this about
  if (/\b(summary|summarize|overview|about|ano ito|tungkol saan|buod|brief|explain|tungkol)\b/i.test(q)) {
    const cleanContent = (articleContent || '').replace(/\r?\n+/g, ' ').trim();
    const sentences = cleanContent.match(/[^.!?]+[.!?]+/g) || [cleanContent];
    const keyPoints = sentences.slice(0, 3).map(s => `• ${s.trim()}`).join('\n');

    return `**Summary of "${articleTitle}":**\n\n${keyPoints || '• Official advisory released by the Sta. Cruz Municipal Police Station.'}\n\n• **Issuing Agency:** Sta. Cruz Municipal Police Station\n• **Official Advice:** Please stay vigilant and refer to official station announcements for updates. If you observe any relevant activity or concern, contact the station desk at **0998 598 5667** or dial **911**.`;
  }

  // 4. Location / Where / Barangay
  if (/\b(where|location|saan|barangay|place|street|lugar|area)\b/i.test(q)) {
    const mentionedBrgy = VALID_BARANGAYS.filter(b => (articleContent || '').toLowerCase().includes(b.toLowerCase()) || (articleTitle || '').toLowerCase().includes(b.toLowerCase()));
    const locText = mentionedBrgy.length > 0 
      ? mentionedBrgy.map(b => `• **Brgy. ${b}**`).join('\n') 
      : `• Sta. Cruz municipality jurisdiction (Poblacion and surrounding sectors)`;

    return `**Location Information:**\n\n${locText}\n• **Lead Police Station:** Sta. Cruz Municipal Police Station (Main HQ: 1153 A. Mabini St., Poblacion)\n• **Active Police Patrols:** Station mobile units and sector checkpoints operate 24/7 across all 26 barangays of Sta. Cruz, Laguna.`;
  }

  // 5. Date / Time / When / Schedule
  if (/\b(when|date|kailan|time|oras|petsa|schedule|kailan nangyari)\b/i.test(q)) {
    const dateMatch = (articleContent || '').match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/i) ||
                      (articleContent || '').match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/);
    const dateInfo = dateMatch ? `• **Identified Date in Advisory:** **${dateMatch[0]}**` : `• Please refer to the advisory posting date on this portal for active schedule and operational validity.`;

    return `**Date & Schedule Details:**\n\n${dateInfo}\n• **Advisory Topic:** ${articleTitle}\n• For questions regarding active advisories or traffic rerouting, the station desk is reachable 24/7 at **(049) 501-5971**.`;
  }

  // 6. Safety Tips / Advice / What to do / Paano mag-ingat
  if (/\b(tips|tip|advice|paano|gawin|precaution|safety|ingat|iwasan|protect)\b/i.test(q)) {
    return `**Public Safety Advisory Guidelines:**\n\n• **Stay Alert & Vigilant:** Report any suspicious individuals, unattended items, or unusual activities in your neighborhood immediately.\n• **Preserve Evidence / Records:** For online transactions or cybercrime concerns, keep screenshots, transaction IDs, and sender details.\n• **Cooperate with Law Enforcement:** Follow directives from PNP patrol units, traffic marshals, and local barangay tanods.\n• **Emergency Verification:** Verify official advisories directly on this PNP Sta. Cruz portal before forwarding notices to others.\n• **Emergency Dial:** Call **911** or **0998 598 5667** for immediate police assistance.`;
  }

  // 7. Statistics / Crime stats
  if (/\b(stat|stats|statistics|crime rate|bilang|ilan|cases|datos|data)\b/i.test(q)) {
    return `**Sta. Cruz Municipal Police Station Statistics Overview:**\n\n${dbContext}\n\n• *For in-depth crime mapping and spatial analytics, you can also view the interactive Crime Map on the main navigation.*`;
  }

  // 8. General question matching content
  const cleanContent = (articleContent || '').replace(/\r?\n+/g, ' ').trim();
  const sentences = cleanContent.match(/[^.!?]+[.!?]+/g) || [cleanContent];
  const words = q.split(/\s+/).filter(w => w.length > 3);
  const matchingSentences = sentences.filter(s => {
    const lowerS = s.toLowerCase();
    return words.some(w => lowerS.includes(w));
  });

  if (matchingSentences.length > 0) {
    const points = matchingSentences.slice(0, 3).map(s => `• ${s.trim()}`).join('\n');
    return `**Regarding "${articleTitle}":**\n\n${points}\n\n• **Station Desk Contact:** If you require further clarification or need to file an official report, please call **(049) 501-5971** or visit the station at 1153 A. Mabini St., Poblacion.`;
  }

  // Default informative excerpt
  const fallbackExcerpt = sentences.slice(0, 2).map(s => `• ${s.trim()}`).join('\n');
  return `**Regarding "${articleTitle}":**\n\n${fallbackExcerpt || '• Official announcement from the Sta. Cruz Municipal Police Station.'}\n\n• **Station Inquiries:** You may contact the police desk directly at **0998 598 5667** or call **911** for immediate emergency assistance.`;
}

export const chatWithArticle = async (req: Request, res: Response) => {
  try {
    const { articleTitle, articleContent, userMessage, chatHistory } = req.body;
    if (!articleTitle || !articleContent || !userMessage) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const dbContext = await getDatabaseSummaryCached();

    let historyContext = "";
    if (chatHistory && Array.isArray(chatHistory)) {
      historyContext = chatHistory.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
    }

    const prompt = `You are an official public safety AI assistant for the Sta. Cruz Municipal Police Station.

=== CURRENT ARTICLE / BULLETIN CONTEXT ===
Title: ${articleTitle}
Content: ${articleContent}

${dbContext}

=== STRICT SCOPE & REJECTION RULE ===
1. PRIMARY FOCUS: You are strictly programmed to answer questions related to this specific article ("${articleTitle}") or official Sta. Cruz Municipal Police Station public safety information, case statistics, hotlines, and advisories.
2. OUT-OF-SCOPE REJECTION: If the user asks a question that is NOT related to this article ("${articleTitle}") or PNP Sta. Cruz public safety / station information (for example: capitals of countries, general trivia, personal advice, cooking, sports, pop culture, entertainment, coding, math, or unrelated general knowledge):
   YOU MUST STRICTLY DECLINE to answer the question, and respond ONLY with:
   "I am programmed to answer questions that are related only to this article '${articleTitle}' and official Sta. Cruz public safety information. Please ask a question related to this bulletin or station public safety."
3. DO NOT answer out-of-scope topics under any circumstances.

=== FORMATTING INSTRUCTIONS ===
1. ACCURATE STATISTICAL ANSWERS: When answering in-scope questions about case statistics, incident counts, barangay breakdowns, or hotline numbers, use the READ-ONLY DATABASE CONTEXT above.
2. CLEAN & STRUCTURED FORMATTING:
   - Use bullet points (• or -) or numbered lists (1., 2.) for multiple items or statistics.
   - Use bold text (**like this**) for key numbers, categories, and titles.
   - Add clear line breaks between paragraphs and list items.
   - NEVER clump multiple bullet points or statistics into a single dense block paragraph.

=== CHAT HISTORY ===
${historyContext}

User: ${userMessage}
Assistant:`;

    const openrouterKey = process.env.OPENROUTER_API_KEY;
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
          const reply = data.choices[0].message.content.trim();
          return res.json({ success: true, reply });
        } else {
          console.warn('OpenRouter chatbot returned no choices, falling back to Gemini API:', data);
        }
      } catch (err: any) {
        console.warn('OpenRouter chatbot error, falling back to Gemini API:', err?.message || err);
      }
    }

    const apiKey = process.env.CHAT_GEMINI_KEY || process.env.GEMINI_API_KEY || process.env.PALM_API_KEY;
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
              const reply = response.text.trim();
              return res.json({ success: true, reply });
            }
          } catch (modelErr: any) {
            console.warn(`Gemini chatbot with ${model} failed, trying next:`, modelErr?.message || modelErr);
          }
        }
      } catch (aiErr: any) {
        console.error('Gemini chatbot error:', aiErr?.message || aiErr);
      }
    }

    // Fallback: Intelligent server-side synthesis from article content, station hotlines, and DB context
    const synthesizedReply = generateIntelligentArticleResponse(articleTitle, articleContent, userMessage, dbContext);
    return res.json({ success: true, reply: synthesizedReply, fallback: true });
  } catch (err: any) {
    console.error('Chat with article endpoint error:', err);
    return res.status(500).json({ error: err.message || 'An unexpected error occurred' });
  }
};
