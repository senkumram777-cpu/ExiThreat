/**
 * Image Service
 * Converts raw text content into a PNG "Paper Strip" image.
 *
 * The strip is:
 *  - Exactly 25 characters wide (monospace font)
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
const FONT_FAMILY = 'Courier New, Courier, monospace';

/**
 * Wraps text into lines of at most CHARS_PER_LINE characters,
 * respecting existing newlines.
 */
function wrapText(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > 0) {
      lines.push(remaining.slice(0, CHARS_PER_LINE));
      remaining = remaining.slice(CHARS_PER_LINE);
    }
  }
  return lines;
}

/**
 * Escapes characters that would break inline SVG text nodes.
 */
function escapeSvg(str: string): string {
  return str
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
