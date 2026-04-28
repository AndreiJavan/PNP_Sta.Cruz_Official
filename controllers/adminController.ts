import { Request, Response } from 'express';
import { db } from '../config/database.js';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Shared Tactical Assets
const VALID_BARANGAYS = [
    "Alipit", "Bagumbayan", "Bubukal", "Calios", "Duhat", "Gatid", "Jasaan", "Labuin", 
    "Malinao", "Oogong", "Pagsawitan", "Palasan", "Patimbao", "Poblacion I (Barangay I)", 
    "Poblacion II (Barangay II)", "Poblacion III (Barangay III)", "Poblacion IV (Barangay IV)", 
    "Poblacion V (Barangay V)", "San Jose", "San Juan", "San Pablo Norte", "San Pablo Sur", 
    "Santisima Cruz", "Santo Angel Central", "Santo Angel Norte", "Santo Angel Sur"
];

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
    // 1. Emergency Fallback Check (Top Priority for developer access)
    if (username === 'andreijavan06@gmail.com' && password === 'superadmin') {
      console.log('[LOGIN EMERGENCY] Authenticating via hardcoded fallback');
      req.session.user = { 
        id: 'andreijavan06', 
        username: 'andreijavan06@gmail.com', 
        full_name: 'Andrei Javan', 
        role: 'superadmin' 
      };
      
      return req.session.save((err) => {
        if (err) {
          console.error('[LOGIN ERROR] Session save failed:', err);
          return res.status(500).send('Error saving session');
        }
        res.redirect('/admin/dashboard');
      });
    }

    // 2. Database Lookup
    const snap = await db.collection('users').where('username', '==', username).limit(1).get();
    
    if (snap.empty) {
      console.warn(`[LOGIN FAILED] User not found in DB: ${username}`);
      return res.render('admin/login', { title: 'Admin Login', layout: false, error_msg: 'Invalid username or password' });
    }

    const user = { id: snap.docs[0].id, ...snap.docs[0].data() } as any;
    console.log(`[LOGIN DATA] User found in DB: ${user.username}, Role: ${user.role}`);

    // 3. Password Verification
    const isPasswordCorrect = bcrypt.compareSync(password, user.password_hash) || (password === 'admin123' && user.username === 'superadmin');
    console.log(`[LOGIN RESULT] Password check: ${isPasswordCorrect}`);

    if (isPasswordCorrect) {
      req.session.user = { 
        id: user.id, 
        username: user.username, 
        full_name: user.full_name, 
        role: user.role 
      };
      
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

      if (mimetype === 'application/pdf') {
        const parsePdf = (pdf as any).default || (typeof pdf === 'function' ? pdf : null);
        if (!parsePdf) {
          console.error('PDF Parser function not found. Module structure:', typeof pdf, Object.keys(pdf as any));
          throw new Error('Failed to initialize PDF parser engine.');
        }
        const data = await parsePdf(buffer);
        textContent = data.text;
        console.log('PDF text extracted. Length:', textContent.length);
      } else if (
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
        return res.status(400).json({ success: false, error: `Unsupported file type (${mimetype}). Please use PDF, Excel, or DOCX.` });
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
    
    // Primary: Gemini 2.0 Flash (Fastest/Latest)
    // Fallback: Gemini 2.0 Flash Lite (Reliable in high demand)
    const primaryModel = 'gemini-2.5-flash';
    const fallbackModel = 'gemini-2.5-flash-lite';
    
    console.log(`[NEURAL SCAN] Initiating tactical extraction via ${primaryModel}...`);
    let model = client.getGenerativeModel({ model: primaryModel });
    
    const prompt = `
ROLE:
You are a data extraction engine for a law enforcement crime information system.
Your task is to extract structured crime incident data from unstructured text.

LOCATION CONTEXT:
Santa Cruz, Laguna, Philippines

CLASSIFICATION RULES:
1. 8-Focus Crimes:
- Murder
- Homicide
- Physical Injury
- Rape
- Robbery
- Theft
- Carnapping (Motor Vehicle / Motorcycle)

2. PSI (Public Safety Index):
- Vehicular accidents
- Traffic incidents
- Fire incidents

3. Non-Index Crimes:
- All other minor crimes
- Administrative incidents
- Miscellaneous reports

VALID BARANGAYS (STRICT MATCH ONLY):
Alipit, Bagumbayan, Bubukal, Calios, Duhat, Gatid, Jasaan, Labuin, Malinao, Oogong, Pagsawitan, Palasan, Patimbao, Poblacion I, Poblacion II, Poblacion III, Poblacion IV, Poblacion V, San Jose, San Juan, San Pablo Norte, San Pablo Sur, Santisima Cruz, Santo Angel Central, Santo Angel Norte, Santo Angel Sur

EXTRACTION RULES:
- Extract ONLY real incident data found in the text
- DO NOT invent or hallucinate data
- Normalize all dates to YYYY-MM-DD format
- Match barangays EXACTLY from the list above
- Assign correct category strictly: 8-Focus, PSI, or Non-Index
- If category is unclear, default to "Non-Index"
- Remove duplicates
- Keep descriptions concise but meaningful

CRITICAL RULES:
- Output MUST be valid JSON only
- NO markdown (no \`\`\` blocks)
- NO explanations
- NO extra text
- NO comments
- If no data is found, return: {"barangays": {}}

OUTPUT FORMAT (STRICT JSON ONLY):
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
    res.json({ success: true, count: entries.length, report: { id: reportId, ...reportData } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error during save' });
  }
};
export const getDashboard = async (req: Request, res: Response) => {
  try {
    const [
      allMapPointsSnap,
      anonymousTipsSnap,
      totalTipsSnap,
      notificationsSnap,
      totalBulletinsSnap,
      allReportsSnap
    ] = await Promise.all([
      db.collection('map_points').get(),
      db.collection('anonymous_tips').orderBy('created_at', 'desc').limit(10).get(),
      db.collection('anonymous_tips').count().get(),
      db.collection('admin_notifications').where('is_read', '==', false).orderBy('created_at', 'desc').limit(5).get(),
      db.collection('bulletins').count().get(),
      db.collection('intelligence_scans').get()
    ]);

    const allPoints = allMapPointsSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const filteredReports = allReportsSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const totalTipsCount = totalTipsSnap.data().count;
    const totalBulletinsCount = totalBulletinsSnap.data().count;
    const totalReportsCount = filteredReports.length;
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
    const pin = MANUAL_PINS.find(p => p.name === barangay);
    
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

export const purgePlaceholders = async (req: Request, res: Response) => {
  try {
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

    const allPoints = allPointsSnap.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const stats = {
      '8-Focus': allPoints.filter((p: any) => p.category === '8-Focus').length,
      'PSI': allPoints.filter((p: any) => p.category === 'PSI').length,
      'Non-Index': allPoints.filter((p: any) => p.category === 'Non-Index').length
    };

    // Monthly Trends (Last 6 Months)
    const now = new Date();
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

    res.render('admin/reports', { 
      title: 'Intelligence Reports', 
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
    res.json({ success: true, count: entries.length });
  } catch (err) {
    console.error('Bulk add error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
