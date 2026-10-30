// Online mode: accounts (Supabase RPC functions) and live multiplayer (Supabase Realtime broadcast + presence).
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://fwhwxgnealjxeodttvhe.supabase.co';
const SUPABASE_KEY = 'sb_publishable_E5FwK-3SmuLgRiQ59Yp5QA_4s4UE9RY';
const SESSION_KEY = 'roblok.session';

const ERRORS = {
  bad_username: "Login 3-14 ta harf, raqam yoki _ bo'lsin",
  short_password: "Parol kamida 4 ta belgidan iborat bo'lsin",
  taken: 'Bu login band, boshqasini tanlang',
  wrong: "Login yoki parol noto'g'ri",
  expired: 'Qaytadan kiring',
  network: "Internet yo'q yoki server javob bermadi",
};

let client = null;
function sb() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  return client;
}

async function rpc(name, args) {
  let res;
  try {
    res = await sb().rpc(name, args);
  } catch (e) {
    return { error: ERRORS.network };
  }
  if (res.error) return { error: ERRORS.network };
  const d = res.data || {};
  if (d.error) return { error: ERRORS[d.error] || d.error, code: d.error };
  return d;
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
}
function writeSession(s) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* storage unavailable */ }
}

export const account = {
  session: readSession(),
  async register(username, password, shirt) {
    const r = await rpc('roblok_register', { p_username: username, p_password: password, p_shirt: shirt });
    if (!r.error) { this.session = { token: r.token, username: r.username }; writeSession(this.session); }
    return r;
  },
  async login(username, password) {
    const r = await rpc('roblok_login', { p_username: username, p_password: password });
    if (!r.error) { this.session = { token: r.token, username: r.username }; writeSession(this.session); }
    return r;
  },
  async me() {
    if (!this.session) return { error: ERRORS.expired };
    const r = await rpc('roblok_me', { p_token: this.session.token });
    if (r.code === 'expired') this.logout();
    return r;
  },
  async save(coins, shirt) {
    if (!this.session) return;
    await rpc('roblok_save', { p_token: this.session.token, p_coins: coins, p_shirt: shirt });
  },
  logout() { this.session = null; writeSession(null); },
};

// One room = one Realtime channel. Everyone in it sees each other.
// handlers: { onState(id, s), onLeave(id), onPlayers(list), onNewcomer(id), onBlock(b), onEdits(list), onChat(id, text),
//   onVoice(id, mime, base64), onStatus(ok) }
export function joinRoom(room, me, handlers) {
  const id = me.username;
  const joinedAt = Date.now();
  const channel = sb().channel('roblok:' + room, {
    config: { broadcast: { self: false }, presence: { key: id } },
  });
  let players = [];

  channel.on('broadcast', { event: 's' }, ({ payload }) => {
    if (payload && payload.id && payload.id !== id) handlers.onState(payload.id, payload);
  });
  channel.on('broadcast', { event: 'b' }, ({ payload }) => handlers.onBlock(payload));
  channel.on('broadcast', { event: 'bb' }, ({ payload }) => {
    if (payload && Array.isArray(payload.l) && payload.l.length <= 2000) handlers.onBlocks(payload.l);
  });
  channel.on('broadcast', { event: 'edits' }, ({ payload }) => {
    if (payload && payload.to === id) handlers.onEdits(payload.list || []);
  });
  channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
    if (payload && payload.id !== id) handlers.onChat(payload.id, String(payload.text || '').slice(0, 60));
  });
  channel.on('broadcast', { event: 'voice' }, ({ payload }) => {
    if (!payload || payload.id === id || typeof payload.data !== 'string' || payload.data.length > 300000) return;
    if (!/^audio\/[a-z0-9.+-]+(;[ a-z0-9=,.+-]*)?$/i.test(payload.mime || '')) return;
    handlers.onVoice(payload.id, payload.mime, payload.data);
  });
  channel.on('presence', { event: 'sync' }, () => {
    const st = channel.presenceState();
    const before = new Set(players.map((p) => p.id));
    players = Object.entries(st).map(([pid, metas]) => Object.assign({ id: pid }, metas[0] || {}));
    const now = new Set(players.map((p) => p.id));
    for (const pid of before) if (!now.has(pid)) handlers.onLeave(pid);
    handlers.onPlayers(players);
    // The longest-connected player sends the room's block edits to newcomers
    const host = players.slice().sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))[0];
    if (host && host.id === id) {
      for (const p of players) if (p.id !== id && !before.has(p.id)) handlers.onNewcomer(p.id);
    }
  });

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ name: me.username, shirt: me.shirt, coins: me.coins, joinedAt });
      handlers.onStatus(true);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      handlers.onStatus(false);
    }
  });

  const send = (event, payload) => channel.send({ type: 'broadcast', event, payload });
  return {
    id,
    get players() { return players; },
    sendState(s) { s.id = id; send('s', s); },
    sendBlock(b) { send('b', b); },
    sendBlocks(list) { send('bb', { l: list }); },
    sendEdits(to, list) { send('edits', { to, list }); },
    sendChat(text) { send('chat', { id, text }); },
    sendVoice(mime, data) { send('voice', { id, mime, data }); },
    updateMeta(meta) { channel.track(Object.assign({ name: me.username, joinedAt }, meta)); },
    leave() { sb().removeChannel(channel); },
  };
}
