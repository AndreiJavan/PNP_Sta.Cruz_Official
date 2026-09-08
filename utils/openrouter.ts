import { memoryCache } from './cache.js';

export interface TranslationOptions {
  text: string;
  targetLang?: 'fil' | 'en' | 'Tagalog' | 'English';
  context?: string;
}

export async function translateWithOpenRouter(options: TranslationOptions): Promise<string> {
  const { text, targetLang = 'fil', context = 'PNP Public Safety Advisory / News Article' } = options;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return text;
  }

  const normalizedLang = (targetLang === 'fil' || targetLang === 'Tagalog') ? 'Filipino (Tagalog)' : 'English';
  const cacheKey = `openrouter_trans_${normalizedLang}_${Buffer.from(text.trim()).toString('base64').substring(0, 100)}`;

  // Check cache first
  const cached = memoryCache.get<string>(cacheKey);
  if (cached) {
    return cached;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('[OpenRouter] OPENROUTER_API_KEY missing in environment.');
    return text; // Fallback to original text
  }

  try {
    const prompt = `You are an expert official translator for PNP (Philippine National Police) Sta. Cruz, Laguna. 
Translate the following ${context} accurately and naturally into ${normalizedLang}. 
Maintain original formatting, paragraph structure, dates, and names. 
Provide ONLY the translated text as your response without introductory remarks, explanations, or quotes.

Text to translate:
${text.trim()}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://pnp-stacruz.gov.ph',
        'X-Title': 'PNP Sta. Cruz Official Portal',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[OpenRouter API Error] ${response.status}: ${errorText}`);
      return text;
    }

    const data = await response.json();
    const translatedText = data.choices?.[0]?.message?.content?.trim();

    if (translatedText) {
      // Cache for 24 hours (24 * 60 * 60 * 1000 ms)
      memoryCache.set(cacheKey, translatedText, 24 * 60 * 60 * 1000);
      return translatedText;
    }

    return text;
  } catch (error) {
    console.error('[OpenRouter Translation Exception]', error);
    return text;
  }
}
