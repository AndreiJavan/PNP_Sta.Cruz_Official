import { Request, Response } from 'express';
import { db } from '../config/database.js';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { VALID_BARANGAYS, MANUAL_PINS } from '../constants/tactical_assets.js';
import { extractTacticalData } from '../services/aiService.js';
import { logAction } from '../services/auditService.js';
import { createRequire } from 'module';



export const getLogin = (req: Request, res: Response) => {
  if (req.session.user) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Admin Login', layout: false });
};

export const postLogin = async (req: Request, res: Response) => {
  const { username, password } = req.body;
  console.log(`[LOGIN ATTEMPT] Username: ${username}`);

  if (!req.session) {
    console.error('[LOGIN ERROR] No session object found');
    return res.status(500).send('Session error: No session object found');
  }

  try {
    // 1. Database Lookup
    const snap = await db.collection('users').where('username', '==', username).limit(1).get();

    if (snap.empty) {
      console.warn(`[LOGIN FAILED] User not found in DB: ${username}`);
      return res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Invalid username or password' });
    }

    const user = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
    console.log(`[LOGIN DATA] User found in DB: ${user.username}, Role: ${user.role}`);

    // 2. Password Verification
    const isPasswordCorrect = bcrypt.compareSync(password, user.password_hash);
    console.log(`[LOGIN RESULT] Password check: ${isPasswordCorrect}`);

    if (isPasswordCorrect) {
      req.session.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role
      };
      (req.session as any).hideSidebar = true;

      await logAction(req, 'LOGIN', `Personnel ${user.username} authenticated successfully.`);

      return req.session.save((err) => {
        if (err) {
          console.error('[LOGIN ERROR] Session save failed:', err);
          return res.status(500).send('Error saving session');
        }
        console.log('[LOGIN SUCCESS] Redirecting to dashboard');
        res.redirect('/admin/dashboard');
      });
    } else {
      console.warn(`[LOGIN FAILED] Incorrect password for: ${username}`);
      return res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('[LOGIN FATAL ERROR]:', err);
    res.status(500).send('Error during login');
  }
};

export const getLogout = (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
};

export const processAIExtraction = async (req: Request, res: Response) => {
  try {
    let textContent = '';
    const file = (req as any).file;

    if (file) {
      const buffer = file.buffer;
      const mimetype = file.mimetype;

      if (mimetype.includes('excel') || mimetype.includes('spreadsheet') || mimetype === 'text/csv') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          textContent += `[Sheet: ${sheetName}]\n` + XLSX.utils.sheet_to_csv(sheet) + '\n';
        });
      } else if (mimetype.includes('word') || mimetype === 'application/msword') {
        const result = await mammoth.extractRawText({ buffer });
        textContent = result.value;
      } else {
        return res.status(400).json({ success: false, error: `Unsupported file type (${mimetype}).` });
      }
    } else if (req.body.data) {
      textContent = req.body.data;
    }

    if (!textContent?.trim()) {
      return res.status(400).json({ success: false, error: 'No readable text content found.' });
    }

    const flattened = await extractTacticalData(textContent);
    return res.json({ success: true, data: flattened });
  } catch (err: any) {
    console.error('AI Processing Error:', err);
    return res.status(500).json({ success: false, error: `Neural Unit Error: ${err.message}` });
  }
};

export const saveReportBatch = async (req: Request, res: Response) => {
  const { entries, filename, entryType } = req.body;
  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({ success: false, message: 'Invalid entries' });
  }

  try {
    const categoryStats: any = { '8-Focus': 0, 'PSI': 0, 'Non-Index': 0, entry_type: entryType || 'scanned' };
    const batch = db.batch();

    // Create reference for scan report first to link individual points
    const reportRef = db.collection('intelligence_scans').doc();
    const reportId = reportRef.id;

    // 1. Pre-calculate points and stats
    const pointsToCreate = entries.map(entry => {
      const pin = MANUAL_PINS.find(p => p.name === entry.barangay);
      const cat = entry.category || 'Non-Index';
      categoryStats[cat] = (categoryStats[cat] || 0) + 1;

      return {
        ref: db.collection('map_points').doc(),
        data: {
          lat: pin ? pin.lat : 0, lng: pin ? pin.lng : 0,
          incident_type: entry.incident_type || entry.offense,
          incident_date: entry.incident_date || entry.date || entry.date_committed,
          barangay: entry.barangay,
          description: entry.description || 'Intel extracted',
          category: cat,
          report_id: reportId,
          created_at: new Date().toISOString()
        }
      };
    });

    const reportData = {
      admin_id: req.session.user.id, admin_name: req.session.user.full_name,
      timestamp: new Date().toISOString(), total_records: entries.length,
      category_stats: categoryStats, raw_data: entries,
      filename: filename || 'Neural Scan Buffer'
    };

    // 2. Add Parent to batch FIRST
    batch.set(reportRef, reportData);

    // 3. Add Children to batch
    for (const point of pointsToCreate) {
      batch.set(point.ref, point.data);
    }

    await batch.commit();
    await logAction(req, 'REPORT_SAVE', `Saved intelligence report batch: ${filename || 'Neural Scan Buffer'} (${entries.length} records)`);
    res.json({ success: true, count: entries.length, report: { id: reportId, ...reportData } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error during save' });
  }
};

export const getAuditLogs = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('audit_logs').orderBy('timestamp', 'desc').limit(100).get();
    const logs = snap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        admin_name: data.username || data.admin_id || 'System',
        action: data.action,
        details: data.details,
        timestamp: data.timestamp
      };
    });
    res.render('admin/audit_log', { title: 'System Audit Logs', logs, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading audit logs');
  }
};

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];

    const [
      allMapPointsSnap,
      anonymousTipsSnap,
      totalTipsSnap,
      notificationsSnap,
      totalBulletinsSnap,
      allReportsSnap
    ] = await Promise.all([
      db.collection('map_points').where('incident_date', '>=', oneYearAgoStr).get(),
      db.collection('anonymous_tips').orderBy('created_at', 'desc').limit(10).get(),
      db.collection('anonymous_tips').count().get(),
      db.collection('admin_notifications').where('is_read', '==', false).orderBy('created_at', 'desc').limit(5).get(),
      db.collection('bulletins').count().get(),
      db.collection('intelligence_scans').get()
    ]);

    const allPoints = allMapPointsSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .filter((p: any) => {
        const dateStr = String(p.incident_date || '');
        const isPlaceholder = dateStr === 'N/A' ||
          dateStr === '' ||
          dateStr === '2026-04-27T09:22:14.910Z' ||
          p.description === 'Strategic placeholder data';
        return !isPlaceholder;
      });

    const filteredReports = allReportsSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const totalTipsCount = totalTipsSnap.data().count;
    const totalBulletinsCount = totalBulletinsSnap.data().count;
    const totalReportsCount = filteredReports.length;
    const notifications = notificationsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    // Time-based calculations - Reference date is latest of (Now, Latest Record)
    let referenceDate = new Date();
    if (allPoints.length > 0) {
      // Improved date parsing: handle ISO strings and standard date strings
      const dates = allPoints.map((p: any) => {
        const d = new Date(p.incident_date);
        return isNaN(d.getTime()) ? 0 : d.getTime();
      }).filter((t: number) => t > 0);

      if (dates.length > 0) {
        const maxDate = new Date(Math.max(...dates));
        // If maxDate is significantly in the future or past, we still want to anchor to Now if it's the current year
        if (maxDate > referenceDate) referenceDate = maxDate;
      }
    }

    const todayStr = referenceDate.toISOString().split('T')[0];
    const yesterday = new Date(referenceDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Today's stats
    const todayPoints = allPoints.filter((p: any) => p.incident_date && typeof p.incident_date === 'string' && p.incident_date.startsWith(todayStr));
    const yesterdayPoints = allPoints.filter((p: any) => p.incident_date && typeof p.incident_date === 'string' && p.incident_date.startsWith(yesterdayStr));

    const todayStats = {
      total: todayPoints.length,
      focus: allPoints.filter((p: any) => p.category === '8-Focus').length,
      nonIndex: allPoints.filter((p: any) => p.category === 'Non-Index').length,
      psi: allPoints.filter((p: any) => p.category === 'PSI').length,
      comparison: 0,
      totalTips: totalTipsCount,
      totalBulletins: totalBulletinsCount,
      totalReports: totalReportsCount
    };

    if (yesterdayPoints.length > 0) {
      todayStats.comparison = Math.round(((todayPoints.length - yesterdayPoints.length) / yesterdayPoints.length) * 100);
    } else if (todayPoints.length > 0) {
      todayStats.comparison = 100;
    }

    // High Risk Barangays
    const brgyMap: { [key: string]: number } = {};
    allPoints.forEach((p: any) => {
      if (p.barangay) brgyMap[p.barangay] = (brgyMap[p.barangay] || 0) + 1;
    });

    const highRiskBarangays = Object.entries(brgyMap)
      .map(([name, count]) => {
        let risk: 'Low' | 'Medium' | 'High' = 'Low';
        if (count > 15) risk = 'High';
        else if (count > 5) risk = 'Medium';
        return { name, count, risk };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Monthly Trends (Last 12 Months from Reference)
    const monthlyTrends: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
      const monthLabel = d.toLocaleString('en-US', { month: 'short' });
      const month = d.getMonth();
      const year = d.getFullYear();

      const mPoints = allPoints.filter((p: any) => {
        if (!p.incident_date) return false;
        const pd = new Date(p.incident_date);
        return pd.getMonth() === month && pd.getFullYear() === year;
      });

      monthlyTrends.push({
        month: monthLabel,
        focus: mPoints.filter((p: any) => p.category === '8-Focus').length,
        nonIndex: mPoints.filter((p: any) => p.category === 'Non-Index').length,
        psi: mPoints.filter((p: any) => p.category === 'PSI').length
      });
    }

    // Alerts Feed (Recent Map Points as alerts)
    const alerts = allPoints
      .filter((p: any) => p.incident_date || p.created_at)
      .sort((a: any, b: any) => {
        const dateA = new Date(a.created_at || a.incident_date).getTime();
        const dateB = new Date(b.created_at || b.incident_date).getTime();
        return dateB - dateA;
      })
      .slice(0, 10)
      .map((p: any) => ({
        id: p.id,
        message: `${p.incident_type || 'Incident'} reported`,
        location: p.barangay || 'Unknown',
        timestamp: p.created_at || p.incident_date,
        severity: p.category === '8-Focus' ? 'Critical' : (p.category === 'PSI' ? 'Warning' : 'Info')
      }));

    res.render('admin/dashboard', {
      title: 'Dashboard',
      todayStats,
      highRiskBarangays,
      monthlyTrends: JSON.stringify(monthlyTrends),
      alerts,
      notifications,
      points: allPoints,
      layout: 'layouts/admin'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
};

export const getBulletins = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const [snap, countSnap] = await Promise.all([
      db.collection('bulletins').orderBy('created_at', 'desc').offset(offset).limit(limit).get(),
      db.collection('bulletins').count().get()
    ]);
    const bulletins = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const totalPages = Math.ceil(countSnap.data().count / limit);

    res.render('admin/bulletins', { title: 'Bulletins', bulletins, currentPage: page, totalPages, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletins');
  }
};

export const getCreateBulletin = (req: Request, res: Response) => {
  res.render('admin/bulletin_form', { title: 'New Bulletin', bulletin: null, layout: 'layouts/admin' });
};

export const postCreateBulletin = async (req: Request, res: Response) => {
  const { title, category, custom_category, body } = req.body;
  const finalCategory = category === 'Other' ? custom_category : category;

  try {
    const data: any = {
      title,
      category: finalCategory,
      body,
      posted_by: req.session.user.id,
      is_archived: false,
      created_at: new Date().toISOString()
    };

    if ((req as any).file) {
      const file = (req as any).file;
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const path = `bulletins/${fileName}`;

      try {
        const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
        data.photo_path = publicUrl;
        console.log(`[BULLETIN] Image uploaded successfully: ${publicUrl}`);
      } catch (storageErr) {
        console.error('[BULLETIN] Supabase Storage Error:', storageErr);
        // data.photo_path remains undefined or we could set a placeholder here explicitly if we want
        // But the db.storage.upload already returns a placeholder on failure
      }
    }

    await logAction(req, 'BULLETIN_CREATE', `Created informational bulletin: ${title}`);
    await db.collection('bulletins').add(data);
    res.redirect('/admin/bulletins');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating bulletin');
  }
};

export const getEditBulletin = async (req: Request, res: Response) => {
  try {
    const doc = await db.collection('bulletins').doc(req.params.id).get();
    const bulletin = { id: doc.id, ...doc.data() };
    res.render('admin/bulletin_form', { title: 'Edit Bulletin', bulletin, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletin');
  }
};

export const postEditBulletin = async (req: Request, res: Response) => {
  const { title, category, custom_category, body, is_archived } = req.body;
  const finalCategory = category === 'Other' ? custom_category : category;

  try {
    const data: any = {
      title,
      category: finalCategory,
      body,
      is_archived: is_archived === 'on' || is_archived === true,
      updated_at: new Date().toISOString()
    };

    if ((req as any).file) {
      const file = (req as any).file;
      const fileExt = file.originalname.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const path = `bulletins/${fileName}`;

      try {
        const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
        data.photo_path = publicUrl;
        console.log(`[BULLETIN EDIT] Image updated: ${publicUrl}`);
      } catch (storageErr) {
        console.error('[BULLETIN EDIT] Supabase Storage Error:', storageErr);
      }
    }

    await logAction(req, 'BULLETIN_EDIT', `Updated bulletin ID: ${req.params.id} (${title})`);
    await db.collection('bulletins').doc(req.params.id).update(data);
    res.redirect('/admin/bulletins');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating bulletin');
  }
};

export const deleteBulletin = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await logAction(req, 'BULLETIN_DELETE', `Deleted bulletin ID: ${id}`);
    await db.collection('bulletins').doc(id).delete();

    if (req.xhr || req.headers.accept?.indexOf('json') !== -1) {
      return res.json({ success: true, message: 'Directive purged successfully' });
    }
    res.redirect('/admin/bulletins');
  } catch (err: any) {
    console.error(err);
    if (req.xhr || req.headers.accept?.indexOf('json') !== -1) {
      return res.status(500).json({ success: false, message: err.message });
    }
    res.status(500).send('Error deleting bulletin');
  }
};

export const getTips = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const [snap, countSnap] = await Promise.all([
      db.collection('anonymous_tips').orderBy('created_at', 'desc').offset(offset).limit(limit).get(),
      db.collection('anonymous_tips').count().get()
    ]);
    const tips = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const totalPages = Math.ceil(countSnap.data().count / limit);

    // Mark tip-related notifications as read when viewed
    const unreadNotifs = await db.collection('admin_notifications')
      .where('type', '==', 'TIP')
      .where('is_read', '==', false)
      .get();

    if (!unreadNotifs.empty) {
      const batch = db.batch();
      unreadNotifs.docs.forEach(doc => {
        batch.update(doc.ref, { is_read: true, updated_at: new Date().toISOString() });
      });
      await batch.commit();
    }

    res.render('admin/tips', { title: 'Anonymous Tips', tips, currentPage: page, totalPages, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading tips');
  }
};

export const getUnreadTipsCount = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('admin_notifications')
      .where('type', '==', 'TIP')
      .where('is_read', '==', false)
      .count()
      .get();
    res.json({ unreadCount: snap.data().count });
  } catch (err) {
    console.error('Error fetching unread tips count:', err);
    res.status(500).json({ unreadCount: 0 });
  }
};

export const updateTip = async (req: Request, res: Response) => {
  const { is_flagged, admin_notes } = req.body;
  try {
    await logAction(req, 'TIP_UPDATE', `Updated anonymous tip ID: ${req.params.id}`);
    await db.collection('anonymous_tips').doc(req.params.id).update({
      is_flagged: is_flagged === 'on' || is_flagged === true,
      admin_notes,
      updated_at: new Date().toISOString()
    });
    res.redirect('/admin/tips');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating tip');
  }
};

export const getMap = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('map_points').get();
    const points = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter((p: any) => {
        const dateStr = String(p.incident_date || '');
        const isPlaceholder = dateStr === 'N/A' ||
          dateStr === '' ||
          dateStr === '2026-04-27T09:22:14.910Z' ||
          p.description === 'Strategic placeholder data';
        return !isPlaceholder;
      });
    res.render('admin/map', {
      title: 'Map',
      points,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      layout: 'layouts/admin'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading map points');
  }
};

export const postMapPoint = async (req: Request, res: Response) => {
  const { incident_type, incident_date, barangay, description } = req.body;
  try {
    const pin = MANUAL_PINS.find(p => p.name === barangay);

    // Categorization logic
    const focus8 = ['Murder', 'Homicide', 'Physical Injury', 'Rape', 'Robbery', 'Theft', 'Carnapping MV', 'Carnapping MC'];
    const psi = ['Vehicular Accident', 'Traffic Accident', 'Public Safety', 'Fire Incident'];
    let category = 'Non-Index';
    if (focus8.includes(incident_type)) category = '8-Focus';
    else if (psi.includes(incident_type)) category = 'PSI';

    await logAction(req, 'MAP_POINT_ADD', `Added manual map point: ${incident_type} in Brgy. ${barangay}`);
    await db.collection('map_points').add({
      lat: pin ? pin.lat : 0,
      lng: pin ? pin.lng : 0,
      incident_type,
      incident_date,
      barangay,
      description: description || '',
      category,
      created_at: new Date().toISOString()
    });
    res.redirect('/admin/map');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error adding map point');
  }
};

export const deleteMapPoint = async (req: Request, res: Response) => {
  try {
    await logAction(req, 'MAP_POINT_DELETE', `Deleted tactical point ID: ${req.params.id}`);
    await db.collection('map_points').doc(req.params.id).delete();

    // Check if it's an AJAX request
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({ success: true, message: 'Tactical point neutralized' });
    }

    res.redirect('/admin/map');
  } catch (err) {
    console.error(err);
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message: 'Neutralization sequence failed' });
    }
    res.status(500).send('Error deleting map point');
  }
};

export const purgePlaceholders = async (req: Request, res: Response) => {
  try {
    await logAction(req, 'SYSTEM_PURGE', 'Initiated full tactical data purge (RESET).');
    const tables = ['map_points', 'intelligence_scans', 'anonymous_tips', 'audit_logs', 'bulletins'];
    const batch = db.batch();

    for (const table of tables) {
      const snap = await db.collection(table).get();
      snap.docs.forEach((doc: any) => batch.delete(doc.ref));
    }

    await batch.commit();

    res.json({ success: true, message: 'All tactical data purged. System reset to zero-state.' });
  } catch (err) {
    console.error('Purge error:', err);
    res.status(500).json({ success: false, error: 'Purge failed' });
  }
};

export const getHotlines = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('hotlines').orderBy('category').get();
    const hotlines = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/hotlines', { title: 'Hotlines', hotlines, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading hotlines');
  }
};

export const postHotline = async (req: Request, res: Response) => {
  const { name, number, category } = req.body;
  try {
    await logAction(req, 'HOTLINE_ADD', `Added tactical hotline: ${name}`);
    await db.collection('hotlines').add({
      name,
      number,
      category,
      updated_at: new Date().toISOString()
    });
    res.redirect('/admin/hotlines');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error adding hotline');
  }
};

export const deleteHotline = async (req: Request, res: Response) => {
  try {
    await logAction(req, 'HOTLINE_DELETE', `Deleted hotline ID: ${req.params.id}`);
    await db.collection('hotlines').doc(req.params.id).delete();
    res.redirect('/admin/hotlines');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting hotline');
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const [usersSnap, logsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('audit_logs').orderBy('timestamp', 'desc').limit(50).get()
    ]);

    const users = (usersSnap && usersSnap.docs) ? usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [];
    const logs = (logsSnap && logsSnap.docs) ? logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })) : [];

    res.render('admin/users', {
      title: 'Users',
      users,
      logs,
      layout: 'layouts/admin'
    });
  } catch (err) {
    console.error('[PERSONNEL ERROR]', err);
    res.render('admin/users', {
      title: 'Personnel & Operational Logs',
      users: [],
      logs: [],
      layout: 'layouts/admin',
      error_msg: 'Operational data retrieval partially compromised.'
    });
  }
};

export const postUser = async (req: Request, res: Response) => {
  const { username, full_name, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    // 🛡️ Backend Enforcement: Only superadmins can deploy new personnel
    if (req.session.user.role !== 'superadmin') {
      console.warn(`[SECURITY BREACH ATTEMPT] Non-admin ${req.session.user.username} tried to create personnel.`);
      return res.status(403).send('Forbidden: Insufficient tactical clearance.');
    }

    await logAction(req, 'USER_CREATE', `Created administrative personnel: ${username} (Role: staff)`);
    await db.collection('users').add({
      username,
      full_name,
      password_hash: hash,
      role: 'staff',
      created_at: new Date().toISOString()
    });
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating personnel account');
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    // 🛡️ Backend Enforcement: Only superadmins can neutralize credentials
    if (req.session.user.role !== 'superadmin') {
      return res.status(403).send('Forbidden: Insufficient tactical clearance.');
    }

    const userId = req.params.id;
    if (userId === req.session.user.id) {
      return res.status(400).send('You cannot neutralize your own credentials while active.');
    }

    const docRef = db.collection('users').doc(userId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).send('Subject not found.');

    const userData = snap.data() as any;
    await logAction(req, 'USER_DELETE', `Neutralized administrative credentials for: ${userData.username}`);
    await docRef.delete();
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.status(500).send('Operational failure during user neutralization');
  }
};

export const getReports = async (req: Request, res: Response) => {
  try {
    const [reportsSnap, allPointsSnap] = await Promise.all([
      db.collection('intelligence_scans').orderBy('timestamp', 'desc').get(),
      db.collection('map_points').orderBy('incident_date', 'desc').get()
    ]);

    const reports = reportsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const allPoints = allPointsSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .filter((p: any) => {
        const dateStr = String(p.incident_date || '');
        const isPlaceholder = dateStr === 'N/A' ||
          dateStr === '' ||
          dateStr === '2026-04-27T09:22:14.910Z' ||
          p.description === 'Strategic placeholder data';
        return !isPlaceholder;
      });

    const stats = {
      '8-Focus': allPoints.filter((p: any) => p.category === '8-Focus').length,
      'PSI': allPoints.filter((p: any) => p.category === 'PSI').length,
      'Non-Index': allPoints.filter((p: any) => p.category === 'Non-Index').length
    };

    // Monthly Trends (Last 12 Months from Latest Data)
    let referenceDate = new Date();
    if (allPoints.length > 0) {
      const dates = allPoints.map((p: any) => new Date(p.incident_date).getTime()).filter((t: number) => !isNaN(t));
      if (dates.length > 0) {
        const maxDate = new Date(Math.max(...dates));
        if (maxDate > referenceDate) referenceDate = maxDate;
      }
    }

    const monthlyTrends: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
      const monthLabel = d.toLocaleString('en-US', { month: 'short' });
      const month = d.getMonth();
      const year = d.getFullYear();

      const mPoints = allPoints.filter((p: any) => {
        if (!p.incident_date) return false;
        const pd = new Date(p.incident_date);
        return pd.getMonth() === month && pd.getFullYear() === year;
      });

      monthlyTrends.push({
        month: monthLabel,
        focus: mPoints.filter((p: any) => p.category === '8-Focus').length,
        nonIndex: mPoints.filter((p: any) => p.category === 'Non-Index').length,
        psi: mPoints.filter((p: any) => p.category === 'PSI').length
      });
    }

    res.render('admin/reports', {
      title: 'Crime Reports',
      reports,
      allIncidents: allPoints,
      stats,
      monthlyTrends: JSON.stringify(monthlyTrends),
      points: allPoints,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      layout: 'layouts/admin'
    });
  } catch (err) {
    console.error('getReports error:', err);
    res.status(500).send('Error loading reports');
  }
};

export const deleteReport = async (req: Request, res: Response) => {
  try {
    const reportId = req.params.id;
    await logAction(req, 'REPORT_DELETE', `Deleted intelligence report and associated map points. ID: ${reportId}`);
    console.log(`[DELETION PROTOCOL] Initiating purge for Report ID: ${reportId}`);

    // 1. Cascading deletion: Purge all map points associated with this report
    // We MUST ensure the children are gone first before the parent
    await db.collection('map_points').where('report_id', '==', reportId).delete();
    console.log(`[DELETION PROTOCOL] Associated map points purged.`);

    // 2. Small safety wait to ensure Postgres triggers/cache update (Optional but helps in some high-latency envs)
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. Delete the scan report (Parent)
    await db.collection('intelligence_scans').doc(reportId).delete();
    console.log(`[DELETION PROTOCOL] Intelligence report ${reportId} successfully neutralized.`);

    res.redirect('/admin/reports');
  } catch (err: any) {
    console.error('Error deleting report and children:', err);
    const errorMsg = err.message || JSON.stringify(err);
    res.status(500).send(`Error deleting report: ${errorMsg}`);
  }
};
export const bulkAddMapPoints = async (req: Request, res: Response) => {
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({ success: false, message: 'Invalid entries' });
  }

  try {
    const categoryStats: any = { '8-Focus': 0, 'PSI': 0, 'Non-Index': 0, entry_type: 'manual' };
    const batch = db.batch();

    // Create report first
    const reportRef = db.collection('intelligence_scans').doc();
    const reportId = reportRef.id;

    for (const entry of entries) {
      const pin = MANUAL_PINS.find(p => p.name === entry.barangay);
      const cat = entry.category || 'Non-Index';
      categoryStats[cat] = (categoryStats[cat] || 0) + 1;

      const pointRef = db.collection('map_points').doc();
      batch.set(pointRef, {
        lat: pin ? pin.lat : 0,
        lng: pin ? pin.lng : 0,
        incident_type: entry.offense || entry.incident_type,
        incident_date: entry.date_committed || entry.incident_date,
        barangay: entry.barangay,
        description: entry.description || 'Manual entry',
        category: cat,
        report_id: reportId,
        created_at: new Date().toISOString()
      });
    }

    // Save a report of this scan
    batch.set(reportRef, {
      admin_id: req.session.user.id,
      admin_name: req.session.user.full_name,
      timestamp: new Date().toISOString(),
      total_records: entries.length,
      category_stats: categoryStats,
      raw_data: entries,
      filename: 'Manual Intelligence Session'
    });

    await batch.commit();
    await logAction(req, 'MAP_BULK_ADD', `Successfully synchronized ${entries.length} manual records to tactical grid.`);
    res.json({ success: true, count: entries.length });
  } catch (err) {
    console.error('Bulk add error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
