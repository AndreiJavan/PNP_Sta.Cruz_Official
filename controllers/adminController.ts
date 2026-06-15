import { Request, Response } from 'express';
import { db } from '../config/database.js';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createRequire } from 'module';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'andreijavan05@gmail.com',
    pass: 'mwcb ioze huql sxgd'
  }
});

// Shared Tactical Assets
const VALID_BARANGAYS = [
  "Alipit", "Bagumbayan", "Bubukal", "Calios", "Duhat", "Gatid", "Jasaan", "Labuin",
  "Malinao", "Oogong", "Pagsawitan", "Palasan", "Patimbao", "Poblacion I (Barangay I)",
  "Poblacion II (Barangay II)", "Poblacion III (Barangay III)", "Poblacion IV (Barangay IV)",
  "Poblacion V (Barangay V)", "San Jose", "San Juan", "San Pablo Norte", "San Pablo Sur",
  "Santisima Cruz", "Santo Angel Central", "Santo Angel Norte", "Santo Angel Sur"
];

// Audit Strategy
async function logAction(req: Request, action: string, details: string) {
  try {
    const adminId = req.session?.user?.id || 'system';
    const adminUsername = req.session?.user?.username || 'system';
    const ip = req.ip || '0.0.0.0';

    await db.collection('audit_logs').add({
      admin_id: adminId,
      username: adminUsername,
      action,
      details,
      timestamp: new Date().toISOString(),
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[AUDIT FAIL]', err);
  }
}

// Workaround for Supabase 'bulletins_category_check' constraint
const STANDARD_CATEGORIES = ['Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement'];

const encodeCustomCategory = (category: string, body: string) => {
  if (!STANDARD_CATEGORIES.includes(category)) {
    return {
      category: 'General Announcement',
      body: body + `\n<!--CUSTOM_CATEGORY:${category}-->`
    };
  }
  return { category, body };
};

export const decodeCustomCategory = (item: any) => {
  if (item && item.body && item.body.includes('<!--CUSTOM_CATEGORY:')) {
    const match = item.body.match(/<!--CUSTOM_CATEGORY:(.*?)-->/);
    if (match) {
      item.category = match[1];
      item.body = item.body.replace(/\n?<!--CUSTOM_CATEGORY:.*?-->/g, '');
    }
  }
  return item;
};

const MANUAL_PINS = [
  { name: 'Alipit', lat: 14.223931, lng: 121.405213 }, { name: 'Bagumbayan', lat: 14.268334, lng: 121.398454 },
  { name: 'Duhat', lat: 14.2525, lng: 121.3825 }, { name: 'Bubukal', lat: 14.256460, lng: 121.399183 },
  { name: 'Calios', lat: 14.2750, lng: 121.4050 }, { name: 'Gatid', lat: 14.2600, lng: 121.3830 },
  { name: 'Jasaan', lat: 14.223577, lng: 121.394827 }, { name: 'Labuin', lat: 14.250158, lng: 121.400664 },
  { name: 'Malinao', lat: 14.232833, lng: 121.396823 }, { name: 'Oogong', lat: 14.226323, lng: 121.400621 },
  { name: 'Pagsawitan', lat: 14.265754, lng: 121.426545 }, { name: 'Palasan', lat: 14.257498, lng: 121.418992 },
  { name: 'Patimbao', lat: 14.270081, lng: 121.418366 }, { name: 'Poblacion I (Barangay I)', lat: 14.277068, lng: 121.418881 },
  { name: 'Poblacion II (Barangay II)', lat: 14.279647, lng: 121.416006 }, { name: 'Poblacion III (Barangay III)', lat: 14.282028, lng: 121.415159 },
  { name: 'Poblacion IV (Barangay IV)', lat: 14.283790, lng: 121.414016 }, { name: 'Poblacion V (Barangay V)', lat: 14.285282, lng: 121.412476 },
  { name: 'San Jose', lat: 14.237118, lng: 121.403754 }, { name: 'San Juan', lat: 14.243815, lng: 121.406972 },
  { name: 'San Pablo Norte', lat: 14.290210, lng: 121.413023 }, { name: 'San Pablo Sur', lat: 14.282211, lng: 121.422261 },
  { name: 'Santisima Cruz', lat: 14.290647, lng: 121.409140 }, { name: 'Santo Angel Central', lat: 14.285137, lng: 121.408947 },
  { name: 'Santo Angel Norte', lat: 14.288547, lng: 121.406307 }, { name: 'Santo Angel Sur', lat: 14.282329, lng: 121.410985 }
];

// Initialize AI
let genAI: GoogleGenerativeAI | null = null;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined. Please configure it in your environment variables.');
  }

  if (!apiKey.startsWith('AIza')) {
    console.warn('CRITICAL WARNING: GEMINI_API_KEY does not appear to be a valid Google API Key format (expected to start with "AIza").');
  }

  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/**
 * Robust JSON extraction from AI response.
 * Handles cases where the model wraps JSON in markdown blocks.
 */
function cleanAndParseJSON(text: string) {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch (e) {
    // Attempt to extract JSON from markdown blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (innerError) {
        throw new Error('Failed to parse JSON inside markdown blocks.');
      }
    }

    // Last ditch effort: find anything between brackets
    const bracketMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (bracketMatch && bracketMatch[1]) {
      try {
        return JSON.parse(bracketMatch[1]);
      } catch (innerError) {
        throw new Error('Failed to parse JSON using bracket extraction.');
      }
    }

    throw new Error('AI response is not valid JSON format.');
  }
}

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
    // 1. Database Lookup - Check username first
    let snap = await db.collection('users').where('username', '==', username).limit(1).get();

    // If not found by username, try looking up by email
    if (snap.empty) {
      snap = await db.collection('users').where('email', '==', username).limit(1).get();
    }

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
      if (user.status === 'pending') {
        return res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Your account is pending approval by the Police Chief.' });
      }
      if (user.status === 'rejected') {
        return res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Your account request was rejected.' });
      }

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
    console.log('AI Extraction Request received. File present:', !!(req as any).file);

    if ((req as any).file) {
      const buffer = (req as any).file.buffer;
      const mimetype = (req as any).file.mimetype;
      console.log('Processing file of type:', mimetype);

      if (
        mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimetype === 'application/vnd.ms-excel' ||
        mimetype === 'text/csv' ||
        mimetype === 'application/octet-stream' ||
        mimetype.includes('excel') ||
        mimetype.includes('spreadsheet')
      ) {
        console.log('Processing Excel/CSV data');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          textContent += `[Sheet: ${sheetName}]\n` + XLSX.utils.sheet_to_csv(sheet) + '\n';
        });
        console.log('Excel text extracted. Length:', textContent.length);
      } else if (
        mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimetype === 'application/msword'
      ) {
        console.log('Processing Word document');
        const result = await mammoth.extractRawText({ buffer });
        textContent = result.value;
        console.log('Word text extracted. Length:', textContent.length);
      } else {
        console.warn('Blocked unsupported mimetype:', mimetype);
        return res.status(400).json({ success: false, error: `Unsupported file type (${mimetype}). Please use Excel or DOCX.` });
      }
    } else if (req.body.data) {
      textContent = req.body.data;
    }

    if (!textContent || textContent.trim().length === 0) {
      console.warn('Extraction failed: No text content found.');
      return res.status(400).json({ success: false, error: 'Target document contains no readable text data.' });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error('CRITICAL: GEMINI_API_KEY is missing from environment.');
      return res.status(500).json({ success: false, error: 'Neural Engine Error: API Key not configured. Please add GEMINI_API_KEY to your environment.' });
    }

    const client = getGeminiClient();
    const primaryModel = 'gemini-2.5-flash';
    const fallbackModel = 'gemini-2.5-flash-lite';

    console.log(`[NEURAL SCAN] Initiating tactical extraction via ${primaryModel}...`);
    let model = client.getGenerativeModel({ model: primaryModel });

    const prompt = `
ROLE:
You are a strict data extraction engine for a law enforcement crime information system.

You ONLY extract structured crime incident data from the provided text.
You DO NOT explain. You DO NOT add comments. You DO NOT hallucinate.

---

LOCATION CONTEXT:
Santa Cruz, Laguna, Philippines

---

VALID BARANGAYS (STRICT MATCH ONLY):
Alipit, Bagumbayan, Bubukal, Calios, Duhat, Gatid, Jasaan, Labuin, Malinao, Oogong, Pagsawitan, Palasan, Patimbao, Poblacion I (Barangay I), Poblacion II (Barangay II), Poblacion III (Barangay III), Poblacion IV (Barangay IV), Poblacion V (Barangay V), San Jose, San Juan, San Pablo Norte, San Pablo Sur, Santisima Cruz, Santo Angel Central, Santo Angel Norte, Santo Angel Sur

---

CLASSIFICATION RULES:

1. 8-Focus Crimes:
Murder, Homicide, Physical Injury, Rape, Robbery, Theft, Carnapping (Motor Vehicle or Motorcycle)

2. PSI (Public Safety Index):
Vehicular Accident, Traffic Incident, Fire Incident

3. Non-Index:
All other incidents

---

EXTRACTION RULES:

- Extract ONLY real incidents explicitly stated in the text
- DO NOT create or assume missing data
- If date is missing, use null
- Normalize date format to: YYYY-MM-DD
- Barangay MUST match EXACTLY from the valid list
- If barangay is unclear or not in list, SKIP the record
- Categorize strictly based on rules above
- If unsure, use "Non-Index"
- Remove duplicate incidents
- Keep descriptions short but meaningful

---

CRITICAL OUTPUT RULES:

- Output MUST be valid JSON
- NO markdown (no \`\`\` blocks)
- NO explanations
- NO extra text
- NO comments
- NO trailing commas

---

OUTPUT FORMAT (STRICT):

{
  "barangays": {
    "BarangayName": [
      {
        "date": "YYYY-MM-DD",
        "offense": "string",
        "category": "8-Focus | PSI | Non-Index",
        "description": "string"
      }
    ]
  }
}

---

INPUT DATA STARTS BELOW:
    `;

    let result;
    try {
      result = await model.generateContent([prompt, textContent]);
    } catch (apiErr: any) {
      console.warn(`[RECOVERY] Primary model ${primaryModel} failed. Attempting fallback to ${fallbackModel}...`);
      try {
        model = client.getGenerativeModel({ model: fallbackModel });
        result = await model.generateContent([prompt, textContent]);
      } catch (fallbackErr: any) {
        console.error('Gemini API Fallback Error:', fallbackErr);
        if (apiErr.message?.includes('unregistered callers') || fallbackErr.message?.includes('unregistered callers')) {
          throw new Error('API Key is rejected. Ensure your GEMINI_API_KEY is properly configured in settings.');
        }
        throw new Error('The scanning engine is currently under high demand. Please attempt extraction again in a few moments.');
      }
    }

    const responseText = result.response.text();
    console.log('AI Raw Response received. Length:', responseText.length);

    let aiParsed;
    try {
      aiParsed = cleanAndParseJSON(responseText);
    } catch (parseError: any) {
      console.error('JSON Parse Error from AI:', responseText);
      throw new Error(`Failed to extract structured data: ${parseError.message}`);
    }

    const flattened: any[] = [];
    const barangayData = aiParsed.barangays || aiParsed;

    for (const [brgy, incidents] of Object.entries(barangayData)) {
      if (Array.isArray(incidents)) {
        incidents.forEach((inc: any) => {
          // Normalize barangay name
          let normalizedBrgy = brgy.trim();
          if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
          if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');

          // Try to find the best match in VALID_BARANGAYS
          const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
          if (exactMatch) {
            normalizedBrgy = exactMatch;
          } else {
            const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
            if (partialMatch) normalizedBrgy = partialMatch;
          }

          flattened.push({
            barangay: normalizedBrgy,
            date_committed: inc.date || inc.date_committed || new Date().toISOString().split('T')[0],
            offense: inc.offense || inc.incident_type || "Unknown Incident",
            category: inc.category || (inc.offense && ['Theft', 'Robbery', 'Murder', 'Homicide', 'Physical Injury', 'Rape', 'Carnapping'].some(t => String(inc.offense).includes(t)) ? '8-Focus' : 'Non-Index'),
            description: inc.description || ""
          });
        });
      }
    }

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

const parsePhotos = (path: string | undefined): string[] => {
  if (!path) return [];
  try {
    const parsed = JSON.parse(path);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) { }
  return [path];
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
    const bulletins = snap.docs.map(doc => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    });
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
  const rawCategory = category === 'Other' ? custom_category : category;

  const encoded = encodeCustomCategory(rawCategory, body);

  try {
    const data: any = {
      title,
      category: encoded.category,
      body: encoded.body,
      posted_by: req.session.user.id,
      is_archived: false,
      created_at: new Date().toISOString()
    };

    if ((req as any).files && (req as any).files.length > 0) {
      const files = (req as any).files;
      const uploadedPaths: string[] = [];

      for (const file of files) {
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const path = `bulletins/${fileName}`;

        try {
          const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
          uploadedPaths.push(publicUrl);
          console.log(`[BULLETIN] Image uploaded successfully: ${publicUrl}`);
        } catch (storageErr) {
          console.error('[BULLETIN] Supabase Storage Error:', storageErr);
        }
      }

      if (uploadedPaths.length > 0) {
        data.photo_path = JSON.stringify(uploadedPaths);
      }
    }

    await logAction(req, 'BULLETIN_CREATE', `Created informational bulletin: ${title}`);
    await db.collection('bulletins').add(data);
    res.redirect('/admin/bulletins');
  } catch (err: any) {
    console.error(err);
    if (err.message && err.message.includes('bulletins_category_check')) {
      return res.status(500).send('Database Error: Custom categories are blocked by the current Supabase schema. Please run the SQL command in database.sql to drop the "bulletins_category_check" constraint.');
    }
    res.status(500).send('Error creating bulletin');
  }
};

export const getEditBulletin = async (req: Request, res: Response) => {
  try {
    const doc = await db.collection('bulletins').doc(req.params.id).get();
    const d = doc.data();
    const bulletin = decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    res.render('admin/bulletin_form', { title: 'Edit Bulletin', bulletin, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletin');
  }
};

export const postEditBulletin = async (req: Request, res: Response) => {
  const { title, category, custom_category, body, is_archived } = req.body;
  const rawCategory = category === 'Other' ? custom_category : category;

  const encoded = encodeCustomCategory(rawCategory, body);

  try {
    const data: any = {
      title,
      category: encoded.category,
      body: encoded.body,
      is_archived: is_archived === 'on' || is_archived === true,
      updated_at: new Date().toISOString()
    };

    if ((req as any).files && (req as any).files.length > 0) {
      const files = (req as any).files;
      const uploadedPaths: string[] = [];

      for (const file of files) {
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
        const path = `bulletins/${fileName}`;

        try {
          const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
          uploadedPaths.push(publicUrl);
          console.log(`[BULLETIN EDIT] Image updated: ${publicUrl}`);
        } catch (storageErr) {
          console.error('[BULLETIN EDIT] Supabase Storage Error:', storageErr);
        }
      }

      if (uploadedPaths.length > 0) {
        data.photo_path = JSON.stringify(uploadedPaths);
      }
    }

    await logAction(req, 'BULLETIN_EDIT', `Updated bulletin ID: ${req.params.id} (${title})`);
    await db.collection('bulletins').doc(req.params.id).update(data);
    res.redirect('/admin/bulletins');
  } catch (err: any) {
    console.error(err);
    if (err.message && err.message.includes('bulletins_category_check')) {
      return res.status(500).send('Database Error: Custom categories are blocked by the current Supabase schema. Please run the SQL command in database.sql to drop the "bulletins_category_check" constraint.');
    }
    res.status(500).send('Error updating bulletin');
  }
};

export const deleteBulletin = async (req: Request, res: Response) => {
  try {
    await logAction(req, 'BULLETIN_DELETE', `Deleted bulletin ID: ${req.params.id}`);
    await db.collection('bulletins').doc(req.params.id).delete();
    res.redirect('/admin/bulletins');
  } catch (err) {
    console.error(err);
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
  const { full_name, email, password } = req.body;

  // Generate a guaranteed unique username to prevent duplicate constraint errors
  const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(2, 8);
  const hash = bcrypt.hashSync(password, 10);
  try {
    // 🛡️ Backend Enforcement: Only superadmins can deploy new personnel
    if (req.session.user.role !== 'superadmin') {
      console.warn(`[SECURITY BREACH ATTEMPT] Non-admin ${req.session.user.username} tried to create personnel.`);
      return res.status(403).send('Forbidden: Insufficient tactical clearance.');
    }

    await logAction(req, 'USER_CREATE_PENDING', `Requested creation of administrative personnel: ${username} (Role: staff)`);

    const docRef = await db.collection('users').add({
      username,
      full_name,
      email: email || '',
      password_hash: hash,
      role: 'staff',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    // Force the email link to always point to the live Vercel server
    const baseUrl = 'https://pnp-sta-cruz-official.vercel.app';

    const approveUrl = `${baseUrl}/admin/users/${docRef.id}/approve`;
    const rejectUrl = `${baseUrl}/admin/users/${docRef.id}/reject`;

    const mailOptions = {
      from: 'Sta. Cruz Crime Mapping System <andreijavan06@gmail.com>',
      to: 'andreijavan05@gmail.com',
      subject: `Action Required: New Admin Account Approval - ${full_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #1a56db;">New Account Creation Request</h2>
          <p>Dear Police Chief,</p>
          <p>Please be informed that an administrative personnel, <strong>${req.session.user.full_name} (${req.session.user.username})</strong>, has submitted a request to create a new personnel account in the Sta. Cruz Crime Mapping system.</p>
          <p>For security purposes, new accounts remain in a "Pending" state and cannot access the system until they receive your explicit approval.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <h3 style="margin-bottom: 10px;">Pending Account Details:</h3>
          <ul style="list-style-type: none; padding: 0;">
            <li style="margin-bottom: 5px;"><strong>Full Name:</strong> ${full_name}</li>
            <li style="margin-bottom: 5px;"><strong>Email:</strong> ${email || 'N/A'}</li>
            <li style="margin-bottom: 5px;"><strong>Role:</strong> Staff</li>
          </ul>
          <p style="margin-top: 20px;">Please review the details above and choose whether to approve or reject this request by clicking one of the buttons below:</p>
          <br>
          <div style="display: flex; gap: 15px;">
            <a href="${approveUrl}" style="padding: 12px 24px; background-color: #059669; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Approve Account</a>
            <a href="${rejectUrl}" style="padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; margin-left: 10px;">Reject Account</a>
          </div>
        </div>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log('Approval email successfully sent to Police Chief');
    } catch (error) {
      console.error('Error sending approval email:', error);
    }

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
    const { delete_reason, custom_reason } = req.body;

    // Determine the final reason
    const finalReason = delete_reason === 'Other' ? custom_reason : delete_reason;
    const fallbackReason = 'Administrative Decision';
    const reasonText = finalReason || fallbackReason;

    if (userId === req.session.user.id) {
      return res.status(400).send('You cannot neutralize your own credentials while active.');
    }

    const docRef = db.collection('users').doc(userId);
    const snap = await docRef.get();
    if (!snap.exists) return res.status(404).send('Subject not found.');

    const userData = snap.data() as any;

    // Send email notification if user has an email
    if (userData.email) {
      const mailOptions = {
        from: 'Sta. Cruz Crime Mapping System <andreijavan06@gmail.com>',
        to: userData.email,
        subject: `Sta. Cruz Crime Mapping Account Notice`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #dc2626; margin: 0; padding: 0;">Account Access Revoked</h2>
            </div>
            <p>Dear ${userData.full_name},</p>
            <p>This is an official notice that your administrative account (<strong>${userData.username}</strong>) in the Sta. Cruz Crime Mapping system has been permanently neutralized and deleted by the system administrator.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="margin-bottom: 10px;"><strong>Reason for Neutralization:</strong></p>
            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
              <p style="margin: 0; color: #991b1b; font-weight: bold;">${reasonText}</p>
            </div>
            <p>You can no longer log into the Sta. Cruz Crime Mapping system. If you believe this is an error or require further clarification, please contact the Police Chief or your immediate superior.</p>
            <p style="font-size: 12px; color: #666; margin-top: 30px; text-align: center;">This is an automated operational message from the Sta. Cruz Crime Mapping Database System.</p>
          </div>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`Deletion notice email successfully sent to ${userData.email}`);
      } catch (emailErr) {
        console.error('Failed to send deletion notice email:', emailErr);
      }
    }

    await logAction(req, 'USER_DELETE', `Neutralized administrative credentials for: ${userData.username} | Reason: ${reasonText}`);
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

export const approveUser = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const docRef = db.collection('users').doc(userId);
    const snap = await docRef.get();

    const thankYouHtml = (title: string, message: string, color: string) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <div style="background: white; padding: 40px 20px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); text-align: center; max-width: 90%; width: 400px;">
          <div style="background-color: ${color}; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; margin: 0 auto 20px auto;">✓</div>
          <h1 style="color: #111827; font-size: 24px; margin: 0 0 10px 0;">Thank You!</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin: 0;">${message}</p>
          <p style="color: #9ca3af; font-size: 14px; margin-top: 30px;">You may now close this window.</p>
        </div>
      </body>
      </html>
    `;

    if (!snap.exists) return res.status(404).send(thankYouHtml('Account Not Found', 'This account request could not be found.', '#6b7280'));

    const userData = snap.data() as any;
    if (userData.status === 'active') {
      return res.send(thankYouHtml('Already Approved', 'This account has already been approved.', '#059669'));
    }

    await docRef.update({ status: 'active' });
    await logAction(req, 'USER_APPROVE', `Approved administrative credentials for: ${userData.username}`);

    // Send approval email to the new user
    if (userData.email) {
      const userMailOptions = {
        from: 'Sta. Cruz Crime Mapping System <andreijavan05@gmail.com>',
        to: userData.email,
        subject: 'Sta. Cruz Crime Mapping Account Approved',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #059669;">Account Approved!</h2>
            <p>Dear ${userData.full_name},</p>
            <p>Your Sta. Cruz Crime Mapping account has been <strong>approved</strong> by the Police Chief.</p>
            <p>You may now log in to the system using your email address: <strong>${userData.email}</strong></p>
            <br>
            <a href="https://pnp-sta-cruz-official.vercel.app/admin/login" style="padding: 12px 24px; background-color: #1a56db; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px;">Go to Login</a>
          </div>
        `
      };
      try {
        await transporter.sendMail(userMailOptions);
        console.log('Welcome email successfully sent to new user');
      } catch (err) {
        console.error('Error sending welcome email to user:', err);
      }
    }

    res.send(thankYouHtml('Approved Successfully', `You have approved the account for ${userData.full_name}.`, '#059669'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Error approving account.');
  }
};

export const rejectUser = async (req: Request, res: Response) => {
  try {
    const userId = req.params.id;
    const docRef = db.collection('users').doc(userId);
    const snap = await docRef.get();

    const thankYouHtml = (title: string, message: string, color: string) => `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
        <div style="background: white; padding: 40px 20px; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); text-align: center; max-width: 90%; width: 400px;">
          <div style="background-color: ${color}; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; margin: 0 auto 20px auto;">✓</div>
          <h1 style="color: #111827; font-size: 24px; margin: 0 0 10px 0;">Thank You!</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin: 0;">${message}</p>
          <p style="color: #9ca3af; font-size: 14px; margin-top: 30px;">You may now close this window.</p>
        </div>
      </body>
      </html>
    `;

    if (!snap.exists) return res.status(404).send(thankYouHtml('Account Not Found', 'This account request could not be found.', '#6b7280'));

    const userData = snap.data() as any;
    if (userData.status === 'rejected') {
      return res.send(thankYouHtml('Already Rejected', 'This account has already been rejected.', '#dc2626'));
    }

    await docRef.update({ status: 'rejected' });
    await logAction(req, 'USER_REJECT', `Rejected administrative credentials for: ${userData.username}`);

    // Send rejection email to the new user
    if (userData.email) {
      const userMailOptions = {
        from: 'Sta. Cruz Crime Mapping System <andreijavan05@gmail.com>',
        to: userData.email,
        subject: 'Account Request Update',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #dc2626;">Account Not Approved</h2>
            <p>Dear ${userData.full_name},</p>
            <p>Your request for a Sta. Cruz Crime Mapping account has been <strong>rejected</strong> by the Police Chief.</p>
            <p>If you believe this is a mistake, please contact your commanding officer.</p>
          </div>
        `
      };
      try {
        await transporter.sendMail(userMailOptions);
        console.log('Rejection email successfully sent to user');
      } catch (err) {
        console.error('Error sending rejection email to user:', err);
      }
    }

    res.send(thankYouHtml('Rejected Successfully', `You have rejected the account request for ${userData.full_name}.`, '#dc2626'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Error rejecting account.');
  }
};
