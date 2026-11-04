export type AdvisoryCategory = 'Crime Advisory' | 'Traffic Advisory' | 'Cybercrime Advisory' | 'Community Awareness' | 'General Announcement';

interface CategoryKeywords {
  category: AdvisoryCategory;
  keywords: string[];
}

/**
 * Checks whether the given text is specifically about a public safety advisory,
 * crime prevention reminder, traffic warning, or cybercrime prevention notice.
 *
 * If not about an advisory or prevention (e.g. police operations, buy-busts, arrests,
 * accomplishments, courtesy calls, conferences, tree planting), it returns false
 * so that it is scoped as General Announcement (News) only.
 */
export function isAdvisoryOrPrevention(text: string | undefined | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase();

  // Strong exclusion: Law enforcement operational reports & arrests without actionable prevention/advisory tips
  const hasPureOperationsOrArrests = (
    /\b(buy-bust|buybust|warrant of arrest|arrest of wanted person|operatiba ng|huli sa akto|dinakip|nadakip|aresto|naaresto|isinagawang operasyon|nakumpiskang shabu|nakumpiskang marijuana|illegal drugs seized|anti-illegal drug operation|apprehended the suspect)\b/i.test(clean)
  );

  // Strong exclusion: Ceremonial, official visits, awards, or protocol without public safety advisory guidance
  const hasPureProtocolOrCeremony = (
    /\b(courtesy call|turnover ceremony|turn-over ceremony|oath taking|panunumpa|pagparangal|commendation|tree planting|clean-up drive|feeding program|kapihan|pulong-pulong)\b/i.test(clean)
  );

  // Positive Advisory & Prevention Signals (English & Tagalog)
  const hasExplicitAdvisoryOrPrevention = (
    /\b(crime advisory|crime advisories|traffic advisory|traffic advisories|cybercrime advisory|cybercrime advisories|public advisory|safety advisory|security advisory|road safety advisory|safety alert|crime alert|public warning|crime prevention|theft prevention|robbery prevention|scam prevention|accident prevention|safety tips|security tips|precaution|precautions|modus operandi|stay vigilant|vigilance|mag-ingat sa|pag-iingat sa|iwas-krimen|iwas krimen|pag-iwas sa krimen|babala sa publiko|paalala sa publiko|tips sa kaligtasan|road closure|reroute|rerouting|trapiko advisory|scam alert|phishing alert|fake account warning|otp scam)\b/i.test(clean) ||
    /\b(paalala|babala|mag-ingat|pag-iingat|iwasan|bantayan|magmatyag|alerto|beware|caution|safeguard|prevention|advisory)\b/i.test(clean)
  );

  // If operational/ceremonial narrative, require explicit advisory or prevention signals
  if (hasPureOperationsOrArrests || hasPureProtocolOrCeremony) {
    // Only count as advisory if explicitly headlined or structured as an advisory or prevention guide
    return /\b(crime advisory|safety advisory|crime prevention|paalala|babala|safety tips|modus operandi|mag-ingat)\b/i.test(clean);
  }

  return hasExplicitAdvisoryOrPrevention;
}

const CATEGORY_RULES: CategoryKeywords[] = [
  {
    category: 'General Announcement',
    keywords: [
      'news', 'press release', 'courtesy call', 'turnover', 'turn-over', 'ceremony', 'commendation',
      'award', 'official statement', 'pnp news', 'station update', 'balita', 'pahayag',
      'pormal na pahayag', 'dangal', 'pagparangal', 'pagdalaw', 'bisita', 'panunumpa', 'pinarangalan',
      'announcement', 'general announcement', 'release', 'press', 'inagurasyon', 'paglalagda',
      'mOU', 'mOA', 'chief of police', 'cop', 'regional director', 'ppda', 'buy-bust', 'buybust',
      'arrest', 'arrested', 'aresto', 'huli', 'naaresto', 'nadakip', 'dinakip', 'warrant of arrest',
      'warrant', 'manhunt', 'operation', 'operasyon', 'shabu', 'marijuana', 'confiscated', 'seized',
      'nakumpiska', 'suspect', 'suspek', 'personnel', 'pulisya', 'accomplishment', 'tree planting',
      'clean up', 'donation', 'outreach', 'seminar', 'symposium', 'meeting', 'feeding program'
    ]
  },
  {
    category: 'Traffic Advisory',
    keywords: [
      'traffic advisory', 'traffic rerouting', 'road closure', 'traffic congestion', 'road safety advisory',
      'reroute', 'rerouting', 'traffic', 'roadblock', 'trapiko', 'kalsada', 'isinarang daan',
      'isinarang kalsada', 'kodigo ng kalsada', 'pagmamaneho', 'vehicular accident'
    ]
  },
  {
    category: 'Cybercrime Advisory',
    keywords: [
      'cybercrime advisory', 'scam alert', 'phishing alert', 'fake account', 'online scam warning',
      'scam prevention', 'phishing', 'fraud advisory', 'gcash scam', 'paymaya scam', 'bank advisory',
      'otp scam', 'identity theft', 'malware warning', 'ransomware', 'digital scam', 'manloloko',
      'pagnanakaw ng impormasyon'
    ]
  },
  {
    category: 'Crime Advisory',
    keywords: [
      'crime advisory', 'crime prevention', 'safety advisory', 'public advisory', 'security advisory',
      'crime alert', 'safety alert', 'babala sa krimen', 'paalala sa krimen', 'iwas krimen',
      'pag-iwas sa krimen', 'mag-ingat sa krimen', 'prevention tips', 'crime prevention tips',
      'safety tips', 'security tips', 'precautions', 'precautionary measures', 'modus operandi',
      'modus', 'stay vigilant', 'vigilance', 'beware', 'caution', 'safeguard', 'protect yourself',
      'anti-theft', 'anti-robbery', 'anti-carnapping', 'anti-burglary', 'lock your doors',
      'secure your home', 'paalala', 'babala', 'mag-ingat', 'pag-iingat', 'pag-iwas', 'iwasan',
      'alerto', 'patnubay', 'panawagan', 'bantayan', 'magmatyag', 'safety reminder', 'public warning'
    ]
  }
];

/**
 * Classifies text content into Public Advisory categories or General Announcement (News).
 * Focuses Crime Advisory strictly on crime advisories or crime prevention.
 * If not about an advisory or prevention, it classifies as General Announcement (News).
 */
export function classifyCategory(text: string | undefined | null): AdvisoryCategory {
  if (!text || typeof text !== 'string') {
    return 'General Announcement';
  }

  // Core Scope Rule: If not about an advisory or prevention, it is General Announcement (News) only.
  if (!isAdvisoryOrPrevention(text)) {
    return 'General Announcement';
  }

  const cleanText = text.toLowerCase();
  const scores: Record<AdvisoryCategory, number> = {
    'General Announcement': 0,
    'Traffic Advisory': 0,
    'Cybercrime Advisory': 0,
    'Crime Advisory': 0,
    'Community Awareness': 0
  };

  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      const regex = new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'gi');
      const matches = cleanText.match(regex);
      if (matches) {
        scores[rule.category] += matches.length;
      }
    }
  }

  let maxCategory: AdvisoryCategory = 'Crime Advisory';
  let maxScore = -1;

  // Compare advisory categories first
  const advisoryCats: AdvisoryCategory[] = ['Traffic Advisory', 'Cybercrime Advisory', 'Crime Advisory'];
  for (const cat of advisoryCats) {
    if (scores[cat] > maxScore) {
      maxScore = scores[cat];
      maxCategory = cat;
    }
  }

  // If score is negligible, default to Crime Advisory since isAdvisoryOrPrevention is true
  return maxScore > 0 ? maxCategory : 'Crime Advisory';
}
