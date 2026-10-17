// Service Monitor > Settings > Slack: posts to a Slack incoming webhook when monitors change status.
//   level 'monitor': a message for each monitor that goes down (or slow, with notifySlow) and when it is back up.
//   level 'group':   a message for each group whose state changes: up (no monitor with a problem), slow (some slow,
//                    with notifySlow), partial (some down) or down (all of its active monitors); it lists the
//                    monitors with a problem. Ungrouped monitors are one group, "Ungrouped".
// Monitors and groups in Settings > Don't notify are left out (a group's state is that of its other monitors).
// Changes are gathered for GATHER_MS, so a group (or many monitors) failing at once is read once. A group's state
// before the batch is the current one with the batch's changes undone, so nothing is kept between batches.
const axios = require('axios');
const { get } = require('../../../app/core/config/sqlite');
const settings = require('./settings.model');
const model = require('./services.model');

const GATHER_MS = 5000;
const SEND_GAP_MS = 1100;            // Slack accepts about one message a second per webhook
const MAX_SINGLE = 10;               // monitor level: more changes than this in a batch are one summary message
const MAX_LISTED = 15;               // monitors named in one message
const COLORS = { up: '#12B76A', slow: '#F79009', partial: '#F79009', down: '#F04438', test: '#2563EB' };

let batch = [], timer = null, queue = Promise.resolve();
const last = { sentAt: null, error: '', errorAt: null };

// 0 fine, 1 slow (only when slow is notified), 2 down
const severity = (status, slow) => (status === 'down' ? 2 : slow && status === 'slow' ? 1 : 0);
const WORD = ['UP', 'SLOW', 'DOWN'];
const ICON = [':large_green_circle:', ':large_orange_circle:', ':red_circle:'];
// Slack shows it in each reader's own time zone.
const stamp = (iso) => { const t = Math.floor(new Date(iso).getTime() / 1000); return `<!date^${t}^{date_short_pretty} {time}|${iso}>`; };
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function duration(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ''}`;
}

/** A hooks.slack.com incoming webhook URL, or a 400. */
exports.validUrl = function (url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { u = null; }
  if (!u || u.protocol !== 'https:' || u.hostname !== 'hooks.slack.com' || u.pathname.length < 10) {
    throw Object.assign(new Error('Slack: the webhook URL must be a Slack incoming webhook, e.g. https://hooks.slack.com/services/T000/B000/XXXX.'), { status: 400, expose: true });
  }
  return u.href;
};

/** The webhook URL as the settings page shows it (the secret part hidden). */
exports.mask = (url) => (url ? url.replace(/^(https:\/\/hooks\.slack\.com\/[^/]+\/[^/]+\/).*(.{4})$/, '$1…$2') : '');

/** The last delivery: { sentAt, error, errorAt }. */
exports.status = () => Object.assign({}, last);

function post(url, message) {
  const p = queue.then(() => axios.post(url, message, { timeout: 10000, headers: { 'Content-Type': 'application/json' } }))
    .then(() => { last.sentAt = new Date().toISOString(); last.error = ''; })
    .catch((err) => {
      const why = err.response ? `HTTP ${err.response.status}${typeof err.response.data === 'string' ? ': ' + err.response.data.slice(0, 120) : ''}` : err.message;
      Object.assign(last, { error: why, errorAt: new Date().toISOString() });
      throw Object.assign(new Error(`Slack did not accept the message (${why}).`), { status: 400, expose: true });
    });
  // the next message waits for this one and a gap, whatever its outcome
  queue = p.catch(() => null).then(() => new Promise((r) => setTimeout(r, SEND_GAP_MS)));
  return p;
}

const message = (text, color, lines) => ({ text, attachments: [{ color, mrkdwn_in: ['text'], text: lines.filter(Boolean).join('\n') }] });

/** Called by services.model.record() when a monitor's settled status changes. */
exports.changed = function (c) {
  batch.push(c);
  if (!timer) timer = setTimeout(() => { timer = null; flush().catch((err) => console.error('Service Monitor: Slack:', err.message)); }, GATHER_MS);
};

async function flush() {
  const changes = batch;
  batch = [];
  const all = await settings.get(), s = all.slack;
  if (!s.enabled || !s.webhookUrl) return;
  const heard = (m) => !settings.isMuted(all.mute, m);
  const notified = changes.filter(heard);
  if (!notified.length) return;
  const sends = s.level === 'group' ? await groupMessages(notified, s, heard) : await monitorMessages(notified, s);
  for (const m of sends) await post(s.webhookUrl, m).catch((err) => console.error('Service Monitor:', err.message));
}

// ---- monitor level ----

async function monitorMessages(changes, s) {
  const groups = await model.groupLabels();
  const notable = changes.filter((c) => severity(c.from, s.notifySlow) !== severity(c.to, s.notifySlow));
  const one = async (c) => {
    const sev = severity(c.to, s.notifySlow);
    const prev = await get('SELECT at FROM sm_events WHERE service_id = ? AND at < ? ORDER BY id DESC LIMIT 1', [c.id, c.at]);
    const lasted = prev ? duration(new Date(c.at).getTime() - new Date(prev.at).getTime()) : '';
    const title = sev === 0
      ? `${ICON[0]} *${esc(c.name)}* is back UP${lasted ? ` after ${lasted} ${WORD[severity(c.from, s.notifySlow)].toLowerCase()}` : ''}`
      : `${ICON[sev]} *${esc(c.name)}* is ${WORD[sev]}`;
    return message(title.replace(/\*/g, ''), COLORS[['up', 'slow', 'down'][sev]], [
      title,
      `Group: ${esc(groups.get(c.groupId) || 'Ungrouped')} · ${stamp(c.at)}`,
      s.showTargets && c.target ? `Target: \`${esc(c.target)}\`` : '',
      s.showTargets && sev && c.message ? `Error: ${esc(c.message)}` : ''
    ]);
  };
  if (notable.length <= MAX_SINGLE) return Promise.all(notable.map(one));
  // Many at once (a network outage): one summary.
  const down = notable.filter((c) => severity(c.to, s.notifySlow)), up = notable.filter((c) => !severity(c.to, s.notifySlow));
  const list = (l) => l.slice(0, MAX_LISTED).map((c) => `• ${esc(c.name)} — ${WORD[severity(c.to, s.notifySlow)]}`).concat(l.length > MAX_LISTED ? [`… and ${l.length - MAX_LISTED} more`] : []);
  const text = `${notable.length} monitors changed status: ${down.length} with a problem, ${up.length} back up`;
  return [message(text, down.length ? COLORS.down : COLORS.up, [`*${text}*`, ...list(down), ...list(up)])];
}

// ---- group level ----

function groupState(rows, slow) {
  const sev = rows.map((r) => severity(r.status, slow));
  const down = sev.filter((v) => v === 2).length;
  if (rows.length && down === rows.length) return 'down';
  if (down) return 'partial';
  if (sev.some((v) => v === 1)) return 'slow';
  return 'up';
}
const STATE = {
  up: [':large_green_circle:', 'is all UP'], slow: [':large_orange_circle:', 'is SLOW'],
  partial: [':large_orange_circle:', 'is PARTLY DOWN'], down: [':red_circle:', 'is DOWN']
};

async function groupMessages(changes, s, heard) {
  const [names, rows] = await Promise.all([model.groupLabels(), model.enabled()]);
  const key = (gid) => (gid && names.has(gid) ? gid : 0);
  // The status of each changed monitor before this batch (its first change's "from").
  const before = new Map();
  changes.forEach((c) => { if (!before.has(c.id)) before.set(c.id, c.from); });
  const changedIn = new Map(changes.map((c) => [c.id, c]));
  const out = [];
  for (const gid of new Set(changes.map((c) => key(c.groupId)))) {
    const members = rows.filter((r) => key(r.group_id) === gid && heard({ id: r.id, groupId: r.group_id }));
    const now = members.map((r) => ({ id: r.id, name: r.name, target: r.target, error: r.last_error, status: r.settled }));
    const was = now.map((m) => Object.assign({}, m, before.has(m.id) ? { status: before.get(m.id) } : {}));
    const [from, to] = [groupState(was, s.notifySlow), groupState(now, s.notifySlow)];
    if (from === to) continue;
    const name = gid ? names.get(gid) : 'Ungrouped';
    const bad = now.filter((m) => severity(m.status, s.notifySlow));
    const back = now.filter((m) => !severity(m.status, s.notifySlow) && changedIn.has(m.id) && severity(before.get(m.id), s.notifySlow));
    const title = `${STATE[to][0]} Group *${esc(name)}* ${STATE[to][1]}` + (to === 'up' ? '' : ` — ${bad.length} of ${now.length} monitor${now.length === 1 ? '' : 's'}`);
    out.push(message(title.replace(/\*/g, ''), COLORS[to], [
      title,
      `Was ${from === 'up' ? 'all up' : from} · ${stamp(changes[changes.length - 1].at)}`,
      ...bad.slice(0, MAX_LISTED).map((m) => `• ${ICON[severity(m.status, s.notifySlow)]} ${esc(m.name)}` +
        (s.showTargets ? ` — \`${esc(m.target)}\`${m.error ? ` ${esc(m.error)}` : ''}` : '')),
      bad.length > MAX_LISTED ? `… and ${bad.length - MAX_LISTED} more` : '',
      back.length ? `Back up: ${back.map((m) => esc(m.name)).join(', ')}` : ''
    ]));
  }
  return out;
}

/** Sends a test message to `url` (or the saved webhook), as the chosen level would. */
exports.test = async function (url, level, username) {
  const s = (await settings.get()).slack;
  const to = url ? exports.validUrl(url) : s.webhookUrl;
  if (!to) throw Object.assign(new Error('Enter the Slack webhook URL first.'), { status: 400, expose: true });
  const how = level === 'group' ? 'one message per group when its state changes' : 'one message per monitor when it goes down and when it is back up';
  await post(to, message('Service Monitor: test message', COLORS.test, [
    ':white_check_mark: *Service Monitor* can post to this channel.',
    `Notify level: *${level === 'group' ? 'Group' : 'Monitor'}* — ${how}.`,
    `Sent by ${esc(username || 'an administrator')} · ${stamp(new Date().toISOString())}`
  ]));
};
