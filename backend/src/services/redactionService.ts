/**
 * Redaction Service
 * Strips PII from post content to produce the "Redacted Version"
 * shown after a user has consumed their one-time unredacted view.
 *
 * Patterns covered:
 *  - Email addresses
 *  - Phone numbers (multiple formats)
 *  - Names preceded by common salutations
 *  - Street addresses
 *  - SSN / national ID patterns
 *  - URLs (optional — kept but masked)
 *  - Dates of birth patterns
 */

interface RedactionRule {
  label: string;
  pattern: RegExp;
  replacement: string;
}

const RULES: RedactionRule[] = [
  {
    label: 'email',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL REDACTED]',
  },
  {
    label: 'phone_us',
    pattern: /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
    replacement: '[PHONE REDACTED]',
  },
  {
    label: 'ssn',
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: '[ID REDACTED]',
  },
  {
    label: 'salutation_name',
    pattern: /\b(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.)\s+[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)?\b/g,
    replacement: '[NAME REDACTED]',
  },
  {
    label: 'full_name_caps',
    // Two or more consecutive capitalised words not at sentence start
    pattern: /(?<!\.\s)(?<!\n)\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}(\s+[A-Z][a-z]{1,20})?\b/g,
    replacement: '[NAME REDACTED]',
  },
  {
    label: 'street_address',
    pattern: /\d{1,5}\s+[A-Z][a-zA-Z\s]{2,30}(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/gi,
    replacement: '[ADDRESS REDACTED]',
  },
  {
    label: 'url',
    pattern: /https?:\/\/[^\s]+/g,
    replacement: '[URL REDACTED]',
  },
  {
    label: 'dob',
    pattern: /\b(0?[1-9]|[12]\d|3[01])[\/\-](0?[1-9]|1[0-2])[\/\-](\d{2}|\d{4})\b/g,
    replacement: '[DATE REDACTED]',
  },
  {
    label: 'zip_code',
    pattern: /\b\d{5}(-\d{4})?\b/g,
    replacement: '[ZIP REDACTED]',
  },
];

/**
 * Returns the redacted version of content with all PII patterns replaced.
 */
export function redactContent(content: string): string {
  let result = content;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}
