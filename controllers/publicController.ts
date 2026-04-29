import { Request, Response } from 'express';
import { db } from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

export const getHome = async (req: Request, res: Response) => {
  try {
    const hotlinesSnap = await db.collection('hotlines').limit(5).get();
    const hotlines = hotlinesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const activeBulletinsSnap = await db.collection('bulletins')
      .where('is_archived', '==', false)
      .count().get();
    
    const tipsReceivedSnap = await db.collection('anonymous_tips')
      .count().get();

    const stats = {
      activeBulletins: activeBulletinsSnap.data().count,
      tipsReceived: tipsReceivedSnap.data().count
    };

    res.render('public/home', { title: 'Home', hotlines, stats });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading home page');
  }
};

export const getMap = (req: Request, res: Response) => {
  res.render('public/map', { title: 'Crime Map' });
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
    if (range === '7days') dateLimit = new Date(now.setDate(now.getDate() - 7));
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

export const getBulletins = async (req: Request, res: Response) => {
  const { category, search, page = 1 } = req.query;
  const limit = 10;
  // For simplicity, we'll just fetch with limit.
  
  try {
    let query: any = db.collection('bulletins').where('is_archived', '==', false);

    if (category && category !== 'All') {
      query = query.where('category', '==', category);
    }

    // We'll fetch and filter in memory if search is present.
    // Given the small scale, we'll fetch and filter.
    
    const snap = await query.orderBy('created_at', 'desc').get();
    let bulletins = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    if (search) {
      const s = String(search).toLowerCase();
      bulletins = bulletins.filter((b: any) => 
        b.title.toLowerCase().includes(s) || b.body.toLowerCase().includes(s)
      );
    }

    // Manual pagination
    const total = bulletins.length;
    const offset = (Number(page) - 1) * limit;
    bulletins = bulletins.slice(offset, offset + limit);

    res.render('public/bulletins', { title: 'Bulletins', bulletins, category, search, page: Number(page) });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletins');
  }
};

export const getBulletinDetail = async (req: Request, res: Response) => {
  try {
    const doc = await db.collection('bulletins').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Bulletin not found');
    const bulletin = { id: doc.id, ...doc.data() };
    res.render('public/bulletin_detail', { title: bulletin.title, bulletin });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletin detail');
  }
};

export const getTip = (req: Request, res: Response) => {
  res.render('public/tip', { title: 'Submit Anonymous Tip' });
};

export const postTip = async (req: Request, res: Response) => {
  const { concern_type, location_text, description } = req.body;
  const tip_id = `TIP-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  
  try {
    await db.runTransaction(async (transaction) => {
      const tipRef = db.collection('anonymous_tips').doc();
      transaction.set(tipRef, {
        tip_id,
        concern_type,
        location_text,
        description,
        created_at: new Date().toISOString()
      });

      const notifRef = db.collection('admin_notifications').doc();
      transaction.set(notifRef, {
        type: 'TIP',
        message: `New Anonymous Tip received: ${concern_type}`,
        reference_id: tip_id,
        is_read: false,
        created_at: new Date().toISOString()
      });
    });
    res.render('public/tip_success', { title: 'Success', tip_id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error submitting tip');
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
