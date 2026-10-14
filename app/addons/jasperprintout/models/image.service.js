// Uploaded pages -> A4 PNGs at 300 dpi (2480 x 3508), sharpened, as in the original builder.
const sharp = require('sharp');

const A4_300DPI = { width: 2480, height: 3508 };
// Pages saved as a Jasper Designer design: smaller JPEGs, so a 20-page report stays within the
// design library's limits (5 MB per image, 20 MB in all).
const A4_200DPI = { width: 1654, height: 2339 };

const safeBase = (name) => String(name || '')
  .replace(/\.[^.]+$/, '')
  .replace(/[^a-zA-Z0-9_.-]/g, '')
  .replace(/\.+/g, '.')
  .toLowerCase()
  .slice(0, 80) || 'image';

/**
 * files: multer memory files, in page order.
 * Returns [{ name, buffer }] with unique .png names (they become report-unit resource names),
 * or .jpg names at 200 dpi with opts.jpeg.
 */
exports.toA4Pages = async function (files, opts = {}) {
  const ext = opts.jpeg ? 'jpg' : 'png';
  const used = new Set();
  const pages = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // Multer gives the original name as latin1; Thai names become their ASCII remainder.
    const original = Buffer.from(f.originalname || '', 'latin1').toString('utf8');
    let base = safeBase(original);
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name); n++) name = `${base}_${n}.${ext}`;
    used.add(name);

    let buffer;
    try {
      // A page opened from a saved design is already an A4 JPEG at 200 dpi: kept as it is, so saving
      // again doesn't sharpen and re-compress it each time.
      if (opts.jpeg) {
        const meta = await sharp(f.buffer).metadata();
        if (meta.format === 'jpeg' && meta.width === A4_200DPI.width && meta.height === A4_200DPI.height) {
          pages.push({ name, buffer: f.buffer });
          continue;
        }
      }
      const img = sharp(f.buffer)
        .withMetadata({ density: opts.jpeg ? 200 : 300 })
        .resize(opts.jpeg ? A4_200DPI : A4_300DPI)
        .sharpen({ sigma: 2.0 });
      buffer = await (opts.jpeg ? img.flatten({ background: '#ffffff' }).jpeg({ quality: 85 }) : img.png()).toBuffer();
    } catch (err) {
      const e = new Error(`Page ${i + 1} (${original || 'image'}) is not an image that can be read: ${err.message}`);
      e.status = 400;
      e.expose = true;
      throw e;
    }
    pages.push({ name, buffer });
  }
  return pages;
};
