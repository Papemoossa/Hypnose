/* ==========================================================================
   RELAX MIND — application
   Aucune dépendance externe. Fonctionne hors connexion.

   v3.1 (2026-09) — Étape A : branchement sur la nouvelle base Supabase
     • envoyer()   : nouveau payload (seance_numero, seance_titre, voix_source,
                     app_version, appareil) ciblant la table `ecoute`.
     • tirerSync() : lecture depuis `ecoute` avec compatibilité rétro (accepte
                     l'ancien champ seance_id des lignes rm_seances existantes).
   Le reste est identique à la v3.0.
   ========================================================================== */
(function () {
"use strict";

var CFG = window.RM_CONFIG || {};
var VERSION = CFG.version || "3.1.0";

/* ═══════════════════════════════ OUTILS ═══════════════════════════════ */
var $  = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
function mmss(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
function jour(ts) { return new Date(ts).toLocaleDateString("fr-FR"); }
function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("on"); }, 3000); }
function saveAs(c, nom, mime) {
  var b = c instanceof Blob ? c : new Blob([c], { type: mime || "text/plain;charset=utf-8" });
  var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = nom;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function moy(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
function n1(v) { return v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1); }

/* ── petite couche cryptographique (mot de passe administrateur) ── */
var SUB = window.crypto && window.crypto.subtle;
function b64u(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
function ub64(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function derive(mdp, saltB64, iter) {
  if (!SUB) return Promise.reject(new Error("crypto indisponible"));
  return SUB.importKey("raw", new TextEncoder().encode(mdp), "PBKDF2", false, ["deriveBits"])
    .then(function (k) { return SUB.deriveBits({ name: "PBKDF2", salt: b64u(saltB64), iterations: iter, hash: "SHA-256" }, k, 256); })
    .then(ub64);
}

/* ═══════════════════════════════ STOCKAGE ═══════════════════════════════ */
var CLE = "rm.db", CLE_SESS = "rm.session";
var memoire = {};
var LS = (function () {
  try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return localStorage; }
  catch (e) {
    return { getItem: function (k) { return k in memoire ? memoire[k] : null; },
             setItem: function (k, v) { memoire[k] = String(v); },
             removeItem: function (k) { delete memoire[k]; } };
  }
})();

function dbVide() {
  return {
    users: [], sessions: [], textes: {}, cadence: {}, jeux: [], clips: {},
    cfg: {
      delaiHeures: CFG.delaiHeures != null ? CFG.delaiHeures : 48,
      dureeDefaut: CFG.dureeDefaut || 20,
      etude: CFG.etude || "",
      sync: Object.assign({ actif: false, url: "", key: "", table: "ecoute" }, CFG.sync || {})
    },
    cree: Date.now()
  };
}
var DB = (function () {
  var d = dbVide();
  try { var r = JSON.parse(LS.getItem(CLE) || "null"); if (r) { for (var k in r) d[k] = r[k]; d.cfg = Object.assign(dbVide().cfg, r.cfg || {}); } } catch (e) {}
  return d;
})();

// v3.1 : migration douce du nom de table pour les installations existantes
if (DB.cfg && DB.cfg.sync && DB.cfg.sync.table === "rm_seances") {
  DB.cfg.sync.table = "ecoute";
}

var tSave = null;
function save() { clearTimeout(tSave); tSave = setTimeout(function () { try { LS.setItem(CLE, JSON.stringify(DB)); } catch (e) {} }, 200); }
function saveNow() { try { LS.setItem(CLE, JSON.stringify(DB)); } catch (e) {} }

/* compte de test toujours présent */
(function () {
  var t = CFG.compteTest || { pid: "TEST", pin: "0000" };
  if (!DB.users.some(function (u) { return u.pid === t.pid; })) {
    DB.users.unshift({ pid: t.pid, pin: t.pin, nom: t.nom || "Compte de test", groupe: "test", cree: Date.now(), test: true });
    save();
  }
})();

/* préférences par participante */
function prefs(pid) {
  var d = { voix: null, rate: 0.85, pitch: 0.95, sil: 1, vol: 1, duree: DB.cfg.dureeDefaut, fond: "none", fvol: 0.12 };
  try { var r = JSON.parse(LS.getItem("rm.prefs." + pid) || "null"); if (r) for (var k in r) d[k] = r[k]; } catch (e) {}
  return d;
}
function savePrefs(pid, p) { try { LS.setItem("rm.prefs." + pid, JSON.stringify(p)); } catch (e) {} }

/* ── IndexedDB : enregistrements audio ── */
var IDB = null;
function idb() {
  if (IDB) return Promise.resolve(IDB);
  return new Promise(function (res, rej) {
    var r = indexedDB.open("rm-audio", 1);
    r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains("clips")) d.createObjectStore("clips", { keyPath: "id" }); };
    r.onsuccess = function () { IDB = r.result; res(IDB); };
    r.onerror = function () { rej(r.error); };
  });
}
function clipSet(rec) { return idb().then(function (d) { return new Promise(function (res, rej) { var q = d.transaction("clips", "readwrite").objectStore("clips").put(rec); q.onsuccess = res; q.onerror = function () { rej(q.error); }; }); }); }
function clipGet(id) { return idb().then(function (d) { return new Promise(function (res) { var q = d.transaction("clips").objectStore("clips").get(id); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }); }
function clipDel(id) { return idb().then(function (d) { return new Promise(function (res) { var q = d.transaction("clips", "readwrite").objectStore("clips").delete(id); q.onsuccess = res; q.onerror = res; }); }); }
function clipAll() { return idb().then(function (d) { return new Promise(function (res) { var q = d.transaction("clips").objectStore("clips").getAll(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; }); }); }

/* ═══════════════════════════ TEXTES & DÉCOUPAGE ═══════════════════════════ */
var BASE = (typeof SEANCES !== "undefined" ? SEANCES : []).slice(0, 30);
function seance(sid) {
  var b = BASE.filter(function (s) { return s.id === sid; })[0] || {};
  var o = DB.textes[sid] || {};
  return {
    id: sid,
    titre: o.titre != null ? o.titre : b.titre,
    theme: o.theme != null ? o.theme : b.theme,
    objectif: o.objectif != null ? o.objectif : b.objectif,
    texte: o.texte != null ? o.texte : b.texte,
    canevas: /\[\[\[/.test(o.texte != null ? o.texte : (b.texte || ""))
  };
}
function toutes() { return BASE.map(function (s) { return seance(s.id); }); }

function decoupe(txt) {
  txt = String(txt || "").replace(/\[\[\[[\s\S]*?\]\]\]/g, "");
  var out = [], paras = txt.split(/\n\s*\n/);
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i].trim(); if (!p) continue;
    var parts = p.split(/(\[pause\s+\d+(?:\.\d+)?\])/i);
    for (var j = 0; j < parts.length; j++) {
      var seg = parts[j], m = seg.match(/^\[pause\s+(\d+(?:\.\d+)?)\]$/i);
      if (m) { out.push({ t: "p", ms: parseFloat(m[1]) * 1000 }); continue; }
      var c = seg.replace(/\s+/g, " ").trim(); if (!c) continue;
      phrases(c).forEach(function (x) { out.push({ t: "s", texte: x }); });
    }
    if (i < paras.length - 1) out.push({ t: "p", ms: 1400 });
  }
  return out;
}
function phrases(s) {
  var brut = s.match(/[^.!?…]+[.!?…]*\s*/g) || [s], res = [];
  brut.forEach(function (x) {
    x = x.trim(); if (!x) return;
    if (x.length <= 170) { res.push(x); return; }
    var ch = x.split(/,\s*/), cu = "";
    ch.forEach(function (c) { if ((cu + " " + c).length > 170 && cu) { res.push(cu.trim()); cu = c; } else cu = cu ? cu + ", " + c : c; });
    if (cu.trim()) res.push(cu.trim());
  });
  return res;
}
function blocs(txt) {
  var segs = decoupe(txt), out = [], k = -1, cur = null;
  segs.forEach(function (g) {
    if (g.t === "p") { if (cur) { out.push(cur); cur = null; } out.push({ t: "p", ms: g.ms }); }
    else { if (!cur) { k++; cur = { t: "s", k: k, phr: [] }; } cur.phr.push(g.texte); }
  });
  if (cur) out.push(cur);
  out.forEach(function (b) { if (b.t === "s") b.texte = b.phr.join(" "); });
  return out;
}
function msParole(b, rate) { return (b.texte.split(/\s+/).length / (150 * rate)) * 60000 + 260; }
function msBloc(b, rate, meta) {
  if (meta && meta[b.k] && meta[b.k].d) return meta[b.k].d * 1000 + 200;
  return msParole(b, rate);
}
function monter(txt, cible, rate, sil, meta) {
  var segs = blocs(txt), parole = 0, pause = 0;
  segs.forEach(function (g) { if (g.t === "p") { g.ms *= sil; pause += g.ms; } else parole += msBloc(g, rate, meta); });
  var besoin = cible * 60000 - parole;
  var f = (pause > 0 && besoin > pause) ? Math.min(6, besoin / pause) : 1;
  if (f > 1) segs.forEach(function (g) { if (g.t === "p") g.ms = Math.round(g.ms * f); });
  var total = 0; segs.forEach(function (g) { total += g.t === "p" ? g.ms : msBloc(g, rate, meta); });
  return { segs: segs, ms: total };
}
function cadence(sid, p) {
  var c = DB.cadence[sid];
  if (c && c.perso) return { rate: c.rate, sil: c.sil, duree: c.duree };
  return { rate: p.rate, sil: p.sil, duree: p.duree };
}

/* ═══════════════════════════════ VOIX ═══════════════════════════════ */
var synth = window.speechSynthesis, VOIX = [];
var FEM = ["amelie","amélie","aurelie","aurélie","audrey","virginie","hortense","julie","marie","chantal","celine","céline","female","femme","google français","charlotte","léa","lea","denise","eloise","éloise","brigitte","alice","siri voix 1"];
var MAS = ["thomas","daniel","nicolas","paul","claude","henri","antoine","male","homme","yannick","mathieu","jacques","rémi","remi","guillaume","alain","siri voix 2"];
function chargerVoix() {
  var all = synth ? synth.getVoices() : [];
  VOIX = all.filter(function (v) { return /^fr/i.test(v.lang); });
  if (!VOIX.length) VOIX = all.slice();
  if (ETAT.vue === "voix") rendreVoix();
}
function genre(v) {
  var n = (v.name + " " + (v.voiceURI || "")).toLowerCase();
  for (var i = 0; i < FEM.length; i++) if (n.indexOf(FEM[i]) > -1) return "f";
  for (var j = 0; j < MAS.length; j++) if (n.indexOf(MAS[j]) > -1) return "m";
  return "?";
}
function nomVoix(v) { return v.name.replace(/Microsoft |Google |\(.*?\)|français|Français|France|fr-FR/g, "").replace(/\s+/g, " ").trim() || v.name; }
function voixTTS() {
  var p = P();
  if (p.voix && p.voix.type === "tts") {
    for (var i = 0; i < VOIX.length; i++) if (VOIX[i].voiceURI === p.voix.uri) return VOIX[i];
  }
  return VOIX[0] || null;
}
function parler(txt, rate) {
  var u = new SpeechSynthesisUtterance(txt), v = voixTTS(), p = P();
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "fr-FR";
  u.rate = rate || p.rate; u.pitch = p.pitch; u.volume = p.vol;
  return u;
}

function metaJeu(jeuId, sid) {
  var m = {};
  Object.keys(DB.clips).forEach(function (id) {
    var pp = id.split(":");
    if (pp[0] === jeuId && +pp[1] === sid) m[+pp[2]] = DB.clips[id];
  });
  return m;
}
function jeuComplet(jeuId, sid) {
  var bl = blocs(seance(sid).texte).filter(function (b) { return b.t === "s"; });
  var m = metaJeu(jeuId, sid);
  return bl.length > 0 && bl.every(function (b) { return m[b.k]; });
}
function jeuxDisponibles(sid) {
  return DB.jeux.filter(function (j) { return jeuComplet(j.id, sid); });
}

/* ═══════════════════════════ FOND SONORE ═══════════════════════════ */
var AC = null, fondNodes = null;
function fondStart() {
  var p = P();
  if (p.fond === "none" || fondNodes) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    var out = AC.createGain(); out.gain.value = p.fvol; out.connect(AC.destination);
    var liste = [];
    if (p.fond === "bourdon") {
      [55, 82.5, 110].forEach(function (f, i) {
        var o = AC.createOscillator(), g = AC.createGain();
        o.type = "sine"; o.frequency.value = f; g.gain.value = i === 0 ? .5 : .16;
        o.connect(g); g.connect(out); o.start(); liste.push(o);
      });
    } else {
      var n = AC.sampleRate * 4, buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0), b0 = 0, b1 = 0, b2 = 0;
      for (var i2 = 0; i2 < n; i2++) {
        var w = Math.random() * 2 - 1;
        b0 = .99765 * b0 + w * .0990460; b1 = .96300 * b1 + w * .2965164; b2 = .57000 * b2 + w * 1.0526913;
        d[i2] = (b0 + b1 + b2 + w * .1848) * .16;
      }
      var src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
      var flt = AC.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = p.fond === "vagues" ? 500 : 900;
      src.connect(flt); flt.connect(out); src.start(); liste.push(src);
      if (p.fond === "vagues") {
        var lf = AC.createOscillator(), lg = AC.createGain();
        lf.frequency.value = .09; lg.gain.value = p.fvol * .85; lf.connect(lg); lg.connect(out.gain); lf.start(); liste.push(lf);
      }
    }
    fondNodes = { out: out, liste: liste };
  } catch (e) { fondNodes = null; }
}
function fondStop() {
  if (!fondNodes) return;
  try { fondNodes.liste.forEach(function (n) { try { n.stop(); } catch (e) {} }); fondNodes.out.disconnect(); } catch (e) {}
  fondNodes = null;
}

/* ═══════════════════════════════ ÉTAT ═══════════════════════════════ */
var ETAT = { role: null, pid: null, vue: null, admOnglet: "bord" };
function P() { return ETAT._p || (ETAT._p = prefs(ETAT.pid || "anon")); }
function majPrefs(f) { var p = P(); f(p); savePrefs(ETAT.pid, p); }
function moi() { return DB.users.filter(function (u) { return u.pid === ETAT.pid; })[0] || {}; }
function illimite() { return !!moi().test; }

function mesSessions(pid) {
  pid = pid || ETAT.pid;
  return DB.sessions.filter(function (s) { return s.pid === pid; });
}
function premiere(sid, pid) {
  var l = mesSessions(pid).filter(function (s) { return s.sid === sid; }).map(function (s) { return s.fin; });
  return l.length ? Math.min.apply(null, l) : 0;
}
function faite(sid, pid) { return !!premiere(sid, pid); }
function ouvreLe(sid, pid) {
  if (illimite()) return 0;
  if (sid <= 1) return 0;
  var p = premiere(sid - 1, pid);
  if (!p) return Infinity;
  return p + DB.cfg.delaiHeures * 3600000;
}
function ouverte(sid, pid) { return Date.now() >= ouvreLe(sid, pid); }
function reste(sid) { return Math.max(0, ouvreLe(sid) - Date.now()); }
function delaiTexte(ms) {
  if (!isFinite(ms)) return "";
  var h = Math.ceil(ms / 3600000);
  if (h >= 48) return "dans " + Math.ceil(h / 24) + " jours";
  if (h > 1) return "dans " + h + " heures";
  var mn = Math.ceil(ms / 60000);
  return "dans " + Math.max(1, mn) + " minute" + (mn > 1 ? "s" : "");
}

/* ═══════════════════════════════ LECTEUR ═══════════════════════════════ */
var L = { sid: 0, segs: [], i: 0, lit: false, ecoule: 0, total: 0, tick: null, tPause: null, finPause: 0, restePause: 0,
          avant: null, debut: 0, jeu: null, meta: null, file: null, wake: null, reprise: false };

function ouvrirSeance(sid) {
  var s = seance(sid); if (!s.titre) return;
  stopTout();
  var p = P(), c = cadence(sid, p);
  L.jeu = null; L.meta = null;
  if (p.voix && p.voix.type === "enr" && jeuComplet(p.voix.jeu, sid)) { L.jeu = p.voix.jeu; L.meta = metaJeu(L.jeu, sid); }
  var b = monter(s.texte, c.duree, c.rate, c.sil, L.meta);
  L.sid = sid; L.segs = b.segs; L.i = 0; L.ecoule = 0; L.avant = null; L.debut = 0; L.rate = c.rate;
  L.total = b.ms / 1000;
  $("#pl-titre").textContent = s.titre;
  $("#pl-theme").textContent = "Séance " + sid + " · " + s.theme + (L.jeu ? " · voix enregistrée" : "");
  $("#pl-phrase").textContent = s.objectif;
  $("#pl-phrase").classList.remove("silence");
  $("#t-tot").textContent = mmss(L.total);
  $("#t-cur").textContent = "00:00";
  arc(0); aller("lecteur");
}
function arc(f) { $("#pg-arc").setAttribute("stroke-dashoffset", String(283 - 283 * Math.min(1, Math.max(0, f)))); }

function lirePause() {
  if (!synth && !L.jeu) { toast("La synthèse vocale n'est pas disponible sur cet appareil."); return; }
  if (L.lit) { pause(); return; }
  if (L.i === 0 && L.avant === null) { echelle("avant", function (v) { L.avant = v; demarrer(); }); return; }
  demarrer();
}
function demarrer() {
  L.lit = true;
  if (!L.debut) L.debut = Date.now();
  $("#ic-lire").hidden = true; $("#ic-pause").hidden = false;
  $("#pl-wrap").classList.add("lit");
  fondStart(); wakeOn();
  if (!L.tick) L.tick = setInterval(battement, 250);
  if (L.restePause > 0) { attendre(L.restePause); L.restePause = 0; }
  else if (L.reprise) { L.reprise = false; var a = $("#au"); a.volume = P().vol; a.play().catch(function () { suivant(); }); }
  else if (L.file && L.file.length) { var q = L.file; L.file = null; direPhrases(q); }
  else suivant();
}
function pause() {
  L.lit = false;
  $("#ic-lire").hidden = false; $("#ic-pause").hidden = true;
  $("#pl-wrap").classList.remove("lit");
  if (L.tPause) { clearTimeout(L.tPause); L.tPause = null; L.restePause = Math.max(0, L.finPause - Date.now()); }
  try { if (synth) synth.cancel(); } catch (e) {}
  var a = $("#au"); if (a && !a.paused) { a.pause(); L.reprise = true; }
  fondStop(); wakeOff();
}
function stopTout() {
  L.lit = false;
  if (L.tick) { clearInterval(L.tick); L.tick = null; }
  if (L.tPause) { clearTimeout(L.tPause); L.tPause = null; }
  L.restePause = 0; L.reprise = false; L.file = null;
  try { if (synth) synth.cancel(); } catch (e) {}
  var a = $("#au"); if (a) { try { a.pause(); a.removeAttribute("src"); a.load(); } catch (e) {} }
  fondStop(); wakeOff();
  $("#ic-lire").hidden = false; $("#ic-pause").hidden = true;
  $("#pl-wrap").classList.remove("lit");
}
function battement() {
  if (!L.lit) return;
  L.ecoule += .25;
  $("#t-cur").textContent = mmss(L.ecoule);
  arc(L.segs.length ? L.i / L.segs.length : 0);
  try { if (synth && synth.speaking && !synth.paused) synth.resume(); } catch (e) {}
}
function suivant() {
  if (!L.lit) return;
  if (L.i >= L.segs.length) { terminer(); return; }
  var g = L.segs[L.i++];
  if (g.t === "p") { $("#pl-phrase").textContent = "…"; $("#pl-phrase").classList.add("silence"); attendre(g.ms); return; }
  $("#pl-phrase").classList.remove("silence");
  $("#pl-phrase").textContent = g.texte;
  if (L.jeu && L.meta && L.meta[g.k]) { jouerClip(L.jeu + ":" + L.sid + ":" + g.k, g); return; }
  direPhrases(g.phr || [g.texte]);
}
function jouerClip(id, g) {
  clipGet(id).then(function (r) {
    if (!r || !L.lit) { direPhrases(g.phr || [g.texte]); return; }
    var a = $("#au"), fini = false;
    var url = URL.createObjectURL(new Blob([r.data], { type: r.mime || "audio/webm" }));
    var fin = function () { if (fini) return; fini = true; a.onended = a.onerror = null; URL.revokeObjectURL(url); setTimeout(suivant, 140); };
    a.onended = fin;
    a.onerror = function () { if (fini) return; fini = true; URL.revokeObjectURL(url); direPhrases(g.phr || [g.texte]); };
    a.volume = P().vol; a.src = url;
    a.play().catch(function () { if (!fini) { fini = true; URL.revokeObjectURL(url); direPhrases(g.phr || [g.texte]); } });
  }).catch(function () { direPhrases(g.phr || [g.texte]); });
}
function direPhrases(liste) {
  var q = liste.slice(); L.file = q;
  (function etape() {
    if (!L.lit) return;
    if (!q.length) { L.file = null; setTimeout(suivant, 120); return; }
    var txt = q.shift(), u = parler(txt, L.rate), fini = false;
    u.onend = function () { if (fini) return; fini = true; setTimeout(etape, 90); };
    u.onerror = function () { if (fini) return; fini = true; setTimeout(etape, 90); };
    try { synth.speak(u); } catch (e) { setTimeout(etape, 200); }
    var garde = Math.max(4000, (txt.split(/\s+/).length / (150 * L.rate)) * 60000 * 2.2 + 3000);
    setTimeout(function () { if (!fini && L.lit) { fini = true; try { synth.cancel(); } catch (e) {} etape(); } }, garde);
  })();
}
function attendre(ms) {
  ms = ms / ((window.RM && window.RM.vitesse) || 1);
  L.finPause = Date.now() + ms;
  L.tPause = setTimeout(function () { L.tPause = null; suivant(); }, ms);
}
function terminer() {
  var duree = Math.round(L.ecoule), sid = L.sid, avant = L.avant, debut = L.debut;
  stopTout(); arc(1);
  $("#pl-phrase").classList.remove("silence");
  $("#pl-phrase").textContent = "Séance terminée. Prenez le temps de vous relever doucement.";
  echelle("apres", function (apres, etoiles, rem) {
    DB.sessions.push({
      id: "s" + Date.now() + Math.random().toString(36).slice(2, 7),
      pid: ETAT.pid, sid: sid,
      debut: debut || (Date.now() - duree * 1000), fin: Date.now(),
      duree: duree, avant: avant, apres: apres, etoiles: etoiles,
      remarque: rem || "", envoye: 0
    });
    saveNow(); rendreListe(); rendreJournal();
    envoyer(true);
    var nid = sid + 1;
    if (illimite()) toast("Séance enregistrée. Compte de test : aucune attente.");
    else if (nid <= 30) toast("Bravo ! La séance " + nid + " s'ouvrira " + delaiTexte(reste(nid)) + ".");
    else toast("Programme terminé. Bravo !");
    setTimeout(function () { aller("seances"); }, 900);
  });
}
function wakeOn() { try { if ("wakeLock" in navigator && !L.wake) navigator.wakeLock.request("screen").then(function (w) { L.wake = w; }).catch(function () {}); } catch (e) {} }
function wakeOff() { try { if (L.wake) { L.wake.release(); L.wake = null; } } catch (e) {} }

/* ═══════════════════════ FEUILLE D'ÉVALUATION ═══════════════════════ */
var fCB = null, fVal = null, fEt = null;
function echelle(genre_, cb) {
  fCB = cb; fVal = null; fEt = null;
  var apres = genre_ === "apres";
  $("#fe-titre").textContent = apres ? "Après la séance" : "Avant de commencer";
  $("#fe-sous").innerHTML = "Votre niveau de détente en ce moment<br><span style='opacity:.7'>0 = très tendue &nbsp;•&nbsp; 10 = parfaitement détendue</span>";
  $("#fe-etoiles-w").hidden = !apres;
  $("#fe-rem").hidden = !apres; $("#fe-rem").value = "";
  var c = $("#fe-ech"); c.innerHTML = "";
  for (var i = 0; i <= 10; i++) (function (n) {
    var b = el("button", "", String(n));
    b.onclick = function () { fVal = n; $$("#fe-ech button").forEach(function (x) { x.classList.remove("on"); }); b.classList.add("on"); };
    c.appendChild(b);
  })(i);
  var e = $("#fe-etoiles"); e.innerHTML = "";
  for (var j = 1; j <= 10; j++) (function (n) {
    var b = el("button", "", "★"); b.title = n + "/10";
    b.onclick = function () {
      fEt = n;
      $$("#fe-etoiles button").forEach(function (x, k) { x.classList.toggle("on", k < n); });
      $("#fe-note-txt").textContent = n + " / 10 — " + ["", "très faible", "faible", "insuffisant", "passable", "correct", "bien", "très bien", "excellent", "remarquable", "parfait"][n];
    };
    e.appendChild(b);
  })(j);
  $("#fe-note-txt").textContent = "Touchez les étoiles pour noter";
  $("#feuille").classList.add("on");
}
function fermerEchelle(valider) {
  $("#feuille").classList.remove("on");
  var cb = fCB; fCB = null;
  if (cb) cb(valider ? fVal : null, valider ? fEt : null, $("#fe-rem").value.trim());
}

/* ═══════════════════════════ VUES PARTICIPANTE ═══════════════════════════ */
function rendreListe() {
  var c = $("#liste-seances"); c.innerHTML = "";
  var prochaine = null, nb = 0;
  toutes().forEach(function (s) {
    var ok = ouverte(s.id), f = faite(s.id);
    if (f) nb++;
    var b = el("button", "seance" + (f ? " fait" : "") + (ok ? "" : " verrou"));
    b.appendChild(el("div", "num", f ? "✓" : (ok ? String(s.id) : "🔒")));
    var m = el("div", "", ""); m.style.flex = "1";
    m.appendChild(el("div", "ti", esc(s.titre) + (s.canevas ? '<span class="marque">canevas</span>' : "")));
    var p = P(), cd = cadence(s.id, p);
    var meta = (p.voix && p.voix.type === "enr" && jeuComplet(p.voix.jeu, s.id)) ? metaJeu(p.voix.jeu, s.id) : null;
    var sous = f ? "Faite le " + jour(premiere(s.id)) + " · " + mesSessions().filter(function (x) { return x.sid === s.id; }).length + " écoute(s)"
            : ok ? s.theme + " · env. " + Math.round(monter(s.texte, cd.duree, cd.rate, cd.sil, meta).ms / 60000) + " min"
            : (reste(s.id) === Infinity ? "Terminez la séance " + (s.id - 1) : "Disponible " + delaiTexte(reste(s.id)));
    m.appendChild(el("div", "su", sous));
    b.appendChild(m);
    b.appendChild(el("div", "fl", ok ? "›" : ""));
    if (ok) b.onclick = function () { ouvrirSeance(s.id); };
    else { b.onclick = function () { toast(reste(s.id) === Infinity ? "Terminez d'abord la séance précédente." : "Cette séance s'ouvrira " + delaiTexte(reste(s.id)) + "."); };
           if (!prochaine) prochaine = s; }
    c.appendChild(b);
  });
  var u = moi();
  $("#sous-titre").textContent = (ETAT.pid || "") + (u.test ? " · accès illimité" : "") + " · " + nb + " / 30 séances";
  anneau($("#anneau-prog"), nb / 30, nb);
  if (prochaine && reste(prochaine.id) !== Infinity && !illimite()) {
    $("#c-suivante").hidden = false;
    $("#txt-suivante").innerHTML = "<b>" + esc(prochaine.titre) + "</b> — disponible " + delaiTexte(reste(prochaine.id)) + ".";
  } else $("#c-suivante").hidden = true;
}
function anneau(box, frac, label) {
  var r = 27, C = 2 * Math.PI * r;
  box.innerHTML = '<svg width="64" height="64" viewBox="0 0 64 64">' +
    '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="4"/>' +
    '<circle cx="32" cy="32" r="' + r + '" fill="none" stroke="url(#gPg)" stroke-width="4" stroke-linecap="round" ' +
    'stroke-dasharray="' + C + '" stroke-dashoffset="' + (C - C * frac) + '" style="transition:stroke-dashoffset .9s var(--ease)"/></svg>' +
    '<b>' + label + '</b>';
}
function rendreJournal() {
  var ss = mesSessions().slice().sort(function (a, b) { return b.fin - a.fin; });
  var sids = {}; ss.forEach(function (s) { sids[s.sid] = 1; });
  var mins = ss.reduce(function (a, s) { return a + (s.duree || 0); }, 0) / 60;
  var gains = ss.filter(function (s) { return typeof s.avant === "number" && typeof s.apres === "number"; }).map(function (s) { return s.apres - s.avant; });
  var et = ss.filter(function (s) { return s.etoiles; }).map(function (s) { return s.etoiles; });
  $("#k-faites").textContent = Object.keys(sids).length;
  $("#k-min").textContent = Math.round(mins);
  $("#k-gain").textContent = gains.length ? "+" + n1(moy(gains)) : "—";
  $("#k-etoiles").textContent = et.length ? n1(moy(et)) : "—";
  var t = $("#tbl-journal");
  if (!ss.length) { t.innerHTML = '<p class="mut">Aucune séance enregistrée pour l\'instant.</p>'; return; }
  var h = "<table><tr><th>Date</th><th>Séance</th><th>Durée</th><th>Av.</th><th>Ap.</th><th>Note</th></tr>";
  ss.forEach(function (s) {
    h += "<tr><td>" + jour(s.fin) + "</td><td>" + s.sid + ". " + esc(seance(s.sid).titre) +
         "</td><td>" + Math.round((s.duree || 0) / 60) + " min</td><td>" + (s.avant == null ? "—" : s.avant) +
         "</td><td>" + (s.apres == null ? "—" : s.apres) + "</td><td>" + (s.etoiles ? s.etoiles + "★" : "—") + "</td></tr>";
  });
  t.innerHTML = h + "</table>";
  majEtatSync();
}
function rendreVoix() {
  var p = P();
  var dispo = DB.jeux.filter(function (j) { return toutes().some(function (s) { return jeuComplet(j.id, s.id); }); });
  $("#c-voix-enr").hidden = !dispo.length;
  var ce = $("#l-voix-enr"); ce.innerHTML = "";
  dispo.forEach(function (j) {
    var n = toutes().filter(function (s) { return jeuComplet(j.id, s.id); }).length;
    var sel = p.voix && p.voix.type === "enr" && p.voix.jeu === j.id;
    ce.appendChild(optionVoix(esc(j.nom), n + " séance(s) disponible(s)", sel, function () {
      majPrefs(function (x) { x.voix = { type: "enr", jeu: j.id }; }); rendreVoix(); rendreListe();
    }, null));
  });
  var f = $("#l-voix-f"), m = $("#l-voix-m"), a = $("#l-voix-a");
  f.innerHTML = ""; m.innerHTML = ""; a.innerHTML = "";
  $("#voix-vide").hidden = !!VOIX.length;
  VOIX.forEach(function (v) {
    var sel = p.voix && p.voix.type === "tts" && p.voix.uri === v.voiceURI;
    var row = optionVoix(esc(nomVoix(v)), v.lang + (v.localService ? " · hors ligne" : ""), sel, function () {
      majPrefs(function (x) { x.voix = { type: "tts", uri: v.voiceURI }; }); rendreVoix(); rendreListe();
    }, function () {
      try { synth.cancel(); } catch (e) {}
      majPrefs(function (x) { x.voix = { type: "tts", uri: v.voiceURI }; });
      synth.speak(parler("Installez-vous confortablement. Respirez lentement… et laissez vos épaules descendre."));
      rendreVoix();
    });
    (genre(v) === "f" ? f : genre(v) === "m" ? m : a).appendChild(row);
  });
  $("#w-voix-a").hidden = !a.children.length;
  if (!f.children.length) f.appendChild(el("p", "ptit", "Aucune voix féminine identifiée automatiquement."));
  if (!m.children.length) m.appendChild(el("p", "ptit", "Aucune voix masculine identifiée automatiquement."));
  $("#durees").innerHTML = "";
  [15, 20, 25, 30].forEach(function (d) {
    var b = el("button", p.duree === d ? "on" : "", d + " min");
    b.onclick = function () { majPrefs(function (x) { x.duree = d; }); rendreVoix(); rendreListe(); };
    $("#durees").appendChild(b);
  });
  $("#r-rate").value = p.rate; $("#r-pitch").value = p.pitch; $("#r-sil").value = p.sil;
  $("#r-vol").value = p.vol; $("#r-fvol").value = p.fvol; $("#s-fond").value = p.fond;
  $("#v-rate").textContent = Math.round(p.rate * 100) + " %";
  $("#v-pitch").textContent = p.pitch.toFixed(2);
  $("#v-sil").textContent = "× " + p.sil.toFixed(2);
  $("#v-vol").textContent = Math.round(p.vol * 100) + " %";
  $("#v-fvol").textContent = Math.round(p.fvol * 200) + " %";
}
function optionVoix(nom, sous, sel, onSel, onEssai) {
  var row = el("div", "carte mince");
  row.style.cssText = "display:flex;align-items:center;gap:11px;margin-bottom:8px;cursor:pointer;padding:11px 13px" +
    (sel ? ";border-color:var(--turquoise);background:rgba(56,176,168,.12)" : "");
  var d = el("div", "", "<div style='font-size:14px;font-weight:560'>" + nom + "</div><div class='ptit' style='opacity:.75'>" + esc(sous) + "</div>");
  d.style.flex = "1"; row.appendChild(d);
  if (onEssai) { var pv = el("button", "pas or", "Écouter"); pv.onclick = function (e) { e.stopPropagation(); onEssai(); }; row.appendChild(pv); }
  if (sel) row.appendChild(el("span", "pas ok", "choisie"));
  row.onclick = onSel;
  return row;
}

/* ═══════════════════════════ RPC SUPABASE (Étape C) ═══════════════════════════ */
function rpcSupabase(fn, params) {
  var url = supabaseUrl ? supabaseUrl() : (DB.cfg.sync.url || "").replace(/\/+$/, "");
  var key = supabaseKey ? supabaseKey() : (DB.cfg.sync.key || "");
  return fetch(url + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + key },
    body: JSON.stringify(params)
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}
/* ═══════════════════════════ AUTH SUPABASE (Étape B) ═══════════════════════════ */
function supabaseUrl() { return (DB.cfg.sync.url || "").replace(/\/+$/, ""); }
function supabaseKey() { return DB.cfg.sync.key || ""; }

function loginAdmin(email, mdp) {
  return fetch(supabaseUrl() + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseKey() },
    body: JSON.stringify({ email: email, password: mdp })
  }).then(function (r) {
    if (!r.ok) return r.json().then(function (b) { throw new Error(b.error_description || b.msg || "HTTP " + r.status); });
    return r.json();
  });
}

function verifierAdmin(token) {
  return fetch(supabaseUrl() + "/rest/v1/admin?select=id,nom_complet,role,actif&actif=eq.true", {
    headers: { apikey: supabaseKey(), Authorization: "Bearer " + token }
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function (rows) {
    if (!rows.length) throw new Error("Pas admin");
    return rows[0];
  });
}

function refreshToken(rt) {
  return fetch(supabaseUrl() + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: supabaseKey() },
    body: JSON.stringify({ refresh_token: rt })
  }).then(function (r) {
    if (!r.ok) throw new Error("refresh échoué");
    return r.json();
  });
}

function sauverSessionAdmin(data, adminInfo) {
  ETAT.token = data.access_token;
  ETAT.refreshToken = data.refresh_token;
  ETAT.adminId = data.user ? data.user.id : adminInfo.id;
  ETAT.adminNom = adminInfo.nom_complet;
  ETAT.adminRole = adminInfo.role;
  try {
    LS.setItem("rm.admin_session", JSON.stringify({
      token: data.access_token,
      refresh: data.refresh_token,
      adminId: ETAT.adminId,
      nom: adminInfo.nom_complet,
      role: adminInfo.role
    }));
  } catch (e) {}
}

function effacerSessionAdmin() {
  ETAT.token = null; ETAT.refreshToken = null;
  ETAT.adminId = null; ETAT.adminNom = null; ETAT.adminRole = null;
  try { LS.removeItem("rm.admin_session"); } catch (e) {}
}
/* ═══════════════════════════ TRANSMISSION SUPABASE ═══════════════════════════ */
/* v3.1 — nouveau payload pour la table `ecoute` de la nouvelle base RELAX MIND. */
function syncOK() { var s = DB.cfg.sync; return !!(s.actif && s.url && s.key); }
function envoyer(silencieux) {
  if (!syncOK()) { majEtatSync(); return Promise.resolve(0); }
  var att = DB.sessions.filter(function (s) { return !s.envoye; });
  if (!att.length) { majEtatSync(); return Promise.resolve(0); }
  if (!navigator.onLine) { majEtatSync(); return Promise.resolve(0); }
  var s = DB.cfg.sync;
  var corps = att.map(function (x) {
    // Récupérer les préférences de la participante pour connaître la voix utilisée
    var pp = null;
    try { pp = prefs(x.pid); } catch (e) {}
    var voixSource = (pp && pp.voix && pp.voix.type === "enr") ? "humain" : "synthese";
    return {
      ref:           x.id,
      pid:           x.pid,
      seance_numero: x.sid,
      seance_titre:  seance(x.sid).titre,
      voix_source:   voixSource,
      debut:         x.debut ? new Date(x.debut).toISOString() : null,
      fin:           new Date(x.fin).toISOString(),
      duree_sec:     x.duree,
      detente_avant: x.avant,
      detente_apres: x.apres,
      qualite_texte: x.etoiles,
      remarque:      x.remarque || "",
      app_version:   VERSION,
      appareil: {
        os: navigator.platform || "",
        ua: (navigator.userAgent || "").slice(0, 200)
      }
    };
  });
  return fetch(s.url.replace(/\/+$/, "") + "/rest/v1/" + (s.table || "ecoute"), {
    method: "POST", mode: "cors", cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      apikey: s.key,
      Authorization: "Bearer " + s.key,
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(corps)
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    att.forEach(function (x) { x.envoye = Date.now(); });
    saveNow(); majEtatSync();
    if (!silencieux) toast(att.length + " séance(s) transmise(s).");
    return att.length;
  }).catch(function (err) {
    majEtatSync();
    if (!silencieux) toast("Envoi impossible pour l'instant : il se fera automatiquement dès le retour du réseau.");
    // Diagnostic optionnel dans la console
    try { console.warn("[RELAX MIND] Envoi Supabase impossible :", err); } catch (e) {}
    return 0;
  });
}
function majEtatSync() {
  var e = $("#etat-sync"); if (!e) return;
  if (!syncOK()) { e.textContent = "Transmission automatique non activée. Vos données restent sur cet appareil."; return; }
  var n = DB.sessions.filter(function (s) { return s.pid === ETAT.pid && !s.envoye; }).length;
  e.innerHTML = n ? "<b style='color:var(--alerte)'>" + n + " séance(s) en attente de réseau.</b> L'envoi se fera tout seul."
                  : "Toutes vos séances ont été transmises.";
}

/* ═══════════════════════════ CSV ═══════════════════════════ */
function csvSessions(liste) {
  var L2 = ["identifiant;groupe;seance_id;titre;date;heure;duree_minutes;detente_avant;detente_apres;gain;qualite_texte_sur_10;remarque"];
  liste.forEach(function (x) {
    var u = DB.users.filter(function (y) { return y.pid === x.pid; })[0] || {};
    var d = new Date(x.fin);
    var g = (typeof x.avant === "number" && typeof x.apres === "number") ? (x.apres - x.avant) : "";
    L2.push([x.pid, u.groupe || "", x.sid, '"' + seance(x.sid).titre + '"',
             d.toISOString().slice(0, 10), d.toTimeString().slice(0, 5),
             ((x.duree || 0) / 60).toFixed(1).replace(".", ","),
             x.avant == null ? "" : x.avant, x.apres == null ? "" : x.apres, g,
             x.etoiles == null ? "" : x.etoiles,
             '"' + String(x.remarque || "").replace(/"/g, "'") + '"'].join(";"));
  });
  return "\uFEFF" + L2.join("\n");
}

/* ═══════════════════════════ ADMINISTRATION ═══════════════════════════ */
function admOnglet(t) {
  ETAT.admOnglet = t;
  $$("#ong-admin button").forEach(function (b) { b.classList.toggle("on", b.dataset.t === t); });
  $$(".adm-t").forEach(function (d) { d.hidden = d.id !== "t-" + t; });
  if (t === "bord") rendreBord();
  if (t === "users") rendreUsers();
  if (t === "textes") { rendreListeTextes(); chargerEditeur(); }
  if (t === "studio") { rendreJeux(); rendreListeStudio(); }
  if (t === "synthese") rendreSynthese();
  if (t === "reglages") rendreReglages();
  if (t !== "studio") stopEnr(true);
  if (t !== "textes") { try { synth.cancel(); } catch (e) {} }
  window.scrollTo(0, 0);
}
function statsUser(pid) {
  var ss = DB.sessions.filter(function (s) { return s.pid === pid; });
  var sids = {}; ss.forEach(function (s) { sids[s.sid] = 1; });
  var g = ss.filter(function (s) { return typeof s.avant === "number" && typeof s.apres === "number"; }).map(function (s) { return s.apres - s.avant; });
  var e = ss.filter(function (s) { return s.etoiles; }).map(function (s) { return s.etoiles; });
  return {
    faites: Object.keys(sids).length, ecoutes: ss.length,
    minutes: ss.reduce(function (a, s) { return a + (s.duree || 0); }, 0) / 60,
    gain: moy(g), etoiles: moy(e),
    derniere: ss.length ? Math.max.apply(null, ss.map(function (s) { return s.fin; })) : 0
  };
}
function rendreBord() {
  var us = DB.users.filter(function (u) { return !u.test; });
  var semaine = Date.now() - 7 * 864e5;
  var tous = DB.sessions.filter(function (s) { return s.pid !== "TEST"; });
  var gains = tous.filter(function (s) { return typeof s.avant === "number" && typeof s.apres === "number"; }).map(function (s) { return s.apres - s.avant; });
  $("#a-nb").textContent = us.length;
  $("#a-actives").textContent = us.filter(function (u) { return statsUser(u.pid).derniere > semaine; }).length;
  $("#a-seances").textContent = tous.length;
  $("#a-gain").textContent = gains.length ? "+" + n1(moy(gains)) : "—";
  var t = $("#tbl-progression");
  if (!DB.users.length) { t.innerHTML = '<p class="mut">Aucune participante enregistrée.</p>'; return; }
  var h = "<table><tr><th>Identifiant</th><th>Groupe</th><th style='min-width:130px'>Progression</th><th>Faites</th><th>Minutes</th><th>Gain</th><th>Note</th><th>Dernière</th></tr>";
  DB.users.forEach(function (u) {
    var s = statsUser(u.pid), pc = Math.round(s.faites / 30 * 100);
    h += "<tr><td class='mono'>" + esc(u.pid) + (u.test ? " <span class='pas or'>test</span>" : "") +
      "</td><td>" + esc(u.groupe || "—") +
      "</td><td><div class='barre'><i style='width:" + pc + "%'></i></div><span class='ptit'>" + pc + " %</span>" +
      "</td><td>" + s.faites + "/30</td><td>" + Math.round(s.minutes) + "</td><td>" + (s.gain == null ? "—" : "+" + n1(s.gain)) +
      "</td><td>" + (s.etoiles == null ? "—" : n1(s.etoiles) + "★") +
      "</td><td class='ptit'>" + (s.derniere ? jour(s.derniere) : "—") + "</td></tr>";
  });
  t.innerHTML = h + "</table>";
}
function rendreUsers() {
  $("#u-nb").textContent = DB.users.length;
  var t = $("#tbl-users");
  var h = "<tr><th>Identifiant T0</th><th>Code</th><th>Groupe</th><th>Créée</th><th>Séances</th><th></th></tr>";
  DB.users.forEach(function (u, i) {
    var s = statsUser(u.pid);
    h += "<tr><td class='mono'>" + esc(u.pid) + (u.test ? " <span class='pas or'>test</span>" : "") +
      "</td><td class='mono' style='color:var(--or)'>" + esc(u.pin) +
      "</td><td>" + esc(u.groupe || "—") + "</td><td class='ptit'>" + jour(u.cree) + "</td><td>" + s.faites + "/30</td>" +
      "<td style='white-space:nowrap'><button class='btn fant p' data-pin='" + i + "'>Nouveau code</button> " +
      (u.test ? "" : "<button class='btn fant p' data-del='" + i + "'>Retirer</button>") + "</td></tr>";
  });
  t.innerHTML = h;
  $$("#tbl-users [data-del]").forEach(function (b) {
    b.onclick = function () {
      var u = DB.users[+b.dataset.del];
      if (!confirm("Retirer " + u.pid + " de la cohorte ?\nSes évaluations déjà enregistrées sont conservées.")) return;
      DB.users.splice(+b.dataset.del, 1); saveNow(); rendreUsers(); rendreBord();
    };
  });
  $$("#tbl-users [data-pin]").forEach(function (b) {
    b.onclick = function () { DB.users[+b.dataset.pin].pin = pin4(); saveNow(); rendreUsers(); toast("Nouveau code : " + DB.users[+b.dataset.pin].pin); };
  });
}
function pin4() { var a = new Uint32Array(1); crypto.getRandomValues(a); return String(1000 + (a[0] % 9000)); }
function fichesHTML() {
  var h = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>RELAX MIND — identifiants</title><style>' +
    'body{font-family:Georgia,serif;margin:16mm}h1{font-size:15pt;letter-spacing:.1em}' +
    '.s{border:1px dashed #999;border-radius:8px;padding:13px 15px;margin:0 0 10px;page-break-inside:avoid}' +
    '.c{font-family:monospace;font-size:14pt;letter-spacing:.07em;margin:5px 0}' +
    '.n{font-size:9pt;color:#555;line-height:1.55}</style></head><body>' +
    "<h1>RELAX MIND — vos identifiants</h1><p style='font-size:9pt;color:#555'>" + esc(DB.cfg.etude) + "</p>";
  DB.users.filter(function (u) { return !u.test; }).forEach(function (u) {
    h += "<div class='s'><div class='n'>Participante</div>" +
      "<div class='c'>Identifiant : " + esc(u.pid) + "</div><div class='c'>Code : " + esc(u.pin) + "</div>" +
      "<div class='n'>Saisissez ces deux informations à chaque ouverture de l'application RELAX MIND. " +
      "Une nouvelle séance s'ouvre " + DB.cfg.delaiHeures + " heures après la précédente ; les séances déjà ouvertes restent accessibles autant de fois que vous le souhaitez. " +
      "En cas de perte, prévenez la responsable de l'étude.</div></div>";
  });
  return h + "</body></html>";
}

/* ─── textes & cadence ─── */
var tSel = 1;
function rendreListeTextes() {
  var c = $("#l-textes"); c.innerHTML = "";
  toutes().forEach(function (s) {
    var cd = DB.cadence[s.id];
    var b = el("button", s.id === tSel ? "on" : "",
      "<b>" + s.id + ". " + esc(s.titre) + "</b><div class='t2'>" + esc(s.theme || "") +
      (s.canevas ? " · canevas" : "") + (cd && cd.perso ? " · cadence propre" : "") +
      (DB.textes[s.id] ? " · modifié" : "") + "</div>");
    b.onclick = function () { tSel = s.id; rendreListeTextes(); chargerEditeur(); };
    c.appendChild(b);
  });
}
function chargerEditeur() {
  var s = seance(tSel);
  $("#t-titre").value = s.titre || ""; $("#t-theme").value = s.theme || "";
  $("#t-obj").value = s.objectif || ""; $("#t-texte").value = s.texte || "";
  var c = DB.cadence[tSel] || { perso: false, rate: .85, sil: 1, duree: DB.cfg.dureeDefaut };
  $("#c-perso").checked = !!c.perso;
  $("#c-rate").value = c.rate; $("#c-sil").value = c.sil; $("#c-duree").value = c.duree;
  majCadenceAff(); statTexte();
}
function majCadenceAff() {
  $("#c-v-rate").textContent = Math.round($("#c-rate").value * 100) + " %";
  $("#c-v-sil").textContent = "× " + (+$("#c-sil").value).toFixed(2);
  $("#c-v-duree").textContent = $("#c-duree").value + " min";
}
function statTexte() {
  var txt = $("#t-texte").value, segs = decoupe(txt);
  var mots = segs.filter(function (g) { return g.t === "s"; }).reduce(function (a, g) { return a + g.texte.split(/\s+/).length; }, 0);
  var sil = segs.filter(function (g) { return g.t === "p"; }).length;
  var b = monter(txt, +$("#c-duree").value, +$("#c-rate").value, +$("#c-sil").value, null);
  $("#t-stat").innerHTML = mots + " mots · " + sil + " silences · " + blocs(txt).filter(function (x) { return x.t === "s"; }).length +
    " blocs · ≈ " + Math.round(b.ms / 60000) + " min" + (/\[\[\[/.test(txt) ? " · <span style='color:var(--alerte)'>zone à compléter</span>" : "");
}
function sauverEditeur() {
  DB.textes[tSel] = { titre: $("#t-titre").value, theme: $("#t-theme").value, objectif: $("#t-obj").value, texte: $("#t-texte").value };
  DB.cadence[tSel] = { perso: $("#c-perso").checked, rate: +$("#c-rate").value, sil: +$("#c-sil").value, duree: +$("#c-duree").value };
  save(); statTexte(); rendreListeTextes();
}

/* ─── studio multi-voix ─── */
var ST = { jeu: null, sid: null, blocs: [], sel: 0, rec: null, morceaux: [], t0: 0, chrono: null, flux: null };
function mimeEnr() {
  var c = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i];
  return "";
}
function extDe(m) { return /ogg/.test(m) ? "ogg" : /mp4/.test(m) ? "m4a" : "webm"; }
function rendreJeux() {
  var s = $("#s-jeu"); s.innerHTML = "";
  if (!DB.jeux.length) { s.innerHTML = '<option value="">— aucun jeu de voix —</option>'; ST.jeu = null; }
  else {
    DB.jeux.forEach(function (j) { var o = el("option", "", esc(j.nom)); o.value = j.id; s.appendChild(o); });
    if (!ST.jeu || !DB.jeux.some(function (j) { return j.id === ST.jeu; })) ST.jeu = DB.jeux[0].id;
    s.value = ST.jeu;
  }
  $("#a-fmt").textContent = mimeEnr() ? extDe(mimeEnr()).toUpperCase() + " / Opus" : "non disponible sur ce navigateur";
}
function rendreListeStudio() {
  var c = $("#l-studio"); c.innerHTML = "";
  toutes().forEach(function (s) {
    var bl = blocs(s.texte).filter(function (b) { return b.t === "s"; });
    var m = ST.jeu ? metaJeu(ST.jeu, s.id) : {};
    var n = bl.filter(function (b) { return m[b.k]; }).length;
    var b = el("button", s.id === ST.sid ? "on" : "",
      "<b>" + s.id + ". " + esc(s.titre) + "</b><div class='t2'>" + n + "/" + bl.length + " blocs" +
      (n === bl.length && bl.length ? " <span style='color:var(--ok)'>✓</span>" : "") + "</div>");
    b.onclick = function () { choisirStudio(s.id); };
    c.appendChild(b);
  });
}
function choisirStudio(sid) {
  stopEnr(true);
  ST.sid = sid; ST.sel = 0;
  ST.blocs = blocs(seance(sid).texte).filter(function (b) { return b.t === "s"; });
  $("#st-titre").textContent = seance(sid).titre;
  rendreBlocs(); rendreListeStudio();
}
function rendreBlocs() {
  var t = $("#tbl-blocs");
  if (!ST.blocs.length) { t.innerHTML = "<tr><td class='mut'>Sélectionnez une séance.</td></tr>"; $("#st-bloc").textContent = "—"; return; }
  var m = ST.jeu ? metaJeu(ST.jeu, ST.sid) : {};
  var h = "<tr><th style='width:36px'>#</th><th>Texte</th><th style='width:96px'>État</th><th style='width:190px'></th></tr>";
  ST.blocs.forEach(function (b, i) {
    var r = m[b.k];
    h += "<tr" + (i === ST.sel ? " style='background:rgba(56,176,168,.10)'" : "") + "><td class='mono'>" + (b.k + 1) + "</td>" +
      "<td>" + esc(b.texte.length > 190 ? b.texte.slice(0, 190) + "…" : b.texte) + "</td>" +
      "<td>" + (r ? "<span class='pas ok'>" + Math.round(r.d) + " s</span>" : "<span class='pas no'>à faire</span>") + "</td>" +
      "<td style='white-space:nowrap'><button class='btn fant p' data-go='" + i + "'>Choisir</button> " +
      (r ? "<button class='btn fant p' data-pl='" + b.k + "'>Écouter</button> <button class='btn fant p' data-rm='" + b.k + "'>Effacer</button>" : "") + "</td></tr>";
  });
  t.innerHTML = h;
  $$("#tbl-blocs [data-go]").forEach(function (x) { x.onclick = function () { ST.sel = +x.dataset.go; rendreBlocs(); }; });
  $$("#tbl-blocs [data-pl]").forEach(function (x) { x.onclick = function () { ecouterClip(+x.dataset.pl); }; });
  $$("#tbl-blocs [data-rm]").forEach(function (x) {
    x.onclick = function () {
      var id = ST.jeu + ":" + ST.sid + ":" + x.dataset.rm;
      clipDel(id).then(function () { delete DB.clips[id]; saveNow(); rendreBlocs(); rendreListeStudio(); });
    };
  });
  var b = ST.blocs[ST.sel];
  $("#st-bloc").textContent = b ? b.texte : "—";
  $("#st-pos").textContent = b ? "Bloc " + (ST.sel + 1) + " sur " + ST.blocs.length : "—";
}
function micro() {
  if (ST.flux) return Promise.resolve(ST.flux);
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    .then(function (f) { ST.flux = f; return f; });
}
function startEnr() {
  if (!ST.jeu) { toast("Créez d'abord un jeu de voix."); return; }
  var b = ST.blocs[ST.sel]; if (!b) { toast("Sélectionnez une séance."); return; }
  var m = mimeEnr(); if (!m) { toast("Ce navigateur ne permet pas d'enregistrer. Utilisez Chrome ou Firefox."); return; }
  micro().then(function (f) {
    ST.morceaux = [];
    ST.rec = new MediaRecorder(f, { mimeType: m, audioBitsPerSecond: 48000 });
    ST.rec.ondataavailable = function (e) { if (e.data && e.data.size) ST.morceaux.push(e.data); };
    ST.rec.onstop = function () { finEnr(new Blob(ST.morceaux, { type: m }), m, b); };
    ST.t0 = Date.now(); ST.rec.start();
    $("#b-enr").textContent = "■ Arrêter"; $("#b-enr").classList.add("danger"); $("#b-enr").classList.remove("or");
    $("#pt-enr").hidden = false;
    ST.chrono = setInterval(function () { $("#chrono").textContent = ((Date.now() - ST.t0) / 1000).toFixed(1) + " s"; }, 100);
  }).catch(function () { toast("Micro refusé ou indisponible."); });
}
function stopEnr(muet) {
  if (ST.rec && ST.rec.state === "recording") { try { ST.rec.stop(); } catch (e) {} }
  ST.rec = null;
  clearInterval(ST.chrono); ST.chrono = null;
  var b = $("#b-enr"); if (b) { b.textContent = "● Enregistrer ce bloc"; b.classList.remove("danger"); b.classList.add("or"); }
  var p = $("#pt-enr"); if (p) p.hidden = true;
  if (muet) {
    ST.morceaux = [];
    if (ST.flux) { ST.flux.getTracks().forEach(function (t) { t.stop(); }); ST.flux = null; }
  }
}
function finEnr(blob, m, b) {
  var d = (Date.now() - ST.t0) / 1000;
  if (d < .4) { toast("Enregistrement trop court."); return; }
  blob.arrayBuffer().then(function (buf) {
    var id = ST.jeu + ":" + ST.sid + ":" + b.k;
    return clipSet({ id: id, data: buf, mime: m }).then(function () {
      DB.clips[id] = { d: Math.round(d * 10) / 10, ext: extDe(m), mime: m, at: Date.now() };
      saveNow(); rendreBlocs(); rendreListeStudio();
      toast("Bloc " + (b.k + 1) + " enregistré (" + d.toFixed(1) + " s).");
      if ($("#ch-auto").checked && ST.sel < ST.blocs.length - 1) { ST.sel++; rendreBlocs(); setTimeout(startEnr, 750); }
    });
  }).catch(function () { toast("Échec de l'enregistrement."); });
}
function ecouterClip(k) {
  clipGet(ST.jeu + ":" + ST.sid + ":" + k).then(function (r) {
    if (!r) return;
    var url = URL.createObjectURL(new Blob([r.data], { type: r.mime || "audio/webm" }));
    var a = $("#au-studio"); a.src = url; a.play();
    a.onended = function () { URL.revokeObjectURL(url); };
  });
}

/* ─── ZIP (méthode « stockage », sans compression) ─── */
var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(fichiers) {
  var parts = [], central = [], off = 0, enc = new TextEncoder();
  function u32(v) { return new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]); }
  function u16(v) { return new Uint8Array([v & 255, (v >> 8) & 255]); }
  fichiers.forEach(function (f) {
    var nom = enc.encode(f.nom), c = crc32(f.data), len = f.data.length;
    var lh = [].concat(Array.from(u32(0x04034b50)), Array.from(u16(20)), Array.from(u16(0)), Array.from(u16(0)),
      Array.from(u16(0)), Array.from(u16(0x21)), Array.from(u32(c)), Array.from(u32(len)), Array.from(u32(len)),
      Array.from(u16(nom.length)), Array.from(u16(0)));
    parts.push(new Uint8Array(lh), nom, f.data);
    central.push({ nom: nom, crc: c, len: len, off: off });
    off += lh.length + nom.length + len;
  });
  var cd = [], debut = off;
  central.forEach(function (e) {
    var h = [].concat(Array.from(u32(0x02014b50)), Array.from(u16(20)), Array.from(u16(20)), Array.from(u16(0)), Array.from(u16(0)),
      Array.from(u16(0)), Array.from(u16(0x21)), Array.from(u32(e.crc)), Array.from(u32(e.len)), Array.from(u32(e.len)),
      Array.from(u16(e.nom.length)), Array.from(u16(0)), Array.from(u16(0)), Array.from(u16(0)), Array.from(u16(0)),
      Array.from(u32(0)), Array.from(u32(e.off)));
    cd.push(new Uint8Array(h), e.nom);
    off += h.length + e.nom.length;
  });
  var eocd = [].concat(Array.from(u32(0x06054b50)), Array.from(u16(0)), Array.from(u16(0)),
    Array.from(u16(central.length)), Array.from(u16(central.length)),
    Array.from(u32(off - debut)), Array.from(u32(debut)), Array.from(u16(0)));
  return new Blob(parts.concat(cd, [new Uint8Array(eocd)]), { type: "application/zip" });
}
function exporterZip() {
  toast("Préparation du pack audio…");
  clipAll().then(function (rows) {
    if (!rows.length) { toast("Aucun enregistrement à exporter."); return; }
    var fichiers = [], index = {};
    rows.forEach(function (r) {
      var p = r.id.split(":"), jeu = p[0], sid = +p[1], k = +p[2];
      var meta = DB.clips[r.id] || {};
      var nom = "audio/" + jeu + "/s" + (sid < 10 ? "0" + sid : sid) + "/b" + ("00" + k).slice(-3) + "." + (meta.ext || "webm");
      fichiers.push({ nom: nom, data: new Uint8Array(r.data) });
      index[jeu] = index[jeu] || { nom: (DB.jeux.filter(function (j) { return j.id === jeu; })[0] || {}).nom || jeu, seances: {} };
      index[jeu].seances[sid] = index[jeu].seances[sid] || { ext: meta.ext || "webm", blocs: {} };
      index[jeu].seances[sid].blocs[k] = { d: meta.d };
    });
    fichiers.push({ nom: "audio/index.json", data: new TextEncoder().encode(JSON.stringify(index, null, 1)) });
    saveAs(zip(fichiers), "relax-mind-audio.zip");
    toast(fichiers.length - 1 + " fichiers audio exportés.");
  });
}

/* ─── synthèse ─── */
function rendreSynthese() {
  var ss = DB.sessions.filter(function (s) { return s.pid !== "TEST"; });
  var av = ss.filter(function (s) { return typeof s.avant === "number"; }).map(function (s) { return s.avant; });
  var ap = ss.filter(function (s) { return typeof s.apres === "number"; }).map(function (s) { return s.apres; });
  var g = ss.filter(function (s) { return typeof s.avant === "number" && typeof s.apres === "number"; }).map(function (s) { return s.apres - s.avant; });
  var et = ss.filter(function (s) { return s.etoiles; }).map(function (s) { return s.etoiles; });
  var us = DB.users.filter(function (u) { return !u.test; });
  var attendu = us.length * 12;
  $("#s-n").textContent = ss.length;
  $("#s-av").textContent = n1(moy(av));
  $("#s-ap").textContent = n1(moy(ap));
  $("#s-gain").textContent = g.length ? "+" + n1(moy(g)) : "—";
  $("#s-et").textContent = n1(moy(et));
  $("#s-obs").textContent = attendu ? Math.round(ss.length / attendu * 100) + " %" : "—";

  var t = $("#tbl-synthese");
  var h = "<tr><th>#</th><th>Séance</th><th>Écoutes</th><th>Participantes</th><th>Avant</th><th>Après</th><th>Gain</th><th>Qualité /10</th></tr>";
  toutes().forEach(function (s) {
    var l = ss.filter(function (x) { return x.sid === s.id; });
    var pids = {}; l.forEach(function (x) { pids[x.pid] = 1; });
    var a1 = l.filter(function (x) { return typeof x.avant === "number"; }).map(function (x) { return x.avant; });
    var a2 = l.filter(function (x) { return typeof x.apres === "number"; }).map(function (x) { return x.apres; });
    var gg = l.filter(function (x) { return typeof x.avant === "number" && typeof x.apres === "number"; }).map(function (x) { return x.apres - x.avant; });
    var ee = l.filter(function (x) { return x.etoiles; }).map(function (x) { return x.etoiles; });
    h += "<tr><td class='mono'>" + s.id + "</td><td>" + esc(s.titre) + "</td><td>" + l.length + "</td><td>" + Object.keys(pids).length +
      "</td><td>" + n1(moy(a1)) + "</td><td>" + n1(moy(a2)) + "</td><td>" + (gg.length ? "+" + n1(moy(gg)) : "—") +
      "</td><td>" + (ee.length ? n1(moy(ee)) + "★" : "—") + "</td></tr>";
  });
  t.innerHTML = h;

  var r = ss.filter(function (s) { return s.remarque; }).sort(function (a, b) { return b.fin - a.fin; });
  var rt = $("#tbl-remarques");
  if (!r.length) { rt.innerHTML = '<p class="mut">Aucune remarque pour l\'instant.</p>'; return; }
  var rh = "<table><tr><th>Date</th><th>Identifiant</th><th>Séance</th><th>Remarque</th></tr>";
  r.forEach(function (s) {
    rh += "<tr><td class='ptit'>" + jour(s.fin) + "</td><td class='mono'>" + esc(s.pid) + "</td><td>" + s.sid +
      "</td><td>" + esc(s.remarque) + "</td></tr>";
  });
  rt.innerHTML = rh + "</table>";
}
function csvSynthese() {
  var ss = DB.sessions.filter(function (s) { return s.pid !== "TEST"; });
  var L2 = ["seance_id;titre;ecoutes;participantes;detente_avant_moy;detente_apres_moy;gain_moy;qualite_texte_moy"];
  toutes().forEach(function (s) {
    var l = ss.filter(function (x) { return x.sid === s.id; });
    var pids = {}; l.forEach(function (x) { pids[x.pid] = 1; });
    var f = function (k) { return l.filter(function (x) { return typeof x[k] === "number"; }).map(function (x) { return x[k]; }); };
    var gg = l.filter(function (x) { return typeof x.avant === "number" && typeof x.apres === "number"; }).map(function (x) { return x.apres - x.avant; });
    var num = function (v) { return v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ","); };
    L2.push([s.id, '"' + s.titre + '"', l.length, Object.keys(pids).length,
             num(moy(f("avant"))), num(moy(f("apres"))), num(moy(gg)), num(moy(f("etoiles")))].join(";"));
  });
  return "\uFEFF" + L2.join("\n");
}

/* ─── réglages admin ─── */
function rendreReglages() {
  $("#g-delai").value = DB.cfg.delaiHeures;
  $("#g-duree").value = DB.cfg.dureeDefaut;
  $("#g-etude").value = DB.cfg.etude;
  var s = DB.cfg.sync;
  $("#g-url").value = s.url || ""; $("#g-key").value = s.key || "";
  $("#g-table").value = s.table || "ecoute"; $("#g-sync").checked = !!s.actif;
}
function testerSync() {
  var s = DB.cfg.sync;
  if (!s.url || !s.key) { toast("Renseignez l'URL et la clé anonyme."); return; }
  $("#g-etat").innerHTML = "<span class='point'></span> test…";
  fetch(s.url.replace(/\/+$/, "") + "/rest/v1/" + (s.table || "ecoute") + "?select=ref&limit=1",
    { headers: { apikey: s.key, Authorization: "Bearer " + s.key } })
    .then(function (r) {
      // 401/403 signifie que la table existe mais la lecture est bloquée par RLS
      // → c'est en réalité un bon signe pour la clé anon, elle a le droit d'INSERT seulement
      var ok = r.ok || r.status === 401 || r.status === 403;
      $("#g-etat").innerHTML = ok ? "<span class='point ok'></span> connexion OK"
                                  : "<span class='point'></span> erreur " + r.status;
      toast(ok ? "Connexion à Supabase réussie."
               : "Échec (HTTP " + r.status + "). Vérifiez l'URL, la clé et le script SQL.");
    })
    .catch(function () { $("#g-etat").innerHTML = "<span class='point'></span> injoignable"; toast("Serveur injoignable."); });
}
function tirerSync() {
  var s = DB.cfg.sync;
  if (!s.url || !s.key) { toast("Renseignez d'abord l'URL et la clé."); return; }
  toast("Récupération…");
  fetch(s.url.replace(/\/+$/, "") + "/rest/v1/" + (s.table || "ecoute") + "?select=*&order=fin.asc&limit=5000",
    { headers: { apikey: s.key, Authorization: "Bearer " + s.key } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rows) {
      var connus = {}; DB.sessions.forEach(function (x) { connus[x.id] = 1; });
      var n = 0;
      rows.forEach(function (r2) {
        var id = r2.ref || ("srv" + r2.id);
        if (connus[id]) return;
        // Compat rétro : accepte l'ancien "seance_id" (1-30) et le nouveau "seance_numero"
        var sid = (r2.seance_numero != null) ? r2.seance_numero : r2.seance_id;
        DB.sessions.push({
          id: id, pid: r2.pid, sid: sid,
          debut: +new Date(r2.debut || r2.fin),
          fin: +new Date(r2.fin),
          duree: r2.duree_sec || 0,
          avant: r2.detente_avant,
          apres: r2.detente_apres,
          etoiles: r2.qualite_texte,
          remarque: r2.remarque || "",
          envoye: 1
        });
        if (!DB.users.some(function (u) { return u.pid === r2.pid; }))
          DB.users.push({ pid: r2.pid, pin: pin4(), nom: "", groupe: r2.groupe || "", cree: Date.now() });
        n++;
      });
      saveNow(); rendreBord(); rendreSynthese(); rendreUsers();
      toast(n + " séance(s) récupérée(s) du serveur.");
    })
    .catch(function () { toast("Récupération impossible — vérifiez la clé et les droits de lecture."); });
}

/* ═══════════════════════════ ROUTAGE ═══════════════════════════ */
function aller(v) {
  if (v !== "porte" && !ETAT.role) v = "porte";
  if (v !== "lecteur") stopTout();
  ETAT.vue = v;
  $$(".vue").forEach(function (s) { s.classList.remove("on"); });
  $("#v-" + v).classList.add("on");
  document.getElementById("app").classList.toggle("admin", v === "admin");
  var navOn = ETAT.role === "part" && v !== "porte" && v !== "admin";
  $("#nav").classList.toggle("on", navOn);
  $$("#nav button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === v); });
  window.scrollTo(0, 0);
  if (v === "seances") rendreListe();
  if (v === "journal") rendreJournal();
  if (v === "voix") rendreVoix();
}
function entrerPart(pid, pin) {
  // Fallback local si hors ligne ou Supabase non configuré
  var u = DB.users.filter(function (x) { return x.pid.toUpperCase() === pid.toUpperCase(); })[0];
  if (!u) return "Cet identifiant ne figure pas dans l'étude.";
  if (String(u.pin).toLowerCase() !== String(pin).toLowerCase()) return "Code incorrect.";
  ETAT.role = "part"; ETAT.pid = u.pid; ETAT._p = prefs(u.pid);
  try { LS.setItem(CLE_SESS, JSON.stringify({ role: "part", pid: u.pid })); } catch (e) {}
  aller("seances");
  return null;
}

function entrerPartSupabase(pid, code, erreurFn) {
  if (!pid || pid.length < 1) { erreurFn("Saisissez votre identifiant."); return; }

  // Si pas de réseau ou Supabase non configuré → fallback local
  if (!navigator.onLine || !DB.cfg.sync.url || !DB.cfg.sync.key) {
    if (!code) { erreurFn("Pas de connexion réseau. Saisissez votre identifiant et votre code."); $("#f-code-login").hidden = false; return; }
    var msg = entrerPart(pid, code);
    if (msg) erreurFn(msg);
    return;
  }

  $("#b-entrer").disabled = true; $("#b-entrer").textContent = "Vérification…";

  // Étape 1 : si pas encore de code saisi, on vérifie d'abord le PID
  if (!code) {
    rpcSupabase("login_participante", { p_pid: pid.toUpperCase(), p_code: "" })
      .then(function (res) {
        if (res.raison === "premier_acces") {
          afficherCreationCode(res.pid);
        } else if (res.raison === "code_incorrect" || res.ok === false && res.raison !== "pid_inconnu") {
          // Le PID existe et a un code → afficher le champ code
          $("#f-code-login").hidden = false;
          $("#in-pin").focus();
          $("#b-entrer").textContent = "Se connecter";
        } else if (res.raison === "pid_inconnu") {
          erreurFn("Cet identifiant n'est pas encore enregistré dans l'étude.");
        } else {
          erreurFn("Erreur inattendue.");
        }
      })
      .catch(function () {
        erreurFn("Pas de connexion réseau.");
      })
      .then(function () {
        $("#b-entrer").disabled = false;
        if ($("#b-entrer").textContent === "Vérification…") $("#b-entrer").textContent = "Entrer";
      });
    return;
  }

  // Étape 2 : PID + code → connexion réelle
  rpcSupabase("login_participante", { p_pid: pid.toUpperCase(), p_code: code.toLowerCase() })
    .then(function (res) {
      if (res.ok) {
        // Sauver en local pour le hors-ligne
        if (!DB.users.some(function (u) { return u.pid.toUpperCase() === res.pid.toUpperCase(); })) {
          DB.users.push({ pid: res.pid, pin: code.toLowerCase(), nom: "", groupe: res.groupe || "", cree: Date.now() });
        } else {
          DB.users.forEach(function (u) { if (u.pid.toUpperCase() === res.pid.toUpperCase()) u.pin = code.toLowerCase(); });
        }
        saveNow();
        ETAT.role = "part"; ETAT.pid = res.pid; ETAT._p = prefs(res.pid);
        try { LS.setItem(CLE_SESS, JSON.stringify({ role: "part", pid: res.pid })); } catch (e) {}
        aller("seances");
      } else if (res.raison === "premier_acces") {
        afficherCreationCode(res.pid);
      } else if (res.raison === "code_incorrect") {
        erreurFn("Code incorrect. Vérifiez : 3 dernières lettres du mois + jour (2 chiffres) + 2 dernières lettres du nom.");
      } else if (res.raison === "pid_inconnu") {
        erreurFn("Cet identifiant n'est pas encore enregistré dans l'étude.");
      } else {
        erreurFn("Connexion refusée.");
      }
    })
    .catch(function () {
      var msg = entrerPart(pid, code);
      if (msg) erreurFn(msg);
    })
    .then(function () {
      $("#b-entrer").disabled = false;
      if ($("#b-entrer").textContent === "Vérification…") $("#b-entrer").textContent = "Entrer";
    });
}

function afficherCreationCode(pid) {
  ETAT._pidEnCours = pid;
  $("#f-code-login").hidden = true;
  $("#f-code-creation").hidden = false;
  $("#in-code-new").value = "";
  $("#in-code-confirm").value = "";
  $("#in-code-new").focus();
  $("#b-entrer").textContent = "Créer mon code";
  $("#b-entrer").disabled = false;
}

function creerCodeSupabase(erreurFn) {
  var pid = ETAT._pidEnCours;
  var c1 = ($("#in-code-new").value || "").trim().toLowerCase();
  var c2 = ($("#in-code-confirm").value || "").trim().toLowerCase();

  if (!c1) { erreurFn("Saisissez votre code."); return; }
  if (!/^[a-z]{3}[0-9]{2}[a-z]{2}$/.test(c1)) {
    erreurFn("Format incorrect. Le code doit faire 7 caractères : 3 lettres + 2 chiffres + 2 lettres. Exemple : ier05op");
    return;
  }
  if (c1 !== c2) { erreurFn("Les deux codes ne correspondent pas."); return; }

  $("#b-entrer").disabled = true; $("#b-entrer").textContent = "Enregistrement…";

  rpcSupabase("definir_code_participante", { p_pid: pid, p_code: c1 })
    .then(function (res) {
      if (res.ok) {
        toast("Code créé. Bienvenue !");
        // Maintenant connecter directement
        $("#f-code-creation").hidden = true;
        $("#f-code-login").hidden = false;
        entrerPartSupabase(pid, c1, erreurFn);
      } else if (res.raison === "format_invalide") {
        erreurFn("Format incorrect : 3 lettres + 2 chiffres + 2 lettres. Exemple : ier05op");
      } else if (res.raison === "code_deja_defini") {
        erreurFn("Un code existe déjà pour cet identifiant. Essayez de vous connecter normalement.");
        $("#f-code-creation").hidden = true;
        $("#f-code-login").hidden = false;
      } else {
        erreurFn("Erreur : " + (res.raison || "inconnue"));
      }
    })
    .catch(function () {
      erreurFn("Pas de connexion réseau. La création du code nécessite Internet.");
    })
    .then(function () {
      $("#b-entrer").disabled = false; $("#b-entrer").textContent = "Entrer";
    });
}
function sortir() {
  ETAT.role = null; ETAT.pid = null; ETAT._p = null;
  effacerSessionAdmin();
  try { LS.removeItem(CLE_SESS); } catch (e) {}
  $("#in-pid").value = ""; $("#in-pin").value = "";
  if ($("#in-adm-email")) $("#in-adm-email").value = "";
  $("#in-adm").value = "";
    $("#f-code-login").hidden = true;
  $("#f-code-creation").hidden = true;
  aller("porte");
}

/* ═══════════════════════════ CIEL ÉTOILÉ ═══════════════════════════ */
function ciel() {
  var c = $("#etoiles"), x = c.getContext("2d"), pts = [], W, H;
  function taille() {
    W = c.width = innerWidth * devicePixelRatio; H = c.height = innerHeight * devicePixelRatio;
    c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px";
    pts = [];
    var n = Math.min(90, Math.round(innerWidth * innerHeight / 16000));
    for (var i = 0; i < n; i++) pts.push({ x: Math.random() * W, y: Math.random() * H * .72,
      r: (Math.random() * 1.3 + .3) * devicePixelRatio, a: Math.random(), v: .002 + Math.random() * .006 });
  }
  function boucle() {
    x.clearRect(0, 0, W, H);
    pts.forEach(function (p) {
      p.a += p.v; var o = .25 + Math.abs(Math.sin(p.a)) * .6;
      x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7);
      x.fillStyle = "rgba(220,240,245," + o.toFixed(3) + ")"; x.fill();
    });
    requestAnimationFrame(boucle);
  }
  taille(); addEventListener("resize", taille);
  if (!matchMedia("(prefers-reduced-motion:reduce)").matches) boucle();
}

/* ═══════════════════════════ DÉMARRAGE ═══════════════════════════ */
function init() {
  ciel();
  $("#version").textContent = "RELAX MIND · version " + VERSION + " · 30 séances";

  $$("#ong-porte button").forEach(function (b) {
    b.onclick = function () {
      $$("#ong-porte button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      $("#f-part").hidden = b.dataset.r !== "part";
      $("#f-adm").hidden = b.dataset.r !== "adm";
      $("#err-porte").style.display = "none";
    };
  });
  function erreur(m) { var e = $("#err-porte"); e.textContent = m; e.style.display = "block"; }
    function tenter() {
    $("#err-porte").style.display = "none";
    if ($("#f-adm").hidden) {
      // Mode création de code (première connexion)
      if (!$("#f-code-creation").hidden) {
        creerCodeSupabase(erreur);
        return;
      }
      // Mode connexion normal → via Supabase
      // Mode connexion : étape 1 (PID seul) ou étape 2 (PID + code)
      var codeSaisi = $("#f-code-login").hidden ? "" : ($("#in-pin").value || "").trim();
      entrerPartSupabase(
        $("#in-pid").value.trim(),
        codeSaisi,
        erreur
      );
    } else {
      var email = ($("#in-adm-email") ? $("#in-adm-email").value.trim() : "");
      var mdp = $("#in-adm").value;
      if (!email || !mdp) { erreur("Saisissez l'email et le mot de passe."); return; }
      $("#b-entrer").disabled = true; $("#b-entrer").textContent = "Connexion…";
      loginAdmin(email, mdp).then(function (data) {
        return verifierAdmin(data.access_token).then(function (info) {
          sauverSessionAdmin(data, info);
          ETAT.role = "adm"; ETAT.pid = null;
          aller("admin"); admOnglet("bord");
        });
      }).catch(function (err) {
        erreur("Connexion refusée : vérifiez vos identifiants ou votre connexion réseau.");
      }).then(function () {
        $("#b-entrer").disabled = false; $("#b-entrer").textContent = "Entrer";
      });
    }
  }
  $("#b-entrer").onclick = tenter;
  ["#in-pid", "#in-pin", "#in-adm-email", "#in-adm", "#in-code-new", "#in-code-confirm"].forEach(function (s) {
    if ($(s)) $(s).addEventListener("keydown", function (e) { if (e.key === "Enter") tenter(); });
  });

  $$("#nav button").forEach(function (b) { b.onclick = function () { aller(b.dataset.v); }; });
  $("#b-retour").onclick = function () { aller("seances"); };
  $("#b-sortir").onclick = sortir;
  $("#b-adm-sortir").onclick = sortir;

  $("#b-lire").onclick = lirePause;
  $("#b-stop").onclick = function () {
    stopTout(); L.i = 0; L.ecoule = 0; arc(0);
    $("#t-cur").textContent = "00:00"; $("#pl-phrase").textContent = "Lecture arrêtée.";
  };
  $("#b-fond").onclick = function () {
    var ordre = ["none", "souffle", "vagues", "bourdon"], p = P();
    var i = (ordre.indexOf(p.fond) + 1) % ordre.length;
    majPrefs(function (x) { x.fond = ordre[i]; });
    $("#b-fond").classList.toggle("on", ordre[i] !== "none");
    fondStop(); if (L.lit) fondStart();
    toast("Fond sonore : " + ({ none: "aucun", souffle: "souffle continu", vagues: "vagues lentes", bourdon: "bourdon grave" })[ordre[i]]);
  };
  document.addEventListener("visibilitychange", function () { if (document.hidden && L.lit) pause(); });

  $("#fe-ok").onclick = function () {
    if (fVal === null) { toast("Choisissez un chiffre de 0 à 10."); return; }
    fermerEchelle(true);
  };
  $("#fe-skip").onclick = function () { fermerEchelle(false); };

  $("#r-rate").oninput = function () { majPrefs(function (p) { p.rate = +this.value; }.bind(this)); rendreVoix(); };
  $("#r-pitch").oninput = function () { majPrefs(function (p) { p.pitch = +this.value; }.bind(this)); rendreVoix(); };
  $("#r-sil").oninput = function () { majPrefs(function (p) { p.sil = +this.value; }.bind(this)); rendreVoix(); };
  $("#r-vol").oninput = function () { majPrefs(function (p) { p.vol = +this.value; }.bind(this)); rendreVoix(); };
  $("#r-fvol").oninput = function () { majPrefs(function (p) { p.fvol = +this.value; }.bind(this)); rendreVoix(); };
  $("#s-fond").onchange = function () { majPrefs(function (p) { p.fond = this.value; }.bind(this)); fondStop(); if (L.lit) fondStart(); };
  $("#b-essai").onclick = function () {
    try { synth.cancel(); } catch (e) {}
    synth.speak(parler("Installez-vous confortablement. Respirez lentement… et laissez vos épaules descendre."));
  };
  $("#b-envoyer").onclick = function () { envoyer(false); };
  $("#b-csv-moi").onclick = function () {
    var l = mesSessions(); if (!l.length) { toast("Aucune donnée."); return; }
    saveAs(csvSessions(l), "relaxmind_" + ETAT.pid + ".csv", "text/csv;charset=utf-8");
  };
  addEventListener("online", function () { envoyer(true); });

  $$("#ong-admin button").forEach(function (b) { b.onclick = function () { admOnglet(b.dataset.t); }; });

  $("#b-u-add").onclick = function () {
    var lignes = $("#u-in").value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (!lignes.length) { toast("Collez d'abord les identifiants T0."); return; }
    var g = $("#u-groupe").value.trim(), n = 0;
    lignes.forEach(function (l) {
      var pid = l.toUpperCase().replace(/\s+/g, "-").replace(/-+/g, "-");
      if (DB.users.some(function (u) { return u.pid === pid; })) return;
      DB.users.push({ pid: pid, pin: pin4(), nom: "", groupe: g, cree: Date.now() });
      n++;
    });
    saveNow(); $("#u-in").value = ""; rendreUsers(); rendreBord();
    toast(n + " participante(s) ajoutée(s).");
  };
  $("#b-u-csv").onclick = function () {
    var L2 = ["identifiant_t0;code;groupe;cree_le"];
    DB.users.forEach(function (u) { L2.push([u.pid, u.pin, u.groupe || "", new Date(u.cree).toISOString().slice(0, 10)].join(";")); });
    saveAs("\uFEFF" + L2.join("\n"), "relaxmind-participantes.csv", "text/csv;charset=utf-8");
  };
  $("#b-u-fiches").onclick = function () { saveAs(fichesHTML(), "relaxmind-fiches.html", "text/html;charset=utf-8"); };

  ["t-titre", "t-theme", "t-obj", "t-texte"].forEach(function (id) { $("#" + id).addEventListener("input", sauverEditeur); });
  ["c-rate", "c-sil", "c-duree"].forEach(function (id) { $("#" + id).addEventListener("input", function () { majCadenceAff(); sauverEditeur(); }); });
  $("#c-perso").addEventListener("change", sauverEditeur);
  $("#b-t-pause").onclick = function () {
    var ta = $("#t-texte"), p = ta.selectionStart, v = ta.value;
    ta.value = v.slice(0, p) + "\n\n[pause 15]\n\n" + v.slice(p);
    ta.focus(); ta.selectionStart = ta.selectionEnd = p + 15; sauverEditeur();
  };
  $("#b-t-lire").onclick = function () {
    var ta = $("#t-texte"), depuis = ta.value.slice(ta.selectionStart) || ta.value;
    try { synth.cancel(); } catch (e) {}
    var segs = decoupe(depuis).filter(function (g) { return g.t === "s"; }).slice(0, 40);
    var i = 0, rate = +$("#c-rate").value;
    (function suite() {
      if (i >= segs.length) return;
      var u = parler(segs[i++].texte, rate);
      u.onend = u.onerror = function () { setTimeout(suite, 90); };
      try { synth.speak(u); } catch (e) {}
    })();
    toast("Lecture d'essai — « Arrêter » pour interrompre.");
  };
  $("#b-t-stop").onclick = function () { try { synth.cancel(); } catch (e) {} };
  $("#b-t-reset").onclick = function () {
    if (!confirm("Restaurer le texte d'origine de cette séance ?")) return;
    delete DB.textes[tSel]; saveNow(); chargerEditeur(); rendreListeTextes(); toast("Texte d'origine restauré.");
  };

  $("#s-jeu").onchange = function () { ST.jeu = this.value || null; rendreListeStudio(); rendreBlocs(); };
  $("#b-jeu-new").onclick = function () {
    var n = prompt("Nom de ce jeu de voix :\n(par exemple « Ma voix douce », « Voix grave », « Voix de Fatou »)");
    if (!n) return;
    var id = "v" + Date.now().toString(36);
    DB.jeux.push({ id: id, nom: n.trim(), cree: Date.now() });
    ST.jeu = id; saveNow(); rendreJeux(); rendreListeStudio(); rendreBlocs();
    toast("Jeu de voix créé.");
  };
  $("#b-jeu-ren").onclick = function () {
    var j = DB.jeux.filter(function (x) { return x.id === ST.jeu; })[0]; if (!j) return;
    var n = prompt("Nouveau nom :", j.nom); if (!n) return;
    j.nom = n.trim(); saveNow(); rendreJeux();
  };
  $("#b-jeu-del").onclick = function () {
    var j = DB.jeux.filter(function (x) { return x.id === ST.jeu; })[0]; if (!j) return;
    if (!confirm("Supprimer le jeu « " + j.nom + " » et tous ses enregistrements ?")) return;
    var ids = Object.keys(DB.clips).filter(function (id) { return id.split(":")[0] === j.id; });
    Promise.all(ids.map(clipDel)).then(function () {
      ids.forEach(function (id) { delete DB.clips[id]; });
      DB.jeux = DB.jeux.filter(function (x) { return x.id !== j.id; });
      ST.jeu = null; saveNow(); rendreJeux(); rendreListeStudio(); rendreBlocs();
      toast("Jeu de voix supprimé.");
    });
  };
  $("#b-enr").onclick = function () { if (ST.rec && ST.rec.state === "recording") stopEnr(); else startEnr(); };
  $("#b-prec").onclick = function () { if (ST.sel > 0) { ST.sel--; rendreBlocs(); } };
  $("#b-suiv").onclick = function () { if (ST.sel < ST.blocs.length - 1) { ST.sel++; rendreBlocs(); } };
  $("#b-ecouter").onclick = function () { if (ST.blocs[ST.sel]) ecouterClip(ST.blocs[ST.sel].k); };
  $("#b-zip").onclick = exporterZip;

  $("#b-s-csv").onclick = function () {
    if (!DB.sessions.length) { toast("Aucune donnée."); return; }
    saveAs(csvSessions(DB.sessions), "relaxmind-donnees-" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8");
  };
  $("#b-s-syn").onclick = function () {
    saveAs(csvSynthese(), "relaxmind-synthese-" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8");
  };

  $("#g-delai").onchange = function () { DB.cfg.delaiHeures = Math.max(0, +this.value || 0); saveNow(); toast("Délai : " + DB.cfg.delaiHeures + " h."); };
  $("#g-duree").onchange = function () { DB.cfg.dureeDefaut = +this.value || 20; saveNow(); };
  $("#g-etude").oninput = function () { DB.cfg.etude = this.value; save(); };
  ["url", "key", "table"].forEach(function (k) {
    $("#g-" + k).oninput = function () { DB.cfg.sync[k] = this.value.trim(); save(); };
  });
  $("#g-sync").onchange = function () { DB.cfg.sync.actif = this.checked; saveNow(); };
  $("#b-g-test").onclick = testerSync;
  $("#b-g-pull").onclick = tirerSync;
  $("#b-sauve").onclick = function () {
    saveAs(JSON.stringify({ format: "RELAX-MIND", v: VERSION, date: new Date().toISOString(), db: DB }, null, 1),
      "relaxmind-projet-" + new Date().toISOString().slice(0, 10) + ".rmjson", "application/json");
    toast("Sauvegarde enregistrée.");
  };
  $("#b-restaure").onclick = function () { $("#f-restaure").click(); };
  $("#f-restaure").onchange = function () {
    var f = this.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var o = JSON.parse(fr.result);
        if (!o || !o.db) throw 0;
        if (!confirm("Remplacer le contenu actuel par cette sauvegarde ?")) return;
        for (var k in o.db) DB[k] = o.db[k];
        saveNow(); admOnglet("bord"); toast("Sauvegarde restaurée.");
      } catch (e) { toast("Fichier illisible."); }
    };
    fr.readAsText(f);
  };
  $("#b-raz-donnees").onclick = function () {
    if (!confirm("Effacer TOUTES les évaluations enregistrées ?\nCette action est irréversible.")) return;
    DB.sessions = []; saveNow(); admOnglet("bord"); toast("Évaluations effacées.");
  };
  $("#b-raz-tout").onclick = function () {
    if (!confirm("Réinitialiser complètement l'application ?\nTextes, cohorte, évaluations et enregistrements seront perdus.")) return;
    clipAll().then(function (rows) { return Promise.all(rows.map(function (r) { return clipDel(r.id); })); })
      .then(function () { try { LS.removeItem(CLE); LS.removeItem(CLE_SESS); } catch (e) {} location.reload(); });
  };

  if (synth) { chargerVoix(); synth.onvoiceschanged = chargerVoix; setTimeout(chargerVoix, 900); }

  var s = null;
  try { s = JSON.parse(LS.getItem(CLE_SESS) || "null"); } catch (e) {}
  if (s && s.role === "part" && DB.users.some(function (u) { return u.pid === s.pid; })) {
    ETAT.role = "part"; ETAT.pid = s.pid; ETAT._p = prefs(s.pid);
    aller("seances");
  } else {
    var adm = null;
    try { adm = JSON.parse(LS.getItem("rm.admin_session") || "null"); } catch (e) {}
    if (adm && adm.token && adm.refresh) {
      refreshToken(adm.refresh).then(function (data) {
        return verifierAdmin(data.access_token).then(function (info) {
          sauverSessionAdmin(data, info);
          ETAT.role = "adm"; ETAT.pid = null;
          aller("admin"); admOnglet("bord");
        });
      }).catch(function () {
        effacerSessionAdmin();
        aller("porte");
      });
    } else aller("porte");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

window.RM = {
  vitesse: 1,
  get db() { return DB; },
  get etat() { return ETAT; },
  entrer: entrerPart,
  seances: toutes
};
})();