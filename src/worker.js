// Game server: one Durable Object per room code. Holds the game state, relays it to every
// phone over WebSockets, and stores the audio clips so each phone can fetch them.
import { DurableObject } from "cloudflare:workers";
import DAILY from "./daily-words.js";

const PTS_PER_SYL = 10;
const pointsFor = s => s * PTS_PER_SYL;
const penaltyFor = s => Math.ceil(pointsFor(s) / 2);
const CLIP_KINDS = ["orig", "copy"];
const MAX_CLIP_BYTES = 1_500_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/api\/room\/([A-Z]{4})(\/.*)?$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    if (url.pathname.startsWith("/api/daily")) return daily(req, env, url);
    if (url.pathname === "/api/say" && req.method === "GET") {
      const w = (url.searchParams.get("w") || "").trim().slice(0, 80);
      if (!w || !(await wordSet(env, url.origin)).has(w.toLowerCase())) return new Response("Unknown word", { status: 404 });
      const r = await ttsAudio(env, w, `${url.origin}/api/say?w=${encodeURIComponent(w.toLowerCase())}&v=1`);
      if (!r.ok) return r;
      return new Response(r.body, { headers: { "content-type": r.headers.get("content-type"), "cache-control": "public, max-age=86400" } });
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(req);
  }
};

// ---------- Daily puzzle ----------
// One answer per day (America/New_York), the same for everyone. Puzzle #1 is 2026-11-24.
const DAILY_TZ = "America/New_York", DAILY_START = Date.UTC(2026, 10, 24), DAILY_GUESSES = 5;
function dailyToday() {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_TZ }).format(new Date());
  const [y, mo, d] = date.split("-").map(Number);
  const n = Math.round((Date.UTC(y, mo - 1, d) - DAILY_START) / 864e5) + 1;
  const [word, cat, syl] = DAILY[((n - 1) % DAILY.length + DAILY.length) % DAILY.length];
  return { n, date, word, cat, syl };
}
const shape = w => w.split(" ").map(x => x.replace(/[a-z0-9]/gi, "_")).join("  ");
function dailyHints(t, misses) {
  const words = t.word.split(" ");
  const all = [
    `${t.syl} syllables`,
    `${words.length} word${words.length > 1 ? "s" : ""}: ${shape(t.word)}`,
    `Starts with: ${words.map(x => x[0].toUpperCase()).join(" ")}`,
    `Looks like: ${words.map(x => x.length > 1 ? x[0].toUpperCase() + x.slice(1, -1).replace(/[a-z0-9]/gi, "_") + x.slice(-1) : x.toUpperCase()).join(" ")}`,
  ];
  return all.slice(0, Math.min(misses, all.length));
}
// Per-guess feedback: each guessed word marked g (right spot), y (in the answer, wrong spot),
// n (almost a word in the answer), x (not in it), plus an overall closeness level.
const toks = w => w.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
function feedback(guess, answer) {
  const gw = toks(guess), aw = toks(answer), left = [...aw];
  const marks = gw.map((w, i) => (aw[i] === w || aw[aw.length - gw.length + i] === w ? "g" : null));
  marks.forEach((m, i) => { if (m) left.splice(left.indexOf(gw[i]), 1); });
  gw.forEach((w, i) => {
    if (marks[i]) return;
    const k = left.indexOf(w);
    if (k >= 0) { marks[i] = "y"; left.splice(k, 1); return; }
    marks[i] = aw.some(a => a.length >= 4 && lev(a, w) <= (a.length >= 7 ? 2 : 1)) ? "n" : "x";
  });
  const a = norm(answer), g = norm(guess);
  const r1 = a && g ? 1 - lev(a, g) / Math.max(a.length, g.length) : 0;
  const pts = { g: 2, y: 1.5, n: 1, x: 0 }, r2 = aw.length ? marks.reduce((t, m) => t + pts[m], 0) / (2 * Math.max(aw.length, gw.length)) : 0;
  const r = Math.max(r1, r2);
  const level = r >= 0.75 ? 3 : r >= 0.5 ? 2 : r >= 0.3 ? 1 : 0;
  return { words: gw.map((w, i) => ({ w, s: marks[i] })), level, heat: ["Cold", "Warm", "Close", "Very close"][level] };
}
const json = (o, init = {}) => new Response(JSON.stringify(o), { ...init, headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers || {}) } });
async function dailyAudio(env, t, origin) {
  return ttsAudio(env, t.word, `${origin}/api/daily/audio?d=${t.date}&v=1`);
}
// Free play: speak any entry from the public word list (and only those, so the endpoint can't be used as a general voice).
let WORDSET = null;
async function wordSet(env, origin) {
  if (WORDSET) return WORDSET;
  const r = await env.ASSETS.fetch(new Request(origin + "/words.json"));
  const data = await r.json(), set = new Set();
  for (const levels of Object.values(data)) for (const arr of Object.values(levels)) for (const w of arr) set.add(w.toLowerCase());
  for (const [w] of DAILY) set.add(w.toLowerCase());
  return (WORDSET = set);
}
async function ttsAudio(env, text, cacheUrl) {
  const t = { word: text };
  const key = new Request(cacheUrl);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  let bytes = null, type = "audio/mpeg";
  const tries = [
    ["@cf/deepgram/aura-2-en", { text: t.word, encoding: "mp3" }],
    ["@cf/deepgram/aura-1", { text: t.word, speaker: "asteria", encoding: "mp3" }],
    ["@cf/myshell-ai/melotts", { prompt: t.word, lang: "en" }],
  ];
  let lastErr = "";
  for (const [model, input] of tries) {
    try {
      const r = await env.AI.run(model, input, { returnRawResponse: true });
      if (r instanceof Response) {
        if (!r.ok) throw new Error(model + " " + r.status);
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("json")) { const j = await r.json(); const a = j.audio || (j.result && j.result.audio); if (!a) throw new Error(model + " no audio"); bytes = Uint8Array.from(atob(a), c => c.charCodeAt(0)); }
        else { bytes = new Uint8Array(await r.arrayBuffer()); if (ct.startsWith("audio/")) type = ct; }
      } else if (r && typeof r.getReader === "function") bytes = new Uint8Array(await new Response(r).arrayBuffer());
      else if (r && r.audio) bytes = Uint8Array.from(atob(r.audio), c => c.charCodeAt(0));
      if (bytes && bytes.length > 500) break;
      bytes = null;
    } catch (e) { lastErr = String(e && e.message || e); }
  }
  if (!bytes) return new Response("Voice unavailable: " + lastErr, { status: 503 });
  const res = new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=90000" } });
  await cache.put(key, res.clone());
  return res;
}
async function daily(req, env, url) {
  const t = dailyToday();
  if (url.pathname === "/api/daily" && req.method === "GET")
    return json({ n: t.n, date: t.date, cat: t.cat, maxGuesses: DAILY_GUESSES });
  if (url.pathname === "/api/daily/audio" && req.method === "GET") {
    const r = await dailyAudio(env, t, url.origin);
    if (!r.ok) return r;
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type"), "cache-control": "private, max-age=600" } });
  }
  if (url.pathname === "/api/daily/guess" && req.method === "POST") {
    let body = {}; try { body = await req.json(); } catch (e) {}
    if (Number(body.n) !== t.n) return json({ stale: true, n: t.n }, { status: 409 });
    const guess = String(body.guess || "").slice(0, 120);
    const prior = Math.max(0, Math.min(DAILY_GUESSES, Number(body.misses) || 0));
    const correct = judge(guess, t.word);
    const misses = correct ? prior : prior + 1;
    const over = correct || misses >= DAILY_GUESSES;
    return json({ correct, misses, over, fb: correct ? undefined : feedback(guess, t.word), hints: dailyHints(t, misses), word: over ? t.word : undefined, syl: over ? t.syl : undefined });
  }
  return new Response("Not found", { status: 404 });
}

// ---------- pure game helpers ----------
const norm = s => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(a|an|the)\b/g, " ").replace(/\s+/g, " ").trim();
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
export function judge(guess, answer) {
  const g = norm(guess), a = norm(answer);
  if (!g) return false;
  if (g === a || g.replace(/ /g, "") === a.replace(/ /g, "")) return true;
  return lev(g, a) <= Math.max(1, Math.floor(a.length / 10));
}
const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

function freshState(code) {
  return {
    code, hostId: null, players: {}, order: [],
    settings: { mode: "points", source: "opponent", category: "Places", guesserPlays: 2, speakerPlays: 2, rounds: 4 },
    teamNames: ["Red", "Blue"], scores: [0, 0], turns: [0, 0],
    phase: "lobby", round: 1, turnTeam: 0, turn: null, history: [], used: [], clipVer: 0
  };
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.words = null;
    ctx.blockConcurrencyWhile(async () => { this.s = (await ctx.storage.get("s")) || null; });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const code = url.pathname.split("/")[3];
    if (!this.s) this.s = freshState(code);
    const rest = url.pathname.split("/").slice(4).join("/");

    if (rest === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
      const pid = clean(url.searchParams.get("pid"), 40);
      if (!pid) return new Response("Missing player id", { status: 400 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ pid });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const clipM = rest.match(/^clip\/(orig|copy)$/);
    if (clipM) {
      const kind = clipM[1];
      if (req.method === "PUT") {
        const pid = clean(url.searchParams.get("pid"), 40);
        const t = this.s.turn;
        if (!t || t.speakerId !== pid || this.s.phase !== "speak") return new Response("Not your turn", { status: 403 });
        const buf = await req.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > MAX_CLIP_BYTES) return new Response("Bad clip size", { status: 413 });
        await this.ctx.storage.put("clip:" + kind, { type: req.headers.get("Content-Type") || "audio/webm", data: buf });
        t.clips[kind] = true;
        this.s.clipVer++;
        await this.save();
        return new Response("ok");
      }
      const c = await this.ctx.storage.get("clip:" + kind);
      if (!c) return new Response("No clip", { status: 404 });
      return new Response(c.data, { headers: { "Content-Type": c.type, "Cache-Control": "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  }

  async loadWords() {
    if (this.words) return this.words;
    const r = await this.env.ASSETS.fetch(new Request("https://assets.local/words.json"));
    const data = await r.json(), bank = {};
    for (const [cat, levels] of Object.entries(data)) { bank[cat] = []; for (const [n, arr] of Object.entries(levels)) for (const w of arr) bank[cat].push([w, +n]); }
    return (this.words = bank);
  }
  async draw(cat, level) {
    const bank = await this.loadWords();
    let list = (bank[cat] || []).filter(([, n]) => level == null || n === level);
    if (!list.length) list = Object.values(bank).flat().filter(([, n]) => level == null || n === level);
    const used = new Set(this.s.used);
    let pool = list.filter(([w]) => !used.has(w)); if (!pool.length) pool = list;
    const [w, n] = pool[Math.floor(Math.random() * pool.length)];
    this.s.used.push(w); if (this.s.used.length > 3000) this.s.used.splice(0, 1000);
    return { word: w, syl: n };
  }

  async save() { await this.ctx.storage.put("s", this.s); this.broadcast(); }

  teamOf(pid) { return this.s.players[pid]?.team; }
  members(team) { return this.s.order.filter(id => this.s.players[id] && this.s.players[id].team === team); }

  // Each phone gets its own view: the word stays hidden from the guessing side until the reveal.
  viewFor(pid, connected = this.connectedIds()) {
    const s = this.s, t = s.turn;
    const v = { ...s, used: undefined, me: pid, connected };
    if (t) {
      const knows = s.phase === "reveal" || s.phase === "final" || pid === t.speakerId || this.teamOf(pid) !== t.team;
      v.turn = { ...t, word: knows ? t.word : null };
    }
    return v;
  }
  connectedIds() { return [...new Set(this.ctx.getWebSockets().map(ws => ws.deserializeAttachment()?.pid).filter(Boolean))]; }
  // Work out who is connected once per broadcast, and build each distinct view once
  // (a player with two tabs, or players on the same side of the secret word, share most of the work).
  broadcast() {
    const sockets = this.ctx.getWebSockets();
    const ids = sockets.map(ws => ws.deserializeAttachment()?.pid);
    const connected = [...new Set(ids.filter(Boolean))];
    const msgs = new Map();
    sockets.forEach((ws, i) => {
      const pid = ids[i]; if (!pid) return;
      if (!msgs.has(pid)) msgs.set(pid, JSON.stringify({ type: "state", state: this.viewFor(pid, connected) }));
      try { ws.send(msgs.get(pid)); } catch (e) {}
    });
  }
  sendErr(ws, msg) { try { ws.send(JSON.stringify({ type: "error", message: msg })); } catch (e) {} }

  // Finish the close handshake so the phone's socket closes now (and it can reconnect) instead of hanging.
  async webSocketClose(ws) { try { ws.close(1000, "bye"); } catch (e) {} this.broadcast(); }
  async webSocketError(ws) { this.broadcast(); }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const pid = ws.deserializeAttachment()?.pid; if (!pid) return;
    const s = this.s, me = s.players[pid], t = s.turn, isHost = s.hostId === pid;
    const pts = s.settings.mode === "points";
    try {
      switch (m.type) {
        case "hello": {
          if (!me) {
            if (s.phase !== "lobby") {
              // late joiner goes to the smaller team
              const team = this.members(0).length <= this.members(1).length ? 0 : 1;
              s.players[pid] = { name: clean(m.name, 20) || "Player", team };
            } else {
              const team = this.members(0).length <= this.members(1).length ? 0 : 1;
              s.players[pid] = { name: clean(m.name, 20) || "Player", team };
            }
            s.order.push(pid);
          } else if (m.name) me.name = clean(m.name, 20) || me.name;
          if (!s.hostId || !s.players[s.hostId]) s.hostId = pid;
          break;
        }
        case "team": if (s.phase === "lobby" && me && (m.team === 0 || m.team === 1)) me.team = m.team; break;
        case "teamName": if (me && (m.team === 0 || m.team === 1)) s.teamNames[m.team] = clean(m.name, 16) || s.teamNames[m.team]; break;
        case "settings": {
          if (!isHost || s.phase !== "lobby") return;
          const x = m.settings || {}, st = s.settings;
          if (["points", "casual"].includes(x.mode)) st.mode = x.mode;
          if (["opponent", "random"].includes(x.source)) st.source = x.source;
          if (typeof x.category === "string") st.category = clean(x.category, 20);
          if ([0, 1, 2, 3].includes(x.guesserPlays)) st.guesserPlays = x.guesserPlays;
          if ([2, 4, 6, 8].includes(x.rounds)) st.rounds = x.rounds;
          break;
        }
        case "kick": if (isHost && s.phase === "lobby" && m.pid !== pid) { delete s.players[m.pid]; s.order = s.order.filter(i => i !== m.pid); } break;
        case "start": {
          if (!isHost || !["lobby", "final"].includes(s.phase)) return;
          if (this.members(0).length < 2 || this.members(1).length < 2) return this.sendErr(ws, "Each team needs at least 2 players.");
          s.scores = [0, 0]; s.turns = [0, 0]; s.round = 1; s.turnTeam = 0; s.history = [];
          await this.newTurn(); break;
        }
        case "bet": {
          if (s.phase !== "bet" || pid !== t.speakerId || !(m.level >= 1 && m.level <= 6)) return;
          t.level = m.level; await this.afterBet(); break;
        }
        case "pick": {
          if (s.phase !== "pick" || this.teamOf(pid) === t.team) return;
          if (m.random) { Object.assign(t, await this.draw(t.cat, pts ? t.level : null), { drawn: true }); }
          else { const w = clean(m.word, 60); if (!w) return; t.word = w; t.drawn = false; }
          t.pickedBy = pid; s.phase = "speak"; break;
        }
        case "shuffle": {
          if (s.phase !== "speak" || pid !== t.speakerId || !t.drawn || t.clips.orig) return;
          Object.assign(t, await this.draw(t.cat, pts ? t.level : null)); break;
        }
        case "speakerListen": if (s.phase === "speak" && pid === t.speakerId && t.sPlays > 0) t.sPlays--; break;
        case "redoOrig": if (s.phase === "speak" && pid === t.speakerId) { t.clips = { orig: false, copy: false }; t.sPlays = s.settings.speakerPlays; } break;
        case "send": {
          if (s.phase !== "speak" || pid !== t.speakerId || !t.clips.orig || !t.clips.copy) return;
          s.phase = "guess"; break;
        }
        case "listen": {
          if (s.phase !== "guess" || pid !== t.guesserId) return;
          if (s.settings.guesserPlays && t.gPlays <= 0) return;
          if (s.settings.guesserPlays) t.gPlays--;
          t.heard = true;
          ws.send(JSON.stringify({ type: "play" }));
          break;
        }
        case "guess": case "giveup": case "reveal": {
          if (s.phase !== "guess" || pid !== t.guesserId) return;
          t.guess = m.type === "guess" ? clean(m.text, 80) : "";
          t.correct = m.type === "guess" ? judge(t.guess, t.word) : (m.type === "giveup" ? false : null);
          this.finishTurn(); break;
        }
        case "mark": {
          if (s.phase !== "reveal" || typeof m.correct !== "boolean") return;
          const last = s.history[s.history.length - 1];
          if (pts && t.correct !== null) s.scores[t.team] -= t.delta;
          t.correct = m.correct;
          if (pts) { t.delta = t.correct ? pointsFor(t.level) : -penaltyFor(t.level); s.scores[t.team] += t.delta; }
          if (last) { last.ok = t.correct; last.d = t.delta; }
          break;
        }
        case "next": {
          if (s.phase !== "reveal") return;
          if (pts && s.round > s.settings.rounds) { s.phase = "final"; break; }
          await this.newTurn(); break;
        }
        case "end": if (s.phase === "reveal" || s.phase === "guess") s.phase = "final"; break;
        case "lobby": if (isHost) { s.phase = "lobby"; s.turn = null; } break;
        default: return;
      }
    } catch (e) { return this.sendErr(ws, "Something went wrong: " + e.message); }
    await this.save();
  }

  async newTurn() {
    const s = this.s, team = s.turnTeam, mem = this.members(team), n = mem.length;
    const k = s.turns[team];
    const cats = Object.keys(await this.loadWords());
    const cat = s.settings.category === "Mixed" || !cats.includes(s.settings.category) ? cats[Math.floor(Math.random() * cats.length)] : s.settings.category;
    s.turn = {
      team, speakerId: mem[k % n], guesserId: mem[(k + 1) % n], cat, level: null, word: null, syl: null, drawn: false,
      sPlays: s.settings.speakerPlays, gPlays: s.settings.guesserPlays || 0, clips: { orig: false, copy: false },
      heard: false, guess: "", correct: null, delta: 0, n: (s.history.length + 1)
    };
    await this.ctx.storage.delete(["clip:orig", "clip:copy"]);
    if (s.settings.mode === "points") s.phase = "bet"; else await this.afterBet();
  }
  async afterBet() {
    const s = this.s, t = s.turn;
    if (s.settings.source === "opponent") s.phase = "pick";
    else { Object.assign(t, await this.draw(t.cat, s.settings.mode === "points" ? t.level : null), { drawn: true }); s.phase = "speak"; }
  }
  finishTurn() {
    const s = this.s, t = s.turn, pts = s.settings.mode === "points";
    if (pts) { t.delta = t.correct ? pointsFor(t.level) : -penaltyFor(t.level); s.scores[t.team] += t.delta; }
    s.history.push({ team: t.team, word: t.word, level: t.level, d: t.delta, ok: t.correct, speaker: s.players[t.speakerId]?.name, guesser: s.players[t.guesserId]?.name });
    s.turns[t.team]++;
    s.turnTeam = 1 - s.turnTeam; if (s.turnTeam === 0) s.round++;
    s.phase = "reveal";
  }
}
