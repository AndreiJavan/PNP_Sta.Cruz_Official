import { Request, Response } from 'express';
import { db } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { decodeCustomCategory } from './adminController.js';
import { memoryCache } from '../utils/cache.js';

// Cached Data Helpers
const getRawBulletinsCached = async (): Promise<any[]> => {
  const cacheKey = 'bulletins:all';
  const cached = memoryCache.get<any[]>(cacheKey);
  if (cached) return cached;

  const snap = await db.collection('bulletins').orderBy('created_at', 'desc').get();
  const bulletins = snap.docs.map((doc: any) => {
    const d = doc.data();
    return decodeCustomCategory({
      id: doc.id,
      ...d,
      photo_paths: parsePhotos(d.photo_path, d.photo_paths),
      video_paths: parseVideos(d.video_path, d.video_paths)
    });
  });
  memoryCache.set(cacheKey, bulletins, 3 * 60 * 1000); // 3 minutes cache
  return bulletins;
};

const getHotlinesCached = async (): Promise<any[]> => {
  const cacheKey = 'hotlines:all';
  const cached = memoryCache.get<any[]>(cacheKey);
  if (cached) return cached;

  const snap = await db.collection('hotlines').orderBy('category').get();
  const hotlines = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  memoryCache.set(cacheKey, hotlines, 5 * 60 * 1000); // 5 minutes cache
  return hotlines;
};

const getPersonnelCached = async (): Promise<any[]> => {
  const cacheKey = 'personnel:active';
  const cached = memoryCache.get<any[]>(cacheKey);
  if (cached) return cached;

  const usersSnap = await db.collection('users').get();
  const personnel = usersSnap.docs
    .map((doc: any) => ({ id: doc.id, ...doc.data() }))
    .filter((u: any) => u.status === 'active');
  memoryCache.set(cacheKey, personnel, 5 * 60 * 1000);
  return personnel;
};

function getFirstParagraph(text: string): string {
  if (!text) return '';
  const paragraphs = text.split(/\r?\n\r?\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length > 0) return paragraphs[0];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return lines[0] || text;
}

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
          urlToImage: (b.photo_paths && b.photo_paths[0]) || b.photo_path || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=800&auto=format&fit=crop',
          photo_paths: b.photo_paths,
          video_paths: b.video_paths || [],
          facebook_url: b.facebook_url,
          publishedAt: b.created_at || new Date().toISOString(),
          author: b.facebook_url ? b.facebook_url : 'Station Desk'
        };
      });

    // Fetch police incidents (map points) to show on home feed
    const mapPointsCacheKey = 'map_points:all_unfiltered';
    let incidents = memoryCache.get<any[]>(mapPointsCacheKey);
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
      memoryCache.set(mapPointsCacheKey, incidents, 3 * 60 * 1000);
    }

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

export const getMap = (req: Request, res: Response) => {
  res.render('public/map', { title: 'Crime Map', hideFooter: true, layout: 'layouts/main' });
};

export const getMapPoints = async (req: Request, res: Response) => {
  const { type, range, barangay } = req.query;
  const cacheKey = `map_points:${type || ''}:${range || ''}:${barangay || ''}`;

  const cachedPoints = memoryCache.get<any[]>(cacheKey);
  if (cachedPoints) {
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
    memoryCache.set(cacheKey, points, 3 * 60 * 1000); // 3 minutes cache
    res.json(points);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching map points' });
  }
};

const parsePhotos = (path: string | undefined, existingPaths?: any): string[] => {
  if (Array.isArray(existingPaths) && existingPaths.length > 0) return existingPaths;
  if (!path) return [];
  try {
    const parsed = JSON.parse(path);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return [path];
};

const parseVideos = (path: string | undefined, existingPaths?: any): string[] => {
  if (Array.isArray(existingPaths) && existingPaths.length > 0) return existingPaths;
  if (!path) return [];
  try {
    const parsed = JSON.parse(path);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return [path];
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
    let bulletin = memoryCache.get<any>(cacheKey);
    if (!bulletin) {
      const doc = await db.collection('bulletins').doc(req.params.id).get();
      if (!doc.exists) return res.status(404).send('Bulletin not found');
      const d = doc.data();
      bulletin = decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path, d.photo_paths), video_paths: parseVideos(d.video_path, d.video_paths) });
      memoryCache.set(cacheKey, bulletin, 5 * 60 * 1000);
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

export const translateToTagalog = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text parameter required' });
    }

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const prompt = `You are an official Filipino translator for Sta. Cruz Municipal Police Station. Translate the following report/bulletin into clear, natural, official Tagalog (Filipino) so it can be spoken out loud via text-to-speech for public accessibility. Return ONLY the translated Tagalog text, with no explanations, notes, or extra formatting:\n\n${text.substring(0, 3000)}`;

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
            model: "google/gemini-2.5-flash",
            max_tokens: 1000,
            messages: [{ role: "user", content: prompt }]
          })
        });
        const data = await response.json() as any;
        if (data.choices && data.choices[0] && data.choices[0].message) {
          const tagalogText = data.choices[0].message.content.trim();
          return res.json({ success: true, tagalogText });
        } else {
          console.warn('OpenRouter translation returned no choices, falling back to Gemini API:', data);
        }
      } catch (err: any) {
        console.warn('OpenRouter translation error, falling back to Gemini API:', err?.message || err);
      }
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.PALM_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt
        });

        const tagalogText = response.text ? response.text.trim() : text;
        return res.json({ success: true, tagalogText });
      } catch (aiErr: any) {
        console.warn('Gemini translation error, falling back to original text:', aiErr?.message || aiErr);
      }
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

export const chatWithArticle = async (req: Request, res: Response) => {
  try {
    const { articleTitle, articleContent, userMessage, chatHistory } = req.body;
    if (!articleTitle || !articleContent || !userMessage) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    let historyContext = "";
    if (chatHistory && Array.isArray(chatHistory)) {
      historyContext = chatHistory.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
    }

    const prompt = `You are a helpful public safety AI assistant for the Sta. Cruz Municipal Police Station. Your job is to answer questions about the article/bulletin provided below.

=== ARTICLE DETAILS ===
Title: ${articleTitle}
Content: ${articleContent}

=== CONSTRAINTS ===
1. You must answer questions related ONLY to this specific article.
2. If the user asks something outside the article's scope, content, or context (e.g. general knowledge, unrelated topics, personal questions, or other incidents), you must politely decline and state that you are only programmed to discuss this specific article.
3. Keep your answers clear, concise, and helpful.

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
            model: "google/gemini-2.5-flash",
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

    const apiKey = process.env.CHAT_GEMINI_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: prompt
        });

        const reply = response.text ? response.text.trim() : "I'm sorry, I couldn't generate a response.";
        return res.json({ success: true, reply });
      } catch (aiErr: any) {
        console.error('Gemini chatbot error:', aiErr?.message || aiErr);
      }
    }

    return res.status(500).json({ error: 'AI services are currently unavailable.' });
  } catch (err: any) {
    console.error('Chat with article endpoint error:', err);
    return res.status(500).json({ error: err.message || 'An unexpected error occurred' });
  }
};
