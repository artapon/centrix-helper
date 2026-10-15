// E-Learning videos: a lesson's video link -> what the browser plays.
//   youtube  any YouTube link (watch, youtu.be, shorts, embed, live) -> ref "<id>" or "<id>?start=<s>"
//   gdrive   a Google Drive file link (file/d/<id>, open?id=<id>, uc?id=<id>) -> ref "<id>"
//   share    a video file in a shared folder of Settings -> ref "<folder key>|<path inside the folder>",
//            streamed by the server (with Range requests, so the player can seek)
const fs = require('fs');
const path = require('path');
const settings = require('./settings.model');

const SOURCES = ['youtube', 'gdrive', 'share'];
const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.ogg': 'video/ogg',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4'
};
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{20,}$/;
const MAX_LIST = 2000;

const invalid = (message) => Object.assign(new Error(message), { status: 400, expose: true });
const isVideo = (name) => Object.prototype.hasOwnProperty.call(TYPES, path.extname(String(name)).toLowerCase());
const asUrl = (s) => { try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s); } catch (e) { return null; } };

// "90", "90s", "1m30s", "1h2m3s" -> seconds
function seconds(t) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(String(t || ''));
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

function youtube(input) {
  const s = String(input || '').trim();
  if (YT_ID.test(s)) return s;
  const u = asUrl(s);
  if (!u || !/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(u.hostname)) throw invalid('This is not a YouTube link, e.g. https://www.youtube.com/watch?v=… or https://youtu.be/….');
  let id = null;
  if (/youtu\.be$/i.test(u.hostname)) id = u.pathname.split('/')[1];
  else if (u.searchParams.get('v')) id = u.searchParams.get('v');
  else {
    const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
    id = m && m[1];
  }
  if (!id || !YT_ID.test(id)) throw invalid('No video found in this YouTube link. Use the link of one video (Share > Copy link).');
  const start = seconds(u.searchParams.get('t') || u.searchParams.get('start'));
  return start ? `${id}?start=${start}` : id;
}

function gdrive(input) {
  const s = String(input || '').trim();
  if (DRIVE_ID.test(s)) return s;
  const u = asUrl(s);
  if (!u || !/(^|\.)(drive|docs)\.google\.com$/i.test(u.hostname)) throw invalid('This is not a Google Drive link, e.g. https://drive.google.com/file/d/…/view.');
  if (/\/folders\//.test(u.pathname)) throw invalid('This is a Drive folder. Open the video in Drive and use its own link (Share > Copy link).');
  const m = /\/d\/([A-Za-z0-9_-]+)/.exec(u.pathname);
  const id = (m && m[1]) || u.searchParams.get('id');
  if (!id || !DRIVE_ID.test(id)) throw invalid('No file found in this Google Drive link. Use the video\'s link (Share > Copy link).');
  return id;
}

const sameOrUnder = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

// The full path of a "<key>|<rel>" ref, inside its folder (never outside, whatever rel holds).
async function sharePath(ref) {
  const i = String(ref || '').indexOf('|');
  const folder = i > 0 ? await settings.folder(ref.slice(0, i)) : null;
  if (!folder) throw invalid('The shared folder of this video is no longer in E-Learning Settings.');
  const full = path.resolve(folder.path, ref.slice(i + 1));
  if (!sameOrUnder(full, folder.path)) throw invalid('The video is outside its shared folder.');
  return { folder, full };
}

// A shared folder video as picked ("<key>|<rel>") or pasted (\\server\share\dir\file.mp4) -> its ref.
async function share(input) {
  let s = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!s) throw invalid('Choose a video file from a shared folder.');
  const { folders } = await settings.get();
  if (!folders.length) throw invalid('No shared folders yet: an administrator adds them in E-Learning > Settings.');
  let ref = null;
  const pipe = s.indexOf('|');
  if (pipe > 0 && folders.some((f) => f.key === s.slice(0, pipe))) {
    ref = s.slice(0, pipe) + '|' + s.slice(pipe + 1).replace(/\\/g, '/').replace(/^\/+/, '');
  } else {
    if (/^file:/i.test(s)) s = decodeURIComponent(s.replace(/^file:\/*/i, '\\\\')).replace(/^\\\\([A-Za-z]:)/, '$1');
    if (/^\/\/[^/]/.test(s)) s = s.replace(/\//g, '\\');
    const full = path.normalize(s);
    // the deepest matching folder, so nested shared folders resolve to the closest one
    const match = folders.filter((f) => sameOrUnder(full, f.path)).sort((a, b) => b.path.length - a.path.length)[0];
    if (!match) throw invalid('This file is not in any shared folder of E-Learning Settings. Ask an administrator to add its folder, or pick it with Browse.');
    ref = match.key + '|' + path.relative(match.path, full).split(path.sep).join('/');
  }
  if (!isVideo(ref)) throw invalid(`Only video files can be played: ${Object.keys(TYPES).join(', ')}.`);
  const { full } = await sharePath(ref);
  const st = await fs.promises.stat(full).catch(() => null);
  if (!st || !st.isFile()) throw invalid('The server cannot find this file in the shared folder (or has no permission to read it).');
  return ref;
}

/** A lesson's video source and link as typed -> the ref stored with it; throws a 400 on a bad link. */
exports.normalize = async function (source, url) {
  if (!SOURCES.includes(source)) throw invalid('Choose where the video is: YouTube, Google Drive or a shared folder.');
  if (!String(url || '').trim()) throw invalid('The video lesson needs a link to its video.');
  if (source === 'youtube') return youtube(url);
  if (source === 'gdrive') return gdrive(url);
  return share(url);
};

/** What the page plays: { kind: 'iframe' | 'file', src, type? }. mediaUrl: the stream link for shared folder files. */
exports.player = function (source, ref, mediaUrl) {
  if (!ref) return null;
  if (source === 'youtube') {
    const [id, query] = ref.split('?');
    return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}?rel=0${query ? '&' + query : ''}`, open: `https://www.youtube.com/watch?v=${id}` };
  }
  if (source === 'gdrive') return { kind: 'iframe', src: `https://drive.google.com/file/d/${ref}/preview`, open: `https://drive.google.com/file/d/${ref}/view` };
  if (source === 'share') return { kind: 'file', src: mediaUrl, type: TYPES[path.extname(ref).toLowerCase()] || 'video/mp4', audio: /^audio\//.test(TYPES[path.extname(ref).toLowerCase()] || '') };
  return null;
};

/** The folders and video files in a shared folder's sub folder: { folder, dir, parent, entries: [{ name, ref?, dir, size, mtime }] }. */
exports.browse = async function (key, dir) {
  const folder = await settings.folder(key);
  if (!folder) throw invalid('This shared folder is not in E-Learning Settings.');
  const rel = String(dir || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const full = path.resolve(folder.path, rel);
  if (!sameOrUnder(full, folder.path)) throw invalid('This folder is outside the shared folder.');
  let list;
  try {
    list = await fs.promises.readdir(full, { withFileTypes: true });
  } catch (err) {
    throw invalid(err.code === 'ENOENT' ? 'The folder was not found.' : `The server cannot open the folder (${err.code || err.message}).`);
  }
  const entries = [];
  for (const e of list.slice(0, MAX_LIST)) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) entries.push({ name: e.name, dir: true, path: child });
    else if (e.isFile() && isVideo(e.name)) {
      const st = await fs.promises.stat(path.join(full, e.name)).catch(() => null);
      entries.push({ name: e.name, dir: false, path: child, ref: `${key}|${child}`, size: st ? st.size : null, mtime: st ? st.mtime.toISOString() : null });
    }
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  return { folder: { key: folder.key, name: folder.name }, dir: rel, parent: rel ? rel.split('/').slice(0, -1).join('/') : null, entries, truncated: list.length > MAX_LIST };
};

/** Streams a shared folder video (a "<key>|<rel>" ref) with Range support. */
exports.stream = async function (req, res, ref) {
  let full;
  try { ({ full } = await sharePath(ref)); } catch (err) { return res.status(404).type('text').send(err.message); }
  const st = await fs.promises.stat(full).catch(() => null);
  if (!st || !st.isFile() || !isVideo(full)) return res.status(404).type('text').send('The video file was not found in the shared folder.');
  const size = st.size;
  const headers = {
    'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Last-Modified': st.mtime.toUTCString()
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  let start = 0, end = size - 1, status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = +range[1]; end = range[2] ? Math.min(+range[2], size - 1) : size - 1; }
    else { start = Math.max(0, size - +range[2]); }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(full, { start, end });
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  return stream.pipe(res);
};

exports.SOURCES = SOURCES;
exports.isVideo = isVideo;
exports.sharePath = sharePath;
