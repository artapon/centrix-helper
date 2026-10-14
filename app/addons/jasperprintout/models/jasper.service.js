// JasperServer REST v2: replace a report unit (delete, then create), check the connection, and read
// the repository (folders, report units and their files) for Jasper Designer's Open dialog.
const axios = require('axios');
const https = require('https');

const TIMEOUT_MS = 60000;

function client(settings) {
  if (!settings.jasperUrl || !settings.jasperUser || !settings.jasperPassword) {
    const err = new Error('JasperServer is not set up yet. An administrator can set it in Reports > Settings.');
    err.status = 409;
    err.expose = true;
    throw err;
  }
  return axios.create({
    baseURL: settings.jasperUrl + '/rest_v2',
    auth: { username: settings.jasperUser, password: settings.jasperPassword },
    timeout: TIMEOUT_MS,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    httpsAgent: new https.Agent({ rejectUnauthorized: !settings.allowSelfSigned })
  });
}

// "PrintOut/Sub folder" -> "/PrintOut/Sub%20folder"
const repoPath = (...parts) => '/' + parts.join('/').split('/').filter(Boolean).map(encodeURIComponent).join('/');

// A readable message from an axios error (JasperServer answers JSON or XML).
function describe(err) {
  if (err.response) {
    const d = err.response.data;
    const detail = typeof d === 'string' ? d.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : d && (d.message || d.errorCode) ? [d.errorCode, d.message].filter(Boolean).join(': ') : JSON.stringify(d);
    if (err.response.status === 401) return 'JasperServer rejected the user name or password (401).';
    return `JasperServer answered ${err.response.status}${detail ? ': ' + detail.slice(0, 400) : ''}`;
  }
  if (err.code === 'ECONNABORTED') return 'JasperServer did not answer in time.';
  if (/self.signed|certificate/i.test(err.message)) return 'JasperServer uses a certificate this server does not trust. Allow self-signed certificates in Reports > Settings.';
  return `Could not reach JasperServer: ${err.message}`;
}

function fail(err) {
  const e = new Error(describe(err));
  e.status = 502;
  e.expose = true;
  return e;
}

/** { ok, version, edition } from /serverInfo. */
exports.test = async function (settings) {
  try {
    const r = await client(settings).get('/serverInfo', { headers: { Accept: 'application/json' } });
    return { ok: true, version: r.data && r.data.version, edition: r.data && r.data.edition };
  } catch (err) {
    if (err.expose) throw err;
    throw fail(err);
  }
};

/**
 * Publishes a report unit at /<folder>/<reportName>, replacing one that is already there.
 * images: [{ name, buffer }] (PNG), already in page order.
 */
exports.publish = async function (settings, { folder, reportName, dataSource, jrxml, images }) {
  const http = client(settings);
  const unitPath = repoPath(folder, reportName);

  try {
    await http.delete('/resources' + unitPath, { headers: { Accept: 'application/json' } });
  } catch (err) {
    if (!err.response || err.response.status !== 404) throw fail(err);
  }

  const body = {
    label: reportName,
    description: `Auto-published report: ${reportName}`,
    dataSource: { dataSourceReference: { uri: dataSource } },
    jrxml: { jrxmlFile: { type: 'jrxml', label: 'Main jrxml', content: Buffer.from(jrxml, 'utf8').toString('base64') } },
    inputControls: (settings.inputControls || []).map((uri) => ({ inputControlReference: { uri } })),
    resources: {
      resource: images.map((img) => ({
        name: img.name,
        file: { fileResource: { type: 'img', label: img.name, content: img.buffer.toString('base64') } }
      }))
    }
  };
  if (!body.inputControls.length) delete body.inputControls;

  try {
    const r = await http.post('/resources' + repoPath(folder), body, {
      headers: { 'Content-Type': 'application/repository.reportUnit+json', Accept: 'application/json' }
    });
    return { uri: (r.data && r.data.uri) || unitPath };
  } catch (err) {
    throw fail(err);
  }
};

/**
 * Runs a published report unit and returns the file (Buffer). params: { name: value }.
 * JasperServer compiles the JRXML here, so JRXML mistakes come back as its error message.
 */
exports.run = async function (settings, unitUri, format, params) {
  const http = client(settings);
  try {
    const r = await http.get('/reports' + unitUri.split('/').map((s) => (s ? encodeURIComponent(decodeURIComponent(s)) : s)).join('/') + '.' + format, {
      params: params || {},
      responseType: 'arraybuffer',
      timeout: 120000
    });
    return Buffer.from(r.data);
  } catch (err) {
    if (err.response && err.response.data && !(typeof err.response.data === 'string')) {
      err.response.data = Buffer.from(err.response.data).toString('utf8');
      try { err.response.data = JSON.parse(err.response.data); } catch (e) { /* XML or text */ }
    }
    throw fail(err);
  }
};

/** Deletes a resource; a missing one is fine. */
exports.remove = async function (settings, uri) {
  try {
    await client(settings).delete('/resources' + uri, { headers: { Accept: 'application/json' } });
  } catch (err) {
    if (!err.response || err.response.status !== 404) throw fail(err);
  }
};

/** Whether something is at /<folder>/<reportName>: { exists, type, updated, by }. */
exports.exists = async function (settings, { folder, reportName }) {
  try {
    const r = await client(settings).get('/resources' + repoPath(folder, reportName), { headers: { Accept: 'application/json' } });
    const d = r.data || {};
    return { exists: true, type: d.resourceType || '', updated: d.updateDate || d.creationDate || '' };
  } catch (err) {
    if (err.expose) throw err;
    if (err.response && err.response.status === 404) return { exists: false };
    throw fail(err);
  }
};

exports.repoPath = repoPath;

// ─── Reading the repository (Jasper Designer: Open a design > a JasperServer tab) ──────────────

// A repository URI as given ("/Centrixreports/My Folder/Report") made safe for a URL path.
const encUri = (uri) => String(uri).split('/').map((s) => (s ? encodeURIComponent(decodeURIComponent(s)) : s)).join('/');

// /resources lookups: JasperServer wants repeated "type" parameters (type=folder&type=reportUnit).
async function lookup(settings, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => [].concat(v).forEach((x) => qs.append(k, String(x))));
  try {
    const r = await client(settings).get('/resources?' + qs.toString(), { headers: { Accept: 'application/json' } });
    const list = (r.data && r.data.resourceLookup) || [];          // 204 No Content: nothing there
    return list.map((x) => ({ uri: x.uri, label: x.label || x.uri.split('/').pop(), type: x.resourceType, description: x.description || '', updated: x.updateDate || x.creationDate || '' }));
  } catch (err) {
    if (err.expose) throw err;
    throw fail(err);
  }
}

/** Folders and report units directly in a folder ("/" is the top), folders first. */
exports.browse = async function (settings, folderUri) {
  const items = await lookup(settings, { folderUri: folderUri || '/', recursive: false, type: ['folder', 'reportUnit'], sortBy: 'label', limit: 0 });
  return items.sort((a, b) => (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1));
};

/** Report units anywhere on the server whose name or description has q (at most `limit`). */
exports.search = async function (settings, q, limit = 200) {
  return lookup(settings, { q, folderUri: '/', recursive: true, type: 'reportUnit', sortBy: 'label', limit });
};

// The uri inside { jrxmlFile: {...} } / { jrxmlFileReference: {...} } / { dataSourceReference: {...} } / …
const refUri = (obj) => {
  if (!obj || typeof obj !== 'object') return '';
  const v = Object.values(obj)[0];
  return (v && v.uri) || '';
};

/**
 * A report unit's parts: { uri, label, dataSource, jrxmlUri, resources: [{ name, uri }] } (its own files
 * and references to files elsewhere in the repository).
 */
exports.reportUnit = async function (settings, uri) {
  try {
    const r = await client(settings).get('/resources' + encUri(uri), { params: { expanded: true }, headers: { Accept: 'application/repository.reportUnit+json' } });
    const d = r.data || {};
    const list = (d.resources && (d.resources.resource || d.resources)) || [];
    return {
      uri: d.uri || uri, label: d.label || uri.split('/').pop(),
      dataSource: refUri(d.dataSource), jrxmlUri: refUri(d.jrxml),
      resources: (Array.isArray(list) ? list : []).map((x) => ({ name: x.name, uri: refUri(x.file) })).filter((x) => x.name && x.uri)
    };
  } catch (err) {
    if (err.expose) throw err;
    if (err.response && err.response.status === 404) { const e = fail(err); e.status = 404; e.message = 'That report is no longer on JasperServer.'; throw e; }
    throw fail(err);
  }
};

/** The content of a file resource (JRXML, image, …) as a Buffer. */
exports.file = async function (settings, uri) {
  const get = (accept) => client(settings).get('/resources' + encUri(uri), { responseType: 'arraybuffer', headers: { Accept: accept } });
  try {
    let r;
    try { r = await get('application/octet-stream'); }
    catch (err) { if (err.response && err.response.status === 406) r = await get('*/*'); else throw err; }
    return Buffer.from(r.data);
  } catch (err) {
    if (err.expose) throw err;
    if (err.response && err.response.data && typeof err.response.data !== 'string') err.response.data = Buffer.from(err.response.data).toString('utf8');
    throw fail(err);
  }
};
