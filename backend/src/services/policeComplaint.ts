/**
 * Whether a post is a complaint about the police. Officers see every post on the common page in
 * full (routes/common.ts), except these: they get only the redacted version, without the
 * author's pseudonym or mobile number, unless the author allows an officer more.
 *
 * A post counts when its author chose "Police or law enforcement" under "Police or government
 * official", or when its own words mention the police, whatever type was chosen. The words are
 * read in English (and Indian words in English letters), Hindi, Tamil, Telugu, Kannada and
 * Malayalam. It errs on the side of the author: a post that only mentions going to the police
 * is protected too, and the officer can ask. Misspellings meant to dodge it are not caught.
 */

const ENGLISH = new RegExp(String.raw`\b(?:${[
  'police', 'policem[ae]n', 'policewom[ae]n', 'policewala', 'policewale', 'policewaala', 'policewaale',
  'cops?', 'constables?', 'head ?constables?', 'inspectors?', 'sub[- ]?inspectors?', 'circle inspectors?',
  'sho', 'dsp', 'dcp', 'acp', 'ips officers?', 'thana', 'thane', 'thanedar', 'daroga', 'darogha', 'darogah',
  'havaldar', 'hawaldar', 'kotwal', 'kotwali', 'law enforcement', 'custodial', 'polees', 'polis',
  'kaval', 'kavalar', 'kaavalar', 'kaval nilayam', 'kavalthurai',
].join('|')})\b`, 'i');

// Indian scripts have no \b; a stem found anywhere counts (so "पुलिसवाले" has "पुलिस").
const STEMS = [
  // Hindi
  'पुलिस', 'पुलीस', 'थाना', 'थाने', 'थानेदार', 'दरोगा', 'दारोगा', 'दरोग़ा', 'हवलदार', 'सिपाही', 'कांस्टेबल', 'कॉन्स्टेबल', 'इंस्पेक्टर', 'दरोगाजी',
  // Tamil
  'காவல்', 'காவலர்', 'போலீஸ்', 'போலீசு', 'போலீசார்', 'காவல்துறை', 'ஆய்வாளர்', 'கான்ஸ்டபிள்',
  // Telugu
  'పోలీస్', 'పోలీసు', 'కానిస్టేబుల్', 'ఇన్స్పెక్టర్', 'ఎస్సై',
  // Kannada
  'ಪೊಲೀಸ್', 'ಪೋಲೀಸ್', 'ಪೊಲೀಸರು', 'ಪೇದೆ', 'ಕಾನ್ಸ್ಟೇಬಲ್', 'ಇನ್ಸ್ಪೆಕ್ಟರ್', 'ಠಾಣೆ',
  // Malayalam
  'പോലീസ്', 'പൊലീസ്', 'പോലീസുകാര', 'കോൺസ്റ്റബിൾ', 'ഇൻസ്പെക്ടർ',
].map((stem) => stem.normalize('NFC'));

/** Whether the text mentions the police. */
export function mentionsPolice(text: string): boolean {
  const normal = text.normalize('NFC');
  return ENGLISH.test(normal) || STEMS.some((stem) => normal.includes(stem));
}

/** Whether a post is a complaint about the police (see above). */
export function isPoliceComplaint(post: { subcategory: string | null; originalContent: string }): boolean {
  return post.subcategory === 'police' || mentionsPolice(post.originalContent);
}
