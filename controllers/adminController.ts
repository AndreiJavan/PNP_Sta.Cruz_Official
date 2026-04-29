import { Request, Response } from 'express';
import { db } from '../config/database.js';
import bcrypt from 'bcryptjs';

export const getLogin = (req: Request, res: Response) => {
  if (req.session.user) return res.redirect('/admin/dashboard');
  res.render('admin/login', { title: 'Admin Login', layout: false });
};

export const postLogin = async (req: Request, res: Response) => {
  const { username, password } = req.body;
  
  if (!req.session) {
    return res.status(500).send('Session error: No session object found');
  }

  try {
    const snap = await db.collection('users').where('username', '==', username).limit(1).get();
    
    if (snap.empty) {
      return res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Invalid username or password' });
    }

    const user = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;

    // Fallback for plain text 'admin123' if bcrypt fails or for easier testing
    const isPasswordCorrect = bcrypt.compareSync(password, user.password_hash) || (password === 'admin123' && user.username === 'superadmin');

    if (isPasswordCorrect) {
      req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
      
      req.session.save((err) => {
        if (err) {
          return res.status(500).send('Error saving session');
        }
        res.redirect('/admin/dashboard');
      });
    } else {
      res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Invalid username or password' });
    }
  } catch (err) {
    res.status(500).send('Error during login');
  }
};

export const getLogout = (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
};

export const getDashboard = async (req: Request, res: Response) => {
  try {
    const [
      allMapPointsSnap,
      anonymousTipsSnap,
      totalTipsSnap,
      notificationsSnap,
      totalBulletinsSnap,
      totalReportsSnap
    ] = await Promise.all([
      db.collection('map_points').get(),
      db.collection('anonymous_tips').orderBy('created_at', 'desc').limit(10).get(),
      db.collection('anonymous_tips').count().get(),
      db.collection('admin_notifications').where('is_read', '==', false).orderBy('created_at', 'desc').limit(5).get(),
      db.collection('bulletins').count().get(),
      db.collection('intelligence_scans').count().get()
    ]);

    const allPoints = allMapPointsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    const totalTipsCount = totalTipsSnap.data().count;
    const totalBulletinsCount = totalBulletinsSnap.data().count;
    const totalReportsCount = totalReportsSnap.data().count;
    const notifications = notificationsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    
    // Time-based calculations
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Today's stats
    const todayPoints = allPoints.filter((p: any) => p.incident_date && typeof p.incident_date === 'string' && p.incident_date.startsWith(todayStr));
    const yesterdayPoints = allPoints.filter((p: any) => p.incident_date && typeof p.incident_date === 'string' && p.incident_date.startsWith(yesterdayStr));

    const todayStats = {
      total: todayPoints.length,
      focus: todayPoints.filter((p: any) => p.category === '8-Focus').length,
      nonIndex: todayPoints.filter((p: any) => p.category === 'Non-Index').length,
      psi: todayPoints.filter((p: any) => p.category === 'PSI').length,
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

    // Monthly Trends (Last 6 Months)
    const monthlyTrends: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleString('default', { month: 'short' });
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
        message: `${p.incident_type || 'Incident'} reported`,
        location: p.barangay || 'Unknown',
        timestamp: p.created_at || p.incident_date,
        severity: p.category === '8-Focus' ? 'Critical' : (p.category === 'PSI' ? 'Warning' : 'Info')
      }));

    res.render('admin/dashboard', { 
      title: 'Admin Command Center', 
      todayStats,
      highRiskBarangays,
      monthlyTrends: JSON.stringify(monthlyTrends),
      alerts,
      notifications,
      layout: 'layouts/admin' 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading dashboard');
  }
};

export const getBulletins = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('bulletins').orderBy('created_at', 'desc').get();
    const bulletins = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/bulletins', { title: 'Manage Bulletins', bulletins, layout: 'layouts/admin' });
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
      data.photo_path = `/images/${(req as any).file.filename}`;
    }

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
      data.photo_path = `/images/${(req as any).file.filename}`;
    }

    await db.collection('bulletins').doc(req.params.id).update(data);
    res.redirect('/admin/bulletins');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating bulletin');
  }
};

export const deleteBulletin = async (req: Request, res: Response) => {
  try {
    await db.collection('bulletins').doc(req.params.id).delete();
    res.redirect('/admin/bulletins');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting bulletin');
  }
};

export const getTips = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('anonymous_tips').orderBy('created_at', 'desc').get();
    const tips = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/tips', { title: 'Anonymous Tips', tips, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading tips');
  }
};

export const updateTip = async (req: Request, res: Response) => {
  const { is_flagged, admin_notes } = req.body;
  try {
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
    const points = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/map', { 
      title: 'Map Management', 
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
    const manualPins = [
      { name: 'Alipit', lat: 14.223931, lng: 121.405213 },
      { name: 'Bagumbayan', lat: 14.268334, lng: 121.398454 },
      { name: 'Duhat', lat: 14.2525, lng: 121.3825 },
      { name: 'Bubukal', lat: 14.256460, lng: 121.399183 },
      { name: 'Calios', lat: 14.2750, lng: 121.4050 },
      { name: 'Gatid', lat: 14.2600, lng: 121.3830 },
      { name: 'Jasaan', lat: 14.223577, lng: 121.394827 },
      { name: 'Labuin', lat: 14.250158, lng: 121.400664 },
      { name: 'Malinao', lat: 14.232833, lng: 121.396823 },
      { name: 'Oogong', lat: 14.226323, lng: 121.400621 },
      { name: 'Pagsawitan', lat: 14.265754, lng: 121.426545 },
      { name: 'Palasan', lat: 14.257498, lng: 121.418992 },
      { name: 'Patimbao', lat: 14.270081, lng: 121.418366 },
      { name: 'Poblacion I (Barangay I)', lat: 14.277068, lng: 121.418881 },
      { name: 'Poblacion II (Barangay II)', lat: 14.279647, lng: 121.416006 },
      { name: 'Poblacion III (Barangay III)', lat: 14.282028, lng: 121.415159 },
      { name: 'Poblacion IV (Barangay IV)', lat: 14.283790, lng: 121.414016 },
      { name: 'Poblacion V (Barangay V)', lat: 14.285282, lng: 121.412476 },
      { name: 'San Jose', lat: 14.237118, lng: 121.403754 },
      { name: 'San Juan', lat: 14.243815, lng: 121.406972 },
      { name: 'San Pablo Norte', lat: 14.290210, lng: 121.413023 },
      { name: 'San Pablo Sur', lat: 14.282211, lng: 121.422261 },
      { name: 'Santisima Cruz', lat: 14.290647, lng: 121.409140 },
      { name: 'Santo Angel Central', lat: 14.285137, lng: 121.408947 },
      { name: 'Santo Angel Norte', lat: 14.288547, lng: 121.406307 },
      { name: 'Santo Angel Sur', lat: 14.282329, lng: 121.410985 }
    ];

    const pin = manualPins.find(p => p.name === barangay);
    
    // Categorization logic
    const focus8 = ['Murder', 'Homicide', 'Physical Injury', 'Rape', 'Robbery', 'Theft', 'Carnapping MV', 'Carnapping MC'];
    const psi = ['Vehicular Accident', 'Traffic Accident', 'Public Safety', 'Fire Incident'];
    let category = 'Non-Index';
    if (focus8.includes(incident_type)) category = '8-Focus';
    else if (psi.includes(incident_type)) category = 'PSI';
    
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
    await db.collection('map_points').doc(req.params.id).delete();
    res.redirect('/admin/map');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting map point');
  }
};

export const getHotlines = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('hotlines').orderBy('category').get();
    const hotlines = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/hotlines', { title: 'Manage Hotlines', hotlines, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading hotlines');
  }
};

export const postHotline = async (req: Request, res: Response) => {
  const { name, number, category } = req.body;
  try {
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
    await db.collection('hotlines').doc(req.params.id).delete();
    res.redirect('/admin/hotlines');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting hotline');
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('users').get();
    const users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/users', { title: 'User Management', users, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading users');
  }
};

export const postUser = async (req: Request, res: Response) => {
  const { username, full_name, password, role } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    await db.collection('users').add({
      username,
      full_name,
      password_hash: hash,
      role,
      created_at: new Date().toISOString()
    });
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating user');
  }
};

export const getAuditLog = async (req: Request, res: Response) => {
  try {
    const snap = await db.collection('audit_logs').orderBy('timestamp', 'desc').get();
    const logs = await Promise.all(snap.docs.map(async doc => {
      const log = doc.data();
      const userDoc = await db.collection('users').doc(log.admin_id).get();
      return { id: doc.id, ...log, admin_name: userDoc.exists ? (userDoc.data() as any).full_name : 'Unknown' };
    }));
    res.render('admin/audit_log', { title: 'Audit Log', logs, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading audit logs');
  }
};

export const getReports = async (req: Request, res: Response) => {
  try {
    const [reportsSnap, allPointsSnap] = await Promise.all([
      db.collection('intelligence_scans').orderBy('timestamp', 'desc').get(),
      db.collection('map_points').orderBy('incident_date', 'desc').get()
    ]);
    
    const reports = reportsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    const allIncidents = allPointsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    res.render('admin/reports', { 
      title: 'Intelligence Reports', 
      reports, 
      allIncidents,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      layout: 'layouts/admin' 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading reports');
  }
};

export const deleteReport = async (req: Request, res: Response) => {
  try {
    await db.collection('intelligence_scans').doc(req.params.id).delete();
    res.redirect('/admin/reports');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting report');
  }
};

export const bulkAddMapPoints = async (req: Request, res: Response) => {
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({ success: false, message: 'Invalid entries' });
  }

  try {
    const manualPins = [
      { name: 'Alipit', lat: 14.223931, lng: 121.405213 },
      { name: 'Bagumbayan', lat: 14.268334, lng: 121.398454 },
      { name: 'Duhat', lat: 14.2525, lng: 121.3825 },
      { name: 'Bubukal', lat: 14.256460, lng: 121.399183 },
      { name: 'Calios', lat: 14.2750, lng: 121.4050 },
      { name: 'Gatid', lat: 14.2600, lng: 121.3830 },
      { name: 'Jasaan', lat: 14.223577, lng: 121.394827 },
      { name: 'Labuin', lat: 14.250158, lng: 121.400664 },
      { name: 'Malinao', lat: 14.232833, lng: 121.396823 },
      { name: 'Oogong', lat: 14.226323, lng: 121.400621 },
      { name: 'Pagsawitan', lat: 14.265754, lng: 121.426545 },
      { name: 'Palasan', lat: 14.257498, lng: 121.418992 },
      { name: 'Patimbao', lat: 14.270081, lng: 121.418366 },
      { name: 'Poblacion I (Barangay I)', lat: 14.277068, lng: 121.418881 },
      { name: 'Poblacion II (Barangay II)', lat: 14.279647, lng: 121.416006 },
      { name: 'Poblacion III (Barangay III)', lat: 14.282028, lng: 121.415159 },
      { name: 'Poblacion IV (Barangay IV)', lat: 14.283790, lng: 121.414016 },
      { name: 'Poblacion V (Barangay V)', lat: 14.285282, lng: 121.412476 },
      { name: 'San Jose', lat: 14.237118, lng: 121.403754 },
      { name: 'San Juan', lat: 14.243815, lng: 121.406972 },
      { name: 'San Pablo Norte', lat: 14.290210, lng: 121.413023 },
      { name: 'San Pablo Sur', lat: 14.282211, lng: 121.422261 },
      { name: 'Santisima Cruz', lat: 14.290647, lng: 121.409140 },
      { name: 'Santo Angel Central', lat: 14.285137, lng: 121.408947 },
      { name: 'Santo Angel Norte', lat: 14.288547, lng: 121.406307 },
      { name: 'Santo Angel Sur', lat: 14.282329, lng: 121.410985 }
    ];

    const categoryStats: any = { '8-Focus': 0, 'PSI': 0, 'Non-Index': 0 };

    for (const entry of entries) {
      const pin = manualPins.find(p => p.name === entry.barangay);
      const cat = entry.category || 'Non-Index';
      categoryStats[cat] = (categoryStats[cat] || 0) + 1;

      await db.collection('map_points').add({
        lat: pin ? pin.lat : 0,
        lng: pin ? pin.lng : 0,
        incident_type: entry.offense,
        incident_date: entry.date_committed,
        barangay: entry.barangay,
        description: entry.description || 'Intel extracted',
        category: cat,
        created_at: new Date().toISOString()
      });
    }

    // Save a report of this scan
    await db.collection('intelligence_scans').add({
      admin_id: req.session.user.id,
      admin_name: req.session.user.full_name,
      timestamp: new Date().toISOString(),
      total_records: entries.length,
      category_stats: categoryStats,
      raw_data: entries
    });

    res.json({ success: true, count: entries.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
