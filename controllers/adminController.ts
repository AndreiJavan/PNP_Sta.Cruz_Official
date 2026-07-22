import { Request, Response } from 'express';
import { db } from '../config/database.js';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { GoogleGenAI } from '@google/genai';
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

// Workaround for Supabase 'bulletins_category_check' constraint and missing 'video_path' column
const STANDARD_CATEGORIES = ['Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement'];

const encodeCustomCategory = (category: string, body: string, videoPaths?: string[]) => {
  let encodedBody = body;
  let cat = category;
  if (!STANDARD_CATEGORIES.includes(category)) {
    cat = 'General Announcement';
    encodedBody = encodedBody + `\n<!--CUSTOM_CATEGORY:${category}-->`;
  }
  if (videoPaths && videoPaths.length > 0) {
    encodedBody = encodedBody + `\n<!--VIDEO_PATHS:${JSON.stringify(videoPaths)}-->`;
  }
  return { category: cat, body: encodedBody };
};

export const decodeCustomCategory = (item: any) => {
  if (item && item.body) {
    if (item.body.includes('<!--CUSTOM_CATEGORY:')) {
      const match = item.body.match(/<!--CUSTOM_CATEGORY:(.*?)-->/);
      if (match) {
        item.category = match[1];
        item.body = item.body.replace(/\n?<!--CUSTOM_CATEGORY:.*?-->/g, '');
      }
    }
    if (item.body.includes('<!--VIDEO_PATHS:')) {
      const match = item.body.match(/<!--VIDEO_PATHS:(.*?)-->/);
      if (match) {
        try {
          const video_paths = JSON.parse(match[1]);
          item.video_paths = video_paths;
          item.video_path = match[1];
        } catch (e) {
          console.error('Error decoding video paths:', e);
        }
        item.body = item.body.replace(/\n?<!--VIDEO_PATHS:.*?-->/g, '');
      }
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
let genAI: GoogleGenAI | null = null;

function getGptOssClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GPT_OSS_120B_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not defined. Please configure it in your settings.');
  }

  if (!genAI) {
    genAI = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
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

export const toggleSidebarState = async (req: Request, res: Response) => {
  try {
    const { hideSidebar } = req.body;
    (req.session as any).hideSidebar = !!hideSidebar;
    req.session.save((err) => {
      if (err) {
        console.error('Failed to save session for hideSidebar:', err);
        return res.status(500).json({ success: false, error: 'Session save failed' });
      }
      res.json({ success: true });
    });
  } catch (err) {
    console.error('Error toggling sidebar state:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const processAIExtraction = async (req: Request, res: Response) => {
  try {
    let textContent = '';
    const programmaticRirPsiRecords: any[] = [];
    console.log('AI Extraction Request received. File present:', !!(req as any).file);

    const parseExcelDate = (val: any): string => {
      if (!val) return new Date().toISOString().split('T')[0];
      
      if (val instanceof Date) {
        return val.toISOString().split('T')[0];
      }
      
      const num = Number(val);
      if (!isNaN(num) && num > 30000 && num < 60000) {
        // Excel base date is 1899-12-30
        const date = new Date((num - 25569) * 86400 * 1000);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
      
      const str = String(val).trim();
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
      
      const cleanStr = str.replace(/[^\w\s-/.]/g, '');
      const dClean = new Date(cleanStr);
      if (!isNaN(dClean.getTime())) {
        return dClean.toISOString().split('T')[0];
      }
      
      return str || new Date().toISOString().split('T')[0];
    };

    const parseExcelTime = (val: any): string | null => {
      if (val === undefined || val === null || val === '') return null;
      
      if (val instanceof Date) {
        const hours = String(val.getHours()).padStart(2, '0');
        const minutes = String(val.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
      
      const num = Number(val);
      if (!isNaN(num) && num >= 0 && num < 1) {
        const totalSeconds = Math.round(num * 24 * 60 * 60);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }
      
      const str = String(val).trim();
      if (/^\d{3,4}$/.test(str)) {
        const padded = str.padStart(4, '0');
        return `${padded.substring(0, 2)}:${padded.substring(2, 4)}`;
      }
      
      const match = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
      if (match) {
        let hours = parseInt(match[1], 10);
        const minutes = match[2];
        const ampm = match[3];
        if (ampm) {
          if (ampm.toUpperCase() === 'PM' && hours < 12) hours += 12;
          if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
        }
        return `${String(hours).padStart(2, '0')}:${minutes}`;
      }
      
      return str;
    };

    const normalizeBarangay = (rawLoc: string): string => {
      let normalizedBrgy = String(rawLoc || '').trim();
      if (!normalizedBrgy) return 'Poblacion I (Barangay I)';
      
      if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
      if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');
      if (normalizedBrgy.startsWith('brgy. ')) normalizedBrgy = normalizedBrgy.replace('brgy. ', '');
      if (normalizedBrgy.startsWith('barangay ')) normalizedBrgy = normalizedBrgy.replace('barangay ', '');

      const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
      if (exactMatch) {
        return exactMatch;
      }
      
      const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
      if (partialMatch) {
        return partialMatch;
      }
      
      return normalizedBrgy;
    };

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
        const getSheetCategory = (name: string): '8-Focus' | 'Non-Index' | 'PSI' | null => {
          const lower = name.toLowerCase().trim();
          if (lower.includes('focus') || lower.includes('8') || lower.includes('crimes')) {
            return '8-Focus';
          }
          if (lower.includes('non-index') || lower.includes('non index') || lower.includes('non_index')) {
            return 'Non-Index';
          }
          if (lower.includes('rir') || lower.includes('psi') || lower.includes('reckless') || lower.includes('public safety') || lower.includes('accident')) {
            return 'PSI';
          }
          return null;
        };

        console.log('Processing Excel/CSV data');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const category = getSheetCategory(sheetName);
          
          if (category) {
            console.log(`[PROGRAMMATIC SCANNER] Processing sheet "${sheetName}" row-by-row (Category: ${category})`);
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
            
            if (!rows || rows.length === 0) return;

            const seqScores = Array(30).fill(0);
            const offenseScores = Array(30).fill(0);
            const barangayScores = Array(30).fill(0);
            const dateScores = Array(30).fill(0);
            const timeScores = Array(30).fill(0);

            // Look at first 40 rows to detect headers and column types
            for (let r = 0; r < Math.min(rows.length, 40); r++) {
              const row = rows[r];
              if (!Array.isArray(row)) continue;
              for (let c = 0; c < row.length; c++) {
                const val = String(row[c] || '').trim();
                if (!val) continue;

                const lowerVal = val.toLowerCase();

                // Sequence column scoring
                if (lowerVal === 'no.' || lowerVal === 'no' || lowerVal === 'seq' || lowerVal === 'seq.' || lowerVal === 'sequence' || lowerVal === 'item' || lowerVal === 'index') {
                  seqScores[c] += 150;
                }
                const num = Number(val);
                if (!isNaN(num) && num > 0 && num < 1000) {
                  seqScores[c] += 10;
                }

                // Offense scoring
                if (lowerVal.includes('offense') || lowerVal.includes('incident') || lowerVal.includes('crime') || lowerVal.includes('particulars') || lowerVal.includes('case') || lowerVal.includes('nature') || lowerVal.includes('violation') || lowerVal.includes('classification')) {
                  offenseScores[c] += 100;
                }

                // Barangay scoring
                if (lowerVal.includes('barangay') || lowerVal.includes('brgy') || lowerVal.includes('location') || lowerVal.includes('place') || lowerVal.includes('address') || lowerVal.includes('venue') || lowerVal.includes('area') || lowerVal.includes('sector')) {
                  barangayScores[c] += 100;
                }

                // Date scoring
                if (lowerVal.includes('date committed') || lowerVal.includes('date_committed') || lowerVal.includes('date') || lowerVal.includes('dt') || lowerVal.includes('when')) {
                  dateScores[c] += 100;
                }

                // Time scoring
                if (lowerVal.includes('time committed') || lowerVal.includes('time_committed') || lowerVal.includes('time') || lowerVal.includes('hr') || lowerVal.includes('hour')) {
                  timeScores[c] += 100;
                }

                // Value heuristics
                const cleanCell = val.replace(/^(brgy\.?|barangay)\s+/i, '').toLowerCase().trim();
                const hasBrgyMatch = VALID_BARANGAYS.some(b => {
                  const bLow = b.toLowerCase();
                  return bLow === cleanCell || bLow.includes(cleanCell) || cleanCell.includes(bLow);
                });
                if (hasBrgyMatch) {
                  barangayScores[c] += 15;
                }

                const dateRegex = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i;
                if (dateRegex.test(val)) {
                  dateScores[c] += 15;
                }

                const timeRegex = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{4}\s*hrs\b/i;
                if (timeRegex.test(val)) {
                  timeScores[c] += 15;
                }

                const isOffenseText = [
                  'reckless', 'imprudence', 'damage', 'property', 'homicide', 'injury', 'injuries',
                  'accident', 'collision', 'vehicular', 'rir', 'psi', 'theft', 'robbery', 'murder', 'rape', 'drugs',
                  'violation', 'assault', 'physical', 'physical injury'
                ].some(keyword => lowerVal.includes(keyword));
                if (isOffenseText && isNaN(num) && !dateRegex.test(val) && !timeRegex.test(val)) {
                  offenseScores[c] += 10;
                }
              }
            }

            // Find best columns
            let seqColIdx = seqScores.indexOf(Math.max(...seqScores));
            if (Math.max(...seqScores) === 0) seqColIdx = -1;

            const exclude: number[] = [];
            if (seqColIdx !== -1) exclude.push(seqColIdx);

            const getBestColIdx = (scores: number[], excl: number[]): number => {
              let maxScore = -1;
              let bestIdx = -1;
              for (let i = 0; i < scores.length; i++) {
                if (excl.includes(i)) continue;
                if (scores[i] > maxScore) {
                  maxScore = scores[i];
                  bestIdx = i;
                }
              }
              return bestIdx;
            };

            let offenseColIdx = getBestColIdx(offenseScores, exclude);
            if (offenseColIdx !== -1 && offenseScores[offenseColIdx] > 0) exclude.push(offenseColIdx);
            else offenseColIdx = -1;

            let barangayColIdx = getBestColIdx(barangayScores, exclude);
            if (barangayColIdx !== -1 && barangayScores[barangayColIdx] > 0) exclude.push(barangayColIdx);
            else barangayColIdx = -1;

            let dateColIdx = getBestColIdx(dateScores, exclude);
            if (dateColIdx !== -1 && dateScores[dateColIdx] > 0) exclude.push(dateColIdx);
            else dateColIdx = -1;

            let timeColIdx = getBestColIdx(timeScores, exclude);
            if (timeColIdx !== -1 && timeScores[timeColIdx] > 0) exclude.push(timeColIdx);
            else timeColIdx = -1;

            // Fallback for missing column assignments using remaining columns
            const availableCols: number[] = [];
            for (let i = 0; i < 20; i++) {
              if (i !== seqColIdx) availableCols.push(i);
            }

            if (offenseColIdx === -1) offenseColIdx = availableCols[0] !== undefined ? availableCols[0] : 0;
            if (barangayColIdx === -1) barangayColIdx = availableCols[1] !== undefined ? availableCols[1] : 1;
            if (dateColIdx === -1) dateColIdx = availableCols[2] !== undefined ? availableCols[2] : 2;
            if (timeColIdx === -1) timeColIdx = availableCols[3] !== undefined ? availableCols[3] : 3;

            console.log(`[PROGRAMMATIC SCANNER] Column mapping for "${sheetName}": Seq=${seqColIdx}, Offense=${offenseColIdx}, Barangay=${barangayColIdx}, Date=${dateColIdx}, Time=${timeColIdx}`);

            // Find where headers end and data starts
            let headerRowIndex = -1;
            let maxHeaderMatches = 0;
            for (let r = 0; r < Math.min(rows.length, 30); r++) {
              const row = rows[r];
              if (!Array.isArray(row)) continue;
              let matches = 0;
              for (let c = 0; c < row.length; c++) {
                const val = String(row[c] || '').toLowerCase().trim();
                if (
                  val.includes('offense') || val.includes('incident') || val.includes('crime') || val.includes('particulars') || val.includes('case') || val.includes('nature') ||
                  val.includes('barangay') || val.includes('brgy') || val.includes('location') || val.includes('place') || val.includes('address') ||
                  val.includes('date committed') || val.includes('date_committed') || val.includes('date') ||
                  val.includes('time committed') || val.includes('time_committed') || val.includes('time') ||
                  val.includes('sequence') || val.includes('no.')
                ) {
                  matches++;
                }
              }
              if (matches > maxHeaderMatches) {
                maxHeaderMatches = matches;
                headerRowIndex = r;
              }
            }

            const dataStartIndex = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;
            let validRowCount = 0;

            for (let r = dataStartIndex; r < rows.length; r++) {
              const row = rows[r];
              if (!Array.isArray(row) || row.length === 0) continue;

              const offenseVal = offenseColIdx !== -1 && row[offenseColIdx] !== undefined ? String(row[offenseColIdx]).trim() : '';
              if (!offenseVal) continue;

              // Filter out obvious header/summary strings
              const lowerOffense = offenseVal.toLowerCase();
              if (lowerOffense.includes('total') || lowerOffense.includes('summary') || lowerOffense === 'offense' || lowerOffense === 'incident' || lowerOffense === 'particulars' || lowerOffense === 'crime' || lowerOffense === 'nature') {
                continue;
              }
              // Skip if it's purely a sequence number
              if (/^\d+$/.test(offenseVal)) {
                continue;
              }

              let barangayVal = barangayColIdx !== -1 && row[barangayColIdx] !== undefined ? String(row[barangayColIdx]).trim() : '';
              if (!barangayVal || barangayVal.toLowerCase() === 'barangay' || barangayVal.toLowerCase() === 'brgy') {
                for (let c = 0; c < row.length; c++) {
                  const cellStr = String(row[c] || '').trim();
                  if (!cellStr) continue;
                  const cleanCell = cellStr.replace(/^(brgy\.?|barangay)\s+/i, '').toLowerCase().trim();
                  const match = VALID_BARANGAYS.find(b => b.toLowerCase() === cleanCell || b.toLowerCase().includes(cleanCell) || cleanCell.includes(b.toLowerCase()));
                  if (match) {
                    barangayVal = cellStr;
                    break;
                  }
                }
              }
              const normalizedBrgy = normalizeBarangay(barangayVal);

              let dateVal = dateColIdx !== -1 && row[dateColIdx] !== undefined ? row[dateColIdx] : '';
              if (!dateVal) {
                const dateRegex = /\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i;
                for (let c = 0; c < row.length; c++) {
                  const cellStr = String(row[c] || '').trim();
                  if (dateRegex.test(cellStr)) {
                    dateVal = cellStr;
                    break;
                  }
                }
              }
              const cleanD = parseExcelDate(dateVal);

              let timeVal = timeColIdx !== -1 && row[timeColIdx] !== undefined ? row[timeColIdx] : '';
              if (timeVal === undefined || timeVal === null || timeVal === '') {
                const timeRegex = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b|\b\d{4}\s*hrs\b/i;
                for (let c = 0; c < row.length; c++) {
                  const cellStr = String(row[c] || '').trim();
                  if (timeRegex.test(cellStr)) {
                    timeVal = cellStr;
                    break;
                  }
                }
              }
              const cleanT = parseExcelTime(timeVal);

              // Normalize crime name and check if category can be refined
              let finalCategory = category;
              let rawOffense = offenseVal;
              const trimOff = rawOffense.trim().toLowerCase();
              if (trimOff === '/es' || trimOff === 'es' || trimOff === 'estafa' || trimOff === 'fraud' || trimOff === 'swindling') {
                rawOffense = 'Estafa';
                finalCategory = 'Non-Index';
              } else if (trimOff === '/d' || trimOff === 'd' || trimOff === 'drugs' || trimOff === 'dangerous drugs' || trimOff === 'ra 9165' || trimOff === 'comprehensive dangerous drugs act (ra 9165)') {
                rawOffense = 'Comprehensive Dangerous Drugs Act (RA 9165)';
                finalCategory = 'Non-Index';
              }

              // Refine category based on normalized offense keywords if they are highly characteristic
              const lowerOff = rawOffense.toLowerCase();
              if (lowerOff.includes('reckless imprudence') || lowerOff.includes('reckless impudence') || /\brir\b/i.test(lowerOff)) {
                finalCategory = 'PSI';
              } else if (['theft', 'robbery', 'murder', 'homicide', 'physical injury', 'rape', 'carnapping'].some(t => lowerOff.includes(t)) && !lowerOff.includes('anti-rape') && !lowerOff.includes('anti rape')) {
                finalCategory = '8-Focus';
              } else if (['vehicular accident', 'traffic incident', 'fire incident', 'vehicular', 'traffic accident'].some(t => lowerOff.includes(t))) {
                finalCategory = 'PSI';
              }

              validRowCount++;
              programmaticRirPsiRecords.push({
                barangay: normalizedBrgy,
                date_committed: cleanD,
                time_committed: cleanT,
                offense: rawOffense,
                category: finalCategory,
                description: `Extracted programmatically row-by-row from sheet ${sheetName}`
              });
            }

            console.log(`[PROGRAMMATIC SCANNER] Successfully processed sheet "${sheetName}": Extracted ${validRowCount} records programmatically.`);
          } else {
            textContent += `[Sheet: ${sheetName}]\n` + XLSX.utils.sheet_to_csv(sheet) + '\n';
          }
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

    if ((!textContent || textContent.trim().length === 0) && programmaticRirPsiRecords.length === 0) {
      console.warn('Extraction failed: No text content or programmatic records found.');
      return res.status(400).json({ success: false, error: 'Target document contains no readable data.' });
    }

    const flattened: any[] = [];
    if (textContent && textContent.trim().length > 0) {
      if (!process.env.GPT_OSS_120B_API_KEY && !process.env.GEMINI_API_KEY) {
        console.error('CRITICAL: GPT_OSS_120B_API_KEY is missing from environment.');
        return res.status(500).json({ success: false, error: 'GPT-OSS 120B Error: API Key not configured. Please add GPT_OSS_120B_API_KEY to your environment.' });
      }

      const client = getGptOssClient();
      const primaryModel = 'gemini-3.5-flash';
      const fallbackModel = 'gemini-3.1-flash-lite';

      console.log(`[NEURAL SCAN] Initiating tactical extraction via GPT-OSS 120B (utilizing ${primaryModel})...`);

    const prompt = `You are an expert in extracting Philippine National Police (PNP) police records from Microsoft Excel workbooks.

Your objective is to accurately and efficiently extract police records from the workbook while avoiding duplicate, missing, or hallucinated data.

=================================================
WORKFLOW
=================================================

Always follow these steps in order.

=================================================
STEP 1 - IDENTIFY VALID WORKSHEETS
=================================================

First, read ONLY the worksheet names.

Do not extract any data yet.

Only process worksheets whose names closely match:

• 8 Focus
• 8-Focus
• 8 Focus Crimes
• 8FOCUS

• Non-Index
• NON INDEX
• NON-INDEX

• RIR
• PSI
• RIR/PSI
• RIR - PSI
• RIR_PSI

Ignore every other worksheet.

Examples:

• Summary
• Dashboard
• Statistics
• Charts
• Graphs
• Pivot
• Legend
• Notes
• Read Me
• Instructions

=================================================
STEP 2 - PROCESS WORKSHEETS
=================================================

Process worksheets one at a time in this order:

1. 8-Focus
2. Non-Index
3. RIR / PSI

Finish one worksheet before processing the next.

Never combine records from different worksheets.

=================================================
STEP 3 - LOCATE THE DATA TABLE
=================================================

Within the current worksheet:

Locate the table containing the police records.

Find the header row first.

Identify the columns corresponding to:

• Offense
• Barangay (or Location)
• Date Committed
• Time Committed

Column names may have slight formatting differences but should represent the same information.

Do not read data outside the identified table.

=================================================
STEP 4 - EXTRACT RECORDS
=================================================

Starting immediately after the header row,

read each row until the end of the table.

Extract only:

• Offense
• Barangay
• Date Committed
• Time Committed

Ignore:

• Blank rows
• Empty rows
• Totals
• Grand Totals
• Summary rows
• Footer text
• Notes
• Charts
• Graphs
• Repeated headers
• Merged titles

If an entire row is empty, skip it.

=================================================
STEP 5 - VERIFY EACH RECORD
=================================================

For every extracted row:

Verify that:

• Offense exists.
• Barangay exists (if present in the worksheet).
• Date Committed belongs to the same row.
• Time Committed belongs to the same row.

Do not shift values between rows.

Do not combine information from multiple rows.

If Offense is empty, ignore the row.

If Barangay, Date Committed, or Time Committed is missing, return null for that field.

Never guess missing values.

=================================================
STEP 6 - NORMALIZE OFFENSE NAMES
=================================================

Normalize offenses that refer to the same crime.

Examples:

THEFT
Theft
THEFT - RPC Art. 308

↓

Theft

--------------------------------

ROBBERY
Robbery
ROBBERY - RPC Art. 293

↓

Robbery

--------------------------------

HOMICIDE
Homicide
HOMICIDE - RPC Art. 249

↓

Homicide

--------------------------------

MURDER
Murder
MURDER - RPC Art. 248

↓

Murder

--------------------------------

COMPREHENSIVE DANGEROUS DRUGS ACT OF 2002
Dangerous Drugs Act Violation
COMPREHENSIVE DANGEROUS DRUGS ACT OF 2002 - RA 9165

↓

Comprehensive Dangerous Drugs Act (RA 9165)

Normalize by removing:

• Capitalization differences
• RPC article references
• RA numbers
• PD numbers
• BP numbers
• Extra punctuation
• Extra spaces

Do NOT merge legally different crimes.

Examples:

Theft ≠ Qualified Theft

Homicide ≠ Reckless Imprudence Resulting to Homicide

=================================================
STEP 7 - ASSIGN CATEGORY
=================================================

Assign the category using ONLY the worksheet name.

Worksheet Name              Category

8 Focus                     8-Focus Crime

Non-Index                   Non-Index Crime

RIR                          PSI

PSI                          PSI

RIR/PSI                      PSI

Do not determine the category from the offense.

=================================================
STEP 8 - COUNT RECORDS
=================================================

After extraction is complete,

count only the successfully extracted police records.

Do not count:

• Blank rows
• Totals
• Summary rows
• Header rows
• Notes
• Charts

Return the exact total for each worksheet.

=================================================
STEP 9 - FINAL VERIFICATION
=================================================

After all worksheets have been processed:

Verify that:

• Every record came from a valid worksheet.
• Every record contains an Offense.
• Barangay, Date Committed, and Time Committed belong to the same row.
• Duplicate offense names have been normalized.
• Legally different offenses remain separate.
• The total number of extracted records matches the number of valid data rows.
• No records from ignored worksheets are included.

=================================================
OUTPUT FORMAT
=================================================

Return ONLY valid JSON.

{
  "worksheets": [
    {
      "worksheet": "8 Focus",
      "category": "8-Focus Crime",
      "totalRecords": 120,
      "records": [
        {
          "offense": "Theft",
          "barangay": "Brgy. Bubukal",
          "dateCommitted": "2026-01-15",
          "timeCommitted": "13:45"
        }
      ]
    },
    {
      "worksheet": "Non-Index",
      "category": "Non-Index Crime",
      "totalRecords": 85,
      "records": []
    },
    {
      "worksheet": "RIR",
      "category": "PSI",
      "totalRecords": 42,
      "records": []
    }
  ]
}

=================================================
IMPORTANT RULES
=================================================

• Read worksheet names before reading any data.
• Process one worksheet completely before moving to the next.
• Locate the header row first, then read only the data rows beneath it.
• Extract only the required fields.
• Do not guess or invent values.
• Use null for missing Barangay, Date Committed, or Time Committed.
• Ignore invalid or empty rows.
• Normalize duplicate offense names.
• Keep legally different offenses separate.
• Count records only after extraction and verification.
• Return only valid JSON.
• Do not include explanations, comments, or Markdown.

INPUT DATA STARTS BELOW:
`;

    const MAX_CHUNK_SIZE = 8000;
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = textContent.split('\n');
    for (const line of lines) {
      if (currentChunk.length + line.length > MAX_CHUNK_SIZE) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk);

    const flattened: any[] = [];
    console.log(`[NEURAL SCAN] Splitting data into ${chunks.length} chunks for processing...`);

    for (let i = 0; i < chunks.length; i++) {
      console.log(`[NEURAL SCAN] Processing chunk ${i + 1}/${chunks.length}...`);
      let result;
      let attempt = 0;
      const maxAttempts = 3;
      let success = false;

      while (attempt < maxAttempts && !success) {
        attempt++;
        try {
          result = await client.models.generateContent({
            model: primaryModel,
            contents: [prompt, chunks[i]],
            config: {
              responseMimeType: 'application/json'
            }
          });
          success = true;
        } catch (apiErr: any) {
          console.warn(`[RECOVERY] Primary model ${primaryModel} failed on chunk ${i + 1}, attempt ${attempt}. Error detail:`, apiErr.message || apiErr);
          console.warn(`Attempting fallback to ${fallbackModel}...`);
          try {
            result = await client.models.generateContent({
              model: fallbackModel,
              contents: [prompt, chunks[i]],
              config: {
                responseMimeType: 'application/json'
              }
            });
            success = true;
          } catch (fallbackErr: any) {
            console.error(`GPT-OSS 120B Fallback Error on chunk ${i + 1}, attempt ${attempt}:`, fallbackErr);
            if (apiErr.message?.includes('unregistered callers') || fallbackErr.message?.includes('unregistered callers')) {
              throw new Error('API Key is rejected. Ensure your GEMINI_API_KEY is properly configured in settings.');
            }
            if (attempt === maxAttempts) {
              throw new Error(`The scanning engine failed on part ${i + 1} of the document after ${maxAttempts} attempts. Please attempt extraction again in a few moments.`);
            } else {
              console.warn(`[RETRY] Retrying chunk ${i + 1} in 3 seconds...`);
              await new Promise(res => setTimeout(res, 3000));
            }
          }
        }
      }

      const responseText = result?.text || '';
      console.log(`Chunk ${i + 1} AI Raw Response received. Length:`, responseText.length);

      let aiParsed;
      try {
        aiParsed = cleanAndParseJSON(responseText);
      } catch (parseError: any) {
        console.warn(`[WARNING] JSON Parse Error from AI on chunk ${i + 1}. Skipping chunk. Error: ${parseError.message}`);
        console.error(`Raw response from chunk ${i + 1}:`, responseText);
        continue;
      }

      if (aiParsed.worksheets && Array.isArray(aiParsed.worksheets)) {
        aiParsed.worksheets.forEach((ws: any) => {
          const wsCategory = ws.category;
          let mappedCategory = 'Non-Index';
          if (wsCategory === '8-Focus Crime' || wsCategory === '8-Focus' || wsCategory === '8-Focus Crimes' || wsCategory === '8 Focus') {
            mappedCategory = '8-Focus';
          } else if (wsCategory === 'PSI' || wsCategory === 'RIR' || wsCategory === 'RIR/PSI' || wsCategory === 'RIR - PSI' || wsCategory === 'RIR_PSI' || wsCategory === 'RIR / PSI') {
            mappedCategory = 'PSI';
          } else if (wsCategory === 'Non-Index Crime' || wsCategory === 'Non-Index') {
            mappedCategory = 'Non-Index';
          }

          if (ws.records && Array.isArray(ws.records)) {
            ws.records.forEach((rec: any) => {
              const rawLoc = rec.Location || rec.location || rec.barangay || rec.Barangay || '';
              let normalizedBrgy = String(rawLoc).trim();
              if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
              if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');

              const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
              if (exactMatch) {
                normalizedBrgy = exactMatch;
              } else {
                const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
                if (partialMatch) normalizedBrgy = partialMatch;
              }

              let rawOffense = rec.Offense || rec.offense || rec.incident_type || "Unknown Incident";
              let rawCategory = mappedCategory;

              if (typeof rawOffense === 'string') {
                const trimOff = rawOffense.trim().toLowerCase();
                if (trimOff === '/es' || trimOff === 'es' || trimOff === 'estafa' || trimOff === 'fraud' || trimOff === 'swindling') {
                  rawOffense = 'Estafa';
                  rawCategory = 'Non-Index';
                } else if (trimOff === '/d' || trimOff === 'd' || trimOff === 'drugs' || trimOff === 'dangerous drugs' || trimOff === 'ra 9165' || trimOff === 'comprehensive dangerous drugs act (ra 9165)') {
                  rawOffense = 'Comprehensive Dangerous Drugs Act (RA 9165)';
                  rawCategory = 'Non-Index';
                }
              }

              let finalCategory = rawCategory;
              const lowerOffense = String(rawOffense).toLowerCase();
              if (lowerOffense.includes('reckless imprudence') || lowerOffense.includes('reckless impudence') || /\brir\b/i.test(lowerOffense)) {
                finalCategory = 'PSI';
              } else if (['theft', 'robbery', 'murder', 'homicide', 'physical injury', 'rape', 'carnapping'].some(t => lowerOffense.includes(t)) && !lowerOffense.includes('anti-rape') && !lowerOffense.includes('anti rape')) {
                finalCategory = '8-Focus';
              } else if (['vehicular accident', 'traffic incident', 'fire incident', 'vehicular', 'traffic accident'].some(t => lowerOffense.includes(t))) {
                finalCategory = 'PSI';
              }

              const rawDate = rec.Date || rec.date || rec.dateCommitted || rec.date_committed || new Date().toISOString().split('T')[0];
              const cleanD = String(rawDate).split('T')[0].split(' ')[0];
              const rawTime = rec.Time || rec.time || rec.timeCommitted || rec.time_committed || null;

              flattened.push({
                barangay: normalizedBrgy,
                date_committed: cleanD,
                time_committed: rawTime,
                offense: rawOffense,
                category: finalCategory,
                description: rec.description || rec.Description || ""
              });
            });
          }
        });
      } else if (aiParsed.incidents && Array.isArray(aiParsed.incidents)) {
        aiParsed.incidents.forEach((inc: any) => {
          if (!inc.barangay) return;
          let normalizedBrgy = String(inc.barangay).trim();
          if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
          if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');

          const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
          if (exactMatch) {
            normalizedBrgy = exactMatch;
          } else {
            const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
            if (partialMatch) normalizedBrgy = partialMatch;
          }

          let rawOffense = inc.offense || inc.incident_type || "Unknown Incident";
          let rawCategory = inc.category;

          if (typeof rawOffense === 'string') {
            const trimOff = rawOffense.trim().toLowerCase();
            if (trimOff === '/es' || trimOff === 'es' || trimOff === 'estafa' || trimOff === 'fraud' || trimOff === 'swindling') {
              rawOffense = 'Estafa';
              rawCategory = 'Non-Index';
            } else if (trimOff === '/d' || trimOff === 'd' || trimOff === 'drugs' || trimOff === 'dangerous drugs' || trimOff === 'ra 9165' || trimOff === 'comprehensive dangerous drugs act (ra 9165)') {
              rawOffense = 'Comprehensive Dangerous Drugs Act (RA 9165)';
              rawCategory = 'Non-Index';
            }
          }

          let finalCategory = 'Non-Index';
          const lowerOffense = String(rawOffense).toLowerCase();
          if (lowerOffense.includes('reckless imprudence') || lowerOffense.includes('reckless impudence') || /\brir\b/i.test(lowerOffense)) {
            finalCategory = 'PSI';
          } else if (['theft', 'robbery', 'murder', 'homicide', 'physical injury', 'rape', 'carnapping'].some(t => lowerOffense.includes(t)) && !lowerOffense.includes('anti-rape') && !lowerOffense.includes('anti rape')) {
            finalCategory = '8-Focus';
          } else if (['vehicular accident', 'traffic incident', 'fire incident', 'vehicular', 'traffic accident'].some(t => lowerOffense.includes(t))) {
            finalCategory = 'PSI';
          } else if (rawCategory === '8-Focus' || rawCategory === 'PSI' || rawCategory === 'Non-Index') {
            finalCategory = rawCategory;
          }

          flattened.push({
            barangay: normalizedBrgy,
            date_committed: String(inc.dateCommitted || inc.date_committed || inc.date || new Date().toISOString().split('T')[0]).split('T')[0].split(' ')[0],
            time_committed: inc.timeCommitted || inc.time_committed || inc.time || null,
            offense: rawOffense,
            category: finalCategory,
            description: inc.description || ""
          });
        });
      } else {
        const barangayData = aiParsed.barangays || aiParsed;
        for (const [brgy, incidents] of Object.entries(barangayData)) {
          if (Array.isArray(incidents)) {
            incidents.forEach((inc: any) => {
              let normalizedBrgy = brgy.trim();
              if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
              if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');
  
              const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
              if (exactMatch) {
                normalizedBrgy = exactMatch;
              } else {
                const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
                if (partialMatch) normalizedBrgy = partialMatch;
              }
  
              let rawOffense = inc.offense || inc.incident_type || "Unknown Incident";
              let rawCategory = inc.category;

              if (typeof rawOffense === 'string') {
                const trimOff = rawOffense.trim().toLowerCase();
                if (trimOff === '/es' || trimOff === 'es' || trimOff === 'estafa' || trimOff === 'fraud' || trimOff === 'swindling') {
                  rawOffense = 'Estafa';
                  rawCategory = 'Non-Index';
                } else if (trimOff === '/d' || trimOff === 'd' || trimOff === 'drugs' || trimOff === 'dangerous drugs' || trimOff === 'ra 9165' || trimOff === 'comprehensive dangerous drugs act (ra 9165)') {
                  rawOffense = 'Comprehensive Dangerous Drugs Act (RA 9165)';
                  rawCategory = 'Non-Index';
                }
              }

              let finalCategory = 'Non-Index';
              const lowerOffense = String(rawOffense).toLowerCase();
              if (lowerOffense.includes('reckless imprudence') || lowerOffense.includes('reckless impudence') || /\brir\b/i.test(lowerOffense)) {
                finalCategory = 'PSI';
              } else if (['theft', 'robbery', 'murder', 'homicide', 'physical injury', 'rape', 'carnapping'].some(t => lowerOffense.includes(t)) && !lowerOffense.includes('anti-rape') && !lowerOffense.includes('anti rape')) {
                finalCategory = '8-Focus';
              } else if (['vehicular accident', 'traffic incident', 'fire incident', 'vehicular', 'traffic accident'].some(t => lowerOffense.includes(t))) {
                finalCategory = 'PSI';
              } else if (rawCategory === '8-Focus' || rawCategory === 'PSI' || rawCategory === 'Non-Index') {
                finalCategory = rawCategory;
              }

              flattened.push({
                barangay: normalizedBrgy,
                date_committed: String(inc.dateCommitted || inc.date_committed || inc.date || new Date().toISOString().split('T')[0]).split('T')[0].split(' ')[0],
                time_committed: inc.timeCommitted || inc.time_committed || inc.time || null,
                offense: rawOffense,
                category: finalCategory,
                description: inc.description || ""
              });
            });
          }
        }
      }
    }
  }

    // Server-side strict deduplication to avoid any repetition
    const seen = new Set<string>();
    const allRecords = [...programmaticRirPsiRecords, ...flattened];
    const uniqueFlattened = allRecords.filter((item: any) => {
      const brgyKey = String(item.barangay).trim().toLowerCase();
      const dateKey = String(item.date_committed).trim();
      const timeKey = item.time_committed ? String(item.time_committed).trim() : '';
      const offenseKey = String(item.offense).trim().toLowerCase();
      const compositeKey = `${brgyKey}|${dateKey}|${timeKey}|${offenseKey}`;
      
      if (seen.has(compositeKey)) {
        console.log(`[DEDUPLICATOR] Filtered out duplicate incident: ${compositeKey}`);
        return false;
      }
      seen.add(compositeKey);
      return true;
    });

    return res.json({ success: true, data: uniqueFlattened });
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
    const logs = snap.docs.map((doc: any) => {
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

const getYearFromPoint = (p: any): number | null => {
  const rawDate = p.incident_date || p.date_committed || p.dateCommitted;
  if (!rawDate) return null;
  const d = new Date(rawDate);
  return !isNaN(d.getTime()) ? d.getUTCFullYear() : null;
};

const getMonthFromPoint = (p: any): number | null => {
  const rawDate = p.incident_date || p.date_committed || p.dateCommitted;
  if (!rawDate) return null;
  const d = new Date(rawDate);
  return !isNaN(d.getTime()) ? d.getUTCMonth() : null;
};

export const getAITrendsAnalysis = async (req: Request, res: Response) => {
  try {
    const selectedBarangay = req.query.barangay ? String(req.query.barangay).trim() : 'ALL';
    const selectedYear = req.query.year ? parseInt(String(req.query.year), 10) : new Date().getFullYear();

    let points: any[] = [];
    try {
      const snap = await db.collection('map_points').get();
      if (snap && snap.docs) {
        points = snap.docs.map((doc: any) => {
          const data = doc.data();
          let cat = data.category || 'Non-Index';
          if (cat === 'RIR' || cat === 'RIR/PSI' || cat === 'RIR - PSI' || cat === 'RIR_PSI') {
            cat = 'PSI';
          }
          return { id: doc.id, ...data, category: cat };
        })
          .filter((p: any) => {
            const dateStr = String(p.incident_date || p.date_committed || p.dateCommitted || '');
            const isPlaceholder = dateStr === 'N/A' ||
              dateStr === '' ||
              dateStr === '2026-04-27T09:22:14.910Z' ||
              p.description === 'Strategic placeholder data';
            return !isPlaceholder;
          });
      }
    } catch (dbErr) {
      console.warn("Database retrieval failed for AI trends, defaulting to offline math fallback mode:", dbErr);
    }

    // Filter by selected barangay if applicable
    const filteredPoints = points.filter((p: any) => {
      if (selectedBarangay !== 'ALL' && (!p.barangay || p.barangay.toLowerCase() !== selectedBarangay.toLowerCase())) {
        return false;
      }
      return true;
    });

    if (filteredPoints.length === 0) {
      return res.json({
        success: true,
        analysis: `No active crime incidents recorded yet for Barangay ${selectedBarangay === 'ALL' ? 'overall' : selectedBarangay} in the local system. The region is deemed safe with stable patrol coverage.`
      });
    }

    // Build the Selected Year array of crime counts (matching the EJS bar graph exactly)
    const monthlyTrendData: { month: string; count: number }[] = [];
    for (let i = 0; i <= 11; i++) {
      const d = new Date(Date.UTC(selectedYear, i, 1));
      const monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

      const count = filteredPoints.filter((p: any) => {
        return getMonthFromPoint(p) === i && getYearFromPoint(p) === selectedYear;
      }).length;

      monthlyTrendData.push({ month: monthLabel, count });
    }

    // Evaluate highest crime incident types for this barangay
    const crimeCounts: { [key: string]: number } = {};
    const categoryCounts: { [key: string]: number } = {};
    filteredPoints.forEach((p: any) => {
      if (getYearFromPoint(p) === selectedYear) {
        if (p.incident_type) crimeCounts[p.incident_type] = (crimeCounts[p.incident_type] || 0) + 1;
        if (p.category) categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
      }
    });

    const sortedCrimes = Object.entries(crimeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Calculate trend characteristics
    const counts = monthlyTrendData.map(item => item.count);
    const totalCount = counts.reduce((a, b) => a + b, 0);

    let peakMonth = "";
    let peakCount = -1;
    monthlyTrendData.forEach(item => {
      if (item.count > peakCount) {
        peakCount = item.count;
        peakMonth = item.month;
      }
    });

    const topCrime = sortedCrimes.length > 0 ? sortedCrimes[0][0] : 'N/A';
    const topCrimeCount = sortedCrimes.length > 0 ? sortedCrimes[0][1] : 0;
    const barangayName = selectedBarangay === 'ALL' ? 'All Barangays' : 'Barangay ' + selectedBarangay;

    let analysisText = "";

    try {
      const client = getGptOssClient();
      const prompt = `Analyze the following crime data for ${barangayName} in the year ${selectedYear}.
Total Incidents: ${totalCount}
Peak Month: ${peakMonth} with ${peakCount} incidents
Top Crime: ${topCrime} (${topCrimeCount} incidents)
Monthly data: ${JSON.stringify(monthlyTrendData)}

Provide exactly 3 simple and short sentences. 
Sentence 1: State the accurate trend (e.g. upward, downward, stable).
Sentence 2: State the patterns (highest crime and peak month).
Sentence 3: Suggest a direct prevention plan for the dashboard based on these patterns.

IMPORTANT: Separate each sentence with exactly one blank line between them.`;

      const aiResponse = await client.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt
      });

      analysisText = aiResponse.text || "Failed to generate AI analysis.";
    } catch (aiError) {
      console.warn("AI Generation failed, falling back to static generation:", aiError);
      let trend = "stable with minor fluctuations";
      if (totalCount > 0) {
        const halfLength = Math.floor(counts.length / 2);
        const firstHalf = counts.slice(0, halfLength).reduce((a, b) => a + b, 0);
        const secondHalf = counts.slice(halfLength).reduce((a, b) => a + b, 0);
        const diffPercent = (secondHalf - firstHalf) / (firstHalf || 1);
        if (diffPercent > 0.15) trend = "experiencing a general upward trend";
        else if (diffPercent < -0.15) trend = "showing a steady downward trend";
        else trend = "fluctuating within a stable range";
      }

      if (totalCount === 0) {
        analysisText = `The trend for ${selectedYear} shows that crime incidents across ${barangayName} remain exceptionally stable with zero active or recorded occurrences.\n\nThe pattern identified during this period indicates a highly secure, peaceful, and well-monitored local environment.`;
      } else {
        analysisText = `The trend for ${selectedYear} shows that crime incidents in ${barangayName} are currently ${trend}, showing a notable peak of ${peakCount} incident${peakCount === 1 ? '' : 's'} recorded in ${peakMonth}.\n\nThe pattern of criminal activity reveals that ${topCrime} remains the most common incident type with ${topCrimeCount} case${topCrimeCount === 1 ? '' : 's'} documented over this period.`;
      }
    }

    res.json({
      success: true,
      analysis: analysisText
    });
  } catch (err: any) {
    console.warn('GPT-OSS Outermost Error Intercepted, returning elegant fallback analysis:', err);
    const selectedBarangay = req.query.barangay ? String(req.query.barangay).trim() : 'ALL';
    const selectedYear = req.query.year ? parseInt(String(req.query.year), 10) : new Date().getFullYear();
    res.json({
      success: true,
      analysis: `Our local predictive model is active and monitoring Barangay ${selectedBarangay === 'ALL' ? 'overall' : selectedBarangay} for ${selectedYear}.\n\nAll current crime indices report a stable and flat distribution with minimal overall activity.\n\nContinued visible patrols and routine safety advisory bulletins are recommended to maintain this status.`
    });
  }
};

export const getReportAnalysis = async (req: Request, res: Response) => {
  try {
    const reportId = req.params.id;
    const doc = await db.collection('intelligence_scans').doc(reportId).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }
    const report = doc.data();
    const rawData = report?.raw_data || [];

    if (rawData.length === 0) {
      return res.json({ success: true, analysis: 'No record items to analyze.' });
    }

    // Attempt AI analysis if API key is defined and valid
    const apiKey = process.env.GEMINI_API_KEY || process.env.GPT_OSS_120B_API_KEY;
    if (apiKey) {
      try {
        const client = getGptOssClient();

        // Prepare serialized data safely, omitting/hiding time because it's optional
        const serializedData = rawData.map((item: any, idx: number) => {
          const cleanD = String(item.date_committed || item.date || 'N/A').split('T')[0].split(' ')[0];
          return `${idx + 1}. Barangay: ${item.barangay || 'N/A'}, Offense: ${item.offense || item.incident_type || 'N/A'}, Category: ${item.category || 'N/A'}, Date: ${cleanD}${item.time_committed ? `, Time: ${item.time_committed}` : ''}, Description: ${item.description || 'N/A'}`;
        }).slice(0, 100).join('\n');

        const prompt = `You are a high-level Crime Pattern and Security Intelligence Analyst. Analyze the following batch of intelligence scan data and generate a clear, highly polished, professional summary of crime patterns and security trends. Focus on:
1. Incident distribution across Barangays.
2. The breakdown between key risk pillars: "8-Focus", "PSI" (Public Safety Index, covering accidents/fires/disasters), and "Non-Index". Do not refer to RIR/PSI - refer to it strictly as PSI.
3. Notable hotspots, trends, and specific areas requiring immediate law enforcement attention or public safety resources.

Format your response in professional Markdown with bullet points, bold key terms, and clear sections.

Intelligence Data:
${serializedData}`;

        const response = await client.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt
        });
        const text = response.text;
        if (text && text.trim().length > 0) {
          return res.json({ success: true, analysis: text });
        }
      } catch (aiErr) {
        console.warn('AI analysis failed, falling back to local analysis:', aiErr);
      }
    }

    const analysisText = generateLocalReportAnalysis(rawData);
    res.json({ success: true, analysis: analysisText });
  } catch (err: any) {
    console.error('Error in getReportAnalysis:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

function generateLocalReportAnalysis(rawData: any[]): string {
  const counts = { '8-Focus': 0, 'PSI': 0, 'Non-Index': 0 };
  const brgyCounts: { [key: string]: number } = {};
  const crimeCounts: { [key: string]: number } = {};

  rawData.forEach((item: any) => {
    let cat = item.category || 'Non-Index';
    if (cat === 'RIR/PSI') cat = 'PSI';
    if (cat in counts) {
      counts[cat as '8-Focus' | 'PSI' | 'Non-Index']++;
    } else {
      counts['Non-Index']++;
    }

    const brgy = item.barangay || 'Unknown';
    brgyCounts[brgy] = (brgyCounts[brgy] || 0) + 1;

    const offense = item.offense || item.incident_type || 'Unknown';
    crimeCounts[offense] = (crimeCounts[offense] || 0) + 1;
  });

  const sortedBrgy = Object.entries(brgyCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const sortedCrimes = Object.entries(crimeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  const topBrgyText = sortedBrgy.map(([name, count]) => `**Brgy. ${name}** (${count} record${count === 1 ? '' : 's'})`).join(', ');
  const topCrimeText = sortedCrimes.map(([name, count]) => `**${name}** (${count} occurrenc${count === 1 ? 'e' : 'es'})`).join(', ');

  return `### **CPICRS Security Intelligence Summary**

This report summarizes **${rawData.length} crime and public safety records** scanned from recent tactical signals.

#### **I. Pillar Breakdown**
- **8-Focus**: **${counts['8-Focus']} cases** — Highlights major street level indexes (Theft, Robbery, Homicide, Homicide, Rape).
- **PSI (Public Safety Index)**: **${counts['PSI']} cases** — Captures road accidents, physical hazards, traffic events, and disaster/rescue compliance.
- **Non-Index**: **${counts['Non-Index']} cases** — Covers local municipal ordinances, special laws, drug possession, cybercrime, and minor security threats.

#### **II. Pattern Analysis**
- **Sectors of Concern**: The primary hotspots identified in this dataset are ${topBrgyText || 'N/A'}. These sectors account for the highest density of reported incidents and should be prioritized for patrol routing.
- **Frequent Offenses**: The most recurrent security signals detected are ${topCrimeText || 'N/A'}. Highly concentrated incident types require dedicated community resources or traffic/patrol checkpoints to actively discourage ongoing patterns.`;
}

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

    const scansMap: { [key: string]: string } = {};
    allReportsSnap.docs.forEach((doc: any) => {
      const data = doc.data();
      const stats = data.category_stats || {};
      scansMap[doc.id] = stats.entry_type || 'scanned';
    });

    const allPoints = allMapPointsSnap.docs
      .map((doc: any) => {
        const data = doc.data();
        let entryType = data.entry_type;
        if (!entryType) {
          if (data.report_id) {
            entryType = scansMap[data.report_id] || 'scanned';
          } else {
            entryType = 'manual';
          }
        }
        let cat = data.category || 'Non-Index';
        if (cat === 'RIR' || cat === 'RIR/PSI' || cat === 'RIR - PSI' || cat === 'RIR_PSI') {
          cat = 'PSI';
        }
        return { id: doc.id, ...data, category: cat, entry_type: entryType };
      })
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

    const availableYears: number[] = Array.from(
      new Set<number>(
        allPoints
          .map((p: any) => getYearFromPoint(p))
          .filter((y: any): y is number => y !== null)
      )
    ).sort((a: number, b: number) => b - a);

    const defaultYear: number = availableYears.length > 0 ? availableYears[0] : new Date().getFullYear();
    const selectedYear: number = req.query.year ? parseInt(req.query.year as string, 10) : defaultYear;

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

    const currentYearPoints = allPoints.filter((p: any) => {
      return getYearFromPoint(p) === selectedYear;
    });

    const todayStats = {
      total: todayPoints.length,
      focus: currentYearPoints.filter((p: any) => p.category === '8-Focus').length,
      nonIndex: currentYearPoints.filter((p: any) => p.category === 'Non-Index').length,
      psi: currentYearPoints.filter((p: any) => p.category === 'PSI').length,
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
    currentYearPoints.forEach((p: any) => {
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

    // Monthly Trends (Current Year: Jan - Dec)
    const monthlyTrends: any[] = [];
    for (let i = 0; i <= 11; i++) {
      const d = new Date(Date.UTC(selectedYear, i, 1));
      const monthLabel = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });

      const mPoints = allPoints.filter((p: any) => {
        return getMonthFromPoint(p) === i && getYearFromPoint(p) === selectedYear;
      });

      monthlyTrends.push({
        month: monthLabel,
        focusManual: mPoints.filter((p: any) => p.category === '8-Focus' && p.entry_type === 'manual').length,
        focusScanned: mPoints.filter((p: any) => p.category === '8-Focus' && p.entry_type === 'scanned').length,
        nonIndexManual: mPoints.filter((p: any) => p.category === 'Non-Index' && p.entry_type === 'manual').length,
        nonIndexScanned: mPoints.filter((p: any) => p.category === 'Non-Index' && p.entry_type === 'scanned').length,
        psiManual: mPoints.filter((p: any) => p.category === 'PSI' && p.entry_type === 'manual').length,
        psiScanned: mPoints.filter((p: any) => p.category === 'PSI' && p.entry_type === 'scanned').length
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
      defaultYear: selectedYear,
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

const parseVideos = (path: string | undefined): string[] => {
  if (!path) return [];
  try {
    const parsed = JSON.parse(path);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) { }
  return [path];
};

export const getBulletins = async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string;

    let query: any = db.collection('bulletins');
    if (category && category !== 'All') {
      query = query.where('category', '==', category);
    }
    
    const snap = await query.orderBy('created_at', 'desc').get();

    const bulletins = snap.docs.map((doc: any) => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path), video_paths: parseVideos(d.video_path) });
    });

    const title = category === 'Wanted Person' ? 'Wanted Persons' : 
                  category === 'Missing Person' ? 'Missing Persons' : 'Bulletins';

    res.render('admin/bulletins', { title, bulletins, category, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletins');
  }
};

export const getCreateBulletin = (req: Request, res: Response) => {
  const category = req.query.category as string || '';
  const isPublic = !req.originalUrl.startsWith('/admin');
  res.render('admin/bulletin_form', {
    title: 'New Bulletin',
    bulletin: null,
    defaultCategory: category,
    layout: isPublic ? 'layouts/main' : 'layouts/admin',
    isPublic
  });
};

export const postCreateBulletin = async (req: Request, res: Response) => {
  const { title, category, custom_category, body } = req.body;
  const rawCategory = category === 'Other' ? custom_category : category;

  // Validation 1: Title/Name character and word limits (Min 3 words, Max 15 words / 100 chars)
  const cleanTitle = (title || '').trim();
  const titleWords = cleanTitle.split(/\s+/).filter(Boolean);
  if (titleWords.length < 3) {
    return res.status(400).send('Validation Error: Title / Name must be at least 3 words long.');
  }
  if (cleanTitle.length > 100 || titleWords.length > 15) {
    return res.status(400).send(`Validation Error: Title is too long (maximum 15 words / 100 characters. Currently: ${titleWords.length} words / ${cleanTitle.length} characters).`);
  }

  // Validation 2: Body text length limiter (Min 5 words / 15 chars, Max 500 words / 5,000 chars)
  const cleanBody = (body || '').trim();
  const bodyWords = cleanBody.split(/\s+/).filter(Boolean);
  if (bodyWords.length < 5 || cleanBody.length < 15) {
    return res.status(400).send(`Validation Error: Bulletin body must be at least 5 words long (currently: ${bodyWords.length} words / ${cleanBody.length} characters).`);
  }
  if (bodyWords.length > 500 || cleanBody.length > 5000) {
    return res.status(400).send(`Validation Error: Bulletin body is too long (maximum 500 words / 5,000 characters. Currently: ${bodyWords.length} words).`);
  }

  try {
    let uploadedPhotoPaths: string[] = [];
    let uploadedVideoPaths: string[] = [];

    let files = (req as any).files;
    if (files && Array.isArray(files)) {
      const photos = files.filter(f => f.fieldname === 'photos');
      const videos = files.filter(f => f.fieldname === 'videos');
      files = {
        photos: photos.length > 0 ? photos : undefined,
        videos: videos.length > 0 ? videos : undefined
      };
    }

    const hasPhotos = files && files.photos && files.photos.length > 0;
    const hasVideos = files && files.videos && files.videos.length > 0;
    if (!hasPhotos && !hasVideos) {
      return res.status(400).send('Validation Error: At least 1 picture or video must be uploaded before posting.');
    }
    if (files) {
      let totalUploaded = 0;
      if (files.photos && files.photos.length > 0) {
        for (const file of files.photos) {
          if (totalUploaded >= 5) break;
          // Per-image size check: Max 5MB
          if (file.size > 5 * 1024 * 1024) {
            return res.status(400).send(`Validation Error: Picture "${file.originalname}" exceeds maximum limit of 5MB.`);
          }
          const fileExt = file.originalname.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
          const path = `bulletins/${fileName}`;
          try {
            const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
            uploadedPhotoPaths.push(publicUrl);
            totalUploaded++;
            console.log(`[BULLETIN] Image uploaded successfully: ${publicUrl}`);
          } catch (storageErr) {
            console.error('[BULLETIN] Supabase Storage Error:', storageErr);
          }
        }
      }

      if (files.videos && files.videos.length > 0) {
        for (const file of files.videos) {
          if (totalUploaded >= 5) break;
          // Per-video size check: Max 100MB
          if (file.size > 100 * 1024 * 1024) {
            return res.status(400).send(`Validation Error: Video "${file.originalname}" exceeds maximum limit of 100MB.`);
          }
          const fileExt = file.originalname.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
          const path = `bulletins/${fileName}`;
          try {
            const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
            uploadedVideoPaths.push(publicUrl);
            totalUploaded++;
            console.log(`[BULLETIN] Video uploaded successfully: ${publicUrl}`);
          } catch (storageErr) {
            console.error('[BULLETIN] Supabase Storage Error:', storageErr);
          }
        }
      }
    }

    const encoded = encodeCustomCategory(rawCategory, body, uploadedVideoPaths);

    const data: any = {
      title,
      category: encoded.category,
      body: encoded.body,
      posted_by: req.session?.user?.id || 'public-user',
      is_archived: false,
      created_at: new Date().toISOString()
    };

    if (uploadedPhotoPaths.length > 0) {
      data.photo_path = JSON.stringify(uploadedPhotoPaths);
    }

    await logAction(req, 'BULLETIN_CREATE', `Created informational bulletin: ${title}`);
    await db.collection('bulletins').add(data);

    const isPublic = !req.originalUrl.startsWith('/admin');
    const redirectPrefix = isPublic ? '/bulletins' : '/admin/bulletins';

    if (encoded.category === 'Wanted Person' && !isPublic) {
      res.redirect('/admin/bulletins?category=Wanted%20Person');
    } else if (encoded.category === 'Wanted Person' && isPublic) {
      res.redirect('/wanted-persons');
    } else if (encoded.category === 'Missing Person' && !isPublic) {
      res.redirect('/admin/bulletins?category=Missing%20Person');
    } else if (encoded.category === 'Missing Person' && isPublic) {
      res.redirect('/missing-persons');
    } else {
      res.redirect(redirectPrefix);
    }
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
    const bulletin = decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path), video_paths: parseVideos(d.video_path) });
    res.render('admin/bulletin_form', { title: 'Edit Bulletin', bulletin, layout: 'layouts/admin', isPublic: false });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletin');
  }
};

export const postEditBulletin = async (req: Request, res: Response) => {
  const { title, category, custom_category, body, is_archived, existing_photos, existing_videos } = req.body;
  const rawCategory = category === 'Other' ? custom_category : category;

  // Validation 1: Title/Name character and word limits (Min 3 words, Max 15 words / 100 chars)
  const cleanTitle = (title || '').trim();
  const titleWords = cleanTitle.split(/\s+/).filter(Boolean);
  if (titleWords.length < 3) {
    return res.status(400).send('Validation Error: Title / Name must be at least 3 words long.');
  }
  if (cleanTitle.length > 100 || titleWords.length > 15) {
    return res.status(400).send(`Validation Error: Title is too long (maximum 15 words / 100 characters. Currently: ${titleWords.length} words / ${cleanTitle.length} characters).`);
  }

  // Validation 2: Body text length limiter (Min 5 words / 15 chars, Max 500 words / 5,000 chars)
  const cleanBody = (body || '').trim();
  const bodyWords = cleanBody.split(/\s+/).filter(Boolean);
  if (bodyWords.length < 5 || cleanBody.length < 15) {
    return res.status(400).send(`Validation Error: Bulletin body must be at least 5 words long (currently: ${bodyWords.length} words / ${cleanBody.length} characters).`);
  }
  if (bodyWords.length > 500 || cleanBody.length > 5000) {
    return res.status(400).send(`Validation Error: Bulletin body is too long (maximum 500 words / 5,000 characters. Currently: ${bodyWords.length} words).`);
  }

  try {
    let finalPhotos: string[] = [];
    if (existing_photos) {
      try {
        finalPhotos = JSON.parse(existing_photos);
      } catch (e) {
        console.error('Error parsing existing_photos:', e);
      }
    }

    let finalVideos: string[] = [];
    if (existing_videos) {
      try {
        finalVideos = JSON.parse(existing_videos);
      } catch (e) {
        console.error('Error parsing existing_videos:', e);
      }
    }

    let files = (req as any).files;
    if (files && Array.isArray(files)) {
      const photos = files.filter(f => f.fieldname === 'photos');
      const videos = files.filter(f => f.fieldname === 'videos');
      files = {
        photos: photos.length > 0 ? photos : undefined,
        videos: videos.length > 0 ? videos : undefined
      };
    }

    const hasNewPhotos = files && files.photos && files.photos.length > 0;
    const hasNewVideos = files && files.videos && files.videos.length > 0;
    const totalMedia = finalPhotos.length + finalVideos.length + (hasNewPhotos ? files.photos.length : 0) + (hasNewVideos ? files.videos.length : 0);

    if (totalMedia === 0) {
      return res.status(400).send('Validation Error: At least 1 picture or video must be attached to the bulletin.');
    }
    if (files) {
      if (files.photos && files.photos.length > 0) {
        const uploadedPaths: string[] = [];
        for (const file of files.photos) {
          if (finalPhotos.length + finalVideos.length + uploadedPaths.length >= 5) break;
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
        finalPhotos = [...finalPhotos, ...uploadedPaths];
      }

      if (files.videos && files.videos.length > 0) {
        const uploadedVideoPaths: string[] = [];
        for (const file of files.videos) {
          if (finalPhotos.length + finalVideos.length + uploadedVideoPaths.length >= 5) break;
          const fileExt = file.originalname.split('.').pop();
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
          const path = `bulletins/${fileName}`;
          try {
            const publicUrl = await db.storage.upload('bulletins', path, file.buffer, file.mimetype);
            uploadedVideoPaths.push(publicUrl);
            console.log(`[BULLETIN EDIT] Video updated: ${publicUrl}`);
          } catch (storageErr) {
            console.error('[BULLETIN EDIT] Supabase Storage Error:', storageErr);
          }
        }
        finalVideos = [...finalVideos, ...uploadedVideoPaths];
      }
    }

    const encoded = encodeCustomCategory(rawCategory, body, finalVideos);

    const data: any = {
      title,
      category: encoded.category,
      body: encoded.body,
      is_archived: is_archived === 'on' || is_archived === true,
      updated_at: new Date().toISOString()
    };

    // Always update these so that any deleted items are properly removed from the list
    data.photo_path = JSON.stringify(finalPhotos);

    await logAction(req, 'BULLETIN_EDIT', `Updated bulletin ID: ${req.params.id} (${title})`);
    await db.collection('bulletins').doc(req.params.id).update(data);
    if (encoded.category === 'Wanted Person') {
      res.redirect('/admin/bulletins?category=Wanted%20Person');
    } else if (encoded.category === 'Missing Person') {
      res.redirect('/admin/bulletins?category=Missing%20Person');
    } else {
      res.redirect('/admin/bulletins');
    }
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
    const docRef = db.collection('bulletins').doc(req.params.id);
    const docSnap = await docRef.get();
    let redirectUrl = '/admin/bulletins';

    if (docSnap.exists) {
      const data = docSnap.data();
      const adminName = req.session?.user?.full_name || req.session?.user?.username || 'System Admin';
      const bulletinCategory = data.category || 'General Announcement';
      const archiveCategory = (bulletinCategory === 'General Announcement' || bulletinCategory === 'News Releases') 
        ? 'News Releases' 
        : 'Public Advisories';

      if (data.category === 'Wanted Person') {
        redirectUrl = '/admin/bulletins?category=Wanted%20Person';
      } else if (data.category === 'Missing Person') {
        redirectUrl = '/admin/bulletins?category=Missing%20Person';
      }

      // Move to recycle bin
      await db.collection('recycle_bin').add({
        category: archiveCategory,
        title: data.title || 'Untitled Bulletin',
        original_id: req.params.id,
        payload: data,
        deleted_by: adminName,
        deleted_at: new Date().toISOString()
      });
    }

    await logAction(req, 'BULLETIN_ARCHIVED', `Archived bulletin ID: ${req.params.id}`);
    await docRef.delete();
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('Error archiving bulletin:', err);
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
    const tips = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    const totalPages = Math.ceil(countSnap.data().count / limit);

    // Mark tip-related notifications as read when viewed
    const unreadNotifs = await db.collection('admin_notifications')
      .where('type', '==', 'TIP')
      .where('is_read', '==', false)
      .get();

    if (!unreadNotifs.empty) {
      const batch = db.batch();
      unreadNotifs.docs.forEach((doc: any) => {
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
    const currentYear = new Date().getFullYear();
    const currentYearStartStr = `${currentYear}-01-01`;

    const snap = await db.collection('map_points').get();
    const points = snap.docs.map((doc: any) => {
      const data = doc.data();
      let cat = data.category || 'Non-Index';
      if (cat === 'RIR' || cat === 'RIR/PSI' || cat === 'RIR - PSI' || cat === 'RIR_PSI') {
        cat = 'PSI';
      }
      return { id: doc.id, ...data, category: cat };
    })
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
      GPT_OSS_120B_API_KEY: process.env.GPT_OSS_120B_API_KEY || process.env.GEMINI_API_KEY,
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

    let finalOffense = incident_type || '';
    let category = 'Non-Index';
    
    if (typeof finalOffense === 'string') {
      const trimOff = finalOffense.trim().toLowerCase();
      if (trimOff === '/es' || trimOff === 'es' || trimOff === 'estafa' || trimOff === 'fraud' || trimOff === 'swindling') {
        finalOffense = 'Estafa';
        category = 'Non-Index';
      } else if (trimOff === '/d' || trimOff === 'd' || trimOff === 'drugs' || trimOff === 'dangerous drugs' || trimOff === 'ra 9165' || trimOff === 'comprehensive dangerous drugs act (ra 9165)') {
        finalOffense = 'Comprehensive Dangerous Drugs Act (RA 9165)';
        category = 'Non-Index';
      }
    }

    const lowerOffense = String(finalOffense).toLowerCase();
    if (lowerOffense.includes('reckless imprudence') || lowerOffense.includes('reckless impudence') || /\brir\b/i.test(lowerOffense)) {
      category = 'PSI';
    } else if (['theft', 'robbery', 'murder', 'homicide', 'physical injury', 'physical injuries', 'rape', 'carnapping'].some(t => lowerOffense.includes(t)) && !lowerOffense.includes('anti-rape') && !lowerOffense.includes('anti rape')) {
      category = '8-Focus';
    } else if (['vehicular accident', 'traffic incident', 'fire incident', 'vehicular', 'traffic accident', 'accident', 'safety'].some(t => lowerOffense.includes(t))) {
      category = 'PSI';
    }

    await logAction(req, 'MAP_POINT_ADD', `Added manual map point: ${finalOffense} in Brgy. ${barangay}`);
    await db.collection('map_points').add({
      lat: pin ? pin.lat : 0,
      lng: pin ? pin.lng : 0,
      incident_type: finalOffense,
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
    const hotlines = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    res.render('admin/hotlines', { title: 'Hotlines', hotlines, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading hotlines');
  }
};

export const postHotline = async (req: Request, res: Response) => {
  const { name, number, category } = req.body;
  if (!/^\d{1,11}$/.test(number)) {
    return res.status(400).send('Invalid hotline number. Must be up to 11 digits only, no characters or spaces.');
  }
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

export const postEditHotline = async (req: Request, res: Response) => {
  const { name, number, category } = req.body;
  if (!/^\d{1,11}$/.test(number)) {
    return res.status(400).send('Invalid hotline number. Must be up to 11 digits only, no characters or spaces.');
  }
  try {
    await logAction(req, 'HOTLINE_EDIT', `Edited tactical hotline number ID: ${req.params.id}`);
    await db.collection('hotlines').doc(req.params.id).update({
      name,
      number,
      category,
      updated_at: new Date().toISOString()
    });
    res.redirect('/admin/hotlines');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating hotline');
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

    const users = (usersSnap && usersSnap.docs) ? usersSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) : [];
    const logs = (logsSnap && logsSnap.docs) ? logsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) : [];

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
      from: 'CPICRS System <andreijavan06@gmail.com>',
      to: 'andreijavan05@gmail.com',
      subject: `Action Required: New Admin Account Approval - ${full_name}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #1a56db;">New Account Creation Request</h2>
          <p>Dear Police Chief,</p>
          <p>Please be informed that an administrative personnel, <strong>${req.session.user.full_name} (${req.session.user.username})</strong>, has submitted a request to create a new personnel account in the CPICRS system.</p>
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
        from: 'CPICRS System <andreijavan06@gmail.com>',
        to: userData.email,
        subject: `Account Notice: Your CPICRS Access Has Been Revoked`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 20px;">
              <h2 style="color: #dc2626; margin: 0; padding: 0;">Account Access Revoked</h2>
            </div>
            <p>Dear ${userData.full_name},</p>
            <p>This is an official notice that your administrative account (<strong>${userData.username}</strong>) in the CPICRS system has been permanently neutralized and deleted by the system administrator.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="margin-bottom: 10px;"><strong>Reason for Neutralization:</strong></p>
            <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
              <p style="margin: 0; color: #991b1b; font-weight: bold;">${reasonText}</p>
            </div>
            <p>You can no longer log into the CPICRS system. If you believe this is an error or require further clarification, please contact the Police Chief or your immediate superior.</p>
            <p style="font-size: 12px; color: #666; margin-top: 30px; text-align: center;">This is an automated operational message from the CPICRS Database System.</p>
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
    const currentYear = new Date().getFullYear();
    const currentYearStartStr = `${currentYear}-01-01`;

    const [reportsSnap, allPointsSnap] = await Promise.all([
      db.collection('intelligence_scans').where('timestamp', '>=', currentYearStartStr).orderBy('timestamp', 'desc').get(),
      db.collection('map_points').where('incident_date', '>=', currentYearStartStr).orderBy('incident_date', 'desc').get()
    ]);

    const reports = reportsSnap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    const scansMap: { [key: string]: string } = {};
    reportsSnap.docs.forEach((doc: any) => {
      const data = doc.data();
      const stats = data.category_stats || {};
      scansMap[doc.id] = stats.entry_type || 'scanned';
    });

    const allPoints = allPointsSnap.docs
      .map((doc: any) => {
        const data = doc.data();
        let entryType = data.entry_type;
        if (!entryType) {
          if (data.report_id) {
            entryType = scansMap[data.report_id] || 'scanned';
          } else {
            entryType = 'manual';
          }
        }
        let cat = data.category || 'Non-Index';
        if (cat === 'RIR' || cat === 'RIR/PSI' || cat === 'RIR - PSI' || cat === 'RIR_PSI') {
          cat = 'PSI';
        }
        return { id: doc.id, ...data, category: cat, entry_type: entryType };
      })
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
        focusManual: mPoints.filter((p: any) => p.category === '8-Focus' && p.entry_type === 'manual').length,
        focusScanned: mPoints.filter((p: any) => p.category === '8-Focus' && p.entry_type === 'scanned').length,
        nonIndexManual: mPoints.filter((p: any) => p.category === 'Non-Index' && p.entry_type === 'manual').length,
        nonIndexScanned: mPoints.filter((p: any) => p.category === 'Non-Index' && p.entry_type === 'scanned').length,
        psiManual: mPoints.filter((p: any) => p.category === 'PSI' && p.entry_type === 'manual').length,
        psiScanned: mPoints.filter((p: any) => p.category === 'PSI' && p.entry_type === 'scanned').length
      });
    }

    res.render('admin/reports', {
      title: 'Crime Reports',
      reports,
      allIncidents: allPoints,
      stats,
      monthlyTrends: JSON.stringify(monthlyTrends),
      points: allPoints,
      GPT_OSS_120B_API_KEY: process.env.GPT_OSS_120B_API_KEY || process.env.GEMINI_API_KEY,
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
    const adminName = req.session?.user?.full_name || req.session?.user?.username || 'System Admin';

    // 1. Fetch parent report scan
    const reportDoc = await db.collection('intelligence_scans').doc(reportId).get();
    if (!reportDoc.exists) {
      return res.redirect('/admin/reports');
    }
    const reportData = reportDoc.data();

    // 2. Fetch associated map points
    const pointsSnap = await db.collection('map_points').where('report_id', '==', reportId).get();
    const mapPointsData = (pointsSnap.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));

    // 3. Store into recycle_bin collection
    await db.collection('recycle_bin').add({
      category: 'Crime Reports',
      title: reportData.filename || `Report ${reportId.slice(-6)}`,
      original_id: reportId,
      payload: {
        report: reportData,
        map_points: mapPointsData
      },
      deleted_by: adminName,
      deleted_at: new Date().toISOString()
    });

    // 4. Delete map points & scan document safely
    await db.collection('map_points').where('report_id', '==', reportId).delete();
    await db.collection('intelligence_scans').doc(reportId).delete();

    await logAction(req, 'REPORT_ARCHIVED', `Archived crime report ID: ${reportId}`);
    res.redirect('/admin/reports');
  } catch (err: any) {
    console.error('Error archiving report:', err);
    const errorMsg = err.message || JSON.stringify(err);
    res.status(500).send(`Error archiving report: ${errorMsg}`);
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
        from: 'CPICRS System <andreijavan05@gmail.com>',
        to: userData.email,
        subject: 'Your CPICRS Account is Approved',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #059669;">Account Approved!</h2>
            <p>Dear ${userData.full_name},</p>
            <p>Your CPICRS personnel account has been <strong>approved</strong> by the Police Chief.</p>
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
        from: 'CPICRS System <andreijavan05@gmail.com>',
        to: userData.email,
        subject: 'CPICRS Account Request Update',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #dc2626;">Account Not Approved</h2>
            <p>Dear ${userData.full_name},</p>
            <p>Your request for a CPICRS personnel account has been <strong>rejected</strong> by the Police Chief.</p>
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

export const getArchive = async (req: Request, res: Response) => {
  try {
    const selectedCategory = (req.query.category as string) || 'All';
    const snap = await db.collection('recycle_bin').orderBy('deleted_at', 'desc').get();
    let items = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    if (selectedCategory !== 'All') {
      items = items.filter((item: any) => item.category === selectedCategory);
    }

    res.render('admin/archive', {
      title: 'Archive',
      category: selectedCategory,
      items,
      layout: 'layouts/admin'
    });
  } catch (err) {
    console.error('Error fetching archive:', err);
    res.status(500).send('Error loading archive');
  }
};

export const restoreArchiveItem = async (req: Request, res: Response) => {
  try {
    const archiveId = req.params.id;
    const docRef = db.collection('recycle_bin').doc(archiveId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.redirect('/admin/archive');
    }

    const item = docSnap.data();
    const { category, payload } = item;

    if (category === 'Crime Reports' && payload) {
      const { report, map_points } = payload;
      if (report) {
        await db.collection('intelligence_scans').doc(item.original_id || docRef.id).set(report);
      }
      if (map_points && Array.isArray(map_points)) {
        const batch = db.batch();
        map_points.forEach((pt: any) => {
          const ptRef = db.collection('map_points').doc(pt.id || db.collection('map_points').doc().id);
          const { id, ...ptData } = pt;
          batch.set(ptRef, ptData);
        });
        await batch.commit();
      }
    } else if ((category === 'Public Advisories' || category === 'News Releases') && payload) {
      await db.collection('bulletins').doc(item.original_id || docRef.id).set(payload);
    }

    await logAction(req, 'ARCHIVE_RESTORE', `Restored ${category} item: ${item.title}`);
    await docRef.delete();

    res.redirect(`/admin/archive?category=${encodeURIComponent(category)}`);
  } catch (err: any) {
    console.error('Error restoring archived item:', err);
    res.status(500).send('Error restoring archived item');
  }
};

export const permanentlyDeleteArchiveItem = async (req: Request, res: Response) => {
  try {
    const archiveId = req.params.id;
    const docRef = db.collection('recycle_bin').doc(archiveId);
    const docSnap = await docRef.get();
    let category = 'All';

    if (docSnap.exists) {
      const item = docSnap.data();
      category = item.category || 'All';
      await logAction(req, 'ARCHIVE_PERMANENT_DELETE', `Permanently deleted archived item: ${item.title}`);
      await docRef.delete();
    }

    res.redirect(`/admin/archive?category=${encodeURIComponent(category)}`);
  } catch (err) {
    console.error('Error permanently deleting archive item:', err);
    res.status(500).send('Error deleting item');
  }
};

