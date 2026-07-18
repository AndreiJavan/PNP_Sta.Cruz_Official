import { Request, Response } from 'express';
import { db } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { decodeCustomCategory } from './adminController.js';

export const getHome = async (req: Request, res: Response) => {
  try {
    const hotlinesSnap = await db.collection('hotlines').limit(5).get();
    const hotlines = hotlinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const activeBulletinsSnap = await db.collection('bulletins')
      .where('is_archived', '!=', true)
      .orderBy('created_at', 'desc')
      .get();
      
    const bulletins = activeBulletinsSnap.docs.map(doc => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    }).filter(b => b.category !== 'Wanted Person' && b.category !== 'Missing Person');

    let newsArticles = [];
    try {
      const newsRes = await fetch('https://newsapi.org/v2/top-headlines?country=ph&pageSize=10&apiKey=6f8c75e4b92c40f58be7987fea7763d1');
      const newsData = await newsRes.json();
      if (newsData.articles) {
        newsArticles = newsData.articles;
      }
    } catch (e) {
      console.error('Error fetching news:', e);
    }

    res.render('public/home', { title: 'Home', hotlines, bulletins, newsArticles });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading home page');
  }
};

export const getMap = (req: Request, res: Response) => {
  res.render('public/map', { title: 'Crime Map', hideFooter: true });
};

export const getMapPoints = async (req: Request, res: Response) => {
  const { type, range, barangay } = req.query;

  let query: any = db.collection('map_points');

  if (type) {
    query = query.where('incident_type', '==', type);
  }

  if (barangay) {
    query = query.where('barangay', '==', barangay);
  }

  if (range) {
    const now = new Date();
    let dateLimit;
    if (range === '1month') dateLimit = new Date(now.setMonth(now.getMonth() - 1));
    else if (range === '2months') dateLimit = new Date(now.setMonth(now.getMonth() - 2));
    else if (range === '3months') dateLimit = new Date(now.setMonth(now.getMonth() - 3));
    else if (range === '7days') dateLimit = new Date(now.setDate(now.getDate() - 7));
    else if (range === '30days') dateLimit = new Date(now.setDate(now.getDate() - 30));
    else if (range === '6months') dateLimit = new Date(now.setMonth(now.getMonth() - 6));

    if (dateLimit) {
      query = query.where('incident_date', '>=', dateLimit.toISOString());
    }
  }

  try {
    const snap = await query.get();
    const points = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    res.json(points);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching map points' });
  }
};

const parsePhotos = (path: string | undefined): string[] => {
  if (!path) return [];
  try {
    const parsed = JSON.parse(path);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {}
  return [path];
};

export const getBulletins = async (req: Request, res: Response) => {
  const { category, search, page = 1 } = req.query;
  const limit = 10;
  try {
    let query: any = db.collection('bulletins').where('is_archived', '!=', true);
    const snap = await query.orderBy('created_at', 'desc').get();
    
    let bulletins = snap.docs.map((doc: any) => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    }).filter((b: any) => b.category !== 'Wanted Person' && b.category !== 'Missing Person');

    if (category && category !== 'All') {
      bulletins = bulletins.filter((b: any) => b.category === category);
    }

    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s));
    }

    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);
    res.render('public/bulletins', { title: 'Bulletins', pageTitle: 'Public Bulletins', bulletins, category, search, page: Number(page) });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Bulletins');
  }
};

export const getWantedPersons = async (req: Request, res: Response) => {
  const { search, page = 1 } = req.query;
  const limit = 10;
  try {
    let query: any = db.collection('bulletins').where('is_archived', '!=', true).where('category', '==', 'Wanted Person');
    const snap = await query.orderBy('created_at', 'desc').get();
    let bulletins = snap.docs.map((doc: any) => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    });
    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s));
    }
    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);
    res.render('public/bulletins', { title: 'Wanted Persons', pageTitle: 'Wanted Persons', bulletins, category: 'Wanted Person', search, page: Number(page) });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Wanted Persons');
  }
};

export const getMissingPersons = async (req: Request, res: Response) => {
  const { search, page = 1 } = req.query;
  const limit = 10;
  try {
    let query: any = db.collection('bulletins').where('is_archived', '!=', true).where('category', '==', 'Missing Person');
    const snap = await query.orderBy('created_at', 'desc').get();
    let bulletins = snap.docs.map((doc: any) => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    });
    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s));
    }
    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);
    res.render('public/bulletins', { title: 'Missing Persons', pageTitle: 'Missing Persons', bulletins, category: 'Missing Person', search, page: Number(page) });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading Missing Persons');
  }
};

export const getBulletinDetail = async (req: Request, res: Response) => {
  try {
    const doc = await db.collection('bulletins').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Bulletin not found');
    const d = doc.data();
    const bulletin = decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    res.render('public/bulletin_detail', { title: bulletin.title, bulletin });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletin detail');
  }
};


export const getAbout = (req: Request, res: Response) => {
  res.render('public/about', { title: 'About' });
};

export const getHotlines = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('hotlines').orderBy('category').get();
    const hotlines = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('public/hotlines', { title: 'Emergency Hotlines', hotlines });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading hotlines');
  }
};
