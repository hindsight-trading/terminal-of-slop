// Terminal of Slop · POST /api/upload
// Takes the launch form (JSON with the image as a data URL), pins the image and the
// pump.fun metadata JSON to IPFS through Pinata, and returns { uri, image }.
// Runs as a Vercel serverless function (Node 18+). Needs the PINATA_JWT environment variable.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const SITE_URL = process.env.SITE_URL || 'https://terminalofslop.xyz';
const GATEWAY = 'https://ipfs.io/ipfs/'; // keep this short: the uri is written into the launch transaction

// Very small per-instance rate limit. Put a real one (Vercel Firewall, Upstash) in front for heavy traffic.
const hits = new Map();
function limited(ip) {
  const now = Date.now(); const win = 10 * 60 * 1000; const max = 12;
  const arr = (hits.get(ip) || []).filter(t => now - t < win); arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function httpsUrl(v, hosts) {
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return '';
    if (hosts && !hosts.includes(u.hostname.replace(/^www\./, ''))) return '';
    return u.toString();
  } catch (e) { return ''; }
}

async function pin(blob, filename, jwt) {
  const fd = new FormData();
  fd.append('network', 'public');
  fd.append('file', blob, filename);
  const r = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data || !j.data.cid) throw new Error('IPFS upload failed (' + r.status + ')');
  return j.data.cid;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST.' }); }
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return res.status(500).json({ error: 'Uploads are not configured on this server yet.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'Too many uploads from this connection. Wait ten minutes and try again.' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'Send the launch details as JSON.' });

  const name = str(b.name, 32);
  const symbol = str(b.symbol, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mission = str(b.mission || b.description, 280);
  const model = str(b.model, 120);
  const share = Math.round(Number(b.computeShareBps));
  if (!name || !symbol) return res.status(400).json({ error: 'The coin needs a name and a ticker.' });
  if (!mission) return res.status(400).json({ error: 'The coin needs a mission.' });
  if (!/^[a-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(model)) return res.status(400).json({ error: 'Pick a model from the list.' });
  if (!(share > 0 && share <= 10000)) return res.status(400).json({ error: 'The fee split is invalid.' });

  const m = typeof b.image === 'string' && b.image.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Attach a png, jpg, gif or webp image.' });
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'The image must be under 3 MB.' });

  try {
    const imageCid = await pin(new Blob([bytes], { type: m[1] }), `${symbol.toLowerCase()}.${TYPES[m[1]]}`, jwt);
    const image = GATEWAY + imageCid;
    const metadata = {
      name, symbol, description: mission, image, showName: true, createdOn: SITE_URL,
      ...(httpsUrl(b.twitter, ['x.com', 'twitter.com']) ? { twitter: httpsUrl(b.twitter, ['x.com', 'twitter.com']) } : {}),
      ...(httpsUrl(b.website) ? { website: httpsUrl(b.website) } : {}),
      terminalOfSlop: { model, mission, computeShareBps: share, createdAt: new Date().toISOString() },
    };
    const metaCid = await pin(new Blob([JSON.stringify(metadata)], { type: 'application/json' }), `${symbol.toLowerCase()}.json`, jwt);
    return res.status(200).json({ uri: GATEWAY + metaCid, image });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'IPFS didn’t accept the upload. Try again in a minute.' });
  }
}
