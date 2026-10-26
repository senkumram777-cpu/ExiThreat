/**
 * Redaction Service
 * Strips PII from post content to produce the "Redacted Version"
 * shown after a user has consumed their one-time unredacted view.
 *
 * It works on patterns, so it is a help and not a guarantee. It covers, for English text
 * with Indian and US formats:
 *  - Email addresses, URLs, UPI ids
 *  - Phone numbers
 *  - ID numbers: Aadhaar, PAN, GSTIN, IFSC, SSN, vehicle registrations (BH series too)
 *  - Official numbers: badge and buckle numbers, police ranks with a number ("PC 1234"), FIR,
 *    CSR, case, complaint and employee numbers
 *  - Dates
 *  - Street and door addresses, PIN and ZIP codes
 *  - Named places: police stations, government offices, courts, hospitals, schools, markets,
 *    bus stands, temples, junctions … ("Adyar Police Station" → "[PLACE REDACTED] Police Station")
 *  - Company names that end in a word such as "Ltd" or "Technologies"
 *  - Names: after a title (Mr., Dr., Shri …), after a role word ("my manager Ravi", "our
 *    neighbour Suresh", "constable Murugan"), with initials ("S. Kumar"), and any run of
 *    capitalised words
 *
 * It cannot recognise a name written in lower case, a single name with nothing around it to
 * mark it as one, or anything in another script. Other place names are capitalised words and
 * are redacted with the names, on purpose: a town or a street can identify a person.
 */

interface RedactionRule {
  label: string;
  pattern: RegExp;
  replacement: string;
}

// Amounts of money are part of a complaint and are left alone: "Rs 45000", "₹1,20,000".
const NOT_MONEY = '(?<!(?:Rs\\.?|INR|₹|\\$)\\s?)';
const NOT_AN_AMOUNT = '(?!\\s?(?:rupees|rs\\b|inr\\b|dollars|usd\\b|per\\b|\\/-))';

const TITLES = 'Mr|Mrs|Ms|Miss|Mx|Dr|Prof|Shri|Smt|Sri|Kum|Kumari|Thiru|Tmt|Selvi|Sir|Madam';
const ROLES =
  'manager|supervisor|boss|director|colleague|coworker|co-worker|owner|founder|foreman|'
  + 'contractor|officer|inspector|executive|engineer|accountant|teacher|principal|professor|'
  + 'doctor|nurse|guard|driver|lead|head|partner|named|called|'
  // Outside work: neighbours, the police and officials, family, and people on the street.
  + 'neighbour|neighbor|landlord|landlady|tenant|constable|sub-inspector|policeman|cop|clerk|'
  + 'tahsildar|collector|councillor|councilor|warden|husband|wife|father|mother|brother|sister|'
  + 'uncle|aunt|cousin|relative|son|daughter|stepfather|stepmother|father-in-law|mother-in-law|'
  + 'brother-in-law|sister-in-law|boyfriend|girlfriend|friend|classmate|senior|junior|tutor|'
  + 'coach|conductor|watchman|shopkeeper|priest|man|woman|boy|girl';
const COMPANY_ENDINGS =
  'Pvt\\.?\\s+Ltd\\.?|Private\\s+Limited|Limited|Ltd\\.?|LLP|LLC|Inc\\.?|Corp\\.?|Corporation|'
  + 'Technologies|Technology|Solutions|Industries|Enterprises|Services|Systems|Consultancy|'
  + 'Consulting|Associates|Holdings|Group|Company|Mills|Textiles|Motors|Pharma|Bank';
// Words that end the name of a place: "Adyar Police Station", "Gandhi Market", "Anna Bus Stand".
const PLACE_WORDS =
  'Police\\s+Station|Police\\s+Outpost|Police\\s+Booth|Station|Thana|Chowki|Taluk\\s+Office|'
  + 'Tahsildar\\s+Office|Collectorate|Municipality|Municipal\\s+Office|Panchayat\\s+Office|Panchayat|'
  + 'Ward\\s+Office|Court|Hospital|Clinic|School|College|University|Hostel|Market|Bus\\s+Stand|'
  + 'Bus\\s+Stop|Bus\\s+Depot|Temple|Church|Mosque|Masjid|Park|Beach|Junction|Signal|Circle|'
  + 'Bridge|Flyover|Mall|Theatre|Theater|Stadium|Lake';
const MONTHS =
  'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|'
  + 'Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

const RULES: RedactionRule[] = [
  {
    label: 'email',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL REDACTED]',
  },
  {
    label: 'url',
    pattern: /\b(?:https?:\/\/|www\.)[^\s]+/gi,
    replacement: '[URL REDACTED]',
  },
  {
    label: 'upi_id',
    pattern: /\b[a-zA-Z0-9._\-]{2,}@[a-zA-Z]{2,}\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'gstin',
    pattern: /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'pan',
    pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'ifsc',
    pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'vehicle_registration',
    pattern: /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{4}\b/g,
    replacement: '[VEHICLE REDACTED]',
  },
  {
    label: 'vehicle_registration_bh',
    pattern: /\b\d{2}[\s-]?BH[\s-]?\d{4}[\s-]?[A-Z]{1,2}\b/g,
    replacement: '[VEHICLE REDACTED]',
  },
  {
    // Numbers that identify an officer or a case. Before the door number rule, which would
    // otherwise take "No. 45" in "case No. 45" for an address.
    label: 'official_number',
    pattern: /\b((?:badge|buckle|belt|FIR|CSR|employee\s+id|staff\s+id|ID\s+card)\s*(?:no\.?|number|#)?\s*[:#.]?)\s*[A-Z]{0,3}[-\s]?\d[\dA-Z\/-]*/gi,
    replacement: '$1[ID REDACTED]',
  },
  {
    label: 'numbered_record',
    pattern: /\b((?:complaint|case|token|service|employee|staff|roll|register|registration|ID)\s*(?:no\.?|number|#)\s*[:#.]?)\s*[A-Z]{0,3}[-\s]?\d[\dA-Z\/-]*/gi,
    replacement: '$1[ID REDACTED]',
  },
  {
    // Police ranks with a number: "PC 1234", "HC No. 567".
    label: 'police_number',
    pattern: /\b((?:PC|HC|ASI|SI|SHO)(?:\s*No\.?)?)\s*\d{2,6}\b/g,
    replacement: '$1 [ID REDACTED]',
  },
  {
    label: 'aadhaar',
    pattern: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'phone_international',
    pattern: /\+\d{1,3}[\s-]?\(?\d{2,5}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}\b/g,
    replacement: '[PHONE REDACTED]',
  },
  {
    label: 'phone_india_mobile',
    pattern: new RegExp(`${NOT_MONEY}(?<!\\d)(?:0|91[\\s-]?)?[6-9]\\d{4}[\\s-]?\\d{5}\\b`, 'g'),
    replacement: '[PHONE REDACTED]',
  },
  {
    label: 'phone_india_landline',
    pattern: /(?<!\d)0\d{2,4}[\s-]?\d{6,8}\b/g,
    replacement: '[PHONE REDACTED]',
  },
  {
    label: 'phone_us',
    pattern: /(?<!\d)(?:1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: '[PHONE REDACTED]',
  },
  {
    label: 'ssn',
    pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'date_numeric',
    pattern: /\b(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](\d{4}|\d{2})\b/g,
    replacement: '[DATE REDACTED]',
  },
  {
    label: 'date_day_month',
    pattern: new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b`, 'gi'),
    replacement: '[DATE REDACTED]',
  },
  {
    label: 'date_month_day',
    pattern: new RegExp(`\\b(?:${MONTHS})\\.?\\s+(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'),
    replacement: '[DATE REDACTED]',
  },
  {
    label: 'door_number',
    // A home or shop number. Not "Unit 2" or "Room 5": those name a part of a building, and
    // hiding them made posts hard to follow without protecting anyone.
    pattern: /\b(?:Door|House|Flat|Plot|Apartment|Apt|Shop|H\.?\s?No|D\.?\s?No|No)\.?(?:\s+No\.?)?\s*[:#]?\s*\d+[A-Za-z]?(?:[\/-]\d+[A-Za-z]?)?/gi,
    replacement: '[ADDRESS REDACTED]',
  },
  {
    label: 'cross_or_sector',
    pattern: /\b(?:\d+(?:st|nd|rd|th)\s+(?:Cross|Main|Street|Lane|Block|Stage|Phase|Sector|Avenue|Floor)|(?:Sector|Block|Phase|Stage|Ward)\s+\d+[A-Za-z]?)\b/gi,
    replacement: '[ADDRESS REDACTED]',
  },
  {
    label: 'street_address',
    pattern: /\b\d{1,5}\s+[A-Z][a-zA-Z\s]{2,30}(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Nagar|Colony|Layout|Salai|Marg)\b\.?/gi,
    replacement: '[ADDRESS REDACTED]',
  },
  {
    label: 'named_street',
    pattern: /\b[A-Z][a-zA-Z.]*(?:\s+[A-Z][a-zA-Z.]*){0,3}\s+(?:Street|Road|Avenue|Lane|Nagar|Colony|Layout|Salai|Marg)\b/g,
    replacement: '[ADDRESS REDACTED]',
  },
  {
    label: 'pin_code',
    pattern: new RegExp(`${NOT_MONEY}(?<![\\d,.])[1-9]\\d{2}\\s?\\d{3}(?![\\d,]|\\.\\d)\\b${NOT_AN_AMOUNT}`, 'gi'),
    replacement: '[PIN REDACTED]',
  },
  {
    label: 'zip_code',
    pattern: new RegExp(`${NOT_MONEY}(?<![\\d,.])\\d{5}(?:-\\d{4})?(?![\\d,]|\\.\\d)\\b${NOT_AN_AMOUNT}`, 'gi'),
    replacement: '[ZIP REDACTED]',
  },
  {
    label: 'title_name',
    pattern: new RegExp(`\\b(?:${TITLES})\\.?\\s+(?:[A-Z]\\.\\s?)*[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+){0,2}\\b`, 'g'),
    replacement: '[NAME REDACTED]',
  },
  {
    label: 'initials_name',
    pattern: /\b(?:[A-Z]\.\s?){1,3}[A-Z][a-z]+\b/g,
    replacement: '[NAME REDACTED]',
  },
];

// A single capitalised word straight after a role word: "my manager Ravi", "a man called Anil".
// The role may start with a capital; the name must.
const ROLE_WORDS = ROLES.split('|').map((r) => `[${r[0].toUpperCase()}${r[0]}]${r.slice(1)}`).join('|');
const ROLE_NAME = new RegExp(`\\b(${ROLE_WORDS}|CEO|CTO|CFO|MD|HR)(\\s+)([A-Z][a-z]+)\\b`, 'g');

// One to four capitalised words ending in a word that places end in: "Adyar Police Station".
const PLACE = new RegExp(`\\b((?:[A-Z][A-Za-z.'-]*\\s+){1,4})(${PLACE_WORDS})\\b`, 'g');

// One to four capitalised words ending in a word that companies end in: "Sunrise Textiles",
// "Acme Solutions Pvt Ltd".
const COMPANY = new RegExp(`\\b((?:[A-Z][A-Za-z0-9&.'-]*\\s+){1,4})(?:${COMPANY_ENDINGS})(?![A-Za-z])`, 'g');

// Two or more capitalised words in a row.
const CAPITALISED_RUN = /\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)+\b/g;

// Capitalised words that are not names: sentence openers, days, months, and words for roles
// and parts of an organisation. They are kept; the other words in a run are redacted.
const NOT_NAMES = new Set(
  (
    'The A An I My We He She They It You Our His Her Their Your This That These Those There Here '
    + 'On In At To By For From With Of As And But Or So If When While After Before Since Because '
    + 'Then Now Also Even Still Yet Once Not No Yes Please Dear Hello Hi Thanks Thank Regards '
    + 'Yesterday Today Tomorrow Last Next Every Each Some All Many Most Both One Two Three '
    + 'Monday Tuesday Wednesday Thursday Friday Saturday Sunday '
    + 'January February March April May June July August September October November December '
    + 'Human Resources Manager Supervisor Director Boss Owner Founder Department Team Lead Head '
    + 'Office Company Management Staff Employee Employees Worker Workers Colleague Colleagues '
    + 'Police Station Court Government Ministry Union Committee Board Branch Factory Warehouse '
    + 'Night Day Shift Morning Evening Internal Complaints Labour Labor Commissioner India Indian '
    // Officials, family and neighbours, and the words of a place's name (PLACE_WORDS)
    + 'Constable Inspector Officer Sub Clerk Collector Councillor Warden Neighbour Neighbor '
    + 'Landlord Landlady Husband Wife Father Mother Brother Sister Uncle Aunt Cousin Son Daughter '
    + 'Friend Teacher Principal Doctor Driver Conductor Watchman Shopkeeper Women Woman Men Man '
    + 'Outpost Booth Thana Chowki Taluk Tahsildar Collectorate Municipality Municipal Corporation '
    + 'Panchayat Ward Hospital Clinic School College University Hostel Market Bus Stand Stop Depot '
    + 'Railway Metro Temple Church Mosque Masjid Park Beach Junction Signal Circle Bridge Flyover '
    + 'Mall Theatre Theater Stadium Lake Public Private Primary Higher Secondary Old New Main'
  ).split(' '),
);

function redactPlaces(text: string): string {
  return text.replace(PLACE, (match, lead: string, place: string) => {
    const words = lead.trim().split(/\s+/);
    // "The Police Station", "Government Hospital": ordinary words, nothing to hide.
    if (words.every((w) => NOT_NAMES.has(w))) return match;
    // Words before the name ("Near", "At") and after it ("Government", "Railway") stay.
    let start = 0;
    while (start < words.length && NOT_NAMES.has(words[start])) start++;
    let end = words.length;
    while (end > start && NOT_NAMES.has(words[end - 1])) end--;
    return [...words.slice(0, start), '[PLACE REDACTED]', ...words.slice(end), place].join(' ');
  });
}

const ROLE_SET = new Set(ROLES.toLowerCase().split('|').flatMap((r) => r.split('-')));

/**
 * Whether a word is an ordinary one, not part of a name: a NOT_NAMES word or a role word ("clerk",
 * "neighbour", "mother-in-law"), in any case. Used to trim the AI's findings (aiRedaction.ts).
 */
export function isOrdinaryWord(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  return NOT_NAMES.has(letters[0].toUpperCase() + letters.slice(1).toLowerCase()) || ROLE_SET.has(letters.toLowerCase());
}

/** Whether a phrase is only ordinary words: "the police station", "my mother-in-law". */
export function isOrdinaryPhrase(phrase: string): boolean {
  const words = phrase.split(/[^A-Za-z]+/).filter(Boolean);
  return words.length > 0 && words.every(isOrdinaryWord);
}

function redactCompanies(text: string): string {
  return text.replace(COMPANY, (match, lead: string) => {
    // "The Company", "Our Group": ordinary words, nothing to hide.
    const words = lead.trim().split(/\s+/);
    if (words.every((w) => NOT_NAMES.has(w))) return match;
    // Sentence openers in front of the name stay: "At Sunrise Textiles" → "At [COMPANY REDACTED]".
    let kept = 0;
    while (kept < words.length - 1 && NOT_NAMES.has(words[kept])) kept++;
    return [...words.slice(0, kept), '[COMPANY REDACTED]'].join(' ');
  });
}

function redactRoleNames(text: string): string {
  return text.replace(ROLE_NAME, (match, role: string, gap: string, name: string) => (
    NOT_NAMES.has(name) ? match : `${role}${gap}[NAME REDACTED]`
  ));
}

function redactCapitalisedRuns(text: string): string {
  return text.replace(CAPITALISED_RUN, (run) => {
    const out: string[] = [];
    let inName = false;
    for (const word of run.split(/[ \t]+/)) {
      if (NOT_NAMES.has(word)) {
        out.push(word);
        inName = false;
      } else if (!inName) {
        out.push('[NAME REDACTED]');
        inName = true;
      }
    }
    return out.join(' ');
  });
}

/**
 * Returns the redacted version of content with all PII patterns replaced.
 */
export function redactContent(content: string): string {
  let result = content;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  result = redactPlaces(result);
  result = redactCompanies(result);
  // Runs first: "Manager Ravi Kumar" must go as a whole, not leave "Kumar" behind.
  result = redactCapitalisedRuns(result);
  result = redactRoleNames(result);
  return result;
}
