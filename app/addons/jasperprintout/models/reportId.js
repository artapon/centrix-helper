// Publish Report > deploy workflow, "Report ID in the page footer": a deploy can print an ID made of
// the deploy time (DDMMYYYYHHMMSS, server time) at the bottom right of every page, so a printed report
// tells which version it came from. It is added to the JRXML that is sent, never to the saved design.
// Each stamped deploy (UAT or Production) gets the time of that deploy; an ID already in the JRXML is
// replaced. Production without the option sends the approved UAT JRXML as it is (its UAT ID, if any).

const MARK = 'com.centrix.designer.reportId';      // marks the stamp's element (and its ID)
const STAMP_H = 14;

const pad = (n) => String(n).padStart(2, '0');

/** "14102026134501" for 14 Oct 2026 13:45:01. */
function make(date = new Date()) {
  return pad(date.getDate()) + pad(date.getMonth() + 1) + date.getFullYear() + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

/** The ID a JRXML is already stamped with, or ''. */
function of(jrxml) {
  const m = new RegExp(`<property name="${MARK.replace(/\./g, '\\.')}" value="(\\d{14})"`).exec(String(jrxml || ''));
  return m ? m[1] : '';
}

const attrOf = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };

function element(id, width, y) {
  return `\t\t\t<staticText>\n` +
    `\t\t\t\t<reportElement x="0" y="${y}" width="${width}" height="${STAMP_H}">\n` +
    `\t\t\t\t\t<property name="${MARK}" value="${id}"/>\n` +
    `\t\t\t\t</reportElement>\n` +
    `\t\t\t\t<textElement textAlignment="Right" verticalAlignment="Bottom"><font size="8"/></textElement>\n` +
    `\t\t\t\t<text><![CDATA[${id}]]></text>\n` +
    `\t\t\t</staticText>`;
}

/**
 * The JRXML with the ID at the bottom right of the page footer (and of the last page footer, which
 * replaces it on the last page). A footer lower than the stamp is made taller; a report without a page
 * footer gets one. A JRXML that already has the stamp element (an earlier deploy, or a report opened
 * from JasperServer and saved) keeps its element where it is, with the ID changed to this one.
 * Returns { jrxml, id, added, replaced } (replaced: the ID it had).
 */
function stamp(jrxml, id) {
  let x = String(jrxml || '');
  const had = of(x);
  if (had) {
    // Every stamp element (page footer, last page footer): its marker property and its text.
    const markRe = new RegExp(`(<property name="${MARK.replace(/\./g, '\\.')}" value=")\\d{14}(")`);
    x = x.replace(/<staticText\b[\s\S]*?<\/staticText>/g, (el) => (!markRe.test(el) ? el
      : el.replace(new RegExp(markRe.source, 'g'), `$1${id}$2`).replace(/<text>[\s\S]*?<\/text>/, `<text><![CDATA[${id}]]></text>`)));
    return { jrxml: x, id, added: false, replaced: had };
  }
  const root = /<jasperReport\b[^>]*>/.exec(x);
  const width = Math.max(1, parseInt(root && attrOf(root[0], 'columnWidth'), 10) || 555);

  let placed = false;
  ['pageFooter', 'lastPageFooter'].forEach((section) => {
    const re = new RegExp(`(<${section}>\\s*)(<band\\b[^>]*?)(\\/?)>`);
    const m = re.exec(x);
    if (!m) return;
    const tag = m[2];
    const h = parseInt(attrOf(tag, 'height'), 10) || 0;
    const height = Math.max(h, STAMP_H);
    const open = (/\sheight="/.test(tag) ? tag.replace(/\sheight="[^"]*"/, ` height="${height}"`) : `${tag} height="${height}"`) + '>';
    const el = element(id, width, height - STAMP_H);
    // A self-closing band gets a body; otherwise the stamp goes last, on top of what is there.
    const body = m[3] ? `${open}\n${el}\n\t\t</band>` : null;
    if (body) {
      x = x.slice(0, m.index) + m[1] + body + x.slice(m.index + m[0].length);
    } else {
      const start = m.index + m[1].length;
      const end = x.indexOf('</band>', start);
      if (end < 0) return;
      x = x.slice(0, start) + open + x.slice(start + tag.length + 1, end).replace(/\s*$/, '\n') + el + '\n\t\t' + x.slice(end);
    }
    placed = true;
  });

  if (!placed) {
    // No page footer: one only for the stamp, where JRXML expects it (before lastPageFooter / summary / noData).
    const footer = `\t<pageFooter>\n\t\t<band height="${STAMP_H}" splitType="Stretch">\n${element(id, width, 0)}\n\t\t</band>\n\t</pageFooter>\n`;
    const at = ['<lastPageFooter', '<summary', '<noData', '</jasperReport>'].map((t) => x.indexOf(t)).filter((i) => i >= 0)[0];
    const lineStart = x.lastIndexOf('\n', at) + 1;
    x = x.slice(0, lineStart) + footer + x.slice(lineStart);
  }
  return { jrxml: x, id, added: true };
}

module.exports = { make, of, stamp, MARK, STAMP_H };
