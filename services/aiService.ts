import { GoogleGenerativeAI } from '@google/generative-ai';
import { VALID_BARANGAYS } from '../constants/tactical_assets.js';

let genAI: GoogleGenerativeAI | null = null;

function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not defined.');
    }
    if (!genAI) {
        genAI = new GoogleGenerativeAI(apiKey);
    }
    return genAI;
}

function cleanAndParseJSON(text: string) {
    try {
        return JSON.parse(text);
    } catch (e) {
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            try {
                return JSON.parse(jsonMatch[1]);
            } catch (innerError) {
                throw new Error('Failed to parse JSON inside markdown blocks.');
            }
        }
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

export const extractTacticalData = async (textContent: string) => {
    const client = getGeminiClient();
    const primaryModel = 'gemini-2.0-flash';
    const fallbackModel = 'gemini-2.0-flash-lite';

    let model = client.getGenerativeModel({ model: primaryModel });

    const prompt = `
ROLE:
You are a strict data extraction engine for a law enforcement crime information system.
You ONLY extract structured crime incident data from the provided text.
LOCATION CONTEXT: Santa Cruz, Laguna, Philippines
VALID BARANGAYS (STRICT MATCH ONLY): ${VALID_BARANGAYS.join(', ')}

CLASSIFICATION RULES:
1. 8-Focus Crimes: Murder, Homicide, Physical Injury, Rape, Robbery, Theft, Carnapping
2. PSI (Public Safety Index): Vehicular Accident, Traffic Incident, Fire Incident
3. Non-Index: All other incidents

EXTRACTION RULES:
- Normalize date format to: YYYY-MM-DD
- Barangay MUST match EXACTLY from the valid list
- Output MUST be valid JSON, NO markdown, NO comments.

OUTPUT FORMAT:
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
    } catch (apiErr) {
        console.warn(`[RECOVERY] Primary model failed. Falling back to ${fallbackModel}...`);
        model = client.getGenerativeModel({ model: fallbackModel });
        result = await model.generateContent([prompt, textContent]);
    }

    const responseText = result.response.text();
    const aiParsed = cleanAndParseJSON(responseText);
    const flattened: any[] = [];
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
    return flattened;
};
