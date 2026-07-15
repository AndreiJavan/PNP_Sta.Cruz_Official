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

function getGptOssClient() {
  const apiKey = process.env.GPT_OSS_120B_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GPT_OSS_120B_API_KEY is not defined. Please configure it in your environment variables.');
  }

  if (!apiKey.startsWith('AIza')) {
    console.warn('CRITICAL WARNING: GPT_OSS_120B_API_KEY does not appear to be a valid Google API Key format.');
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

    if (!process.env.GPT_OSS_120B_API_KEY && !process.env.GEMINI_API_KEY) {
      console.error('CRITICAL: GPT_OSS_120B_API_KEY is missing from environment.');
      return res.status(500).json({ success: false, error: 'GPT-OSS 120B Error: API Key not configured. Please add GPT_OSS_120B_API_KEY to your environment.' });
    }

    const client = getGptOssClient();
    const primaryModel = 'gemini-2.5-flash';
    const fallbackModel = 'gemini-3.1-flash-lite';

    console.log(`[NEURAL SCAN] Initiating tactical extraction via GPT-OSS 120B (utilizing ${primaryModel})...`);
    let model = client.getGenerativeModel({ 
      model: primaryModel,
      generationConfig: { 
        responseMimeType: 'application/json',
        maxOutputTokens: 8192
      }
    });

    const prompt = `You are an expert in analyzing Philippine National Police (PNP) police records.

Your task is to analyze an uploaded Microsoft Excel workbook and extract police records accurately.

=================================================
OBJECTIVE
=================================================

The uploaded workbook contains police records, not full incident reports.

Each record usually contains only:

• Offense
• Date
• Location

Your responsibilities are to:

1. Identify the correct worksheet(s).
2. Extract every police record accurately.
3. Normalize duplicate offense names.
4. Assign the correct category based on the worksheet name.
5. Verify the extracted data before returning the final output.
6. Return only valid JSON.

=================================================
STEP 1 - IDENTIFY VALID WORKSHEETS
=================================================

First, examine every worksheet in the workbook.

Only process worksheets whose names closely match one of the following:

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

Examples of worksheets to ignore:

• Summary
• Dashboard
• Charts
• Graphs
• Statistics
• Pivot
• Pivot Table
• Legend
• Read Me
• Instructions
• Notes
• Totals

=================================================
STEP 2 - PROCESS WORKSHEETS
=================================================

Process worksheets in the following order:

1. 8-Focus
2. Non-Index
3. RIR / PSI

Process one worksheet completely before moving to the next.

Do not mix records between worksheets.

=================================================
STEP 3 - CATEGORY MAPPING
=================================================

Determine the category ONLY from the worksheet name.

Apply the following mapping:

Worksheet Name                Category

8 Focus                       8-Focus Crime
8-Focus                       8-Focus Crime
8 Focus Crimes                8-Focus Crime
8FOCUS                        8-Focus Crime

Non-Index                     Non-Index Crime
NON INDEX                     Non-Index Crime
NON-INDEX                     Non-Index Crime

RIR                           PSI
PSI                           PSI
RIR/PSI                       PSI
RIR - PSI                     PSI
RIR_PSI                       PSI

Do NOT determine the category from the offense.

Always use the worksheet name.

=================================================
STEP 4 - DATA EXTRACTION
=================================================

Extract only actual police records.

Extract ONLY the following fields:

• Offense
• Date
• Location

Do NOT create or infer any additional fields.

Do NOT generate fields such as:

• Time Committed
• Victim
• Suspect
• Narrative
• Case Number
• Reporting Officer
• Coordinates
• Barangay Code
• Evidence
• Remarks

Ignore:

• Empty rows
• Blank rows
• Worksheet titles
• Merged cells
• Totals
• Grand Totals
• Subtotals
• Summary rows
• Footer text
• Repeated headers
• Charts
• Graphs
• Notes

=================================================
STEP 5 - OFFENSE NORMALIZATION
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
COMPREHENSIVE DANGEROUS DRUGS ACT OF 2002 - RA 9165
Dangerous Drugs Act Violation
Comprehensive Dangerous Drugs Act

↓

Comprehensive Dangerous Drugs Act (RA 9165)

--------------------------------

SPECIAL PROTECTION OF CHILDREN AGAINST CHILD ABUSE...
RA 7610
Child Abuse
Anti-Child Abuse Law

↓

Child Abuse (RA 7610)

--------------------------------

ANTI-VIOLENCE AGAINST WOMEN AND THEIR CHILDREN ACT OF 2004
RA 9262
Anti-VAWC Act Violation

↓

Anti-VAWC (RA 9262)

--------------------------------

SAFE SPACES ACT
RA 11313
Gender Based Sexual Harassment

↓

Safe Spaces Act (RA 11313)

Normalize by removing:

• RPC article references
• RA numbers
• PD numbers
• BP numbers
• MC numbers
• Extra punctuation
• Duplicate wording
• Capitalization differences
• Extra spaces

Do NOT merge legally different offenses.

Keep these separate:

• Theft
• Qualified Theft

• Robbery
• Highway Robbery

• Homicide
• Reckless Imprudence Resulting to Homicide

• Physical Injury
• Less Serious Physical Injuries

• Carnapping
• Carnapping (Motorcycle)

=================================================
STEP 6 - LOCATION NORMALIZATION
=================================================

Normalize locations only for formatting.

Example:

brgy bubukal

↓

Brgy. Bubukal

Do not change the actual location.

Do not overwrite or invent missing locations.

When extracting Location/Barangay, refer to this valid list for Santa Cruz, Laguna, Philippines:
Alipit, Bagumbayan, Bubukal, Calios, Duhat, Gatid, Jasaan, Labuin, Malinao, Oogong, Pagsawitan, Palasan, Patimbao, Poblacion I (Barangay I), Poblacion II (Barangay II), Poblacion III (Barangay III), Poblacion IV (Barangay IV), Poblacion V (Barangay V), San Jose, San Juan, San Pablo Norte, San Pablo Sur, Santisima Cruz, Santo Angel Central, Santo Angel Norte, Santo Angel Sur

=================================================
STEP 7 - DATE EXTRACTION
=================================================

Extract the date exactly as it appears.

Convert Excel serial dates into standard date format if necessary.

If no valid date exists, return null.

Do not guess missing dates.

=================================================
STEP 8 - FINAL DATA VERIFICATION
=================================================

After processing all valid worksheets, verify the extracted data.

Ensure that:

• Every extracted record comes directly from the worksheet.
• Offense, Date, and Location belong to the same row.
• No records were invented.
• No rows were skipped unintentionally.
• No duplicate records exist with the exact same Offense, Date, and Location.
• Only records from valid worksheets are included.
• Every record is assigned to the correct category based on the worksheet name.
• Missing Date or Location should be returned as null.
• Records without an Offense should be ignored.
• Preserve the original row order whenever possible.

Perform one final consistency check before returning the response.

=================================================
OUTPUT FORMAT
=================================================

Return ONLY valid JSON.

{
  "worksheets": [
    {
      "worksheet": "8 Focus",
      "category": "8-Focus Crime",
      "records": [
        {
          "offense": "Theft",
          "date": "2026-01-15",
          "location": "Brgy. Bubukal"
        }
      ]
    },
    {
      "worksheet": "Non-Index",
      "category": "Non-Index Crime",
      "records": [
        {
          "offense": "Child Abuse (RA 7610)",
          "date": "2026-02-03",
          "location": "Brgy. San Jose"
        }
      ]
    },
    {
      "worksheet": "RIR",
      "category": "PSI",
      "records": [
        {
          "offense": "Vehicular Accident",
          "date": "2026-03-08",
          "location": "Brgy. Labuin"
        }
      ]
    }
  ]
}

=================================================
IMPORTANT RULES
=================================================

• Process only the valid worksheets.
• Ignore all unrelated worksheets.
• Always determine the category from the worksheet name.
• Convert every RIR worksheet to the category "PSI".
• Extract only Offense, Date, and Location.
• Do not invent missing information.
• Do not create fields that do not exist in the worksheet.
• Normalize duplicate offense names.
• Preserve legally distinct offenses.
• Verify all extracted records before returning the output.
• Return ONLY valid JSON.
• Do not include explanations, comments, Markdown, or additional text outside the JSON response.

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
          result = await model.generateContent([prompt, chunks[i]]);
          success = true;
        } catch (apiErr: any) {
          console.warn(`[RECOVERY] Primary model ${primaryModel} failed on chunk ${i + 1}, attempt ${attempt}. Error detail:`, apiErr.message || apiErr);
          console.warn(`Attempting fallback to ${fallbackModel}...`);
          try {
            const fallbackModelInstance = client.getGenerativeModel({ 
              model: fallbackModel,
              generationConfig: { 
                responseMimeType: 'application/json',
                maxOutputTokens: 8192
              }
            });
            result = await fallbackModelInstance.generateContent([prompt, chunks[i]]);
            success = true;
          } catch (fallbackErr: any) {
            console.error(`GPT-OSS 120B Fallback Error on chunk ${i + 1}, attempt ${attempt}:`, fallbackErr);
            if (apiErr.message?.includes('unregistered callers') || fallbackErr.message?.includes('unregistered callers')) {
              throw new Error('API Key is rejected. Ensure your GPT_OSS_120B_API_KEY is properly configured in settings.');
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

      const responseText = result.response.text();
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
          } else if (wsCategory === 'PSI') {
            mappedCategory = 'PSI';
          } else if (wsCategory === 'Non-Index Crime' || wsCategory === 'Non-Index') {
            mappedCategory = 'Non-Index';
          }

          if (ws.records && Array.isArray(ws.records)) {
            ws.records.forEach((rec: any) => {
              let rawOffense = rec.Offense || rec.offense || rec.incident_type || null;
              if (!rawOffense || String(rawOffense).trim() === '') {
                // Rule 9: If a record has a missing Offense, ignore the record
                return;
              }
              rawOffense = String(rawOffense).trim();

              const rawLoc = rec.Location || rec.location || rec.barangay || rec.Barangay || null;
              let normalizedBrgy: string | null = null;
              if (rawLoc && String(rawLoc).trim() !== '') {
                normalizedBrgy = String(rawLoc).trim();
                if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
                if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');

                const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
                if (exactMatch) {
                  normalizedBrgy = exactMatch;
                } else {
                  const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
                  if (partialMatch) normalizedBrgy = partialMatch;
                }
              }

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

              const rawDate = rec.Date || rec.date || rec.dateCommitted || rec.date_committed || null;
              const cleanD = rawDate ? String(rawDate).split('T')[0].split(' ')[0] : null;
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
          let rawOffense = inc.offense || inc.incident_type || inc.Offense || null;
          if (!rawOffense || String(rawOffense).trim() === '') {
            // Rule 9: If a record has a missing Offense, ignore the record
            return;
          }
          rawOffense = String(rawOffense).trim();

          const rawLoc = inc.barangay || inc.Location || inc.location || inc.Barangay || null;
          let normalizedBrgy: string | null = null;
          if (rawLoc && String(rawLoc).trim() !== '') {
            normalizedBrgy = String(rawLoc).trim();
            if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
            if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');

            const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
            if (exactMatch) {
              normalizedBrgy = exactMatch;
            } else {
              const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
              if (partialMatch) normalizedBrgy = partialMatch;
            }
          }

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

          const rawDate = inc.dateCommitted || inc.date_committed || inc.date || inc.Date || null;
          const cleanD = rawDate ? String(rawDate).split('T')[0].split(' ')[0] : null;

          flattened.push({
            barangay: normalizedBrgy,
            date_committed: cleanD,
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
              let rawOffense = inc.offense || inc.incident_type || inc.Offense || null;
              if (!rawOffense || String(rawOffense).trim() === '') {
                // Rule 9: If a record has a missing Offense, ignore the record
                return;
              }
              rawOffense = String(rawOffense).trim();

              const rawLoc = brgy || inc.Location || inc.location || inc.barangay || inc.Barangay || null;
              let normalizedBrgy: string | null = null;
              if (rawLoc && String(rawLoc).trim() !== '') {
                normalizedBrgy = String(rawLoc).trim();
                if (normalizedBrgy.startsWith('Brgy. ')) normalizedBrgy = normalizedBrgy.replace('Brgy. ', '');
                if (normalizedBrgy.startsWith('Barangay ')) normalizedBrgy = normalizedBrgy.replace('Barangay ', '');

                const exactMatch = VALID_BARANGAYS.find(b => b.toLowerCase() === normalizedBrgy.toLowerCase());
                if (exactMatch) {
                  normalizedBrgy = exactMatch;
                } else {
                  const partialMatch = VALID_BARANGAYS.find(b => b.toLowerCase().includes(normalizedBrgy.toLowerCase()) || normalizedBrgy.toLowerCase().includes(b.toLowerCase()));
                  if (partialMatch) normalizedBrgy = partialMatch;
                }
              }

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

              const rawDate = inc.dateCommitted || inc.date_committed || inc.date || inc.Date || null;
              const cleanD = rawDate ? String(rawDate).split('T')[0].split(' ')[0] : null;

              flattened.push({
                barangay: normalizedBrgy,
                date_committed: cleanD,
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

    // Server-side strict deduplication to avoid any repetition
    const seen = new Set<string>();
    const uniqueFlattened = flattened.filter((item: any) => {
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

      const rawTime = entry.time_committed || entry.time || null;
      const baseDesc = entry.description || 'Intel extracted';
      const finalDesc = rawTime ? `[Time: ${rawTime}] ${baseDesc}` : baseDesc;

      return {
        ref: db.collection('map_points').doc(),
        data: {
          lat: pin ? pin.lat : 0, lng: pin ? pin.lng : 0,
          incident_type: entry.incident_type || entry.offense,
          incident_date: entry.incident_date || entry.date || entry.date_committed,
          barangay: entry.barangay,
          description: finalDesc,
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

export const getAITrendsAnalysis = async (req: Request, res: Response) => {
  try {
    const selectedBarangay = req.query.barangay ? String(req.query.barangay).trim() : 'ALL';
    const selectedYear = req.query.year ? parseInt(String(req.query.year), 10) : new Date().getFullYear();

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
        analysis: `No active crime incidents recorded yet for Barangay ${selectedBarangay === 'ALL' ? 'overall' : selectedBarangay}.`
      });
    }

    // Build the Selected Year array of crime counts (matching the EJS bar graph exactly)
    const monthlyTrendData: { month: string; count: number }[] = [];
    for (let i = 0; i <= 11; i++) {
      const d = new Date(selectedYear, i, 1);
      const monthLabel = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });

      const count = filteredPoints.filter((p: any) => {
        if (!p.incident_date) return false;
        const pd = new Date(p.incident_date);
        return pd.getMonth() === i && pd.getFullYear() === selectedYear;
      }).length;

      monthlyTrendData.push({ month: monthLabel, count });
    }

    // Evaluate highest crime incident types for this barangay
    const crimeCounts: { [key: string]: number } = {};
    const categoryCounts: { [key: string]: number } = {};
    filteredPoints.forEach((p: any) => {
      const pd = new Date(p.incident_date);
      if (pd.getFullYear() === selectedYear) {
        if (p.incident_type) crimeCounts[p.incident_type] = (crimeCounts[p.incident_type] || 0) + 1;
        if (p.category) categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
      }
    });

    const sortedCrimes = Object.entries(crimeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // GPT-OSS 1208 Local Offline Trend & Pattern Analyzer
    const counts = monthlyTrendData.map(item => item.count);
    const totalCount = counts.reduce((a, b) => a + b, 0);

    let trend = "stable with minor fluctuations";
    if (totalCount > 0) {
      const halfLength = Math.floor(counts.length / 2);
      const firstHalf = counts.slice(0, halfLength).reduce((a, b) => a + b, 0);
      const secondHalf = counts.slice(halfLength).reduce((a, b) => a + b, 0);

      const diffPercent = (secondHalf - firstHalf) / (firstHalf || 1);
      if (diffPercent > 0.15) {
        trend = "experiencing a general upward trend";
      } else if (diffPercent < -0.15) {
        trend = "showing a steady downward trend";
      } else {
        trend = "fluctuating within a stable range";
      }
    }

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

    let analysisText = "";
    const barangayName = selectedBarangay === 'ALL' ? 'All Barangays' : 'Barangay ' + selectedBarangay;

    if (totalCount === 0) {
      analysisText = `The trend for ${selectedYear} shows that crime incidents across ${barangayName} remain exceptionally stable with zero active or recorded occurrences.\n\nThe pattern identified during this period indicates a highly secure, peaceful, and well-monitored local environment.`;
    } else {
      analysisText = `The trend for ${selectedYear} shows that crime incidents in ${barangayName} are currently ${trend}, showing a notable peak of ${peakCount} incident${peakCount === 1 ? '' : 's'} recorded in ${peakMonth}.\n\nThe pattern of criminal activity reveals that ${topCrime} remains the most common incident type with ${topCrimeCount} case${topCrimeCount === 1 ? '' : 's'} documented over this period.`;
    }

    res.json({
      success: true,
      analysis: analysisText
    });
  } catch (err: any) {
    console.error('GPT-OSS 1208 Analysis Error:', err);
    res.status(500).json({ success: false, error: err.message });
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
    const apiKey = process.env.GPT_OSS_120B_API_KEY || process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        const client = getGptOssClient();
        const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

        const response = await model.generateContent(prompt);
        const text = response.response.text();
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
    const currentYear = new Date().getFullYear();
    const currentYearStartStr = `${currentYear}-01-01`;

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
        return { id: doc.id, ...data, entry_type: entryType };
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
      if (!p.incident_date) return false;
      const d = new Date(p.incident_date);
      return !isNaN(d.getTime()) && d.getFullYear() === currentYear;
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
      const d = new Date(currentYear, i, 1);
      const monthLabel = d.toLocaleString('en-US', { month: 'short' });

      const mPoints = allPoints.filter((p: any) => {
        if (!p.incident_date) return false;
        const pd = new Date(p.incident_date);
        return pd.getMonth() === i && pd.getFullYear() === currentYear;
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
    const category = req.query.category as string;
    const limit = 20;
    const offset = (page - 1) * limit;

    let query: any = db.collection('bulletins');
    if (category) {
      query = query.where('category', '==', category);
    }
    
    const snap = await query.orderBy('created_at', 'desc').offset(offset).limit(limit).get();
    
    let countQuery: any = db.collection('bulletins');
    if (category) {
      countQuery = countQuery.where('category', '==', category);
    }
    const countSnap = await countQuery.count().get();

    const bulletins = snap.docs.map((doc: any) => {
      const d = doc.data();
      return decodeCustomCategory({ id: doc.id, ...d, photo_paths: parsePhotos(d.photo_path) });
    });
    const totalPages = Math.ceil(countSnap.data().count / limit);

    const title = category === 'Wanted Person' ? 'Wanted Persons' : 
                  category === 'Missing Person' ? 'Missing Persons' : 'Bulletins';

    res.render('admin/bulletins', { title, bulletins, currentPage: page, totalPages, category, layout: 'layouts/admin' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading bulletins');
  }
};

export const getCreateBulletin = (req: Request, res: Response) => {
  const category = req.query.category as string || '';
  res.render('admin/bulletin_form', { title: 'New Bulletin', bulletin: null, defaultCategory: category, layout: 'layouts/admin' });
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
      if (data && data.category === 'Wanted Person') {
        redirectUrl = '/admin/bulletins?category=Wanted%20Person';
      } else if (data && data.category === 'Missing Person') {
        redirectUrl = '/admin/bulletins?category=Missing%20Person';
      }
    }
    await logAction(req, 'BULLETIN_DELETE', `Deleted bulletin ID: ${req.params.id}`);
    await docRef.delete();
    res.redirect(redirectUrl);
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
    const currentYear = new Date().getFullYear();
    const currentYearStartStr = `${currentYear}-01-01`;

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
    const hotlines = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
        return { id: doc.id, ...data, entry_type: entryType };
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
