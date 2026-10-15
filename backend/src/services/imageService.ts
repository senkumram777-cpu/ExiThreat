/**
 * Image Service
 * Converts raw text content into a PNG "Paper Strip" image for the first look.
 *
 * The first look is shown as one line scrolling sideways (SecureMarquee). The text is drawn
 * as rows of at most ROW_CHARS characters, broken between words, stacked in one PNG, with
 * each row's drawn width alongside; the website lays the rows end to end to make the line.
 * One very wide image is not possible: the renderer stops at 32,767 pixels.
 *
 * This keeps the original text out of the page itself and makes automated mass-scraping
 * impractical.
 */

import sharp from 'sharp';

// Drawn at twice the size the website shows it, so the text stays sharp on phone screens.
export const STRIP_SCALE = 2;
const FONT_SIZE = 16 * STRIP_SCALE;
const ROW_HEIGHT = 24 * STRIP_SCALE;
const BASELINE = 17 * STRIP_SCALE;  // from the top of a row
const LEFT = 2 * STRIP_SCALE;       // space before the first character of a row
const ROW_CHARS = 60;
// Wider than any row can be, even in scripts whose characters are wider than Latin ones.
const DRAW_WIDTH = ROW_CHARS * FONT_SIZE;
const BG_COLOR = '#1a1a2e';  // dark navy
const TEXT_COLOR = '#e0e0e0';
// The server image installs DejaVu (Latin) and Noto (Tamil, Devanagari); see the Dockerfile.
// Without an installed font the strip comes out blank.
const FONT_FAMILY = 'DejaVu Sans Mono, Courier New, Courier, monospace';

/**
 * Wraps text into lines of at most `perLine` characters, respecting existing newlines.
 * Lines break between words; only a word longer than a line is cut. Characters are counted
 * as code points so that a character outside the basic plane is never split in two.
 */
export function wrapText(text: string, perLine = 25): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line: string[] = [];
    for (const word of paragraph.split(/[ \t]+/)) {
      let chars = Array.from(word);
      if (chars.length === 0) continue;
      if (line.length > 0 && line.length + 1 + chars.length > perLine) {
        lines.push(line.join(''));
        line = [];
      }
      while (chars.length > perLine) {
        lines.push(chars.slice(0, perLine).join(''));
        chars = chars.slice(perLine);
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
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface PaperStrip {
  png: Buffer;
  /** Drawn width of each row, top to bottom, in image pixels. */
  rows: number[];
  rowHeight: number;
  /** Image pixels per screen pixel. */
  scale: number;
}

/**
 * Draws the original text as rows for the one-line first look. Line breaks become spaces;
 * the gap between two rows is a space the website adds.
 * @param content  The original, unredacted text
 */
export async function generatePaperStrip(content: string): Promise<PaperStrip> {
  const lines = wrapText(content.replace(/\s+/g, ' ').trim(), ROW_CHARS).filter((l) => l.length > 0);
  if (lines.length === 0) lines.push('');
  const height = lines.length * ROW_HEIGHT;

  const textRows = lines
    .map((line, i) => `<text x="${LEFT}" y="${i * ROW_HEIGHT + BASELINE}" font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${TEXT_COLOR}">${escapeSvg(line)}</text>`)
    .join('\n');

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${DRAW_WIDTH}" height="${height}">
  <rect width="100%" height="100%" fill="${BG_COLOR}"/>
  ${textRows}
</svg>`.trim();

  const drawn = await sharp(Buffer.from(svg)).png().toBuffer();

  // Each row ends where its last drawn pixel does.
  const rows = await Promise.all(lines.map(async (_, i) => {
    try {
      // Two steps: within one pipeline sharp trims before it extracts.
      const row = await sharp(drawn)
        .extract({ left: 0, top: i * ROW_HEIGHT, width: DRAW_WIDTH, height: ROW_HEIGHT })
        .png()
        .toBuffer();
      const { info } = await sharp(row)
        .trim({ background: BG_COLOR, threshold: 10 })
        .toBuffer({ resolveWithObject: true });
      const right = -(info.trimOffsetLeft ?? 0) + info.width;
      // Nothing drawn: trimming leaves the row as it was.
      return right >= DRAW_WIDTH ? LEFT : right + LEFT;
    } catch {
      return LEFT;
    }
  }));

  const width = Math.max(1, ...rows);
  const png = await sharp(drawn)
    .extract({ left: 0, top: 0, width, height })
    .png({ compressionLevel: 6 })
    .toBuffer();

  return { png, rows, rowHeight: ROW_HEIGHT, scale: STRIP_SCALE };
}
