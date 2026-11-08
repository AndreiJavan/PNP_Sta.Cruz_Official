import fs from 'fs';
import path from 'path';
import { db } from '../config/database.js';
import { memoryCache } from '../utils/cache.js';
import { v4 as uuidv4 } from 'uuid';

export interface FAQItem {
  id: string | number;
  title: string;
  titleFil?: string;
  category?: string;
  keywords: string[];
  summaryEn: string;
  summaryFil?: string;
  nearQuestionsEn?: string[];
  nearQuestionsFil?: string[];
  display_order?: number;
  created_at?: string;
  updated_at?: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FAQS_FILE_PATH = path.join(DATA_DIR, 'faqs.json');
const CACHE_KEY = 'faqs:all';

export const INITIAL_FAQS: FAQItem[] = [
  {
    id: '1',
    category: 'Emergency',
    title: "How do I report an ongoing emergency or crime in progress in Santa Cruz?",
    titleFil: "Paano mag-ulat ng agarang emergency o krimen sa Santa Cruz?",
    keywords: ["emergency", "ongoing", "crime", "911", "call", "urgent", "tawag", "saklolo", "tulong", "pulis", "pulisya", "dispatch", "krimen"],
    summaryEn: "In an ongoing emergency or crime in progress, dial **911** immediately or call the Sta. Cruz Police Station desk directly at **(049) 501-5971** or **0998 598 5667**.\n\nPlease provide:\n• Your exact location (Barangay, street, or landmark)\n• Nature of the incident\n• Suspect description and any weapons\n• Any injuries requiring medical dispatch.",
    summaryFil: "Sa oras ng agarang emergency o nagaganap na krimen, tumawag agad sa **911** o sa Sta. Cruz Police Station desk sa **(049) 501-5971** o **0998 598 5667**.\n\nIbigay ang:\n• Eksaktong lokasyon (Barangay, kalye, o landmark)\n• Uri ng insidente\n• Deskripsyon ng suspek at armas\n• Mga nasugatan na nangangailangan ng ambulansya.",
    nearQuestionsEn: [
      "What are the official emergency hotlines for Santa Cruz, Laguna?",
      "How do I file an official Police Blotter report?",
      "Where is the PNP Santa Cruz Municipal Police Station located?"
    ],
    nearQuestionsFil: [
      "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
      "Paano mag-file ng opisyal na Police Blotter report?",
      "Saan matatagpuan ang estasyon ng pulisya sa Sta. Cruz?"
    ],
    display_order: 1
  },
  {
    id: '2',
    category: 'Emergency',
    title: "What are the official emergency hotlines for Santa Cruz, Laguna?",
    titleFil: "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
    keywords: ["hotline", "hotlines", "number", "numbers", "contact", "phone", "telepono", "numero", "tawagan", "bfp", "fire", "mdrrmo", "ambulance", "rescue", "bumbero"],
    summaryEn: "Official Sta. Cruz Emergency Hotlines (24/7 Available):\n• **PNP Sta. Cruz Police Desk:** (049) 501-5971 / 0998 598 5667\n• **National Emergency Hotline:** 911\n• **BFP Fire Station (Sunog):** (049) 501-1911 / 0915 602 2167\n• **MDRRMO Disaster & Ambulance:** (049) 501-2070 / 0939 917 5202\n• **Laguna Provincial Police (PPO):** (049) 501-1647",
    summaryFil: "Mga Opisyal na Emergency Hotline ng Sta. Cruz (24/7):\n• **PNP Sta. Cruz Police Desk:** (049) 501-5971 / 0998 598 5667\n• **Pambansang Emergency:** 911\n• **BFP Fire Station (Sunog):** (049) 501-1911 / 0915 602 2167\n• **MDRRMO Rescue at Ambulansya:** (049) 501-2070 / 0939 917 5202\n• **Laguna Provincial Police (PPO):** (049) 501-1647",
    nearQuestionsEn: [
      "How do I report an ongoing emergency or crime in progress in Santa Cruz?",
      "Where is the PNP Santa Cruz Municipal Police Station located?",
      "What assistance does the Women and Children Protection Desk (WCPD) provide?"
    ],
    nearQuestionsFil: [
      "Paano mag-ulat ng agarang emergency o krimen sa Santa Cruz?",
      "Saan matatagpuan ang estasyon ng pulisya sa Sta. Cruz?",
      "Anong tulong ang ibinibigay ng Women and Children Protection Desk (WCPD)?"
    ],
    display_order: 2
  },
  {
    id: '3',
    category: 'Blotter',
    title: "How do I file an official Police Blotter report?",
    titleFil: "Paano mag-file ng opisyal na Police Blotter report?",
    keywords: ["blotter", "file blotter", "magpablotter", "magpa-blotter", "report incident", "magsumbong", "reklamo", "complaint", "extract"],
    summaryEn: "To file an official Police Blotter:\n1. Personally visit the Sta. Cruz Police Station Investigation Section (1153 A. Mabini St., Poblacion).\n2. Present a valid government-issued ID.\n3. Provide the facts of the incident to the duty investigator (date, time, location, suspect details).\n4. Receive an official Incident Record Form (IRF) or Police Blotter Extract.",
    summaryFil: "Para mag-file ng opisyal na Police Blotter:\n1. Pumunta personal sa Investigation Section ng Sta. Cruz Police Station (1153 A. Mabini St., Poblacion).\n2. Magdala ng valid government ID.\n3. Isalaysay ang mga detalye ng insidente sa duty investigator (petsa, oras, lugar, pagkakakilanlan).\n4. Kumuha ng kopya ng Incident Record Form (IRF) o Police Blotter Extract.",
    nearQuestionsEn: [
      "Can I file a police blotter online or through social media?",
      "When should I report to the Barangay Lupon versus the Municipal Police Station?",
      "What valid government IDs and documents are accepted?"
    ],
    nearQuestionsFil: [
      "Maaari ba akong magpa-blotter online o sa social media?",
      "Kailan dapat dumulog sa Barangay Lupon laban sa Police Station?",
      "Anu-anong valid government ID ang tinatanggap?"
    ],
    display_order: 3
  },
  {
    id: '4',
    category: 'Blotter',
    title: "Can I file a police blotter online or through social media?",
    titleFil: "Maaari ba akong magpa-blotter online o sa social media?",
    keywords: ["online blotter", "facebook blotter", "social media report", "chat blotter", "blotter online", "magpablotter online"],
    summaryEn: "No. Under PNP Standard Operating Procedures, official police blotters cannot be filed online, via email, or through social media. Filing requires personal appearance, identity verification, and sworn statements before a duty investigator. However, confidential tips may be messaged to station channels.",
    summaryFil: "Hindi po. Ayon sa panuntunan ng PNP, hindi maaaring magpa-blotter online o sa social media. Kinakailangan ang personal na pagharap upang mapatunayan ang pagkakakilanlan at manumpa sa salaysay. Maaari namang magpadala ng confidential tips sa aming mga opisyal na numero.",
    nearQuestionsEn: [
      "How do I file an official Police Blotter report?",
      "How can the community submit tips regarding Wanted or Missing Persons?",
      "Where is the PNP Santa Cruz Municipal Police Station located?"
    ],
    nearQuestionsFil: [
      "Paano mag-file ng opisyal na Police Blotter report?",
      "Paano magsumite ng impormasyon o tip ukol sa Wanted o Missing Persons?",
      "Saan matatagpuan ang estasyon ng pulisya sa Sta. Cruz?"
    ],
    display_order: 4
  },
  {
    id: '5',
    category: 'Blotter',
    title: "When should I report to the Barangay Lupon versus the Municipal Police Station?",
    titleFil: "Kailan dapat dumulog sa Barangay Lupon laban sa Municipal Police Station?",
    keywords: ["barangay", "lupon", "barangay blotter", "police vs barangay", "katarungang pambarangay", "alitan", "kapitbahay"],
    summaryEn: "Under the Katarungang Pambarangay Law (R.A. 7160):\n• **Barangay Lupon First:** Minor disputes between residents of the same municipality (light threats, simple slander, small claims, neighbor disputes).\n• **Direct to Police Station:** Heinous crimes, physical injuries, drug offenses, domestic violence (VAWC), cybercrime, or offenses punishable by more than 1 year imprisonment.",
    summaryFil: "Ayon sa Katarungang Pambarangay Law (R.A. 7160):\n• **Sa Barangay muna:** Maliliit na alitan ng magkakapitbahay sa parehong bayan (simpleng banta, tsismis, hidwaan).\n• **Diretso sa Pulisya:** Mabibigat na krimen, pananakit, droga, pang-aabuso sa kababaihan/bata (VAWC), cybercrime, o mga kasong higit 1 taon ang parusa.",
    nearQuestionsEn: [
      "How do I file an official Police Blotter report?",
      "What assistance does the Women and Children Protection Desk (WCPD) provide?",
      "How do I report online scams, cyber harassment, or hacking in Santa Cruz?"
    ],
    nearQuestionsFil: [
      "Paano mag-file ng opisyal na Police Blotter report?",
      "Anong tulong ang ibinibigay ng Women and Children Protection Desk (WCPD)?",
      "Paano mag-ulat ng online scam, panloloko, o cyber harassment?"
    ],
    display_order: 5
  },
  {
    id: '6',
    category: 'Clearance',
    title: "How do I apply for a National Police Clearance (NPCS) in Santa Cruz?",
    titleFil: "Paano kumuha ng National Police Clearance (NPCS) sa Santa Cruz?",
    keywords: ["police clearance", "clearance", "npcs", "apply clearance", "kuha clearance", "requirements clearance", "appointment"],
    summaryEn: "To apply for a National Police Clearance (NPCS):\n1. Register and book an appointment online at https://pnpclearance.ph selecting Sta. Cruz MPS.\n2. Pay the ₱180 fee via Landbank/e-wallet (free for first-time jobseekers with Barangay certificate).\n3. Bring 2 valid IDs and your appointment slip to the station for photo and biometrics capturing.\nClearance is released in about 10–15 minutes if there is no hit.",
    summaryFil: "Para kumuha ng National Police Clearance (NPCS):\n1. Mag-rehistro at kumuha ng appointment sa https://pnpclearance.ph at piliin ang Sta. Cruz MPS.\n2. Magbayad ng ₱180 sa Landbank/e-wallet (libre para sa First-Time Jobseekers).\n3. Pumunta sa istasyon dala ang 2 valid ID at appointment slip para sa picture at biometrics.\nMatatapos at maipiprint ang clearance sa loob ng 10-15 minuto kung walang hit.",
    nearQuestionsEn: [
      "What valid government IDs and documents are accepted for Police Clearance?",
      "Can I get a Police Clearance for free under the First-Time Jobseekers Act?",
      "Where is the PNP Santa Cruz Municipal Police Station located and what are its operating hours?"
    ],
    nearQuestionsFil: [
      "Anu-anong valid government ID ang tinatanggap para sa Police Clearance?",
      "Libre ba ang clearance para sa First-Time Jobseekers?",
      "Saan matatagpuan ang estasyon ng pulisya at ano ang operating hours nito?"
    ],
    display_order: 6
  },
  {
    id: '7',
    category: 'Clearance',
    title: "What valid government IDs and documents are accepted for Police Clearance?",
    titleFil: "Anu-anong valid government ID ang tinatanggap para sa Police Clearance?",
    keywords: ["valid id", "valid ids", "mga id", "id requirements", "tinatanggap na id", "anong id"],
    summaryEn: "Bring at least 2 original, valid government-issued IDs, such as:\n• Philippine National ID (PhilID / ePhilID)\n• Passport\n• Driver's License\n• SSS / GSIS UMID Card\n• PRC License\n• Voter's ID or Certificate\n• PhilHealth ID\n• Postal ID\n• Barangay Clearance (with photo, issued within 6 months)",
    summaryFil: "Magdala ng 2 orihinal at hindi expired na valid ID tulad ng:\n• Philippine National ID (PhilID / ePhilID)\n• Pasaporte\n• Driver's License\n• SSS / GSIS UMID Card\n• PRC License\n• Voter's ID o Certificate\n• PhilHealth ID\n• Postal ID\n• Barangay Clearance na may larawan",
    nearQuestionsEn: [
      "How do I apply for a National Police Clearance (NPCS) in Santa Cruz?",
      "Can I get a Police Clearance for free under the First-Time Jobseekers Act?",
      "Is there priority assistance for senior citizens, pregnant women, and PWDs at the station?"
    ],
    nearQuestionsFil: [
      "Paano kumuha ng National Police Clearance (NPCS) sa Santa Cruz?",
      "Libre ba ang clearance para sa First-Time Jobseekers?",
      "May priority assistance ba para sa senior citizens, buntis, at PWD?"
    ],
    display_order: 7
  },
  {
    id: '8',
    category: 'Clearance',
    title: "Can I get a Police Clearance for free under the First-Time Jobseekers Act?",
    titleFil: "Libre ba ang police clearance para sa First-Time Jobseekers?",
    keywords: ["first time jobseeker", "libreng clearance", "free clearance", "ra 11261", "unang trabaho", "fresh graduate"],
    summaryEn: "Yes! Under the First-Time Jobseekers Assistance Act (R.A. 11261), first-time jobseekers are entitled to one (1) free National Police Clearance. Present an original Barangay Certificate specifying First-Time Jobseeker eligibility and an accomplished Oath of Undertaking upon appointment.",
    summaryFil: "Opo! Sa ilalim ng R.A. 11261 (First-Time Jobseekers Assistance Act), libre ang unang Police Clearance. Magdala ng orihinal na Barangay Certificate para sa First-Time Jobseeker at Oath of Undertaking sa araw ng appointment.",
    nearQuestionsEn: [
      "How do I apply for a National Police Clearance (NPCS) in Santa Cruz?",
      "What valid government IDs and documents are accepted for Police Clearance?",
      "Where is the PNP Santa Cruz Municipal Police Station located and what are its operating hours?"
    ],
    nearQuestionsFil: [
      "Paano kumuha ng National Police Clearance (NPCS) sa Santa Cruz?",
      "Anu-anong valid government ID ang tinatanggap para sa Police Clearance?",
      "Saan matatagpuan ang estasyon ng pulisya at ano ang operating hours nito?"
    ],
    display_order: 8
  },
  {
    id: '9',
    category: 'Crime Map',
    title: "Where does the crime data on the MIMPAS Map come from?",
    titleFil: "Saan nagmumula ang datos ng krimen sa MIMPAS Crime Map?",
    keywords: ["crime map data", "datos ng mapa", "saan galing data", "ciras", "blotter records", "map data source"],
    summaryEn: "Crime Map data is sourced directly from blotter-recorded occurrences encoded in the PNP Crime Information Reporting and Analysis System (CIRAS). Data is verified and updated periodically by station records officers to maintain high spatial accuracy and situational awareness.",
    summaryFil: "Ang datos sa Crime Map ay nagmumula sa mga naitalang blotter at opisyal na PNP Crime Information Reporting and Analysis System (CIRAS). Ito ay regular na sinusuri ng records division upang matiyak ang kalidad at katumpakan.",
    nearQuestionsEn: [
      "Does the Crime Map disclose personal names or exact home addresses?",
      "How do I search or filter incidents by Barangay, Year, or Category on the Map?",
      "What is MIMPAS and how does it help Sta. Cruz residents?"
    ],
    nearQuestionsFil: [
      "Inilalabas ba sa Crime Map ang personal na pangalan o tirahan?",
      "Paano mag-filter ng insidente ayon sa Barangay o Taon sa Mapa?",
      "Ano ang MIMPAS at paano ito nakakatulong sa mga residente ng Sta. Cruz?"
    ],
    display_order: 9
  },
  {
    id: '10',
    category: 'Crime Map',
    title: "Does the Crime Map disclose personal names or exact home addresses?",
    titleFil: "Inilalabas ba sa Crime Map ang personal na pangalan o tirahan?",
    keywords: ["privacy", "data privacy", "names", "pangalan", "tirahan", "address", "confidential", "ra 10173"],
    summaryEn: "No. Under the Data Privacy Act of 2012 (R.A. 10173), the Crime Map does NOT publish personal names, exact house numbers, or specific victim/suspect identities. Markers are approximate vicinity centroids placed on public streets or barangay sectors for public awareness.",
    summaryFil: "Hindi po. Alinsunod sa Data Privacy Act (R.A. 10173), HINDI inilalantad ang mga pangalan ng biktima, suspek, o eksaktong numero ng bahay. Ang mga marker ay tinatayang lokasyon sa pampublikong kalsada o barangay para sa kaligtasan ng komunidad.",
    nearQuestionsEn: [
      "Where does the crime data on the MIMPAS Map come from?",
      "How do I search or filter incidents by Barangay, Year, or Category on the Map?",
      "What is MIMPAS and how does it help Sta. Cruz residents?"
    ],
    nearQuestionsFil: [
      "Saan nagmumula ang datos ng krimen sa MIMPAS Crime Map?",
      "Paano mag-filter ng insidente ayon sa Barangay o Taon sa Mapa?",
      "Ano ang MIMPAS at paano ito nakakatulong sa mga residente ng Sta. Cruz?"
    ],
    display_order: 10
  },
  {
    id: '11',
    category: 'Crime Map',
    title: "How do I search or filter incidents by Barangay, Year, or Category on the Map?",
    titleFil: "Paano mag-filter ng insidente ayon sa Barangay o Taon sa Mapa?",
    keywords: ["filter map", "filter", "barangay filter", "year filter", "category filter", "paano gamitin ang mapa", "map controls"],
    summaryEn: "On the Crime Map page (/map):\n1. Use the filter bar at the top to select a specific Barangay (out of 26 barangays).\n2. Select a Calendar Year to observe historical trends.\n3. Filter by crime classification (8-Focus Crimes, Non-Index Crimes, or PSI).\n4. Click any marker or barangay area to view case details.",
    summaryFil: "Sa Crime Map (/map):\n1. Gamitin ang filter toolbar upang pumili ng partikular na Barangay (sa 26 na barangay).\n2. Pumili ng Taon upang makita ang mga nakaraang talaan.\n3. Pumili ayon sa uri ng insidente (8-Focus Crimes, Non-Index, o PSI).\n4. I-click ang mga marker upang makita ang buod ng insidente.",
    nearQuestionsEn: [
      "Where does the crime data on the MIMPAS Map come from?",
      "Does the Crime Map disclose personal names or exact home addresses?",
      "Where can I see traffic rerouting and road safety advisories in Santa Cruz?"
    ],
    nearQuestionsFil: [
      "Saan nagmumula ang datos ng krimen sa MIMPAS Crime Map?",
      "Inilalabas ba sa Crime Map ang personal na pangalan o tirahan?",
      "Saan makikita ang mga traffic advisory at rerouting sa Santa Cruz?"
    ],
    display_order: 11
  },
  {
    id: '12',
    category: 'WCPD',
    title: "What assistance does the Women and Children Protection Desk (WCPD) provide?",
    titleFil: "Anong tulong ang ibinibigay ng Women and Children Protection Desk (WCPD)?",
    keywords: ["wcpd", "vawc", "women", "children", "babae", "bata", "pang-aabuso", "domestic violence", "battered", "abuse", "safe space"],
    summaryEn: "The WCPD provides dedicated, confidential assistance for victims of domestic violence (R.A. 9262), child abuse (R.A. 7610), sexual harassment (Safe Spaces Act), and rape. Female police officers conduct sensitive interviews in a private room and assist with Barangay Protection Orders (BPO) and court referrals.",
    summaryFil: "Ang WCPD ay nagbibigay ng pribado at protektadong tulong para sa mga biktima ng karahasan sa kababaihan at kabataan (VAWC / R.A. 9262, R.A. 7610). Mga babaeng pulis ang nag-iimbestiga sa isang pribadong kwarto at tumutulong sa pagkuha ng Protection Order.",
    nearQuestionsEn: [
      "What are the official emergency hotlines for Santa Cruz, Laguna?",
      "How do I file an official Police Blotter report?",
      "Is there priority assistance for senior citizens, pregnant women, and PWDs at the station?"
    ],
    nearQuestionsFil: [
      "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
      "Paano mag-file ng opisyal na Police Blotter report?",
      "May priority assistance ba para sa senior citizens, buntis, at PWD?"
    ],
    display_order: 12
  },
  {
    id: '13',
    category: 'Cybercrime',
    title: "How do I report online scams, cyber harassment, or hacking in Santa Cruz?",
    titleFil: "Paano mag-ulat ng online scam, panloloko, o cyber harassment?",
    keywords: ["cybercrime", "scam", "online scam", "hacking", "cyber", "hacked", "identity theft", "harassment online", "gcash scam"],
    summaryEn: "To report online scams or cybercrime:\n1. Preserve digital evidence immediately: uncropped screenshots of chat conversations, sender URLs, transaction reference numbers, and phone numbers.\n2. Visit Sta. Cruz MPS Investigation Section or contact the PNP Anti-Cybercrime Group (RACU 4A) at 0998 598 8116.",
    summaryFil: "Para sa online scam o cybercrime:\n1. I-save agad ang digital evidence: buong screenshot ng chat, profile link, transaction reference number, at cellphone number.\n2. Pumunta sa Sta. Cruz MPS Investigation Section o makipag-ugnayan sa PNP Anti-Cybercrime Group (RACU 4A) sa 0998 598 8116.",
    nearQuestionsEn: [
      "How do I file an official Police Blotter report?",
      "Can I file a police blotter online or through social media?",
      "What are the official emergency hotlines for Santa Cruz, Laguna?"
    ],
    nearQuestionsFil: [
      "Paano mag-file ng opisyal na Police Blotter report?",
      "Maaari ba akong magpa-blotter online o sa social media?",
      "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?"
    ],
    display_order: 13
  },
  {
    id: '14',
    category: 'Bulletins',
    title: "How can the community submit tips regarding Wanted or Missing Persons?",
    titleFil: "Paano magsumite ng impormasyon ukol sa Wanted o Missing Persons?",
    keywords: ["wanted", "missing", "tip", "tips", "nawawala", "wanted person", "missing person", "sumbong"],
    summaryEn: "Citizens can report information about wanted fugitives or missing persons by calling (049) 501-5971, texting 0998 598 5667, or visiting the station desk. Tipster identities are strictly confidential under police intelligence protocols. Never confront wanted persons yourself.",
    summaryFil: "Maaaring mag-ulat ng impormasyon sa pamamagitan ng pagtawag sa (049) 501-5971, pag-text sa 0998 598 5667, o personal na pagpunta sa estasyon. Mahigpit na pinangangalagaan ang pagkakakilanlan ng tipster. Huwag subukang hulihin ang suspek mag-isa.",
    nearQuestionsEn: [
      "How do I report an ongoing emergency or crime in progress in Santa Cruz?",
      "What are the official emergency hotlines for Santa Cruz, Laguna?",
      "Where can I see traffic rerouting and road safety advisories in Santa Cruz?"
    ],
    nearQuestionsFil: [
      "Paano mag-ulat ng agarang emergency o krimen sa Santa Cruz?",
      "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
      "Saan makikita ang mga traffic advisory at rerouting sa Santa Cruz?"
    ],
    display_order: 14
  },
  {
    id: '15',
    category: 'Traffic',
    title: "Where can I see traffic rerouting and road safety advisories in Santa Cruz?",
    titleFil: "Saan makikita ang mga traffic advisory at rerouting sa Santa Cruz?",
    keywords: ["traffic", "rerouting", "road closure", "trapiko", "kalsada", "sarado", "advisory", "daan"],
    summaryEn: "Official traffic rerouting, road closures, and public safety advisories are published on this portal under the Public Advisories page (/bulletins) and News Releases page (/news). You can also follow official PNP Sta. Cruz social media broadcasts.",
    summaryFil: "Ang mga traffic rerouting, pagsasara ng kalsada, at road safety advisory ay inilalathala sa Public Advisories (/bulletins) at Station News (/news) ng portal na ito, at sa opisyal na Facebook page ng Sta. Cruz MPS.",
    nearQuestionsEn: [
      "What are the official emergency hotlines for Santa Cruz, Laguna?",
      "Where is the PNP Santa Cruz Municipal Police Station located and what are its operating hours?",
      "How do I report an ongoing emergency or crime in progress in Santa Cruz?"
    ],
    nearQuestionsFil: [
      "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
      "Saan matatagpuan ang estasyon ng pulisya at ano ang operating hours nito?",
      "Paano mag-ulat ng agarang emergency o krimen sa Santa Cruz?"
    ],
    display_order: 15
  },
  {
    id: '16',
    category: 'General',
    title: "Where is the PNP Santa Cruz Municipal Police Station located and what are its operating hours?",
    titleFil: "Saan matatagpuan ang estasyon ng pulisya at ano ang operating hours nito?",
    keywords: ["location", "address", "operating hours", "oras", "lugar", "saan", "headquarters", "istasyon"],
    summaryEn: "Sta. Cruz Municipal Police Station is located at: 1153 A. Mabini St., Poblacion, Santa Cruz, Laguna (beside the Municipal Hall).\n• **Emergency Dispatch & Patrols:** 24/7 continuous operation\n• **Clearance & Administrative Services:** Monday to Friday, 8:00 AM – 5:00 PM.",
    summaryFil: "Ang Sta. Cruz Police Station ay matatagpuan sa: 1153 A. Mabini St., Poblacion, Santa Cruz, Laguna (katabi ng Munisipyo).\n• **Emergency at Patrols:** 24/7 bukas araw at gabi\n• **Clearance at Administrative Services:** Lunes hanggang Biyernes, 8:00 AM – 5:00 PM.",
    nearQuestionsEn: [
      "What are the official emergency hotlines for Santa Cruz, Laguna?",
      "How do I apply for a National Police Clearance (NPCS) in Santa Cruz?",
      "Is there priority assistance for senior citizens, pregnant women, and PWDs at the station?"
    ],
    nearQuestionsFil: [
      "Ano ang mga opisyal na emergency hotline ng Santa Cruz, Laguna?",
      "Paano kumuha ng National Police Clearance (NPCS) sa Santa Cruz?",
      "May priority assistance ba para sa senior citizens, buntis, at PWD?"
    ],
    display_order: 16
  },
  {
    id: '17',
    category: 'General',
    title: "What is MIMPAS and how does it help Sta. Cruz residents?",
    titleFil: "Ano ang MIMPAS at paano ito nakakatulong sa mga residente ng Sta. Cruz?",
    keywords: ["mimpas", "ano ang mimpas", "system", "portal", "about mimpas", "layunin"],
    summaryEn: "MIMPAS (Municipal Information Mapping and Police Advisory System) is the official public safety portal developed for Sta. Cruz MPS. It provides interactive crime mapping, verified police bulletins, official emergency hotlines, and station directory access to keep Santa Cruz residents informed and secure.",
    summaryFil: "Ang MIMPAS ay ang opisyal na digital public safety portal ng Sta. Cruz MPS. Nagbibigay ito ng interactive crime mapping, beripikadong advisories, emergency directory, at mabilis na impormasyon para sa kaligtasan ng buong Sta. Cruz.",
    nearQuestionsEn: [
      "Where does the crime data on the MIMPAS Map come from?",
      "How do I search or filter incidents by Barangay, Year, or Category on the Map?",
      "Does the Crime Map disclose personal names or exact home addresses?"
    ],
    nearQuestionsFil: [
      "Saan nagmumula ang datos ng krimen sa MIMPAS Crime Map?",
      "Paano mag-filter ng insidente ayon sa Barangay o Taon sa Mapa?",
      "Inilalabas ba sa Crime Map ang personal na pangalan o tirahan?"
    ],
    display_order: 17
  },
  {
    id: '18',
    category: 'General',
    title: "Why does this website prioritize verified FAQs over automated AI chatbots?",
    titleFil: "Bakit verified FAQs ang prayoridad ng website na ito kaysa AI chatbots?",
    keywords: ["ai chatbot", "hallucination", "accuracy", "bakit faq", "verified faq", "precision"],
    summaryEn: "This verified FAQ is maintained by Sta. Cruz MPS to provide 100% legally accurate, official answers directly reflecting PNP Standard Operating Procedures, preventing misinformation or hallucinated answers from automated general-purpose AI bots.",
    summaryFil: "Pinapanatili ng Sta. Cruz MPS ang verified FAQ na ito upang masigurong 100% tumpak at sumusunod sa batas at PNP SOP ang bawat sagot, at maiwasan ang maling impormasyon mula sa mga hindi opisyal na AI.",
    nearQuestionsEn: [
      "What is MIMPAS and how does it help Sta. Cruz residents?",
      "Where does the crime data on the MIMPAS Map come from?",
      "How do I report an ongoing emergency or crime in progress in Santa Cruz?"
    ],
    nearQuestionsFil: [
      "Ano ang MIMPAS at paano ito nakakatulong sa mga residente ng Sta. Cruz?",
      "Saan nagmumula ang datos ng krimen sa MIMPAS Crime Map?",
      "Paano mag-ulat ng agarang emergency o krimen sa Santa Cruz?"
    ],
    display_order: 18
  },
  {
    id: '19',
    category: 'General',
    title: "Is there priority assistance for senior citizens, pregnant women, and PWDs at the station?",
    titleFil: "May priority assistance ba para sa senior citizens, buntis, at PWD sa estasyon?",
    keywords: ["senior", "pwd", "pregnant", "buntis", "matanda", "priority", "accessibility", "wheelchair", "ramp"],
    summaryEn: "Yes. In compliance with R.A. 7277 (Magna Carta for PWDs) and R.A. 9994 (Expanded Senior Citizens Act), Sta. Cruz MPS provides an entrance wheelchair ramp, priority lane, and dedicated seating for senior citizens, pregnant women, and PWDs. Duty personnel assist visitors directly throughout their transaction.",
    summaryFil: "Opo. Alinsunod sa R.A. 7277 at R.A. 9994, may wheelchair ramp, priority lane, at upuan sa Sta. Cruz MPS para sa senior citizens, buntis, at PWDs. Agad ding umaalalay ang mga naka-duty na pulis sa kanilang transaksyon.",
    nearQuestionsEn: [
      "How do I apply for a National Police Clearance (NPCS) in Santa Cruz?",
      "Where is the PNP Santa Cruz Municipal Police Station located and what are its operating hours?",
      "What valid government IDs and documents are accepted for Police Clearance?"
    ],
    nearQuestionsFil: [
      "Paano kumuha ng National Police Clearance (NPCS) sa Santa Cruz?",
      "Saan matatagpuan ang estasyon ng pulisya at ano ang operating hours nito?",
      "Anu-anong valid government ID ang tinatanggap para sa Police Clearance?"
    ],
    display_order: 19
  },
  {
    id: '20',
    category: 'Crime Map',
    title: "Which barangay in Santa Cruz has the highest number or largest amount of crime cases?",
    titleFil: "Aling barangay sa Santa Cruz ang may pinakamaraming naitalang kaso ng krimen?",
    keywords: [
      "which barangay", "large amount of cases", "most cases", "highest cases", "barangay cases",
      "crime cases", "pinakamaraming kaso", "maraming kaso", "aling barangay", "anong barangay",
      "top barangay", "highest crime", "crime rate barangay", "case count", "dami ng kaso"
    ],
    summaryEn: "Incident distributions in Santa Cruz, Laguna are actively logged across all 26 barangays on the MIMPAS Crime Map, with high-density commercial centers (such as the Poblacion sectors) historically recording more activity.\n\nTo view real-time ranked incident counts, heatmaps, and filter per barangay:\n1. Open the interactive **Crime Map** (/map) on the navigation bar.\n2. Filter by specific **Barangay** or select a **Year** to see full statistics.\n3. All 26 barangays are actively monitored 24/7 with mobile patrols and checkpoints.\n\nFor police assistance or blotter inquiries in your barangay, contact Sta. Cruz MPS at **(049) 501-5971** or dial **911**.",
    summaryFil: "Ang bilang ng kaso sa 26 na barangay ng Santa Cruz ay nakatala sa MIMPAS Crime Map, kung saan ang mga matataong sentro tulad ng Poblacion ang kadalasang may mas maraming naitalang ulat.\n\nUpang makita ang opisyal na bilang ng kaso at heatmap sa bawat barangay:\n1. Buksan ang **Crime Map** (/map) sa navigation bar.\n2. Gamitin ang filter para pumili ng **Barangay** o **Taon**.\n3. Lahat ng 26 na barangay ay may 24/7 mobile patrol at checkpoints.\n\nPara sa tulong o blotter, tumawag sa **(049) 501-5971** o mag-dial ng **911**.",
    nearQuestionsEn: [
      "Where does the crime data on the MIMPAS Map come from?",
      "How do I search or filter incidents by Barangay, Year, or Category on the Map?",
      "Does the Crime Map disclose personal names or exact home addresses?"
    ],
    nearQuestionsFil: [
      "Saan nagmumula ang datos ng krimen sa MIMPAS Crime Map?",
      "Paano mag-filter ng insidente ayon sa Barangay o Taon sa Mapa?",
      "Inilalabas ba sa Crime Map ang personal na pangalan o tirahan?"
    ],
    display_order: 20
  }
];

// Helper to load FAQs from local persistent JSON file if present
function loadLocalFaqs(): FAQItem[] | null {
  try {
    if (fs.existsSync(FAQS_FILE_PATH)) {
      const data = fs.readFileSync(FAQS_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e: any) {
    console.warn('[FAQ SERVICE] Failed to read local faqs.json:', e?.message || e);
  }
  return null;
}

// Helper to save FAQs to local persistent JSON file
function saveLocalFaqs(items: FAQItem[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FAQS_FILE_PATH, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e: any) {
    console.warn('[FAQ SERVICE] Failed to write local faqs.json:', e?.message || e);
  }
}

// Normalizes database record row into FAQItem
function normalizeFaqRow(row: any): FAQItem {
  return {
    id: String(row.id),
    title: row.title || row.question || '',
    titleFil: row.title_fil || row.titleFil || row.question_fil || '',
    category: row.category || 'General',
    keywords: Array.isArray(row.keywords) ? row.keywords : (typeof row.keywords === 'string' ? row.keywords.split(',').map((k: string) => k.trim()).filter(Boolean) : []),
    summaryEn: row.summary_en || row.summaryEn || row.answer || '',
    summaryFil: row.summary_fil || row.summaryFil || row.answer_fil || '',
    nearQuestionsEn: Array.isArray(row.near_questions_en) ? row.near_questions_en : (Array.isArray(row.nearQuestionsEn) ? row.nearQuestionsEn : []),
    nearQuestionsFil: Array.isArray(row.near_questions_fil) ? row.near_questions_fil : (Array.isArray(row.nearQuestionsFil) ? row.nearQuestionsFil : []),
    display_order: Number(row.display_order ?? row.displayOrder ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

/**
 * Retrieves all FAQs.
 * Checks memory cache -> Supabase 'faqs' collection -> local faqs.json -> default INITIAL_FAQS.
 */
export async function getFaqs(): Promise<FAQItem[]> {
  return memoryCache.getOrSet(CACHE_KEY, async () => {
    // 1. Try Supabase collection
    try {
      const snap = await db.collection('faqs').orderBy('display_order', 'asc').get();
      if (snap && snap.docs && snap.docs.length > 0) {
        const fromDb = snap.docs.map((doc: any) => normalizeFaqRow({ id: doc.id, ...doc.data() }));
        saveLocalFaqs(fromDb);
        return fromDb;
      }
    } catch (dbErr: any) {
      console.warn('[FAQ SERVICE] Database faqs table read skipped/unavailable:', dbErr?.message || dbErr);
    }

    // 2. Try local persistent JSON
    const local = loadLocalFaqs();
    if (local && local.length > 0) {
      return local;
    }

    // 3. Fallback to initial verified dataset and persist it
    saveLocalFaqs(INITIAL_FAQS);
    return [...INITIAL_FAQS];
  }, 5 * 60 * 1000);
}

/**
 * Retrieves a single FAQ by ID.
 */
export async function getFaqById(id: string | number): Promise<FAQItem | null> {
  const faqs = await getFaqs();
  return faqs.find(f => String(f.id) === String(id)) || null;
}

/**
 * Creates a new FAQ item.
 */
export async function addFaq(data: {
  title: string;
  titleFil?: string;
  category?: string;
  keywords?: string[] | string;
  summaryEn: string;
  summaryFil?: string;
  nearQuestionsEn?: string[] | string;
  nearQuestionsFil?: string[] | string;
  display_order?: number;
}): Promise<FAQItem> {
  const currentFaqs = await getFaqs();
  
  const keywordsArr = Array.isArray(data.keywords) 
    ? data.keywords 
    : (typeof data.keywords === 'string' ? data.keywords.split(',').map(s => s.trim()).filter(Boolean) : []);
  
  const nearEnArr = Array.isArray(data.nearQuestionsEn)
    ? data.nearQuestionsEn
    : (typeof data.nearQuestionsEn === 'string' ? data.nearQuestionsEn.split('\n').map(s => s.trim()).filter(Boolean) : []);
  
  const nearFilArr = Array.isArray(data.nearQuestionsFil)
    ? data.nearQuestionsFil
    : (typeof data.nearQuestionsFil === 'string' ? data.nearQuestionsFil.split('\n').map(s => s.trim()).filter(Boolean) : []);

  const newId = uuidv4();
  const now = new Date().toISOString();

  const newFaq: FAQItem = {
    id: newId,
    title: data.title.trim(),
    titleFil: data.titleFil?.trim() || '',
    category: data.category?.trim() || 'General',
    keywords: keywordsArr,
    summaryEn: data.summaryEn.trim(),
    summaryFil: data.summaryFil?.trim() || '',
    nearQuestionsEn: nearEnArr,
    nearQuestionsFil: nearFilArr,
    display_order: Number(data.display_order ?? (currentFaqs.length + 1)),
    created_at: now,
    updated_at: now
  };

  // Try saving to database
  try {
    await db.collection('faqs').doc(newId).set({
      id: newId,
      title: newFaq.title,
      title_fil: newFaq.titleFil,
      category: newFaq.category,
      keywords: newFaq.keywords,
      summary_en: newFaq.summaryEn,
      summary_fil: newFaq.summaryFil,
      near_questions_en: newFaq.nearQuestionsEn,
      near_questions_fil: newFaq.nearQuestionsFil,
      display_order: newFaq.display_order,
      created_at: now,
      updated_at: now
    });
  } catch (err: any) {
    console.warn('[FAQ SERVICE] DB insert failed, persisting to local store:', err?.message || err);
  }

  // Update local file and invalidate cache
  const updatedList = [...currentFaqs, newFaq];
  saveLocalFaqs(updatedList);
  memoryCache.clearNamespace('faqs');

  return newFaq;
}

/**
 * Updates an existing FAQ item.
 */
export async function updateFaq(id: string | number, data: {
  title?: string;
  titleFil?: string;
  category?: string;
  keywords?: string[] | string;
  summaryEn?: string;
  summaryFil?: string;
  nearQuestionsEn?: string[] | string;
  nearQuestionsFil?: string[] | string;
  display_order?: number;
}): Promise<FAQItem | null> {
  const currentFaqs = await getFaqs();
  const idx = currentFaqs.findIndex(f => String(f.id) === String(id));
  if (idx === -1) return null;

  const existing = currentFaqs[idx];
  const now = new Date().toISOString();

  const keywordsArr = data.keywords !== undefined 
    ? (Array.isArray(data.keywords) ? data.keywords : (typeof data.keywords === 'string' ? data.keywords.split(',').map(s => s.trim()).filter(Boolean) : existing.keywords))
    : existing.keywords;

  const nearEnArr = data.nearQuestionsEn !== undefined
    ? (Array.isArray(data.nearQuestionsEn) ? data.nearQuestionsEn : (typeof data.nearQuestionsEn === 'string' ? data.nearQuestionsEn.split('\n').map(s => s.trim()).filter(Boolean) : existing.nearQuestionsEn))
    : existing.nearQuestionsEn;

  const nearFilArr = data.nearQuestionsFil !== undefined
    ? (Array.isArray(data.nearQuestionsFil) ? data.nearQuestionsFil : (typeof data.nearQuestionsFil === 'string' ? data.nearQuestionsFil.split('\n').map(s => s.trim()).filter(Boolean) : existing.nearQuestionsFil))
    : existing.nearQuestionsFil;

  const updatedItem: FAQItem = {
    ...existing,
    title: data.title !== undefined ? data.title.trim() : existing.title,
    titleFil: data.titleFil !== undefined ? data.titleFil.trim() : existing.titleFil,
    category: data.category !== undefined ? data.category.trim() : existing.category,
    keywords: keywordsArr,
    summaryEn: data.summaryEn !== undefined ? data.summaryEn.trim() : existing.summaryEn,
    summaryFil: data.summaryFil !== undefined ? data.summaryFil.trim() : existing.summaryFil,
    nearQuestionsEn: nearEnArr,
    nearQuestionsFil: nearFilArr,
    display_order: data.display_order !== undefined ? Number(data.display_order) : existing.display_order,
    updated_at: now
  };

  // Try updating database
  try {
    await db.collection('faqs').doc(String(id)).update({
      title: updatedItem.title,
      title_fil: updatedItem.titleFil,
      category: updatedItem.category,
      keywords: updatedItem.keywords,
      summary_en: updatedItem.summaryEn,
      summary_fil: updatedItem.summaryFil,
      near_questions_en: updatedItem.nearQuestionsEn,
      near_questions_fil: updatedItem.nearQuestionsFil,
      display_order: updatedItem.display_order,
      updated_at: now
    });
  } catch (err: any) {
    console.warn('[FAQ SERVICE] DB update failed, saving locally:', err?.message || err);
  }

  currentFaqs[idx] = updatedItem;
  saveLocalFaqs(currentFaqs);
  memoryCache.clearNamespace('faqs');

  return updatedItem;
}

/**
 * Deletes an FAQ item.
 */
export async function deleteFaq(id: string | number): Promise<boolean> {
  const currentFaqs = await getFaqs();
  const filtered = currentFaqs.filter(f => String(f.id) !== String(id));
  if (filtered.length === currentFaqs.length) return false;

  try {
    await db.collection('faqs').doc(String(id)).delete();
  } catch (err: any) {
    console.warn('[FAQ SERVICE] DB delete failed:', err?.message || err);
  }

  saveLocalFaqs(filtered);
  memoryCache.clearNamespace('faqs');
  return true;
}

