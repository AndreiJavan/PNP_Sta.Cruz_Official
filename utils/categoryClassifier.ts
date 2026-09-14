export type AdvisoryCategory = 'Crime Advisory' | 'Traffic Advisory' | 'Cybercrime Advisory' | 'Community Awareness' | 'General Announcement';

interface CategoryKeywords {
  category: AdvisoryCategory;
  keywords: string[];
}

const CATEGORY_RULES: CategoryKeywords[] = [
  {
    category: 'General Announcement',
    keywords: [
      'news', 'press release', 'courtesy call', 'turnover', 'turn-over', 'ceremony', 'commendation',
      'award', 'official statement', 'pnp news', 'station update', 'balita', 'pahayag',
      'pormal na pahayag', 'dangal', 'pagparangal', 'pagdalaw', 'bisita', 'panunumpa', 'pinarangalan',
      'announcement', 'general announcement', 'release', 'press', 'inagurasyon', 'paglalagda',
      'mOU', 'mOA', 'chief of police', 'cop', 'regional director', 'ppda'
    ]
  },
  {
    category: 'Traffic Advisory',
    keywords: [
      'traffic', 'road', 'closure', 'reroute', 'rerouting', 'congestion', 'highway', 'lane',
      'vehicular', 'accident', 'motorcycle', 'driver', 'jeepney', 'bypass', 'parking',
      'roadblock', 'trapiko', 'kalsada', 'patrolya sa kalsada', 'kodigo ng kalsada',
      'sakay', 'daan', 'isinarang daan', 'pagmamaneho', 'pagbabara'
    ]
  },
  {
    category: 'Cybercrime Advisory',
    keywords: [
      'cyber', 'online', 'scam', 'phishing', 'hack', 'hacked', 'fraud', 'gcash', 'paymaya',
      'bank', 'password', 'otp', 'social media', 'identity theft', 'malware', 'ransomware',
      'fake account', 'txt scam', 'text scam', 'digital', 'online selling', 'link',
      'manloloko', 'pagnanakaw ng impormasyon', 'lokohan'
    ]
  },
  {
    category: 'Crime Advisory',
    keywords: [
      'crime', 'wanted', 'arrest', 'arrested', 'drug', 'drugs', 'shabu', 'marijuana',
      'buy-bust', 'buybust', 'robbery', 'theft', 'stolen', 'murder', 'assault', 'illegal',
      'homicide', 'operation', 'suspect', 'personnel', 'warrant', 'huli', 'aresto',
      'nakaw', 'holdap', 'tinangay', 'magnanakaw', 'barmed', 'possession', 'pulisya'
    ]
  },
  {
    category: 'Community Awareness',
    keywords: [
      'community', 'awareness', 'symposium', 'seminar', 'meeting', 'barangay', 'outreach',
      'school', 'lecture', 'event', 'program', 'tree planting', 'clean up', 'donation',
      'pulong-pulong', 'information drive', 'kapihan', 'lingkod', 'pamahalaan', 'kasimbayanan',
      'dalaw', 'ugnayan', 'kabataan', 'pnp'
    ]
  }
];

/**
 * Classifies text content into Public Advisory categories or General Announcement (News)
 * using weighted keyword frequency analysis (English & Tagalog).
 */
export function classifyCategory(text: string | undefined | null): AdvisoryCategory {
  if (!text || typeof text !== 'string') {
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

  let maxCategory: AdvisoryCategory = 'General Announcement';
  let maxScore = 0;

  for (const [cat, score] of Object.entries(scores) as [AdvisoryCategory, number][]) {
    if (score > maxScore) {
      maxScore = score;
      maxCategory = cat;
    }
  }

  return maxCategory;
}
