/**
 * Image Service
 * Converts raw text content into a PNG "Paper Strip" image.
 *
 * The strip is:
 *  - At most 25 characters wide (monospace font), broken between words
 *  - Vertically as tall as needed for the full text
 *  - Returned as a PNG Buffer that the frontend streams into an <img> tag
 *
 * This prevents DOM inspection of the original text and makes
 * automated mass-scraping impractical.
 */

import sharp from 'sharp';

const CHAR_WIDTH = 14;       // px per character (monospace)
const LINE_HEIGHT = 22;      // px per line
const CHARS_PER_LINE = 25;
const PADDING = 12;          // px top/bottom padding
const FONT_SIZE = 14;
const BG_COLOR = '#1a1a2e';  // dark navy
const TEXT_COLOR = '#e0e0e0';
// The server image installs DejaVu (Latin) and Noto (Tamil, Devanagari); see the Dockerfile.
// Without an installed font the strip comes out blank.
const FONT_FAMILY = 'DejaVu Sans Mono, Courier New, Courier, monospace';

/**
 * Wraps text into lines of at most CHARS_PER_LINE characters, respecting existing newlines.
 * Lines break between words; only a word longer than a line is cut. Characters are counted
 * as code points so that a character outside the basic plane is never split in two.
 */
export function wrapText(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line: string[] = [];
    for (const word of paragraph.split(/[ \t]+/)) {
      let chars = Array.from(word);
      if (chars.length === 0) continue;
      if (line.length > 0 && line.length + 1 + chars.length > CHARS_PER_LINE) {
        lines.push(line.join(''));
        line = [];
      }
      while (chars.length > CHARS_PER_LINE) {
        lines.push(chars.slice(0, CHARS_PER_LINE).join(''));
        chars = chars.slice(CHARS_PER_LINE);
      }
      line = line.length > 0 ? [...line, ' ', ...chars] : chars;
    }
    lines.push(line.join(''));
  }
  return lines;
}

/**
 * Escapes characters that would break inline SVG text nodes, and drops control characters,
 * which are not allowed in XML at all.
 */
function escapeSvg(str: string): string {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates a PNG strip image from plaintext content.
 * @param content  The original, unredacted text
 * @returns        PNG buffer
 */
export async function generatePaperStrip(content: string): Promise<Buffer> {
  const lines = wrapText(content);
  const imageWidth = CHARS_PER_LINE * CHAR_WIDTH + PADDING * 2;
  const imageHeight = lines.length * LINE_HEIGHT + PADDING * 2;

  const textRows = lines
    .map((line, i) => {
      const y = PADDING + (i + 1) * LINE_HEIGHT;
      return `<text x="${PADDING}" y="${y}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${TEXT_COLOR}">${escapeSvg(line)}</text>`;
    })
    .join('\n');

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">
  <rect width="100%" height="100%" fill="${BG_COLOR}"/>
  ${textRows}
</svg>`.trim();

  const buffer = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 6 })
    .toBuffer();

  return buffer;
}
