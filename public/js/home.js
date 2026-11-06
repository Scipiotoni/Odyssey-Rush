// Home screen server browser: public servers, joining a private one with its invite code (+ password),
// creating your own server and changing its settings. Talks to the hub's /api/servers endpoints.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function deviceId() {
  let d = localStorage.getItem('or_device');
  if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('or_device', d); }
  return d;
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ error: 'Server error' }));
}
const DIFF = { peaceful: '🕊️ Peaceful', normal: '⚔️ Normal', hardcore: '💀 Hardcore' };
function tags(st) {
  return [st.creative ? '🧱 Creative' : '', DIFF[st.difficulty] || '', st.pvp ? '🔫 PvP' : '🤝 No PvP', `☀️ ${st.dayMinutes} min days`, st.gather !== 1 ? `⛏️ ×${st.gather} gather` : '', !st.animals ? '🚫 animals' : '', !st.sharks ? '🚫 sharks' : ''].filter(Boolean).map((t) => `<span class="tag">${t}</span>`).join('');
}

export class Home {
  constructor() {
    this.tab = 'browse';
    this.sel = JSON.parse(localStorage.getItem('or_server') || 'null') || { id: 'main', name: 'Odyssey Rush — Official' };
    this.spw = sessionStorage.getItem('or_spw') || '';
    document.querySelectorAll('#srvtabs button').forEach((b) => (b.onclick = () => this.show(b.dataset.tab)));
    this.renderSel();
    this.show('browse');
  }
  select(s, pw = '') {
    this.sel = { id: s.id, name: s.name }; this.spw = pw;
    localStorage.setItem('or_server', JSON.stringify(this.sel)); sessionStorage.setItem('or_spw', pw);
    this.renderSel();
  }
  renderSel() { $('srvname').textContent = this.sel.name; }
  show(tab) {
    this.tab = tab;
    document.querySelectorAll('#srvtabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ({ browse: () => this.browse(), code: () => this.code(), create: () => this.form(null), mine: () => this.mine() })[tab]();
  }
  row(s, actions) {
    const st = s.settings;
    return `<div class="srvrow${this.sel.id === s.id ? ' sel' : ''}"><div class="srvinfo"><b>${s.official ? '⭐ ' : ''}${esc(s.name)}</b> ${s.locked ? '🔒' : ''} ${s.public ? '' : '<span class="tag">private</span>'}
      <div class="srvtags">${tags(st)}</div></div><div class="srvcount">👥 ${s.players}/${st.maxPlayers}</div>${actions}</div>`;
  }
  async browse() {
    const P = $('srvpanel');
    P.innerHTML = '<div class="srvnote">Loading servers…</div>';
    const r = await fetch('/api/servers').then((x) => x.json()).catch(() => ({ servers: [] }));
    P.innerHTML = (r.servers || []).map((s) => this.row(s, `<button data-pick="${s.id}">${this.sel.id === s.id ? '✓ Selected' : 'Select'}</button>`)).join('') + '<div class="srvnote">Private servers aren\'t listed — join them with their invite code.</div>';
    P.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => {
      const s = r.servers.find((x) => x.id === b.dataset.pick);
      if (s.locked) { const pw = prompt(`Password for ${s.name}:`) || ''; this.select(s, pw); } else this.select(s);
      this.browse();
    }));
  }
  code() {
    const P = $('srvpanel');
    P.innerHTML = `<div class="srvform"><label>Invite code <input id="srvcode" maxlength="8" placeholder="e.g. K7Q2XM" style="text-transform:uppercase"></label>
      <label>Password (if it has one) <input id="srvpw" type="password" maxlength="64"></label><button id="srvfind">Find server</button><div id="srvmsg" class="srvnote"></div></div>`;
    $('srvfind').onclick = async () => {
      const r = await post('/api/servers/find', { code: $('srvcode').value });
      if (r.error) { $('srvmsg').textContent = r.error; return; }
      this.select(r.server, $('srvpw').value);
      $('srvmsg').innerHTML = `✓ <b>${esc(r.server.name)}</b> selected — press Wake Up to join.<div class="srvtags">${tags(r.server.settings)}</div>`;
    };
  }
  async mine() {
    const P = $('srvpanel');
    const r = await post('/api/servers/mine', { token: deviceId() });
    const list = r.servers || [];
    P.innerHTML = list.length ? list.map((s) => this.row(s, `<div class="srvbtns"><button data-pick="${s.id}">${this.sel.id === s.id ? '✓' : 'Select'}</button><button data-edit="${s.id}" class="alt">⚙️</button></div>`) + `<div class="srvcode">Invite code: <b>${s.code}</b></div>`).join('')
      : '<div class="srvnote">You don\'t own a server yet — make one in the Create tab.</div>';
    P.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { this.select(list.find((x) => x.id === b.dataset.pick)); this.mine(); }));
    P.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => this.form(list.find((x) => x.id === b.dataset.edit))));
  }
  // create (s = null) or edit a server
  form(s) {
    const st = s?.settings || { pvp: true, dayMinutes: 40, seasonDays: 2, gather: 1, hunger: 1, animals: true, sharks: true, difficulty: 'normal', creative: false, maxPlayers: 12 };
    const P = $('srvpanel');
    const chk = (id, v, label) => `<label class="chk"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${label}</label>`;
    P.innerHTML = `<div class="srvform grid">
      <label>Server name <input id="f_name" maxlength="40" value="${esc(s?.name || 'My Island')}"></label>
      <label>Visibility <select id="f_pub"><option value="1" ${s?.public !== false ? 'selected' : ''}>🌍 Public (listed)</option><option value="0" ${s && !s.public ? 'selected' : ''}>🔑 Private (invite code)</option></select></label>
      <label>Password ${s ? '<small>(blank = keep, "-" = remove)</small>' : '<small>(optional)</small>'} <input id="f_pw" type="password" maxlength="64"></label>
      ${s ? '' : '<label>World seed <small>(blank = random island)</small> <input id="f_seed" inputmode="numeric" maxlength="10"></label>'}
      <label>Max players <input id="f_max" type="number" min="1" max="64" value="${st.maxPlayers}"></label>
      <label>Difficulty <select id="f_diff">${Object.entries(DIFF).map(([k, v]) => `<option value="${k}" ${st.difficulty === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Day length (minutes) <input id="f_day" type="number" min="5" max="180" value="${st.dayMinutes}"></label>
      <label>Season length (days) <input id="f_season" type="number" min="1" max="14" value="${st.seasonDays}"></label>
      <label>Gather rate <input id="f_gather" type="number" step="0.25" min="0.25" max="10" value="${st.gather}"></label>
      <label>Hunger &amp; thirst rate <input id="f_hunger" type="number" step="0.25" min="0" max="4" value="${st.hunger}"></label>
      ${chk('f_pvp', st.pvp, '🔫 PvP (players can hurt each other)')}
      ${chk('f_animals', st.animals, '🐺 Animals')}
      ${chk('f_sharks', st.sharks, '🦈 Sharks')}
      ${chk('f_creative', st.creative, '🧱 Creative (free building & crafting, item spawner, owner flies with Z)')}
      <div class="srvnote full"><b>Peaceful</b>: animals and sharks don't hurt you, no starving. <b>Hardcore</b>: dying wipes your level, kills and respawn points.</div>
      <div class="srvbtns full"><button id="f_save">${s ? '💾 Save settings' : '➕ Create server'}</button>${s ? '<button id="f_code" class="alt">🔁 New invite code</button><button id="f_wipe" class="alt">🏝️ New island…</button><button id="f_del" class="alt danger">🗑️ Delete…</button>' : ''}</div>
      <div id="srvmsg" class="srvnote full"></div></div>`;
    const settings = () => ({ maxPlayers: +$('f_max').value, difficulty: $('f_diff').value, dayMinutes: +$('f_day').value, seasonDays: +$('f_season').value, gather: +$('f_gather').value, hunger: +$('f_hunger').value, pvp: $('f_pvp').checked, animals: $('f_animals').checked, sharks: $('f_sharks').checked, creative: $('f_creative').checked });
    const msg = (t) => ($('srvmsg').innerHTML = t);
    $('f_save').onclick = async () => {
      const pw = $('f_pw').value;
      const body = { token: deviceId(), name: $('f_name').value, public: $('f_pub').value === '1', settings: settings() };
      let r;
      if (s) { if (pw) body.password = pw === '-' ? '' : pw; r = await post('/api/servers/update', { ...body, id: s.id }); }
      else { body.password = pw; body.seed = $('f_seed').value; r = await post('/api/servers/create', body); }
      if (r.error) return msg('⚠️ ' + esc(r.error));
      this.select(r.server, pw && pw !== '-' ? pw : '');
      msg(`✓ ${s ? 'Saved' : 'Created'} <b>${esc(r.server.name)}</b> — invite code <b class="code">${r.server.code}</b>${s ? ' (changes apply live)' : ''}. Press Wake Up to play.`);
    };
    if (!s) return;
    $('f_code').onclick = async () => { const r = await post('/api/servers/update', { token: deviceId(), id: s.id, newCode: true }); msg(r.error ? '⚠️ ' + esc(r.error) : `New invite code: <b class="code">${r.server.code}</b> (the old one stops working)`); };
    $('f_wipe').onclick = async () => {
      if (!confirm(`Wipe ${s.name} and generate a brand-new island? Everything built there is lost.`)) return;
      if (prompt('Type the server name to confirm:') !== s.name) return msg('Cancelled.');
      const r = await post('/api/servers/update', { token: deviceId(), id: s.id, newIsland: true });
      msg(r.error ? '⚠️ ' + esc(r.error) : '🏝️ New island generated.');
    };
    $('f_del').onclick = async () => {
      if (!confirm(`Delete ${s.name} forever?`)) return;
      if (prompt('Type the server name to confirm:') !== s.name) return msg('Cancelled.');
      const r = await post('/api/servers/update', { token: deviceId(), id: s.id, delete: true });
      if (r.error) return msg('⚠️ ' + esc(r.error));
      if (this.sel.id === s.id) this.select({ id: 'main', name: 'Odyssey Rush — Official' });
      this.show('mine');
    };
  }
}
