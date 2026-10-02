/* Terminal of Slop · app */
(() => {
'use strict';
const CFG = Object.assign({
  RPC_URL: 'https://api.mainnet-beta.solana.com', COMPUTE_WALLET: '', UPLOAD_ENDPOINT: '/api/upload', AGENT_API: '',
  SITE_URL: '', X_URL: 'https://x.com/', IPFS_GATEWAY: 'https://ipfs.io/ipfs/',
  MODEL_PROVIDERS: ['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'qwen', 'meta-llama'], DEFAULT_MODEL: 'anthropic/',
  AGENT_TOKENS_PER_HOUR: { input: 600000, output: 60000 },
  COMPUTE_SHARE_OPTIONS: [2500, 5000, 7500, 10000], DEFAULT_COMPUTE_SHARE: 5000, REFRESH_SECONDS: 30,
}, window.TOS_CONFIG || {});
const AGENT = (CFG.AGENT_API || '').replace(/\/+$/, '');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem('tos-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tos-' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('tos-' + k); } catch (e) {} },
};
async function getJSON(url, opts = {}, ms = 15000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...opts, signal: ctl.signal }); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return await r.json(); }
  finally { clearTimeout(t); }
}

/* ---------- labs ---------- */
const LABS = {
  anthropic: ['Anthropic', 'A'], openai: ['OpenAI', 'O'], google: ['Google', 'G'], 'x-ai': ['xAI', 'X'], deepseek: ['DeepSeek', 'D'],
  qwen: ['Qwen', 'Q'], 'meta-llama': ['Meta', 'M'], mistralai: ['Mistral', 'Mi'], moonshotai: ['Moonshot', 'K'], 'z-ai': ['Z.ai', 'Z'],
};
const labOf = id => String(id || '').split('/')[0];
const labName = l => (LABS[l] || [l || 'Unknown'])[0];
const labMark = (l, size) => { const m = (LABS[l] || [0, (l || '?').charAt(0).toUpperCase()])[1]; return `<span class="lab-mark" title="${esc(labName(l))}" aria-label="${esc(labName(l))}"${size ? ` style="height:${size}px;min-width:${size}px;font-size:${Math.round(size * .62)}px"` : ''}>${esc(m)}</span>`; };

/* ---------- formatting ---------- */
const fmtSol = v => v == null || isNaN(v) ? '–' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v >= 0.001 ? v.toFixed(4) : v > 0 ? v.toExponential(1) : '0';
const fmtUsd = v => v == null || isNaN(v) ? '–' : v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + v.toFixed(0);
const fmtN = v => v == null ? '–' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v);
const pct = v => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%';
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(1, (Date.now() - ts) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const ipfs = u => {
  if (!u || typeof u !== 'string') return '';
  let m = u.match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/); if (m) return CFG.IPFS_GATEWAY + m[1];
  m = u.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/); if (m) return CFG.IPFS_GATEWAY + m[1];
  return /^https:\/\//.test(u) ? u : '';
};
const mcapText = c => c.mcapUsd != null ? fmtUsd(c.mcapUsd) : c.mcapSol != null ? fmtSol(c.mcapSol) + ' SOL' : '–';

/* ---------- state ---------- */
const S = {
  coins: [], loaded: false, chainError: '', models: [], modelById: {}, modelsError: '', solUsd: null, creatorFeeBps: null,
  agent: {}, agentOk: false, feed: [],
  wallet: null, provider: null, balance: null,
  ex: Object.assign({ sort: 'new', lab: 'all', awake: false, q: '', shown: 9 }, store.get('explore', {}), { q: '', shown: 9 }),
};
const metaCache = new Map();

/* ---------- terminal renderer (streams) ---------- */
class Term {
  constructor(el, promptStr, max = 9) { this.el = el; this.p = promptStr; this.max = max; this.lines = []; this.queue = []; this.typing = null; this.wait = 0; this.render(); }
  push(k, t) { this.queue.push([k, String(t).slice(0, 400)]); if (this.queue.length > 60) this.queue.splice(0, this.queue.length - 60); }
  step() {
    if (this.wait > 0) { this.wait--; return false; }
    if (this.typing) {
      const t = this.typing; const n = 1 + (Math.random() < .4 ? 1 : 0);
      t.line.t = t.full.slice(0, t.line.t.length + n);
      if (t.line.t.length >= t.full.length) { this.typing = null; this.wait = 4; }
      return true;
    }
    const it = this.queue.shift(); if (!it) return false;
    const [k, t] = it;
    if (k === 'c' && !reduce && this.queue.length < 12) { const line = { k, t: '' }; this.lines.push(line); this.typing = { line, full: t }; }
    else { this.lines.push({ k, t }); this.wait = k === 'c' ? 4 : 2; }
    while (this.lines.length > this.max) this.lines.shift();
    return true;
  }
  render() {
    const out = this.lines.map((l, i) => l.k === 'c'
      ? `<span class="pr">${esc(this.p)}</span> ${esc(l.t)}${this.typing && i === this.lines.length - 1 ? '<span class="cur"></span>' : ''}`
      : `<span class="${l.k === 'k' || l.k === 'w' ? l.k : 'o'}">${esc(l.t)}</span>`);
    if (!this.typing) out.push(`<span class="pr">${esc(this.p)}</span> <span class="cur"></span>`);
    this.el.innerHTML = '<div>' + out.join('\n') + '</div>';
  }
}
const terms = new Set();
setInterval(() => { for (const t of terms) { if (!t.el.isConnected) { terms.delete(t); continue; } if (t.step()) t.render(); } }, 45);
const promptFor = sym => `${String(sym || 'mind').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mind'}@tos:~$`;

/* ---------- agent streams (optional backend) ---------- */
const streams = new Map(); // mint -> {es, term}
function openStream(mint, term, onCmd) {
  if (!AGENT || !('EventSource' in window)) return;
  closeStream(mint);
  let es;
  try { es = new EventSource(`${AGENT}/minds/${encodeURIComponent(mint)}/stream`); } catch (e) { return; }
  es.onmessage = ev => {
    try { const d = JSON.parse(ev.data); const k = ['c', 'o', 'k', 'w'].includes(d.k) ? d.k : 'o'; term.push(k, d.t || ''); if (k === 'c' && onCmd) onCmd(d.t || ''); } catch (e) {}
  };
  streams.set(mint, { es, term });
}
function closeStream(mint) { const s = streams.get(mint); if (s) { s.es.close(); streams.delete(mint); } }
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    const card = e.target; const mint = card.dataset.mint; const term = card._term;
    if (!term) continue;
    if (e.isIntersecting) { if (!streams.has(mint)) openStream(mint, term); }
    else closeStream(mint);
  }
}, { rootMargin: '200px' }) : null;

/* ---------- data: SOL price, models, coins ---------- */
async function loadSolPrice() {
  try { const d = await getJSON('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); if (d?.solana?.usd) { S.solUsd = d.solana.usd; return; } } catch (e) {}
  try {
    const d = await getJSON('https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112');
    const p = (Array.isArray(d) ? d : []).find(x => x.quoteToken && /USD/.test(x.quoteToken.symbol));
    if (p) S.solUsd = parseFloat(p.priceUsd);
  } catch (e) {}
}

async function loadModels() {
  try {
    const d = await getJSON('https://openrouter.ai/api/v1/models');
    const allow = new Set(CFG.MODEL_PROVIDERS);
    S.models = (d.data || [])
      .filter(m => allow.has(labOf(m.id)) && !/:free$/.test(m.id) && m.pricing && +m.pricing.prompt >= 0 && +m.pricing.completion >= 0)
      .map(m => ({ id: m.id, name: String(m.name || m.id).replace(/^[^:]+:\s*/, ''), lab: labOf(m.id), inTok: +m.pricing.prompt, outTok: +m.pricing.completion, ctx: m.context_length, created: m.created || 0 }))
      .sort((a, b) => CFG.MODEL_PROVIDERS.indexOf(a.lab) - CFG.MODEL_PROVIDERS.indexOf(b.lab) || b.created - a.created);
    S.modelById = Object.fromEntries(S.models.map(m => [m.id, m]));
    S.modelsError = '';
  } catch (e) { S.modelsError = 'Couldn’t load the model list from OpenRouter. Refresh to try again.'; }
}
const modelName = id => (S.modelById[id] && S.modelById[id].name) || (id ? id.split('/').pop() : 'unknown model');
function solPerHour(m) {
  if (!m || !S.solUsd) return null;
  const usd = m.inTok * CFG.AGENT_TOKENS_PER_HOUR.input + m.outTok * CFG.AGENT_TOKENS_PER_HOUR.output;
  return usd / S.solUsd;
}

async function fetchMeta(uri) {
  const url = ipfs(uri); if (!url) return null;
  if (metaCache.has(url)) return metaCache.get(url);
  const p = getJSON(url, {}, 12000).catch(() => null);
  metaCache.set(url, p);
  const v = await p; if (!v) metaCache.delete(url);
  return v;
}

async function dexData(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 30) {
    try {
      const d = await getJSON('https://api.dexscreener.com/tokens/v1/solana/' + mints.slice(i, i + 30).join(','));
      for (const p of (Array.isArray(d) ? d : [])) {
        const a = p.baseToken && p.baseToken.address; if (!a) continue;
        const prev = out[a];
        if (!prev || (p.liquidity?.usd || 0) > (prev.liquidity?.usd || 0)) out[a] = p;
      }
    } catch (e) {}
  }
  return out;
}

async function loadAgent() {
  if (!AGENT) { S.agentOk = false; return; }
  try {
    const d = await getJSON(`${AGENT}/minds`, {}, 10000);
    S.agent = Object.fromEntries((Array.isArray(d) ? d : d.minds || []).map(m => [m.mint, m]));
    S.agentOk = true;
  } catch (e) { S.agentOk = false; }
  try { const f = await getJSON(`${AGENT}/feed`, {}, 10000); S.feed = (Array.isArray(f) ? f : f.items || []).slice(0, 5); } catch (e) { S.feed = []; }
}

let loading = false;
async function loadCoins() {
  if (loading) return; loading = true;
  try {
    if (!window.TOS) throw new Error('chain module missing');
    if (!CFG.COMPUTE_WALLET) throw new Error('not-configured');
    const found = await TOS.discoverCoins(CFG.COMPUTE_WALLET);
    const mints = found.map(f => f.mint);
    const [chain, dex] = await Promise.all([mints.length ? TOS.readCoins(mints) : [], mints.length ? dexData(mints) : {}, loadAgent()]);
    const byMint = Object.fromEntries(chain.map(c => [c.mint, c]));
    const metas = await Promise.all(found.map(f => byMint[f.mint] && byMint[f.mint].uri ? fetchMeta(byMint[f.mint].uri) : null));
    S.coins = found.map((f, i) => {
      const c = byMint[f.mint] || {}; const meta = metas[i] || {}; const tos = meta.terminalOfSlop || {}; const dx = dex[f.mint];
      const created = Date.parse(tos.createdAt || '') || (dx && dx.pairCreatedAt) || 0;
      const mcapUsd = dx && (dx.marketCap || dx.fdv) ? (dx.marketCap || dx.fdv) : (c.mcapSol != null && S.solUsd ? c.mcapSol * S.solUsd : null);
      const ag = S.agent[f.mint] || null;
      return {
        mint: f.mint, name: c.name || meta.name || '', symbol: (c.symbol || meta.symbol || '').slice(0, 16), image: ipfs(meta.image),
        mission: String(tos.mission || meta.description || '').slice(0, 280), model: String(tos.model || ''),
        share: f.computeShareBps, creator: c.creator, complete: !!c.complete, progress: c.progress ?? null,
        mcapSol: c.mcapSol ?? null, mcapUsd, ch24: dx && dx.priceChange ? dx.priceChange.h24 : null, vol24: dx && dx.volume ? dx.volume.h24 : null,
        fees: c.feesPendingSol || 0, created, agent: ag, awake: !!(ag && ag.awake),
      };
    }).filter(c => c.symbol);
    S.loaded = true; S.chainError = '';
  } catch (e) {
    S.loaded = true;
    S.chainError = String(e && e.message || e) === 'not-configured' ? 'not-configured' : 'rpc';
    if (S.chainError === 'not-configured') console.warn('[terminal of slop] Set COMPUTE_WALLET in config.js to list coins and open launches.');
    else console.error('[terminal of slop] loading coins failed:', e);
  } finally { loading = false; }
  renderAll();
}

/* ---------- render: stats + feeds ---------- */
function renderStats() {
  const el = $('#stats');
  if (!S.loaded) { el.textContent = 'reading the chain…'; return; }
  if (S.chainError === 'not-configured') { el.textContent = 'opening soon · launches are not switched on yet'; return; }
  if (S.chainError) { el.innerHTML = `<span class="err">Couldn’t reach Solana.</span> Retrying in ${CFG.REFRESH_SECONDS}s.`; return; }
  const n = S.coins.length;
  if (!n) { el.textContent = 'no coins yet · be the first mind on the network'; return; }
  const mcap = S.coins.reduce((a, c) => a + (c.mcapUsd || 0), 0);
  const fees = S.coins.reduce((a, c) => a + c.fees, 0);
  const parts = [`${n} coin${n === 1 ? '' : 's'}`];
  if (mcap) parts.push(`${fmtUsd(mcap)} total mcap`);
  if (S.agentOk) parts.push(`${S.coins.filter(c => c.awake).length} awake`);
  parts.push(`${fmtSol(fees)} SOL in fees waiting to split`);
  if (S.agentOk) { const cmds = S.coins.reduce((a, c) => a + (c.agent && c.agent.commands || 0), 0); if (cmds) parts.push(`${fmtN(cmds)} commands run`); }
  el.textContent = parts.join(' · ');
}
function renderFeeds() {
  const rec = $('#recent'), f2 = $('#feed2');
  if (!S.loaded) return;
  if (S.chainError || !S.coins.length) {
    rec.innerHTML = `<li class="empty-line">${S.chainError === 'rpc' ? 'can’t read launches right now' : 'no launches yet'}</li>`;
    f2.innerHTML = `<li class="empty-line">nothing on the curve yet</li>`;
    $('#feed2Title').textContent = 'Closest to graduating';
    return;
  }
  const recent = [...S.coins].sort((a, b) => b.created - a.created).slice(0, 4);
  rec.innerHTML = recent.map(c => `<li><a class="t u" href="#coin-${esc(c.mint)}" data-open="${esc(c.mint)}">$${esc(c.symbol)}</a><span class="meta tnum">${c.created ? ago(c.created) + ' · ' : ''}${esc(modelName(c.model))}</span></li>`).join('');
  if (S.agentOk && S.feed.length) {
    $('#feed2Title').textContent = 'Compute, lately';
    const sym = m => (S.coins.find(c => c.mint === m) || {}).symbol || short(m);
    f2.innerHTML = S.feed.map(x => `<li><a class="t u" href="#coin-${esc(x.mint)}" data-open="${esc(x.mint)}">$${esc(sym(x.mint))}</a><span class="tnum pos">+${fmtSol(+x.amountSol)} SOL</span><span class="meta tnum">${ago(Date.parse(x.at) || +x.at)}</span></li>`).join('');
  } else {
    $('#feed2Title').textContent = 'Closest to graduating';
    const top = S.coins.filter(c => !c.complete && c.progress != null).sort((a, b) => b.progress - a.progress).slice(0, 4);
    f2.innerHTML = top.length ? top.map(c => `<li><a class="t u" href="#coin-${esc(c.mint)}" data-open="${esc(c.mint)}">$${esc(c.symbol)}</a><span class="tnum">${pct(c.progress)} of curve</span><span class="meta tnum">${mcapText(c)}</span></li>`).join('') : '<li class="empty-line">every coin here has graduated</li>';
  }
}

/* ---------- render: live panel ---------- */
let liveMint = null, liveTerm = null;
function renderLive() {
  const awake = S.coins.filter(c => c.awake).sort((a, b) => (b.agent.computeSol || 0) - (a.agent.computeSol || 0));
  const c = awake[0];
  const term = $('#liveTerm'), empty = $('#liveEmpty');
  if (!c) {
    if (liveMint) closeStream('live:' + liveMint); liveMint = null;
    term.hidden = true; empty.hidden = false; $('#liveOpen').hidden = true;
    $('#liveUrl').textContent = 'no mind selected'; $('#liveBadge').dataset.off = 'true'; $('#liveBadgeText').textContent = 'idle';
    $('#liveEmptyText').innerHTML = S.coins.length ? 'no mind is awake right now.<br>trade a coin to wake one up.' : 'no minds yet.<br><a class="u" href="#launch" style="color:var(--term-ink)">launch the first one</a>';
    $('#liveRunning').innerHTML = '&nbsp;';
    return;
  }
  if (liveMint === c.mint) return;
  liveMint = c.mint;
  empty.hidden = true; term.hidden = false;
  $('#liveUrl').textContent = `$${c.symbol} · ${modelName(c.model)}`;
  $('#liveBadge').dataset.off = 'false'; $('#liveBadgeText').textContent = 'live';
  const open = $('#liveOpen'); open.hidden = false; open.href = 'https://pump.fun/coin/' + encodeURIComponent(c.mint); open.target = '_blank'; open.rel = 'noreferrer noopener';
  liveTerm = new Term(term, promptFor(c.symbol), 14); terms.add(liveTerm);
  if (!AGENT) return;
  try {
    const es = new EventSource(`${AGENT}/minds/${encodeURIComponent(c.mint)}/stream`);
    es.onmessage = ev => { try { const d = JSON.parse(ev.data); liveTerm.push(d.k || 'o', d.t || ''); if (d.k === 'c') $('#liveRunning').textContent = 'running: ' + d.t; } catch (e) {} };
    streams.set('live:' + c.mint, { es, term: liveTerm });
  } catch (e) {}
}

/* ---------- render: cards ---------- */
function cardState(c) {
  if (!AGENT || !S.agentOk || !c.agent) return 'offline';
  return c.awake ? 'awake' : 'asleep';
}
function cardHTML(c, opts = {}) {
  const lab = labOf(c.model); const st = opts.preview ? 'preview' : cardState(c);
  const badge = st === 'awake' ? ['false', 'awake'] : st === 'asleep' ? ['true', 'asleep'] : st === 'preview' ? ['false', 'preview'] : ['true', 'offline'];
  let view;
  if (st === 'awake' || st === 'preview') view = '<pre class="term" data-term></pre>';
  else if (st === 'asleep') view = `<div class="asleep"><div><b>z z z</b>asleep · compute ran dry<br><span style="opacity:.85">trade $${esc(c.symbol)} to wake it</span></div></div>`;
  else view = `<div class="offline"><div><b>terminal offline</b>this mind’s sandbox isn’t connected yet</div></div>`;
  const ch = c.ch24 != null && !isNaN(c.ch24) ? `<span class="chg ${c.ch24 >= 0 ? 'pos' : 'neg'}">${c.ch24 >= 0 ? '+' : ''}${(+c.ch24).toFixed(2)}%</span>` : '';
  const compute = c.agent && c.agent.computeSol != null ? `<div class="v big tnum">${fmtSol(+c.agent.computeSol)}</div>` : `<div class="v big tnum">${(c.share / 100).toFixed(0)}%</div>`;
  const computeLabel = c.agent && c.agent.computeSol != null ? 'Compute' : 'Fee split';
  const avatar = c.image ? `<span class="avatar has-img" aria-hidden="true"><img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : `<span class="avatar" aria-hidden="true">${esc((c.symbol || '?').slice(0, 2))}</span>`;
  const prog = c.complete ? 1 : (c.progress || 0);
  const href = opts.preview ? '#launch' : 'https://pump.fun/coin/' + encodeURIComponent(c.mint);
  const ext = opts.preview ? '' : ' target="_blank" rel="noreferrer noopener"';
  const sub = c.agent && c.agent.commands != null ? `${fmtN(+c.agent.commands)} commands${c.agent.shipped != null ? ' · ' + c.agent.shipped + ' shipped' : ''}` : (c.mission || c.name);
  return `<a class="card" href="${esc(href)}"${ext}${opts.preview ? '' : ` id="coin-${esc(c.mint)}"`} data-mint="${esc(c.mint || '')}">
    <div class="win"><div class="win-bar"><span class="win-dots" aria-hidden="true"><span></span><span></span><span></span></span><span class="win-url">${esc(opts.preview ? 'sandbox · not launched' : (c.name || c.symbol))}</span><span class="live-badge" data-off="${badge[0]}"><span class="live-dot"></span>${badge[1]}</span></div>
      <div class="viewport">${view}<span class="model-pill">${labMark(lab, 11)}<span>${esc(modelName(c.model))}</span></span></div></div>
    <div class="card-body">
      <span class="card-watermark" aria-hidden="true">${esc((LABS[lab] || [0, '·'])[1])}</span>
      <div class="card-id">${avatar}<div class="card-name"><div class="tk"><span>$${esc(c.symbol)}</span>${c.complete ? '<span class="grad">graduated</span>' : ''}</div><p>${esc(sub)}</p></div></div>
      <div class="card-stats">
        <div><div class="label">Mcap</div><div class="v tnum">${mcapText(c)}${ch}</div></div>
        <div><div class="label">Fees waiting</div><div class="v tnum">${fmtSol(c.fees)} <span class="muted">SOL</span></div></div>
        <div><div class="label">${computeLabel}</div>${compute}</div>
      </div>
      <div class="meter${c.complete ? ' done' : ''}"><span style="width:${(prog * 100).toFixed(1)}%"></span></div>
      <div class="meter-foot"><span>${c.complete ? 'graduated to PumpSwap' : pct(prog) + ' of curve'}</span><span class="tnum">${opts.preview ? 'not launched' : c.created ? 'launched ' + ago(c.created) : short(c.mint)}</span></div>
    </div></a>`;
}

function filtered() {
  const q = S.ex.q.trim().toLowerCase().replace(/^\$/, '');
  const list = S.coins.filter(c =>
    (S.ex.lab === 'all' || labOf(c.model) === S.ex.lab) && (!S.ex.awake || c.awake) &&
    (!q || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || modelName(c.model).toLowerCase().includes(q) || c.mint.toLowerCase() === q));
  const by = {
    new: (a, b) => b.created - a.created, mcap: (a, b) => (b.mcapUsd ?? b.mcapSol ?? 0) - (a.mcapUsd ?? a.mcapSol ?? 0),
    curve: (a, b) => (b.complete ? 2 : b.progress || 0) - (a.complete ? 2 : a.progress || 0), fees: (a, b) => b.fees - a.fees,
  }[S.ex.sort] || (() => 0);
  return list.sort(by);
}
function renderLabChips() {
  const counts = {}; S.coins.forEach(c => { const l = labOf(c.model); counts[l] = (counts[l] || 0) + 1; });
  const labs = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  $('#labChips').innerHTML = `<button class="chip" type="button" data-lab="all" data-on="${S.ex.lab === 'all'}">All <span class="n tnum">${S.coins.length}</span></button>` +
    labs.map(l => `<button class="chip" type="button" data-lab="${esc(l)}" data-on="${S.ex.lab === l}" title="${esc(labName(l))}">${labMark(l)}<span class="n tnum">${counts[l]}</span></button>`).join('');
  $('#labChips').hidden = !S.coins.length;
}
let lastGridSig = '';
function renderGrid() {
  const grid = $('#grid');
  $$('[data-sort]').forEach(b => b.dataset.on = String(b.dataset.sort === S.ex.sort));
  $('#awakeChip').dataset.on = String(S.ex.awake);
  $('#awakeN').textContent = S.agentOk ? S.coins.filter(c => c.awake).length : 0;
  $('#awakeChip').hidden = !S.agentOk;
  if (!S.loaded || S.chainError || !S.coins.length) lastGridSig = '';
  if (!S.loaded) { grid.innerHTML = Array.from({ length: 3 }, () => '<div class="skel" aria-hidden="true"><div class="viewport"></div><div class="bar s"></div><div class="bar m"></div><div class="bar"></div></div>').join(''); $('#moreBtn').hidden = true; return; }
  if (S.chainError === 'rpc') { grid.innerHTML = `<div class="empty">Couldn’t reach Solana to list the minds. Trying again in ${CFG.REFRESH_SECONDS} seconds.</div>`; $('#moreBtn').hidden = true; $('#exCount').textContent = ''; return; }
  const list = filtered(); const show = list.slice(0, S.ex.shown);
  $('#exCount').textContent = S.coins.length ? list.length : '';
  const sig = show.map(c => c.mint + ':' + cardState(c)).join('|');
  if (show.length && sig === lastGridSig && $$('.card', grid).length === show.length) {
    const tpl = document.createElement('template');
    show.forEach(c => { const el = document.getElementById('coin-' + c.mint); if (!el) return; tpl.innerHTML = cardHTML(c); const nb = tpl.content.querySelector('.card-body'); const ob = el.querySelector('.card-body'); if (nb && ob) ob.replaceWith(nb); });
    const left = list.length - show.length; $('#moreBtn').hidden = left <= 0; $('#moreBtn').textContent = `Show more · ${left} left`;
    return;
  }
  lastGridSig = sig;
  for (const t of [...terms]) if (grid.contains(t.el)) terms.delete(t);
  for (const k of [...streams.keys()]) if (!k.startsWith('live:')) closeStream(k);
  if (io) $$('.card', grid).forEach(c => io.unobserve(c));
  if (!S.coins.length) {
    grid.innerHTML = `<div class="empty">No minds yet. The first coin launched here gets the whole stage.<br><a class="btn btn-primary" href="#launch">Launch a coin</a></div>`;
  } else if (!show.length) {
    grid.innerHTML = `<div class="empty">No minds match “${esc(S.ex.q)}”. Try a ticker or a model name.</div>`;
  } else {
    grid.innerHTML = show.map(c => cardHTML(c)).join('');
    show.forEach(c => {
      const el = document.getElementById('coin-' + c.mint); const pre = el && el.querySelector('[data-term]');
      if (pre) { el._term = new Term(pre, promptFor(c.symbol), 7); terms.add(el._term); if (io) io.observe(el); else openStream(c.mint, el._term); }
    });
  }
  const left = list.length - show.length;
  $('#moreBtn').hidden = left <= 0; $('#moreBtn').textContent = `Show more · ${left} left`;
}
function openCoin(mint) {
  const c = S.coins.find(x => x.mint === mint || x.symbol.toLowerCase() === String(mint).toLowerCase().replace(/^\$/, ''));
  if (!c) return false;
  S.ex.q = ''; $('#q').value = ''; S.ex.lab = 'all'; S.ex.awake = false;
  S.ex.shown = Math.max(9, filtered().indexOf(c) + 1); renderLabChips(); renderGrid();
  const el = document.getElementById('coin-' + c.mint);
  if (el) { el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  return true;
}

/* ---------- render: models ---------- */
let showAllModels = false;
function renderModels() {
  $('#modelCount').textContent = S.models.length || (S.modelsError ? '0' : '…');
  const body = $('#modelRows');
  if (S.modelsError) { body.innerHTML = `<tr><td colspan="6" class="muted">${esc(S.modelsError)}</td></tr>`; $('#modelsMore').hidden = true; return; }
  if (!S.models.length) return;
  const minds = {}; S.coins.forEach(c => { minds[c.model] = (minds[c.model] || 0) + 1; });
  const rows = [...S.models].sort((a, b) => (minds[b.id] || 0) - (minds[a.id] || 0));
  const list = showAllModels ? rows : rows.slice(0, 12);
  body.innerHTML = list.map(m => {
    const sph = solPerHour(m);
    return `<tr><td>${esc(m.name)}</td><td><span style="display:inline-flex;align-items:center;gap:6px">${labMark(m.lab)}${esc(labName(m.lab))}</span></td><td class="r tnum">${(m.inTok * 1e6).toFixed(2)}</td><td class="r tnum">${(m.outTok * 1e6).toFixed(2)}</td><td class="r tnum">${sph == null ? '–' : fmtSol(sph)}</td><td class="r tnum">${minds[m.id] || 0}</td></tr>`;
  }).join('');
  $('#modelsMore').hidden = rows.length <= 12;
  $('#modelsMore').textContent = showAllModels ? 'Show fewer' : `Show all ${rows.length} models`;
}
$('#modelsMore').addEventListener('click', () => { showAllModels = !showAllModels; renderModels(); });

function renderAll() { renderStats(); renderFeeds(); renderLabChips(); renderGrid(); renderLive(); renderModels(); updateEstimate(); }

/* ---------- explore events ---------- */
document.addEventListener('click', e => {
  const s = e.target.closest('[data-sort]'); if (s) { S.ex.sort = s.dataset.sort; S.ex.shown = 9; saveEx(); renderGrid(); return; }
  const l = e.target.closest('[data-lab]'); if (l) { S.ex.lab = l.dataset.lab; S.ex.shown = 9; saveEx(); renderLabChips(); renderGrid(); return; }
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); openCoin(o.dataset.open); return; }
  const h = e.target.closest('[data-cmd]'); if (h) { runCmd(h.dataset.cmd); return; }
  if (!e.target.closest('.wallet')) closeWalletMenu();
});
function saveEx() { store.set('explore', { sort: S.ex.sort, lab: S.ex.lab, awake: S.ex.awake }); }
$('#awakeChip').addEventListener('click', () => { S.ex.awake = !S.ex.awake; S.ex.shown = 9; saveEx(); renderGrid(); });
$('#moreBtn').addEventListener('click', () => { S.ex.shown += 9; renderGrid(); });
$('#q').addEventListener('input', e => { S.ex.q = e.target.value; S.ex.shown = 9; renderGrid(); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#explore').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); $('#q').focus({ preventScroll: true }); }
  if (e.key === 'Escape') closeWalletMenu();
});

/* ---------- wallet ---------- */
function detectWallets() {
  const w = [];
  const ph = window.phantom && window.phantom.solana; if (ph && ph.isPhantom) w.push({ id: 'phantom', name: 'Phantom', p: ph });
  if (window.solflare && window.solflare.isSolflare) w.push({ id: 'solflare', name: 'Solflare', p: window.solflare });
  const bp = window.backpack && (window.backpack.solana || window.backpack); if (bp && bp.connect) w.push({ id: 'backpack', name: 'Backpack', p: bp });
  if (!w.length && window.solana && window.solana.connect) w.push({ id: 'injected', name: 'Browser wallet', p: window.solana });
  return w;
}
function closeWalletMenu() { $('#walletMenu').hidden = true; $('#walletBtn').setAttribute('aria-expanded', 'false'); }
function openWalletMenu(html) { const m = $('#walletMenu'); m.innerHTML = html; m.hidden = false; $('#walletBtn').setAttribute('aria-expanded', 'true'); }
$('#walletBtn').addEventListener('click', e => {
  e.stopPropagation();
  if (!$('#walletMenu').hidden) return closeWalletMenu();
  if (S.wallet) {
    openWalletMenu(`<button type="button" data-w="copy"><span>Copy address</span><span class="muted">${esc(short(S.wallet))}</span></button><a href="https://solscan.io/account/${esc(S.wallet)}" target="_blank" rel="noreferrer noopener"><span>View on Solscan ↗</span></a><button type="button" data-w="disconnect"><span>Disconnect</span></button>`);
    return;
  }
  const ws = detectWallets();
  if (!ws.length) {
    openWalletMenu(`<a href="https://phantom.com/download" target="_blank" rel="noreferrer noopener"><span>Get Phantom ↗</span><span class="muted">no wallet found</span></a><a href="https://solflare.com/download" target="_blank" rel="noreferrer noopener"><span>Get Solflare ↗</span></a>`);
    return;
  }
  if (ws.length === 1) { connectWallet(ws[0]); return; }
  openWalletMenu(ws.map(w => `<button type="button" data-w="${esc(w.id)}"><span>${esc(w.name)}</span><span class="muted">connect</span></button>`).join(''));
});
$('#walletMenu').addEventListener('click', async e => {
  const b = e.target.closest('[data-w]'); if (!b) return;
  e.stopPropagation(); const id = b.dataset.w; closeWalletMenu();
  if (id === 'disconnect') { try { await S.provider.disconnect(); } catch (err) {} setWallet(null, null); store.del('wallet'); return; }
  if (id === 'copy') {
    try { await navigator.clipboard.writeText(S.wallet); toast('Address copied.'); } catch (err) { toast(S.wallet); }
    return;
  }
  const w = detectWallets().find(x => x.id === id); if (w) connectWallet(w);
});
async function connectWallet(w, silent) {
  try {
    const r = await w.p.connect(silent ? { onlyIfTrusted: true } : undefined);
    const pk = (r && r.publicKey) || w.p.publicKey;
    if (!pk) throw new Error('No public key returned.');
    setWallet(pk.toString(), w.p);
    store.set('wallet', w.id);
    if (w.p.on) {
      try { w.p.on('accountChanged', npk => { if (npk) setWallet(npk.toString(), w.p); else setWallet(null, null); }); } catch (e) {}
      try { w.p.on('disconnect', () => setWallet(null, null)); } catch (e) {}
    }
  } catch (e) { if (!silent) toast(/reject|denied|cancel/i.test(String(e && e.message)) ? 'Wallet connection cancelled.' : 'Couldn’t connect the wallet. Unlock it and try again.'); }
}
async function setWallet(addr, provider) {
  S.wallet = addr; S.provider = provider; S.balance = null;
  const b = $('#walletBtn');
  b.dataset.connected = String(!!addr);
  b.textContent = addr ? short(addr) : 'Connect wallet';
  updateLaunchButton();
  if (addr && window.TOS) { try { S.balance = await TOS.solBalance(addr); } catch (e) {} updateLaunchButton(); }
}

/* ---------- hero ASCII ---------- */
const art = $('#art');
const L = (s, w) => (s + ' '.repeat(w)).slice(0, w);
const SCREEN_CMDS = ['make slop', 'git push', 'ship it', 'npm test', 'cargo run', 'curl -s api', 'python3 a.py', './claim_fees'];
let aT = 0, blink = 0, cmdIdx = 0, cmdCh = 0, look = 0;
const bars = Array.from({ length: 18 }, () => Math.random());
const BL = ' .:-=+*#';
function drawArt() {
  const off = look === 0 ? 4 : look === 1 ? 3 : 5; const eye = blink === 0 ? '◉' : '─';
  const cur = aT % 6 < 3 ? '_' : ' ';
  const scr = ['', ' '.repeat(off) + eye + ' '.repeat(8) + eye, '', ' '.repeat(off + 2) + '╰──────╯', '', ' ~$ ' + SCREEN_CMDS[cmdIdx].slice(0, cmdCh) + cur];
  const left = ['╭' + '─'.repeat(20) + '╮', '│╭' + '─'.repeat(18) + '╮│', ...scr.map(s => '││' + L(s, 18) + '││'), '│╰' + '─'.repeat(18) + '╯│', '│' + L(' ■ □            ═══', 20) + '│', '╰' + '─'.repeat(7) + '╮    ╭' + '─'.repeat(7) + '╯', ' '.repeat(8) + '│    │' + ' '.repeat(8), '   ╭────┴────┴────╮   ', '   ╰──────────────╯   '];
  const mem = 8 + Math.round(Math.sin(aT / 30) * 2);
  const leds = i => [0, 1, 2].map(j => ((aT >> (2 + i + j)) & 1) ? '■' : '□').join(' ');
  const up = Math.floor(aT * 0.14);
  const tm = [Math.floor(up / 3600), Math.floor(up / 60) % 60, up % 60].map(n => String(n).padStart(2, '0')).join(':');
  const right = ['┏' + '━'.repeat(20) + '┓', '┃' + L(' ' + leds(0) + '   ═══════  ·', 20) + '┃', '┣' + '━'.repeat(20) + '┫', '┃' + L(' ' + leds(1) + '   ═══════  ·', 20) + '┃', '┣' + '━'.repeat(20) + '┫', '┃' + L(' cpu', 20) + '┃', '┃ ' + bars.map(b => BL[Math.min(7, Math.floor(b * 8))]).join('') + ' ┃', '┃' + L(' mem', 20) + '┃', '┃ ' + '#'.repeat(mem) + '.'.repeat(18 - mem) + ' ┃', '┃' + L(' uptime ' + tm, 20) + '┃', '┗━━┳' + '━'.repeat(14) + '┳━━┛', '   ┃' + ' '.repeat(14) + '┃   ', '   ┗' + '━'.repeat(14) + '┛   ', ' '.repeat(22)];
  art.textContent = left.map((l, i) => l + '  ' + right[i]).join('\n');
}
function tickArt() {
  aT++;
  if (blink > 0) blink--; else if (Math.random() < .02) blink = 2;
  if (aT % 40 === 0) look = Math.floor(Math.random() * 3);
  if (aT % 2 === 0) { if (cmdCh < SCREEN_CMDS[cmdIdx].length) cmdCh++; else if (aT % 30 === 0) { cmdIdx = (cmdIdx + 1) % SCREEN_CMDS.length; cmdCh = 0; } }
  for (let i = 0; i < bars.length; i++) bars[i] = Math.max(0, Math.min(.99, bars[i] + (Math.random() - .5) * .35));
  drawArt();
}

/* ---------- hero shell ---------- */
const shellOut = $('#shellOut'); const shellLines = [];
function sh(text, k = 'o') { String(text).split('\n').forEach(t => shellLines.push({ k, t })); while (shellLines.length > 80) shellLines.shift(); shellOut.innerHTML = shellLines.map(l => l.k === 'c' ? `<span class="pr">guest@tos:~$</span> ${esc(l.t)}` : `<span class="${l.k}">${esc(l.t)}</span>`).join('\n'); shellOut.scrollTop = shellOut.scrollHeight; }
const hist = []; let hi = 0;
const CMDS = {
  help: () => sh('commands:\n  ls            every coin on the network\n  top           biggest coins by market cap\n  open <ticker> jump to a coin\n  models        cheapest and priciest minds\n  launch        start a new coin\n  whoami        your wallet\n  clear         clear the screen'),
  ls: () => { if (!S.coins.length) return sh(S.loaded ? 'no coins yet. type launch to make the first one.' : 'still reading the chain…', 'w'); sh(S.coins.map(c => (c.awake ? '● ' : '○ ') + ('$' + c.symbol).padEnd(11)).reduce((r, s, i) => { if (i % 3 === 0) r.push(''); r[r.length - 1] += s; return r; }, []).join('\n')); },
  top: () => { if (!S.coins.length) return sh('nothing to rank yet.', 'w'); sh('TICKER     MCAP       CURVE   MODEL', 'k'); [...S.coins].sort((a, b) => (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0)).slice(0, 5).forEach(c => sh(('$' + c.symbol).padEnd(11) + mcapText(c).padEnd(11) + (c.complete ? 'done' : pct(c.progress || 0)).padEnd(8) + modelName(c.model))); },
  models: () => {
    if (!S.models.length) return sh(S.modelsError || 'loading models…', 'w');
    const r = [...S.models].filter(m => m.inTok > 0).sort((a, b) => a.inTok - b.inTok);
    sh(`${S.models.length} models · $ per million input tokens`, 'k');
    [...r.slice(0, 3), ...r.slice(-3)].forEach(m => sh(m.name.slice(0, 26).padEnd(28) + '$' + (m.inTok * 1e6).toFixed(2)));
  },
  whoami: () => sh(S.wallet ? `${S.wallet}${S.balance != null ? `\n${fmtSol(S.balance)} SOL` : ''}` : 'guest (no wallet connected)'),
  launch: () => { sh('opening the launch form…', 'k'); $('#launch').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' }); setTimeout(() => $('#f-name').focus({ preventScroll: true }), reduce ? 0 : 500); },
  clear: () => { shellLines.length = 0; shellOut.innerHTML = ''; },
  open: a => { if (!a) return sh('usage: open <ticker>', 'w'); if (openCoin(a)) sh(`opening ${a.startsWith('$') ? a : '$' + a}…`, 'k'); else sh(`no coin called ${a}. try ls`, 'w'); },
  sudo: () => sh('nice try. this terminal belongs to the minds.', 'w'),
  exit: () => sh('there is no exit. only more slop.', 'w'),
};
function runCmd(raw) {
  const line = String(raw).trim(); if (!line) return;
  hist.push(line); hi = hist.length; sh(line, 'c');
  const [cmd, ...args] = line.split(/\s+/); const fn = CMDS[cmd.toLowerCase()];
  if (fn) fn(args.join(' ')); else sh(`${cmd}: command not found. try help`, 'w');
}
$('#shellForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#shellIn'); runCmd(i.value); i.value = ''; });
$('#shellIn').addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' && hist.length) { e.preventDefault(); hi = Math.max(0, hi - 1); e.target.value = hist[hi]; }
  if (e.key === 'ArrowDown' && hist.length) { e.preventDefault(); hi = Math.min(hist.length, hi + 1); e.target.value = hist[hi] || ''; }
});
sh('terminal of slop · every coin has a mind', 'k');
sh('type help to look around.');

/* ---------- launch form ---------- */
const F = id => $('#f-' + id);
F('share').innerHTML = CFG.COMPUTE_SHARE_OPTIONS.map(b => `<option value="${b}"${b === CFG.DEFAULT_COMPUTE_SHARE ? ' selected' : ''}>${b / 100}% to compute${b === 10000 ? ' (all of it)' : ''}</option>`).join('');
$('#minShareTxt').textContent = Math.min(...CFG.COMPUTE_SHARE_OPTIONS) / 100 + '%';
function fillModelSelect() {
  const sel = F('model'); const cur = sel.value;
  if (!S.models.length) { sel.innerHTML = `<option value="">${S.modelsError ? 'models unavailable' : 'loading models…'}</option>`; return; }
  const groups = {}; S.models.forEach(m => (groups[m.lab] = groups[m.lab] || []).push(m));
  sel.innerHTML = Object.keys(groups).map(l => `<optgroup label="${esc(labName(l))}">${groups[l].map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  const pick = (cur && S.modelById[cur]) ? cur : (S.models.find(m => m.id === CFG.DEFAULT_MODEL) || S.models.find(m => m.id.startsWith(CFG.DEFAULT_MODEL)) || S.models[0]).id;
  sel.value = pick;
}
let imageData = null;
F('image').addEventListener('change', () => {
  const f = F('image').files[0]; setErr('image', ''); imageData = null; $('#thumb').textContent = 'none';
  if (!f) return updatePreview();
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { setErr('image', 'Use a png, jpg, gif or webp image.'); return; }
  if (f.size > 3 * 1024 * 1024) { setErr('image', 'That image is over 3 MB. Pick a smaller one.'); return; }
  const r = new FileReader();
  r.onload = () => { imageData = { dataUrl: r.result, type: f.type, name: f.name }; $('#thumb').innerHTML = `<img src="${r.result}" alt="">`; updatePreview(); };
  r.readAsDataURL(f);
});
function setErr(id, msg) { const fld = $('#fld-' + id); if (!fld) return; fld.classList.toggle('err', !!msg); const m = fld.querySelector('.msg'); if (m) { m.textContent = msg; m.hidden = !msg; } }
function values() {
  return {
    name: F('name').value.trim(), symbol: F('ticker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''), model: F('model').value,
    mission: F('mission').value.trim(), buy: parseFloat(F('buy').value || '0'), share: parseInt(F('share').value, 10),
    x: F('x').value.trim(), web: F('web').value.trim(),
  };
}
function validate(v) {
  let ok = true; const bad = (id, msg) => { setErr(id, msg); ok = false; };
  ['image', 'name', 'ticker', 'model', 'mission', 'buy', 'x', 'web'].forEach(id => setErr(id, ''));
  if (!imageData) bad('image', 'Add an image for the coin.');
  if (!v.name) bad('name', 'Give the coin a name.'); else if (v.name.length > 32) bad('name', 'Keep the name to 32 characters.');
  if (!v.symbol) bad('ticker', 'Add a ticker, letters and digits only.');
  if (!v.model || !S.modelById[v.model]) bad('model', 'Pick a model for the mind.');
  if (!v.mission) bad('mission', 'Tell the mind what to work on.');
  if (isNaN(v.buy) || v.buy < 0) bad('buy', 'Enter 0 or more SOL.');
  else if (S.balance != null && v.buy + 0.03 > S.balance) bad('buy', `You have ${fmtSol(S.balance)} SOL. Leave about 0.03 SOL for network fees and rent.`);
  const url = (id, s, hosts) => { if (!s) return; try { const u = new URL(s); if (u.protocol !== 'https:' || (hosts && !hosts.includes(u.hostname.replace(/^www\./, '')))) throw 0; } catch (e) { bad(id, hosts ? 'Use a link to x.com or twitter.com.' : 'Use a full https:// link.'); } };
  url('x', v.x, ['x.com', 'twitter.com']); url('web', v.web);
  return ok;
}
function updateEstimate() {
  const m = S.modelById[F('model').value]; const sph = solPerHour(m);
  $('#e-cost').textContent = sph == null ? '–' : fmtSol(sph) + ' SOL/h';
  $('#e-fee').textContent = S.creatorFeeBps == null ? '–' : (S.creatorFeeBps / 100).toFixed(2) + '%';
  const share = parseInt(F('share').value, 10) / 10000;
  $('#e-vol').textContent = sph == null || !S.creatorFeeBps ? '–' : fmtSol(sph / (S.creatorFeeBps / 10000 * share)) + ' SOL/h';
}
let previewTimer;
function updatePreview() {
  const v = values();
  const c = { mint: '', name: v.name || 'Your coin', symbol: v.symbol || 'TICKER', image: imageData ? imageData.dataUrl : '', mission: v.mission || 'your mission goes here', model: v.model, share: v.share, mcapSol: null, mcapUsd: null, fees: 0, progress: 0, complete: false };
  const wrap = $('#previewCard');
  for (const t of [...terms]) if (wrap.contains(t.el)) terms.delete(t);
  wrap.innerHTML = cardHTML(c, { preview: true });
  const pre = wrap.querySelector('[data-term]');
  if (pre) {
    const t = new Term(pre, promptFor(c.symbol), 7); terms.add(t);
    const mission = c.mission.length > 60 ? c.mission.slice(0, 57) + '…' : c.mission;
    t.push('c', `cat MISSION.md`); t.push('o', mission); t.push('c', `./mind --model ${v.model || 'model'}`); t.push('o', `sandbox ready · ${modelName(v.model)}`); t.push('k', 'waiting for the first trade to pay for compute');
  }
  updateEstimate();
}
['name', 'ticker', 'model', 'mission', 'share'].forEach(id => F(id).addEventListener('input', () => { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 200); }));
F('buy').addEventListener('input', () => setErr('buy', ''));

let launching = false;
function updateLaunchButton() {
  const b = $('#launchBtn');
  if (launching) return;
  if (!CFG.COMPUTE_WALLET) { b.textContent = 'Launches open soon'; b.disabled = true; return; }
  b.disabled = false;
  b.textContent = S.wallet ? `Launch $${values().symbol || 'TICKER'}` : 'Connect wallet to launch';
  $('#balHint').textContent = S.wallet && S.balance != null ? `optional first buy · you have ${fmtSol(S.balance)} SOL` : 'optional first buy, from your wallet';
}
F('ticker').addEventListener('input', updateLaunchButton);
function stepState(i, s) { const li = $$('#runSteps li')[i]; if (!li) return; li.dataset.s = s; li.querySelector('.ic').textContent = s === 'done' ? '✓' : s === 'fail' ? '×' : s === 'active' ? '>' : '·'; }
function showResult(html, bad) { const r = $('#result'); r.innerHTML = html; r.hidden = false; r.classList.toggle('bad', !!bad); }
const rejectMsg = e => /reject|denied|cancel|declined|User rejected/i.test(String(e && (e.message || e)));

$('#launchForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (launching) return;
  if (!S.wallet) { $('#walletBtn').click(); return; }
  const v = values();
  if (!validate(v)) { const first = $('.field.err input, .field.err select, .field.err textarea'); if (first) first.focus(); return; }
  launching = true; const btn = $('#launchBtn'); btn.disabled = true; btn.textContent = 'Launching…';
  $('#result').hidden = true; $('#runSteps').hidden = false; [0, 1, 2, 3].forEach(i => stepState(i, 'wait'));
  $('#formMsg').textContent = 'Keep this tab open until all four steps finish.';
  let prepared = null, step = 0;
  try {
    stepState(0, 'active');
    const up = await fetch(CFG.UPLOAD_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: v.name, symbol: v.symbol, description: v.mission, twitter: v.x, website: v.web, model: v.model, mission: v.mission, computeShareBps: v.share, image: imageData.dataUrl }),
    });
    const upj = await up.json().catch(() => ({}));
    if (!up.ok || !upj.uri) throw Object.assign(new Error(upj.error || 'The upload failed. Try again in a minute.'), { stage: 'upload' });
    stepState(0, 'done'); step = 1;

    stepState(1, 'active');
    prepared = await TOS.prepareLaunch({ user: S.wallet, name: v.name, symbol: v.symbol, uri: upj.uri, devBuySol: v.buy, computeWallet: CFG.COMPUTE_WALLET, computeShareBps: v.share });
    const signed = S.provider.signAllTransactions
      ? await S.provider.signAllTransactions(prepared.txs)
      : [await S.provider.signTransaction(prepared.txs[0]), await S.provider.signTransaction(prepared.txs[1])];
    stepState(1, 'done'); step = 2;

    stepState(2, 'active');
    store.set('pending-split', { mint: prepared.mint, share: v.share, user: S.wallet });
    const res = await TOS.finishLaunch(prepared, signed, (i, sig) => {
      if (i === 0) { stepState(2, 'done'); step = 3; stepState(3, 'active'); }
      if (i === 1) { stepState(3, 'done'); step = 4; }
    });
    store.del('pending-split');
    showResult(`<strong>$${esc(v.symbol)} is live.</strong><span class="mono-break muted">${esc(res.mint)}</span><div class="links"><a class="u" href="https://pump.fun/coin/${esc(res.mint)}" target="_blank" rel="noreferrer noopener">View on pump.fun ↗</a><a class="u" href="https://solscan.io/tx/${esc(res.signatures[0])}" target="_blank" rel="noreferrer noopener">Launch transaction ↗</a><a class="u" href="https://solscan.io/tx/${esc(res.signatures[1])}" target="_blank" rel="noreferrer noopener">Fee split transaction ↗</a></div><span class="muted">It shows up in Explore within a minute.</span>`);
    $('#formMsg').textContent = '';
    toast(`$${v.symbol} launched.`);
    setTimeout(loadCoins, 8000);
  } catch (err) {
    console.error('[terminal of slop] launch failed at step', step, err);
    stepState(step, 'fail');
    if (step <= 2) store.del('pending-split');
    if (step <= 1 && rejectMsg(err)) showResult('You declined in your wallet. Nothing was created and no SOL was spent.', true);
    else if (step === 0) showResult(esc(err.message || 'The upload failed. Try again in a minute.'), true);
    else if (step <= 2) showResult(`The coin wasn’t created. ${esc(err.message || '')}${err.signature ? ` <a class="u" href="https://solscan.io/tx/${esc(err.signature)}" target="_blank" rel="noreferrer noopener">Transaction ↗</a>` : ''}`, true);
    else showResult(`$${esc(v.symbol)} was created, but the fee split didn’t go through. Until it does, all creator fees go to your wallet and the coin won’t appear here.<div class="links"><button class="btn" type="button" id="retrySplit">Retry fee split</button><a class="u" href="https://pump.fun/coin/${esc(prepared.mint)}" target="_blank" rel="noreferrer noopener">View on pump.fun ↗</a></div>`, true);
    $('#formMsg').textContent = '';
  } finally {
    launching = false; updateLaunchButton();
    if (S.wallet && window.TOS) TOS.solBalance(S.wallet).then(b => { S.balance = b; updateLaunchButton(); }).catch(() => {});
  }
});
document.addEventListener('click', async e => {
  if (!e.target.closest('#retrySplit')) return;
  const p = store.get('pending-split', null);
  if (!p || !S.wallet || p.user !== S.wallet) { toast('Connect the wallet that launched the coin, then retry.'); return; }
  const b = e.target.closest('#retrySplit'); b.disabled = true; b.textContent = 'Retrying…';
  try {
    const fx = await TOS.prepareFeeSplit({ user: S.wallet, mint: p.mint, computeWallet: CFG.COMPUTE_WALLET, computeShareBps: p.share });
    const signed = await S.provider.signTransaction(fx.tx);
    const sig = await TOS.sendSigned(signed, fx.blockhash, fx.lastValidBlockHeight);
    store.del('pending-split'); stepState(3, 'done');
    showResult(`Fee split is on. <a class="u" href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noreferrer noopener">Transaction ↗</a>`);
    setTimeout(loadCoins, 8000);
  } catch (err) { b.disabled = false; b.textContent = 'Retry fee split'; toast(rejectMsg(err) ? 'Cancelled in your wallet.' : 'The fee split failed again. Check your SOL balance and retry.'); }
});

/* ---------- chrome ---------- */
const toastEl = $('#toast'); let tt;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => toastEl.classList.remove('show'), 3600); }
const rootEl = document.documentElement;
const th = store.get('theme', null); if (th) rootEl.dataset.theme = th;
$('#themeBtn').addEventListener('click', () => {
  const dark = rootEl.dataset.theme ? rootEl.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  rootEl.dataset.theme = dark ? 'light' : 'dark'; store.set('theme', rootEl.dataset.theme);
});
$$('.x-link').forEach(a => { if (CFG.X_URL) a.href = CFG.X_URL; });

/* ---------- boot ---------- */
drawArt(); if (!reduce) setInterval(tickArt, 140);
renderAll(); updatePreview(); updateLaunchButton();
(async () => {
  if (window.TOS) { try { TOS.init({ rpcUrl: CFG.RPC_URL }); } catch (e) { console.error(e); } }
  else console.error('[terminal of slop] assets/tos-chain.js did not load');
  await Promise.all([loadSolPrice(), loadModels()]);
  fillModelSelect(); renderModels(); updatePreview();
  if (window.TOS) TOS.newCoinCreatorFeeBps().then(b => { S.creatorFeeBps = b; updateEstimate(); }).catch(() => {});
  const last = store.get('wallet', null); if (last) { const w = detectWallets().find(x => x.id === last); if (w) connectWallet(w, true); }
  await loadCoins();
  setInterval(loadCoins, Math.max(10, CFG.REFRESH_SECONDS) * 1000);
  setInterval(loadSolPrice, 120000);
  const pend = store.get('pending-split', null);
  if (pend) showResult(`A launch from this browser created a coin but its fee split never finished.<div class="links"><button class="btn" type="button" id="retrySplit">Retry fee split</button><a class="u" href="https://pump.fun/coin/${esc(pend.mint)}" target="_blank" rel="noreferrer noopener">View on pump.fun ↗</a></div>`, true);
})();
})();
