/* ==========================================================================
   RELAX MIND — logique de l'application
   Aucune dépendance externe. Tout fonctionne hors ligne.
   ========================================================================== */
(function () {
"use strict";

var VERSION = "2.0.0";
var CFG = (typeof RM_CONFIG !== "undefined") ? RM_CONFIG : {};
var UNLOCK_HOURS = CFG.unlockHours != null ? CFG.unlockHours : 72;   // 3 jours entre deux séances
var MAX_SEANCES  = 30;
var ITER         = CFG.iterations || 250000;
var LOCK_MIN     = CFG.lockMinutes != null ? CFG.lockMinutes : 15;
var MAX_TRY      = CFG.maxAttempts || 8;
var COHORTE      = (CFG.participants || []);

/* ---------------------------------------------------------------- outils */
var $  = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function mmss(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("on"); }, 2600); }

/* ------------------------------------------------------------ stockage */
var mem = {};                       // repli si localStorage indisponible
var LS = (function () {
  try { var k = "__rm"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return localStorage; }
  catch (e) { return { getItem: function (k) { return k in mem ? mem[k] : null; },
                       setItem: function (k, v) { mem[k] = String(v); },
                       removeItem: function (k) { delete mem[k]; } }; }
})();
var KEY  = "relaxmind.vault";     // coffre chiffré
var KTRY = "relaxmind.try";       // compteur de tentatives (non sensible)

var DEFAULTS = {
  code: "", pid: "", startedAt: 0,
  voiceURI: "", rate: 0.85, pitch: 0.95, vol: 1, tone: "doux",
  amb: "none", ambVol: 0.12, duree: CFG.dureeDefaut || 20,
  done: {}, events: [], unlockHours: UNLOCK_HOURS
};
var S = fresh();
var DEK = null;                   // clé AES en mémoire uniquement
var VAULT = null;                 // en-tête du coffre (sels, emballages)

function fresh() { var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k]; return o; }

function readVault() { try { return JSON.parse(LS.getItem(KEY) || "null"); } catch (e) { return null; } }
function writeVault(v) { try { LS.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

var saveT = null;
function save() {                                  // écriture chiffrée, groupée
  if (!DEK || !VAULT) return;
  clearTimeout(saveT);
  saveT = setTimeout(function () {
    RMC.encJSON(DEK, S).then(function (box) { VAULT.data = box; writeVault(VAULT); }).catch(function () {});
  }, 250);
}

/* ------------------------------------------------- analyse des textes */
function parseTexte(txt) {
  txt = String(txt || "").replace(/\[\[\[[\s\S]*?\]\]\]/g, "");   // ignore les zones à compléter
  var out = [], paras = txt.split(/\n\s*\n/), i;
  for (i = 0; i < paras.length; i++) {
    var p = paras[i].trim(); if (!p) continue;
    var parts = p.split(/(\[pause\s+\d+(?:\.\d+)?\])/i);
    for (var j = 0; j < parts.length; j++) {
      var seg = parts[j], m = seg.match(/^\[pause\s+(\d+(?:\.\d+)?)\]$/i);
      if (m) { out.push({ t: "p", ms: parseFloat(m[1]) * 1000 }); continue; }
      var clean = seg.replace(/\s+/g, " ").trim();
      if (!clean) continue;
      splitPhrases(clean).forEach(function (s) { out.push({ t: "s", text: s }); });
    }
    if (i < paras.length - 1) out.push({ t: "p", ms: 1400 });
  }
  return out;
}
function splitPhrases(s) {
  var raw = s.match(/[^.!?…]+[.!?…]*\s*/g) || [s], res = [];
  raw.forEach(function (x) {
    x = x.trim(); if (!x) return;
    if (x.length <= 170) { res.push(x); return; }
    var chunks = x.split(/,\s*/), cur = "";
    chunks.forEach(function (c) {
      if ((cur + " " + c).length > 170 && cur) { res.push(cur.trim()); cur = c; }
      else cur = cur ? cur + ", " + c : c;
    });
    if (cur.trim()) res.push(cur.trim());
  });
  return res;
}
/* Regroupe les phrases contiguës en blocs (= paragraphes).
   Un bloc est l'unité d'enregistrement de la voix de la responsable d'étude. */
function blocksOf(txt) {
  var segs = parseTexte(txt), out = [], k = -1, cur = null;
  segs.forEach(function (g) {
    if (g.t === "p") { if (cur) { out.push(cur); cur = null; } out.push({ t: "p", ms: g.ms }); }
    else { if (!cur) { k++; cur = { t: "s", k: k, sent: [] }; } cur.sent.push(g.text); }
  });
  if (cur) out.push(cur);
  out.forEach(function (b) { if (b.t === "s") b.text = b.sent.join(" "); });
  return out;
}
function speechMs(g, rate) { return (g.text.split(/\s+/).length / (150 * rate)) * 60000 + 260; }
function blockMs(b, rate, meta) {
  if (meta && meta.blocks && meta.blocks[b.k] && meta.blocks[b.k].d) return meta.blocks[b.k].d * 1000 + 200;
  return speechMs(b, rate);
}
function estimate(segs, rate, meta) {
  var ms = 0;
  segs.forEach(function (g) { ms += (g.t === "p") ? g.ms : blockMs(g, rate, meta); });
  return ms;
}
/* Étire les silences pour que la séance atteigne la durée cible (15 à 30 min).
   Les silences ne sont jamais raccourcis en deçà de ce qui est écrit dans le texte. */
function build(txt, targetMin, rate, meta) {
  var segs = blocksOf(txt), sp = 0, pa = 0;
  segs.forEach(function (g) { if (g.t === "p") pa += g.ms; else sp += blockMs(g, rate, meta); });
  var need = targetMin * 60000 - sp;
  var f = (pa > 0 && need > pa) ? Math.min(6, need / pa) : 1;
  if (f > 1) segs.forEach(function (g) { if (g.t === "p") g.ms = Math.round(g.ms * f); });
  return { segs: segs, est: estimate(segs, rate, meta) };
}
/* ---- voix enregistrée de la responsable d'étude ---- */
var AUDIO = CFG.audio || null;
function audioMeta(id) { return (AUDIO && AUDIO[id]) ? AUDIO[id] : null; }
function audioSrc(id, k) {
  var m = audioMeta(id);
  if (!m || !m.blocks || !m.blocks[k]) return null;
  return "audio/s" + (id < 10 ? "0" + id : id) + "/b" + ("00" + k).slice(-3) + "." + (m.ext || "webm");
}
function hasVoice(id) {
  var m = audioMeta(id);
  if (!m || !m.blocks) return false;
  var need = blocksOf((LISTE.filter(function (s) { return s.id === id; })[0] || {}).texte || "").filter(function (b) { return b.t === "s"; }).length;
  return need > 0 && Object.keys(m.blocks).length >= need;
}

/* ------------------------------------------------------------- séances */
var LISTE = (typeof SEANCES !== "undefined" ? SEANCES : []).slice(0, MAX_SEANCES);

function doneTs(id) { var d = S.done[id]; return d && d.first ? d.first : 0; }
function isDone(id) { return !!doneTs(id); }
function unlockAt(id) {
  if (id <= 1) return 0;
  var prev = doneTs(id - 1);
  if (!prev) return Infinity;                        // séance précédente non faite
  return prev + S.unlockHours * 3600000;
}
function isOpen(id) { return Date.now() >= unlockAt(id); }
function remain(id) { return Math.max(0, unlockAt(id) - Date.now()); }
function humanDelay(ms) {
  if (!isFinite(ms)) return "";
  var h = Math.ceil(ms / 3600000);
  if (h >= 48) return "dans " + Math.ceil(h / 24) + " jours";
  if (h > 1) return "dans " + h + " heures";
  var mn = Math.ceil(ms / 60000);
  return "dans " + Math.max(1, mn) + " minute" + (mn > 1 ? "s" : "");
}

/* ---------------------------------------------------------------- voix */
var synth = window.speechSynthesis;
var VOICES = [];
var FEM = ["amelie","amélie","aurelie","aurélie","audrey","virginie","hortense","julie","marie","chantal","celine","céline","sandy","female","femme","google français","charlotte","léa","lea","siri voix 1","zira","denise","eloise","éloise","brigitte","alice"];
var MAS = ["thomas","daniel","nicolas","paul","claude","henri","antoine","male","homme","siri voix 2","yannick","mathieu","jacques","rémi","remi","guillaume","alain"];

function loadVoices() {
  var all = synth ? synth.getVoices() : [];
  VOICES = all.filter(function (v) { return /^fr/i.test(v.lang); });
  if (!VOICES.length) VOICES = all.slice();
  renderVoices();
}
function genre(v) {
  var n = (v.name + " " + (v.voiceURI || "")).toLowerCase();
  for (var i = 0; i < FEM.length; i++) if (n.indexOf(FEM[i]) > -1) return "f";
  for (var j = 0; j < MAS.length; j++) if (n.indexOf(MAS[j]) > -1) return "m";
  if (/\bf\b|#female|_f_/.test(n)) return "f";
  if (/\bm\b|#male|_m_/.test(n)) return "m";
  return "?";
}
function cleanName(v) {
  return v.name.replace(/Microsoft |Google |\(.*?\)|français|Français|France|fr-FR/g, "").replace(/\s+/g, " ").trim() || v.name;
}
function currentVoice() {
  for (var i = 0; i < VOICES.length; i++) if (VOICES[i].voiceURI === S.voiceURI) return VOICES[i];
  return VOICES[0] || null;
}
function renderVoices() {
  var f = $("#vx-f"), m = $("#vx-m"), o = $("#vx-o");
  f.innerHTML = ""; m.innerHTML = ""; o.innerHTML = "";
  if (!VOICES.length) { $("#vx-none").style.display = "block"; return; }
  $("#vx-none").style.display = "none";
  if (!S.voiceURI) { S.voiceURI = VOICES[0].voiceURI; save(); }
  VOICES.forEach(function (v) {
    var g = genre(v);
    var row = el("div", "opt" + (v.voiceURI === S.voiceURI ? " sel" : ""));
    row.appendChild(el("div", "nm", cleanName(v) + '<div class="tiny" style="opacity:.65">' + v.lang + (v.localService ? " · hors ligne" : "") + "</div>"));
    var pv = el("button", "pv", "Écouter");
    pv.onclick = function (e) { e.stopPropagation(); testVoice(v); };
    row.appendChild(pv);
    row.onclick = function () { S.voiceURI = v.voiceURI; save(); renderVoices(); };
    (g === "f" ? f : g === "m" ? m : o).appendChild(row);
  });
  if (!f.children.length) f.appendChild(el("p", "tiny", "Aucune voix féminine identifiée automatiquement — voir « Autres voix »."));
  if (!m.children.length) m.appendChild(el("p", "tiny", "Aucune voix masculine identifiée automatiquement — voir « Autres voix »."));
  $("#vx-o-wrap").style.display = o.children.length ? "block" : "none";
}

var TONES = [
  { k: "grave",  n: "Très calme et grave",  r: 0.75, p: 0.82 },
  { k: "doux",   n: "Doux et posé",         r: 0.85, p: 0.95 },
  { k: "clair",  n: "Clair et neutre",      r: 0.95, p: 1.00 },
  { k: "chaud",  n: "Chaleureux et lent",   r: 0.80, p: 0.90 },
  { k: "libre",  n: "Réglage personnalisé", r: null, p: null }
];
function renderTones() {
  var c = $("#tones"); c.innerHTML = "";
  TONES.forEach(function (t) {
    var row = el("div", "opt" + (S.tone === t.k ? " sel" : ""));
    row.appendChild(el("div", "nm", t.n));
    row.onclick = function () {
      S.tone = t.k;
      if (t.r) { S.rate = t.r; S.pitch = t.p; }
      save(); renderTones(); syncSliders();
    };
    c.appendChild(row);
  });
}
function renderVoiceMode() {
  var w = $("#voice-mode-wrap"), b = $("#b-voice-mode"); if (!w) return;
  var any = LISTE.some(function (s) { return hasVoice(s.id); });
  w.style.display = any ? "block" : "none";
  if (!any) return;
  var on = S.useVoice !== false;
  b.textContent = on ? "Utiliser plutôt une voix du téléphone" : "Utiliser la voix enregistrée";
  $("#voice-mode-state").textContent = on
    ? "Vous écoutez la voix enregistrée par la responsable de l'étude."
    : "Vous écoutez une voix de synthèse du téléphone.";
}
function renderDurees() {
  var c = $("#durees"); if (!c) return; c.innerHTML = "";
  [15, 20, 25, 30].forEach(function (d) {
    var b = el("button", S.duree === d ? "sel" : "", d + " min");
    b.onclick = function () { S.duree = d; save(); renderDurees(); renderList(); };
    c.appendChild(b);
  });
}
function syncSliders() {
  $("#r-rate").value = S.rate; $("#r-pitch").value = S.pitch; $("#r-vol").value = S.vol; $("#r-avol").value = S.ambVol;
  $("#v-rate").textContent = Math.round(S.rate * 100) + " %";
  $("#v-pitch").textContent = S.pitch.toFixed(2);
  $("#v-vol").textContent = Math.round(S.vol * 100) + " %";
  $("#v-avol").textContent = Math.round(S.ambVol * 200) + " %";
  $("#s-amb").value = S.amb;
}
function utter(text) {
  var u = new SpeechSynthesisUtterance(text);
  var v = currentVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "fr-FR"; }
  u.rate = S.rate; u.pitch = S.pitch; u.volume = S.vol;
  return u;
}
function testVoice(v) {
  if (!synth) return;
  synth.cancel();
  if (v) { S.voiceURI = v.voiceURI; save(); renderVoices(); }
  var u = utter("Installez-vous confortablement. Respirez lentement… et laissez vos épaules descendre.");
  synth.speak(u);
}

/* ------------------------------------------------------- fond sonore */
var AC = null, ambNodes = null;
function ambStart() {
  if (S.amb === "none" || ambNodes) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    var out = AC.createGain(); out.gain.value = S.ambVol; out.connect(AC.destination);
    var nodes = { out: out, list: [] };

    if (S.amb === "bourdon") {
      [55, 82.5, 110].forEach(function (fq, i) {
        var o = AC.createOscillator(), g = AC.createGain();
        o.type = "sine"; o.frequency.value = fq; g.gain.value = i === 0 ? 0.5 : 0.16;
        o.connect(g); g.connect(out); o.start(); nodes.list.push(o);
      });
      var lfo = AC.createOscillator(), lg = AC.createGain();
      lfo.frequency.value = 0.07; lg.gain.value = 0.35; lfo.connect(lg); lg.connect(out.gain); lfo.start(); nodes.list.push(lfo);
    } else {
      var len = AC.sampleRate * 4, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0), b0 = 0, b1 = 0, b2 = 0;
      for (var i2 = 0; i2 < len; i2++) {                      // bruit rose approximé
        var w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
        d[i2] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
      }
      var src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
      var flt = AC.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = S.amb === "vagues" ? 500 : 900;
      src.connect(flt); flt.connect(out); src.start(); nodes.list.push(src);
      if (S.amb === "vagues") {
        var lf = AC.createOscillator(), lg2 = AC.createGain();
        lf.frequency.value = 0.09; lg2.gain.value = S.ambVol * 0.85;
        lf.connect(lg2); lg2.connect(out.gain); lf.start(); nodes.list.push(lf);
      }
    }
    ambNodes = nodes;
  } catch (e) { ambNodes = null; }
}
function ambStop() {
  if (!ambNodes) return;
  try { ambNodes.list.forEach(function (n) { try { n.stop(); } catch (e) {} }); ambNodes.out.disconnect(); } catch (e) {}
  ambNodes = null;
}
function ambSync() { if (ambNodes) { try { ambNodes.out.gain.value = S.ambVol; } catch (e) {} } }

/* ------------------------------------------------------------ lecteur */
var P = { id: 0, segs: [], i: 0, playing: false, elapsed: 0, est: 0, timer: null, pauseT: null, pauseEnd: 0, pauseLeft: 0, before: null, wake: null, started: 0 };

function openSeance(id) {
  var s = LISTE.filter(function (x) { return x.id === id; })[0];
  if (!s) return;
  stopAll();
  P.voice = hasVoice(id) && S.useVoice !== false;
  var b = build(s.texte, S.duree, S.rate, P.voice ? audioMeta(id) : null);
  P.id = id; P.segs = b.segs; P.i = 0; P.elapsed = 0; P.before = null; P.started = 0;
  P.est = b.est / 1000;
  $("#pl-title").textContent = s.titre;
  $("#pl-theme").textContent = "Séance " + id + " · " + s.theme + (P.voice ? " · voix enregistrée" : "");
  $("#pl-line").textContent = s.objectif;
  $("#pl-line").classList.remove("silence");
  $("#t-tot").textContent = mmss(P.est);
  $("#t-cur").textContent = "00:00";
  ring(0);
  go("play");
}
function ring(f) { $("#ring").setAttribute("stroke-dashoffset", String(289 - 289 * Math.min(1, Math.max(0, f)))); }

function playPause() {
  if (!synth && !P.voice) { toast("La synthèse vocale n'est pas disponible sur cet appareil."); return; }
  if (P.playing) { doPause(); return; }
  if (P.i === 0 && P.before === null) { askScale("avant", function (v) { P.before = v; startPlay(); }); return; }
  startPlay();
}
function startPlay() {
  P.playing = true;
  if (!P.started) P.started = Date.now();
  $("#ic-play").style.display = "none"; $("#ic-pause").style.display = "";
  $("#pl-wrap").classList.add("playing");
  ambStart(); wakeOn();
  if (!P.timer) P.timer = setInterval(tick, 250);
  if (P.pauseLeft > 0) { runPause(P.pauseLeft); P.pauseLeft = 0; }
  else if (P.resumeAudio) { P.resumeAudio = false; var au = $("#au"); au.volume = S.vol; au.play().catch(function () { next(); }); }
  else if (P.queue && P.queue.length) { var q = P.queue; P.queue = null; speakBlock(q); }
  else next();
}
function doPause() {
  P.playing = false;
  $("#ic-play").style.display = ""; $("#ic-pause").style.display = "none";
  $("#pl-wrap").classList.remove("playing");
  if (P.pauseT) { clearTimeout(P.pauseT); P.pauseT = null; P.pauseLeft = Math.max(0, P.pauseEnd - Date.now()); }
  try { synth.cancel(); } catch (e) {}
  var au = $("#au"); if (au && !au.paused) { au.pause(); P.resumeAudio = true; }
  ambStop(); wakeOff();
}
function stopAll() {
  P.playing = false;
  if (P.timer) { clearInterval(P.timer); P.timer = null; }
  if (P.pauseT) { clearTimeout(P.pauseT); P.pauseT = null; }
  P.pauseLeft = 0; P.resumeAudio = false; P.queue = null;
  try { if (synth) synth.cancel(); } catch (e) {}
  var a2 = $("#au"); if (a2) { try { a2.pause(); a2.removeAttribute("src"); a2.load(); } catch (e) {} }
  ambStop(); wakeOff();
  $("#ic-play").style.display = ""; $("#ic-pause").style.display = "none";
  $("#pl-wrap").classList.remove("playing");
}
function tick() {
  if (!P.playing) return;
  P.elapsed += 0.25;
  $("#t-cur").textContent = mmss(P.elapsed);
  ring(P.segs.length ? P.i / P.segs.length : 0);
  try { if (synth.speaking && !synth.paused) { synth.resume(); } } catch (e) {}
}
function next() {
  if (!P.playing) return;
  if (P.i >= P.segs.length) { finish(); return; }
  var g = P.segs[P.i++];
  if (g.t === "p") { $("#pl-line").textContent = "…"; $("#pl-line").classList.add("silence"); runPause(g.ms); return; }
  $("#pl-line").classList.remove("silence");
  $("#pl-line").textContent = g.text;
  var src = P.voice ? audioSrc(P.id, g.k) : null;
  if (src) { playAudio(src, g); return; }
  speakBlock(g.sent || [g.text]);
}
/* lecture de la voix enregistrée ; repli automatique sur la synthèse en cas d'échec */
function playAudio(src, g) {
  var au = $("#au"), done = false;
  var go2 = function () { if (done) return; done = true; au.onended = au.onerror = null; setTimeout(next, 140); };
  au.onended = go2;
  au.onerror = function () { if (done) return; done = true; au.onended = null; speakBlock(g.sent || [g.text]); };
  au.volume = S.vol;
  au.src = src;
  au.play().catch(function () { if (!done) { done = true; speakBlock(g.sent || [g.text]); } });
}
/* lecture par synthèse vocale, phrase par phrase */
function speakBlock(sentences) {
  var q = sentences.slice();
  P.queue = q;
  (function step() {
    if (!P.playing) return;
    if (!q.length) { setTimeout(next, 120); return; }
    var txt = q.shift(), u = utter(txt), done = false;
    u.onend = function () { if (done) return; done = true; setTimeout(step, 90); };
    u.onerror = function () { if (done) return; done = true; setTimeout(step, 90); };
    try { synth.speak(u); } catch (e) { setTimeout(step, 200); }
    var guard = Math.max(4000, (txt.split(/\s+/).length / (150 * S.rate)) * 60000 * 2.2 + 3000);
    setTimeout(function () { if (!done && P.playing) { done = true; try { synth.cancel(); } catch (e) {} step(); } }, guard);
  })();
}
function runPause(ms) {
  ms = ms / ((window.RM && window.RM.speed) || 1);      // accélérateur (tests uniquement)
  P.pauseEnd = Date.now() + ms;
  P.pauseT = setTimeout(function () { P.pauseT = null; next(); }, ms);
}
function finish() {
  var secs = Math.round(P.elapsed);
  stopAll(); ring(1);
  $("#pl-line").classList.remove("silence");
  $("#pl-line").textContent = "Séance terminée. Prenez le temps de vous relever doucement.";
  askScale("apres", function (after, note) {
    var id = P.id, d = S.done[id] || { first: 0, count: 0, sec: 0 };
    if (!d.first) d.first = Date.now();
    d.count++; d.sec += secs; d.before = P.before; d.after = after; d.note = note || "";
    S.done[id] = d;
    S.events.push({ ts: Date.now(), id: id, sec: secs, before: P.before, after: after, note: note || "", complete: 1 });
    save(); renderList(); renderLog();
    setTimeout(function () { syncNow(true); }, 900);      // transmission automatique
    var nid = id + 1;
    if (nid <= LISTE.length) toast("Bravo ! La séance " + nid + " sera disponible " + humanDelay(remain(nid)) + ".");
    else toast("Programme terminé. Bravo !");
    setTimeout(function () { go("home"); }, 900);
  });
}

/* ---------------------------------------------------- écran / wake lock */
function wakeOn() {
  try { if ("wakeLock" in navigator && !P.wake) navigator.wakeLock.request("screen").then(function (w) { P.wake = w; }).catch(function () {}); } catch (e) {}
}
function wakeOff() { try { if (P.wake) { P.wake.release(); P.wake = null; } } catch (e) {} }

/* ------------------------------------------------------- échelle 0-10 */
var scaleCb = null, scaleVal = null;
function askScale(kind, cb) {
  scaleCb = cb; scaleVal = null;
  $("#sh-title").textContent = kind === "avant" ? "Avant la séance" : "Après la séance";
  $("#sh-sub").innerHTML = "Votre niveau de détente actuel<br>0 = très tendue &nbsp;•&nbsp; 10 = parfaitement détendue";
  $("#sh-note").style.display = kind === "apres" ? "block" : "none";
  $("#sh-note").value = "";
  var c = $("#sh-scale"); c.innerHTML = "";
  for (var i = 0; i <= 10; i++) (function (n) {
    var b = el("button", "", String(n));
    b.onclick = function () { scaleVal = n; $$("#sh-scale button").forEach(function (x) { x.classList.remove("sel"); }); b.classList.add("sel"); };
    c.appendChild(b);
  })(i);
  $("#sheet").classList.add("on");
}
function closeScale(send) {
  $("#sheet").classList.remove("on");
  var cb = scaleCb; scaleCb = null;
  if (cb) cb(send ? scaleVal : null, $("#sh-note").value.trim());
}

/* ----------------------------------------------------------- rendu UI */
function renderList() {
  var c = $("#list"); c.innerHTML = "";
  var nextLocked = null;
  LISTE.forEach(function (s) {
    var open = isOpen(s.id), done = isDone(s.id);
    var b = el("button", "seance" + (done ? " done" : "") + (open ? "" : " lock"));
    var num = el("div", "num", done ? "✓" : (open ? String(s.id) : "🔒"));
    b.appendChild(num);
    var mid = el("div");
    mid.appendChild(el("div", "ti", s.titre + (s.canevas ? '<span class="badge">canevas</span>' : "")));
    var sub = done ? "Faite le " + new Date(S.done[s.id].first).toLocaleDateString("fr-FR") + " · " + (S.done[s.id].count > 1 ? S.done[s.id].count + " écoutes" : "1 écoute")
            : open ? s.theme + " · env. " + Math.round(build(s.texte, S.duree, S.rate, (hasVoice(s.id) && S.useVoice !== false) ? audioMeta(s.id) : null).est / 60000) + " min" + (hasVoice(s.id) && S.useVoice !== false ? " · voix enregistrée" : "")
            : (remain(s.id) === Infinity ? "Terminez la séance " + (s.id - 1) : "Disponible " + humanDelay(remain(s.id)));
    mid.appendChild(el("div", "su", sub));
    b.appendChild(mid);
    b.appendChild(el("div", "arr", open ? "›" : ""));
    if (open) b.onclick = function () { openSeance(s.id); };
    else { b.onclick = function () { toast(remain(s.id) === Infinity ? "Terminez d'abord la séance précédente." : "Cette séance sera disponible " + humanDelay(remain(s.id)) + "."); };
           if (!nextLocked) nextLocked = s; }
    c.appendChild(b);
  });
  var nb = LISTE.filter(function (s) { return isDone(s.id); }).length;
  $("#hello").textContent = "Bonjour";
  $("#sub-code").textContent = (S.pid ? S.pid + " · " : "") + nb + " / " + LISTE.length + " séances";
  if (nextLocked && remain(nextLocked.id) !== Infinity) {
    $("#next-card").style.display = "block";
    $("#next-txt").innerHTML = "<b>" + nextLocked.titre + "</b> — disponible " + humanDelay(remain(nextLocked.id)) + ".";
  } else $("#next-card").style.display = "none";
}

function renderLog() {
  var ids = Object.keys(S.done);
  var totSec = 0, gains = [];
  S.events.forEach(function (e) { totSec += e.sec || 0; if (typeof e.before === "number" && typeof e.after === "number") gains.push(e.after - e.before); });
  $("#st-done").textContent = ids.length;
  $("#st-min").textContent = Math.round(totSec / 60);
  $("#st-gain").textContent = gains.length ? "+" + (gains.reduce(function (a, b) { return a + b; }, 0) / gains.length).toFixed(1) : "—";
  var t = $("#log-table");
  if (!S.events.length) { t.innerHTML = '<p class="muted">Aucune séance enregistrée pour l\'instant.</p>'; return; }
  var h = "<table><tr><th>Date</th><th>Séance</th><th>Durée</th><th>Av.</th><th>Ap.</th></tr>";
  S.events.slice().reverse().forEach(function (e) {
    var s = LISTE.filter(function (x) { return x.id === e.id; })[0];
    h += "<tr><td>" + new Date(e.ts).toLocaleDateString("fr-FR") + "</td><td>" + e.id + ". " + (s ? s.titre : "") +
         "</td><td>" + Math.round((e.sec || 0) / 60) + " min</td><td>" + (e.before == null ? "—" : e.before) + "</td><td>" + (e.after == null ? "—" : e.after) + "</td></tr>";
  });
  t.innerHTML = h + "</table>";
}

/* ------------------------------------------------------------- export */
function csv() {
  var L = ["code;seance_id;seance_titre;date;heure;duree_minutes;detente_avant;detente_apres;gain;remarque"];
  S.events.forEach(function (e) {
    var s = LISTE.filter(function (x) { return x.id === e.id; })[0], d = new Date(e.ts);
    var g = (typeof e.before === "number" && typeof e.after === "number") ? (e.after - e.before) : "";
    L.push([S.pid, e.id, '"' + (s ? s.titre : "") + '"', d.toISOString().slice(0, 10),
            d.toTimeString().slice(0, 5), (e.sec / 60).toFixed(1).replace(".", ","),
            e.before == null ? "" : e.before, e.after == null ? "" : e.after, g,
            '"' + String(e.note || "").replace(/"/g, "'") + '"'].join(";"));
  });
  return L.join("\n");
}
function saveAs(content, name, mime) {
  var blob = new Blob([content], { type: mime });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
function download() {
  if (!S.events.length) { toast("Aucune donnée à exporter pour l'instant."); return; }
  saveAs("﻿" + csv(), "relaxmind_" + (S.pid || "participante") + "_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8");
  toast("Fichier CSV généré.");
}
/* Sauvegarde chiffrée : lisible uniquement avec la clé de la responsable d'étude. */
function secureBackup() {
  if (!VAULT) { toast("Application verrouillée."); return; }
  if (!VAULT.wrapAdmin) { toast("Aucune clé de secours n'a été configurée pour cette étude."); return; }
  var pack = {
    format: "RELAX-MIND-BACKUP", v: 2, pid: VAULT.pid, fp: VAULT.fp || "",
    exported: new Date().toISOString(), wrapAdmin: VAULT.wrapAdmin, data: VAULT.data
  };
  saveAs(JSON.stringify(pack, null, 1), "relaxmind_" + VAULT.pid + "_" + new Date().toISOString().slice(0, 10) + ".rmx", "application/json");
  toast("Sauvegarde chiffrée générée.");
}

/* ================================================== AUTHENTIFICATION ==== */
function findRecord(code) {
  for (var i = 0; i < COHORTE.length; i++) {
    var p = COHORTE[i];
    if (code === RMC.norm(p.pid) || code.indexOf(RMC.norm(p.pid) + "-") === 0) return p;
  }
  return null;
}
function tryState() {
  var t = { n: 0, until: 0 };
  try { var r = JSON.parse(LS.getItem(KTRY) || "null"); if (r) t = r; } catch (e) {}
  return t;
}
function tryBump(bad) {
  var t = tryState();
  if (!bad) { t = { n: 0, until: 0 }; }
  else {
    t.n++;
    if (t.n >= 3) t.until = Date.now() + Math.min(15 * 60000, Math.pow(2, Math.min(t.n - 2, 10)) * 1000);
  }
  try { LS.setItem(KTRY, JSON.stringify(t)); } catch (e) {}
  return t;
}
function codeErr(msg) {
  var e = $("#code-err");
  if (!msg) { e.style.display = "none"; return; }
  e.textContent = msg; e.style.display = "block";
}

function unlock(raw) {
  var code = RMC.norm(raw);
  codeErr("");
  if (!RMC.ok()) { codeErr("Ce navigateur ne permet pas de protéger vos données. Utilisez Chrome, Safari ou Firefox à jour."); return; }
  if (code.length < 4) { codeErr("Merci de saisir votre code d'accès complet."); return; }

  var t = tryState();
  if (t.until && Date.now() < t.until) {
    codeErr("Trop de tentatives. Réessayez dans " + Math.ceil((t.until - Date.now()) / 60000) + " minute(s).");
    return;
  }

  var v = readVault();
  var rec = findRecord(code);
  if (!rec && COHORTE.length && !(v && v.pid)) { fail("Ce code ne correspond à aucune participante de l'étude."); return; }

  var pid = v && v.pid ? v.pid : (rec ? rec.pid : code);
  var salt = v && v.salt ? v.salt : (rec ? rec.salt : RMC.b64(RMC.rnd(16)));
  var iter = (v && v.iter) || (rec && rec.iter) || ITER;

  $("#btn-start").textContent = "Vérification…";
  $("#btn-start").disabled = true;

  RMC.derive(code, salt, iter).then(function (d) {
    if (v && v.data) return openVault(v, d, pid);
    if (rec && rec.verif && d.ver !== rec.verif) throw new Error("bad");
    return createVault(pid, salt, iter, d);
  }).then(function () {
    tryBump(false);
    $("#btn-start").disabled = false;
    $("#btn-start").textContent = "Commencer le programme";
    afterUnlock();
  }).catch(function () {
    $("#btn-start").disabled = false;
    $("#btn-start").textContent = "Commencer le programme";
    fail("Code incorrect.");
  });
}
function fail(msg) {
  var t = tryBump(true);
  var extra = t.until && Date.now() < t.until ? " Attente de " + Math.ceil((t.until - Date.now()) / 1000) + " s." : "";
  if (t.n >= MAX_TRY) extra += " Contactez la responsable de l'étude.";
  codeErr(msg + extra);
}
function openVault(v, d, pid) {
  return RMC.aesDec(d.kek, v.wrapCode).then(function (dekRaw) {
    return RMC.importDEK(dekRaw).then(function (k) {
      DEK = k; VAULT = v;
      return RMC.decJSON(DEK, v.data).then(function (obj) {
        S = fresh(); for (var j in obj) S[j] = obj[j];
        S.pid = pid;
      });
    });
  });
}
function createVault(pid, salt, iter, d) {
  var dekRaw = RMC.rnd(32);
  return RMC.importDEK(dekRaw).then(function (k) {
    DEK = k;
    S = fresh(); S.pid = pid; S.code = pid; S.startedAt = Date.now();
    return RMC.aesEnc(d.kek, dekRaw).then(function (wc) {
      VAULT = { v: 2, pid: pid, salt: salt, iter: iter, wrapCode: wc, wrapAdmin: null, data: null, created: Date.now() };
      if (CFG.adminPubKey) {
        return RMC.importPub(CFG.adminPubKey)
          .then(function (pub) { return RMC.rsaEnc(pub, dekRaw); })
          .then(function (wa) { VAULT.wrapAdmin = wa; VAULT.fp = CFG.adminFingerprint || ""; });
      }
    });
  }).then(function () {
    return RMC.encJSON(DEK, S).then(function (box) { VAULT.data = box; writeVault(VAULT); });
  });
}
function lock() {
  stopAll();
  DEK = null; VAULT = null; S = fresh();
  $("#in-code").value = ""; codeErr("");
  paintStart();
  go("start");
}
var idleT = null;
function idleReset() {
  clearTimeout(idleT);
  if (!DEK || !LOCK_MIN) return;
  idleT = setTimeout(function () { if (!P.playing) lock(); else idleReset(); }, LOCK_MIN * 60000);
}
function paintStart() {
  var v = readVault(), known = !!(v && v.data);
  $("#card-onboard").style.display = known ? "none" : "block";
  $("#code-lbl").textContent = known ? "Déverrouillez l'application" : "Votre code d'accès";
  $("#code-help").style.display = known ? "none" : "block";
  $("#btn-start").textContent = known ? "Déverrouiller" : "Commencer le programme";
  $("#foot-secu").textContent = known ? "Vos données sont chiffrées sur cet appareil." : "Vos données restent uniquement sur votre téléphone.";
}
function afterUnlock() {
  $("#lk-min").textContent = String(LOCK_MIN);
  renderTones(); renderDurees(); syncSliders(); renderVoices(); renderSync(); renderVoiceMode();
  idleReset();
  go("home");
  if (S.syncPending || (S.events.length && !S.syncAt)) setTimeout(function () { syncNow(true); }, 1500);
}

/* ============================== TRANSMISSION AUTOMATIQUE (chiffrée) ====== */
/* Les données partent déjà chiffrées avec la clé publique de la responsable
   d'étude : le serveur ne stocke que du contenu illisible pour lui.
   Il n'a d'ailleurs aucun droit de lecture (politique RLS « insertion seule »). */
var SYNC = CFG.sync || null;
var syncing = false;

function syncPossible() { return !!(SYNC && SYNC.url && SYNC.key && VAULT && VAULT.wrapAdmin); }
function syncPayload() {
  return {
    pid: VAULT.pid, fp: VAULT.fp || "",
    n_events: (S.events || []).length,
    n_done: Object.keys(S.done || {}).length,
    app: VERSION,
    payload: { format: "RELAX-MIND-BACKUP", v: 2, wrapAdmin: VAULT.wrapAdmin, data: VAULT.data }
  };
}
function syncNow(silent) {
  if (!syncPossible() || syncing) return Promise.resolve(false);
  if (!navigator.onLine) { S.syncPending = true; save(); renderSync(); return Promise.resolve(false); }
  syncing = true; renderSync("en cours");
  var body = syncPayload();
  return fetch(SYNC.url.replace(/\/+$/, "") + "/rest/v1/" + (SYNC.table || "rm_uploads"), {
    method: "POST", mode: "cors", cache: "no-store", referrerPolicy: "no-referrer",
    headers: { "Content-Type": "application/json", "apikey": SYNC.key, "Authorization": "Bearer " + SYNC.key, "Prefer": "return=minimal" },
    body: JSON.stringify(body)
  }).then(function (r) {
    syncing = false;
    if (!r.ok) throw new Error("HTTP " + r.status);
    S.syncAt = Date.now(); S.syncPending = false; save(); renderSync();
    if (!silent) toast("Données transmises à la responsable de l'étude.");
    return true;
  }).catch(function () {
    syncing = false; S.syncPending = true; save(); renderSync();
    if (!silent) toast("Envoi impossible pour l'instant : il se fera automatiquement dès le retour du réseau.");
    return false;
  });
}
function renderSync(state) {
  var e = $("#sync-state"); if (!e) return;
  if (!syncPossible()) { e.textContent = "Transmission automatique non configurée pour cette étude."; return; }
  if (state === "en cours") { e.textContent = "Envoi en cours…"; return; }
  if (S.syncPending) { e.innerHTML = "<b style='color:var(--warn)'>En attente de réseau.</b> L'envoi se fera tout seul dès que possible.";  return; }
  e.textContent = S.syncAt ? "Dernier envoi : " + new Date(S.syncAt).toLocaleString("fr-FR") : "Aucun envoi effectué pour l'instant.";
}

/* ------------------------------------------------------------ routage */
function go(v) {
  if (v !== "start" && !DEK) v = "start";
  stopAllIfLeaving(v);
  $$(".view").forEach(function (s) { s.classList.remove("on"); });
  $("#v-" + v).classList.add("on");
  $("#nav").style.display = (v === "start") ? "none" : "flex";
  $$("#nav button").forEach(function (b) { b.classList.toggle("on", b.dataset.go === v); });
  window.scrollTo(0, 0);
  if (v === "home") renderList();
  if (v === "log") renderLog();
}
function stopAllIfLeaving(v) { if (v !== "play") stopAll(); }

/* ------------------------------------------------------------ init UI */
function init() {
  $("#ver").textContent = "RELAX MIND · version " + VERSION + " · " + LISTE.length + " séances";

  $("#btn-start").onclick = function () { unlock($("#in-code").value); };
  $("#in-code").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(this.value); });
  $("#in-code").addEventListener("input", function () { codeErr(""); });
  $("#b-lock").onclick = lock;
  ["click", "touchstart", "keydown"].forEach(function (ev) {
    document.addEventListener(ev, function () { if (DEK) idleReset(); }, { passive: true });
  });
  $("#btn-back").onclick = function () { go("home"); };
  $("#b-play").onclick = playPause;
  $("#b-stop").onclick = function () { stopAll(); P.i = 0; P.elapsed = 0; ring(0); $("#t-cur").textContent = "00:00"; $("#pl-line").textContent = "Lecture arrêtée."; };
  $("#b-amb").onclick = function () {
    var order = ["none", "souffle", "vagues", "bourdon"], i = (order.indexOf(S.amb) + 1) % order.length;
    S.amb = order[i]; save(); syncSliders(); ambStop(); if (P.playing) ambStart();
    toast("Fond sonore : " + ({ none: "aucun", souffle: "souffle continu", vagues: "vagues lentes", bourdon: "bourdon grave" })[S.amb]);
  };
  $$("#nav button").forEach(function (b) { b.onclick = function () { go(b.dataset.go); }; });

  $("#r-rate").oninput = function () { S.rate = +this.value; S.tone = "libre"; save(); syncSliders(); renderTones(); };
  $("#r-pitch").oninput = function () { S.pitch = +this.value; S.tone = "libre"; save(); syncSliders(); renderTones(); };
  $("#r-vol").oninput = function () { S.vol = +this.value; save(); syncSliders(); };
  $("#r-avol").oninput = function () { S.ambVol = +this.value; save(); syncSliders(); ambSync(); };
  $("#s-amb").onchange = function () { S.amb = this.value; save(); ambStop(); if (P.playing) ambStart(); };
  $("#b-test").onclick = function () { testVoice(null); };

  $("#b-csv").onclick = download;
  $("#b-copy").onclick = function () {
    if (!S.events.length) { toast("Aucune donnée à copier."); return; }
    var txt = csv();
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast("Données copiées."); }, function () { prompt("Copiez ces données :", txt); });
    else prompt("Copiez ces données :", txt);
  };
  $("#b-secure").onclick = secureBackup;
  $("#b-sync").onclick = function () { syncNow(false); };
  $("#b-voice-mode").onclick = function () {
    S.useVoice = (S.useVoice === false); save();
    toast(S.useVoice === false ? "Voix de synthèse du téléphone." : "Voix enregistrée de la responsable d'étude (si disponible).");
    renderList(); renderVoiceMode();
  };
  window.addEventListener("online", function () { if (S.syncPending) syncNow(true); });
  $("#b-reset").onclick = function () {
    if (!confirm("Effacer définitivement toutes vos données sur cet appareil ?\n\nPensez à envoyer votre sauvegarde avant.")) return;
    try { LS.removeItem(KEY); LS.removeItem(KTRY); } catch (e) {}
    mem = {}; location.reload();
  };
  $("#sh-ok").onclick = function () { if (scaleVal === null) { toast("Choisissez un chiffre de 0 à 10."); return; } closeScale(true); };
  $("#sh-skip").onclick = function () { closeScale(false); };

  renderTones(); renderDurees(); syncSliders();
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; setTimeout(loadVoices, 900); }
  else { $("#vx-none").style.display = "block"; }

  document.addEventListener("visibilitychange", function () { if (document.hidden && P.playing) doPause(); });

  paintStart();
  go("start");
  if (!RMC.ok()) codeErr("Protection indisponible sur ce navigateur : utilisez Chrome, Safari ou Firefox à jour, via une adresse https.");
  setInterval(function () { if ($("#v-home").classList.contains("on") && DEK) renderList(); }, 60000);

  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

/* Aucun contournement du rythme de déverrouillage n'est exposé ici :
   la revue libre des 30 séances se fait dans la console d'administration. */
window.RM = { speed: 1, get state() { return S; }, seances: LISTE };
})();
