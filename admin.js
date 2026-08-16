/* ==========================================================================
   RELAX MIND — console d'administration
   Fichier à usage strictement local : ne jamais le mettre en ligne.
   Le projet (textes, cohorte, codes, clé privée) est chiffré en AES-256-GCM
   par une clé dérivée de la phrase de passe administratrice (PBKDF2 400 000).
   ========================================================================== */
(function () {
"use strict";

var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("on"); }, 2800); }
function mmss(s) { s = Math.max(0, Math.round(s)); var m = Math.floor(s / 60); return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
function saveAs(content, name, mime) {
  var b = new Blob([content], { type: mime || "text/plain;charset=utf-8" }), a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

var AKEY = "relaxmind.admin";
var ITER_ADMIN = 400000;
var KEK = null, PROJ = null, PRIV = null;

function defaultProject() {
  return {
    etude: "Auto-hypnose et stress professionnel — district sanitaire de Diourbel",
    iterations: 250000, unlockHours: 72, dureeDefaut: 20, lockMinutes: 15, maxAttempts: 8,
    seances: JSON.parse(JSON.stringify(typeof SEANCES !== "undefined" ? SEANCES : [])),
    participants: [], notes: {}, received: [],
    sync: { on: false, url: "", key: "", service: "", table: "rm_uploads" },
    audioIndex: null,
    adminPub: null, adminPriv: null, fingerprint: "",
    created: Date.now(), updated: Date.now()
  };
}

/* ======================================================= VERROU CONSOLE == */
function gateInit() {
  var raw = localStorage.getItem(AKEY), exists = !!raw;
  $("#g-confirm-wrap").style.display = exists ? "none" : "block";
  $("#gate-lbl").textContent = exists ? "Phrase de passe administratrice" : "Créez votre phrase de passe";
  $("#g-ok").textContent = exists ? "Ouvrir la console" : "Créer le projet";
  $("#g-ok").onclick = exists ? open_ : create_;
  $("#g-pass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#g-ok").click(); });
  $("#g-import").onclick = function () { $("#g-file").click(); };
  $("#g-file").onchange = function () { importProject(this.files[0]); };
  if (!RMC.ok()) gerr("Ce navigateur ne fournit pas les fonctions cryptographiques nécessaires.");
}
function gerr(m) { var e = $("#g-err"); if (!m) { e.style.display = "none"; return; } e.textContent = m; e.style.display = "block"; }

function create_() {
  var p = $("#g-pass").value, p2 = $("#g-pass2").value;
  gerr("");
  if (p.length < 12) { gerr("Choisissez une phrase d'au moins 12 caractères."); return; }
  if (p !== p2) { gerr("Les deux saisies ne correspondent pas."); return; }
  var salt = RMC.b64(RMC.rnd(16));
  busy(true);
  RMC.derive(p, salt, ITER_ADMIN).then(function (d) {
    KEK = d.kek; PROJ = defaultProject();
    return persist(salt).then(function () { busy(false); enter(); toast("Projet créé et chiffré."); });
  }).catch(function () { busy(false); gerr("Erreur lors de la création du projet."); });
}
function open_() {
  var p = $("#g-pass").value; gerr("");
  var box = JSON.parse(localStorage.getItem(AKEY) || "null");
  if (!box) { gerr("Aucun projet trouvé."); return; }
  busy(true);
  RMC.derive(p, box.salt, box.iter || ITER_ADMIN).then(function (d) {
    KEK = d.kek;
    return RMC.decJSON(KEK, box.data);
  }).then(function (obj) {
    PROJ = obj; busy(false); enter();
  }).catch(function () { KEK = null; busy(false); gerr("Phrase de passe incorrecte."); });
}
function busy(b) { $("#g-ok").disabled = b; $("#g-ok").textContent = b ? "Chiffrement en cours…" : ($("#g-confirm-wrap").style.display === "none" ? "Ouvrir la console" : "Créer le projet"); }

function persist(saltOverride) {
  if (!KEK || !PROJ) return Promise.resolve();
  PROJ.updated = Date.now();
  var prev = JSON.parse(localStorage.getItem(AKEY) || "null");
  var salt = saltOverride || (prev && prev.salt);
  return RMC.encJSON(KEK, PROJ).then(function (box) {
    localStorage.setItem(AKEY, JSON.stringify({ v: 2, salt: salt, iter: ITER_ADMIN, data: box, updated: Date.now() }));
  });
}
var pT = null;
function touch() { clearTimeout(pT); pT = setTimeout(function () { persist().catch(function () {}); }, 400); }

function enter() {
  $("#gate").style.display = "none";
  $("#main").style.display = "block";
  $("#g-pass").value = ""; $("#g-pass2").value = "";
  if (PROJ.adminPriv) {
    RMC.importPriv(RMC.ub64(PROJ.adminPriv).buffer).then(function (k) { PRIV = k; }).catch(function () {});
  }
  boot();
}
function importProject(file) {
  if (!file) return;
  var p = $("#g-pass").value;
  if (p.length < 8) { gerr("Saisissez d'abord la phrase de passe de ce fichier."); return; }
  var fr = new FileReader();
  fr.onload = function () {
    var box;
    try { box = JSON.parse(fr.result); } catch (e) { gerr("Fichier illisible."); return; }
    if (!box || !box.salt || !box.data) { gerr("Ce fichier n'est pas un projet RELAX MIND."); return; }
    RMC.derive(p, box.salt, box.iter || ITER_ADMIN).then(function (d) {
      KEK = d.kek; return RMC.decJSON(KEK, box.data);
    }).then(function (obj) {
      PROJ = obj; return persist(box.salt);
    }).then(function () { enter(); toast("Projet restauré."); })
      .catch(function () { gerr("Phrase de passe incorrecte pour ce fichier."); });
  };
  fr.readAsText(file);
}

/* ==================================================== TEXTES DES SÉANCES = */
var cur = 0;
function parseTexte(txt) {
  txt = String(txt || "").replace(/\[\[\[[\s\S]*?\]\]\]/g, "");
  var out = [], paras = txt.split(/\n\s*\n/);
  for (var i = 0; i < paras.length; i++) {
    var p = paras[i].trim(); if (!p) continue;
    var parts = p.split(/(\[pause\s+\d+(?:\.\d+)?\])/i);
    for (var j = 0; j < parts.length; j++) {
      var seg = parts[j], m = seg.match(/^\[pause\s+(\d+(?:\.\d+)?)\]$/i);
      if (m) { out.push({ t: "p", ms: parseFloat(m[1]) * 1000 }); continue; }
      var c = seg.replace(/\s+/g, " ").trim(); if (!c) continue;
      splitPhrases(c).forEach(function (s) { out.push({ t: "s", text: s }); });
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
    var ch = x.split(/,\s*/), cu = "";
    ch.forEach(function (c) { if ((cu + " " + c).length > 170 && cu) { res.push(cu.trim()); cu = c; } else cu = cu ? cu + ", " + c : c; });
    if (cu.trim()) res.push(cu.trim());
  });
  return res;
}
function speechMs(g, r) { return (g.text.split(/\s+/).length / (150 * r)) * 60000 + 260; }
function estimate(sg, r) { var ms = 0; sg.forEach(function (g) { ms += g.t === "p" ? g.ms : speechMs(g, r); }); return ms; }
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
function build(txt, target, rate) {
  var sg = parseTexte(txt), sp = 0, pa = 0;
  sg.forEach(function (g) { if (g.t === "p") pa += g.ms; else sp += speechMs(g, rate); });
  var need = target * 60000 - sp, f = (pa > 0 && need > pa) ? Math.min(6, need / pa) : 1;
  if (f > 1) sg.forEach(function (g) { if (g.t === "p") g.ms = Math.round(g.ms * f); });
  return { segs: sg, est: estimate(sg, rate) };
}

function renderSList() {
  var c = $("#s-list"); c.innerHTML = "";
  PROJ.seances.forEach(function (s, i) {
    var b = el("button", i === cur ? "on" : "",
      "<b>" + s.id + ". " + esc(s.titre) + "</b>" +
      '<div class="t2">' + esc(s.theme || "") + (s.canevas ? " · canevas" : "") +
      " · " + Math.round(build(s.texte, PROJ.dureeDefaut, 0.85).est / 60000) + " min</div>");
    b.onclick = function () { cur = i; renderSList(); loadEditor(); };
    c.appendChild(b);
  });
}
function loadEditor() {
  var s = PROJ.seances[cur]; if (!s) return;
  $("#e-titre").value = s.titre || ""; $("#e-theme").value = s.theme || "";
  $("#e-obj").value = s.objectif || ""; $("#e-texte").value = s.texte || "";
  statEditor();
}
function statEditor() {
  var txt = $("#e-texte").value, sg = parseTexte(txt);
  var words = sg.filter(function (g) { return g.t === "s"; }).reduce(function (a, g) { return a + g.text.split(/\s+/).length; }, 0);
  var pauses = sg.filter(function (g) { return g.t === "p"; }).length;
  var b = build(txt, PROJ.dureeDefaut, 0.85);
  var todo = /\[\[\[/.test(txt);
  $("#e-stat").innerHTML = words + " mots · " + pauses + " silences · ≈ " + Math.round(b.est / 60000) + " min" +
    (todo ? ' · <span style="color:var(--warn)">contient une zone à compléter</span>' : "");
}
function saveEditor() {
  var s = PROJ.seances[cur]; if (!s) return;
  s.titre = $("#e-titre").value; s.theme = $("#e-theme").value;
  s.objectif = $("#e-obj").value; s.texte = $("#e-texte").value;
  s.canevas = /\[\[\[/.test(s.texte);
  statEditor(); renderSList(); renderRList(); touch();
}

/* ==================================================== PARTICIPANTES ====== */
function renderParts() {
  var t = $("#p-table");
  $("#p-count").textContent = PROJ.participants.length;
  if (!PROJ.participants.length) { t.innerHTML = '<tr><td class="tiny">Aucune participante enregistrée.</td></tr>'; return; }
  var h = "<tr><th>Identifiant T0</th><th>Code d'accès à remettre</th><th>Créé le</th><th></th></tr>";
  PROJ.participants.forEach(function (p, i) {
    h += "<tr><td class='mono'>" + esc(p.pid) + "</td><td class='mono' style='color:var(--gold)'>" + esc(p.code) +
         "</td><td class='tiny'>" + new Date(p.created).toLocaleDateString("fr-FR") +
         "</td><td><button class='btn ghost' style='padding:5px 10px;font-size:12px' data-del='" + i + "'>Retirer</button></td></tr>";
  });
  t.innerHTML = h;
  $$("#p-table [data-del]").forEach(function (b) {
    b.onclick = function () {
      if (!confirm("Retirer cette participante de la cohorte ?")) return;
      PROJ.participants.splice(+b.dataset.del, 1); renderParts(); touch();
    };
  });
}
function genCodes() {
  var lines = $("#p-in").value.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (!lines.length) { toast("Collez d'abord les identifiants T0, un par ligne."); return; }
  var len = +$("#p-len").value, iter = PROJ.iterations, done = 0;
  var bar = $("#p-bar"); bar.style.display = "block"; bar.firstElementChild.style.width = "0%";
  $("#b-gen").disabled = true;

  var seq = Promise.resolve();
  lines.forEach(function (line) {
    seq = seq.then(function () {
      var pid = line.toUpperCase().replace(/\s+/g, "-").replace(/-+/g, "-");
      if (PROJ.participants.some(function (p) { return p.pid === pid; })) { done++; return; }
      var code = pid + "-" + RMC.secret(len);
      var salt = RMC.b64(RMC.rnd(16));
      return RMC.derive(code, salt, iter).then(function (d) {
        PROJ.participants.push({ pid: pid, code: code, salt: salt, verif: d.ver, iter: iter, created: Date.now() });
        done++;
        bar.firstElementChild.style.width = Math.round(done / lines.length * 100) + "%";
      });
    });
  });
  seq.then(function () {
    $("#p-in").value = ""; $("#b-gen").disabled = false;
    setTimeout(function () { bar.style.display = "none"; }, 600);
    renderParts(); touch(); toast(done + " participante(s) traitée(s).");
  });
}
function partsCSV() {
  var L = ["identifiant_t0;code_acces;cree_le"];
  PROJ.participants.forEach(function (p) { L.push([p.pid, p.code, new Date(p.created).toISOString().slice(0, 10)].join(";")); });
  return L.join("\n");
}
function slips() {
  var h = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>RELAX MIND — codes d\'accès</title><style>' +
    'body{font-family:Georgia,serif;margin:18mm}h1{font-size:15pt;letter-spacing:.1em}' +
    '.s{border:1px dashed #999;border-radius:6px;padding:12px 14px;margin:0 0 10px;page-break-inside:avoid}' +
    '.c{font-family:monospace;font-size:15pt;letter-spacing:.08em;margin:6px 0}' +
    '.n{font-size:9pt;color:#555;line-height:1.5}</style></head><body>' +
    "<h1>RELAX MIND — codes d'accès</h1><p style='font-size:9pt;color:#555'>" + esc(PROJ.etude) + "</p>";
  PROJ.participants.forEach(function (p) {
    h += "<div class='s'><div style='font-size:9pt;color:#555'>Participante " + esc(p.pid) + "</div>" +
         "<div class='c'>" + esc(p.code) + "</div>" +
         "<div class='n'>Saisissez ce code au premier lancement de l'application RELAX MIND, puis à chaque déverrouillage.<br>" +
         "Conservez-le : il protège vos données et ne peut pas être retrouvé. En cas de perte, prévenez la responsable de l'étude.</div></div>";
  });
  return h + "</body></html>";
}

/* ==================================================== REVUE LIBRE ======== */
var synth = window.speechSynthesis, VOICES = [], R = { segs: [], i: 0, playing: false, t: 0, timer: null, pt: null, id: null };
function loadVoices() {
  var all = synth ? synth.getVoices() : [];
  VOICES = all.filter(function (v) { return /^fr/i.test(v.lang); });
  if (!VOICES.length) VOICES = all.slice();
  var s = $("#r-voice"); s.innerHTML = "";
  VOICES.forEach(function (v, i) { var o = el("option", "", esc(v.name) + " (" + v.lang + ")"); o.value = i; s.appendChild(o); });
  if (!VOICES.length) s.innerHTML = "<option>Aucune voix disponible sur cet ordinateur</option>";
}
function renderRList() {
  var c = $("#r-list"); c.innerHTML = "";
  PROJ.seances.forEach(function (s, i) {
    var note = PROJ.notes[s.id] ? " · noté" : "";
    var b = el("button", R.id === s.id ? "on" : "", "<b>" + s.id + ". " + esc(s.titre) + "</b><div class='t2'>" + esc(s.theme || "") + note + "</div>");
    b.onclick = function () { pickReview(s.id); };
    c.appendChild(b);
  });
}
function pickReview(id) {
  rStop();
  var s = PROJ.seances.filter(function (x) { return x.id === id; })[0]; if (!s) return;
  R.id = id;
  $("#r-titre").textContent = s.titre;
  $("#r-theme").textContent = "Séance " + s.id + " · " + (s.theme || "");
  $("#r-obj").textContent = s.objectif || "";
  $("#r-note").value = PROJ.notes[id] || "";
  $("#r-line").textContent = "—";
  var b = build(s.texte, +$("#r-duree").value || 20, +$("#r-rate").value || 0.85);
  R.segs = b.segs; R.i = 0; R.t = 0;
  $("#r-time").textContent = "00:00 / " + mmss(b.est / 1000);
  renderRList();
}
function rUtter(text) {
  var u = new SpeechSynthesisUtterance(text), v = VOICES[+$("#r-voice").value] || null;
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "fr-FR";
  u.rate = +$("#r-rate").value || 0.85; u.pitch = +$("#r-pitch").value || 0.95; u.volume = 1;
  return u;
}
function rPlay() {
  if (!R.segs.length) { toast("Sélectionnez d'abord une séance."); return; }
  if (R.playing) return;
  R.playing = true;
  if (!R.timer) R.timer = setInterval(function () { if (R.playing) { R.t += 0.25; $("#r-time").textContent = mmss(R.t) + " / " + mmss(estimate(R.segs, +$("#r-rate").value || 0.85) / 1000); } }, 250);
  rNext();
}
function rNext() {
  if (!R.playing) return;
  if (R.i >= R.segs.length) { rStop(); $("#r-line").textContent = "Fin de la séance."; return; }
  var g = R.segs[R.i++];
  if (g.t === "p") {
    var ms = g.ms / (+$("#r-speed").value || 1);
    $("#r-line").innerHTML = "<i style='color:var(--gold)'>silence " + Math.round(g.ms / 1000) + " s</i>";
    R.pt = setTimeout(function () { R.pt = null; rNext(); }, ms);
    return;
  }
  $("#r-line").textContent = g.text;
  var u = rUtter(g.text), done = false;
  u.onend = u.onerror = function () { if (done) return; done = true; setTimeout(rNext, 100); };
  try { synth.speak(u); } catch (e) { setTimeout(rNext, 150); }
  setTimeout(function () { if (!done && R.playing) { done = true; try { synth.cancel(); } catch (e) {} rNext(); } },
             Math.max(4000, (g.text.split(/\s+/).length / (150 * (+$("#r-rate").value || .85))) * 60000 * 2.2 + 3000));
}
function rPause() { R.playing = false; if (R.pt) { clearTimeout(R.pt); R.pt = null; } try { synth.cancel(); } catch (e) {} }
function rStop() { rPause(); if (R.timer) { clearInterval(R.timer); R.timer = null; } R.i = 0; R.t = 0; }

/* ==================================================== SÉCURITÉ =========== */
function renderSecu() {
  $("#c-iter").value = PROJ.iterations; $("#c-lock").value = PROJ.lockMinutes;
  $("#c-try").value = PROJ.maxAttempts; $("#c-unlock").value = PROJ.unlockHours;
  $("#c-duree").value = PROJ.dureeDefaut; $("#c-etude").value = PROJ.etude;
  var ok = !!PROJ.adminPub;
  $("#k-state").textContent = ok ? "Clé de secours active" : "Aucune clé";
  $("#k-state").className = "pill " + (ok ? "ok" : "no");
  $("#k-fp").style.display = ok ? "inline-block" : "none";
  $("#k-fp").textContent = PROJ.fingerprint || "";
}
function genKey() {
  if (PROJ.adminPub && !confirm("Une clé existe déjà. La remplacer rendra ILLISIBLES les sauvegardes des applications déjà distribuées. Continuer ?")) return;
  toast("Génération de la clé…");
  RMC.genAdminKeys().then(function (kp) {
    return RMC.exportPub(kp.publicKey).then(function (pub) {
      return RMC.exportPriv(kp.privateKey).then(function (priv) {
        PROJ.adminPub = pub; PROJ.adminPriv = RMC.b64(priv); PRIV = null;
        return RMC.importPriv(priv).then(function (k) { PRIV = k; });
      }).then(function () { return RMC.fingerprint(pub); }).then(function (fp) { PROJ.fingerprint = fp; });
    });
  }).then(function () { renderSecu(); touch(); toast("Clé de secours générée. Sauvegardez-la sans attendre."); })
    .catch(function () { toast("Échec de la génération de la clé."); });
}
function saveKey() {
  if (!PROJ.adminPriv) { toast("Générez d'abord une clé."); return; }
  var pass = prompt("Phrase de passe pour protéger le fichier de clé (elle vous sera redemandée à l'import) :");
  if (!pass || pass.length < 8) { toast("Phrase trop courte."); return; }
  var salt = RMC.b64(RMC.rnd(16));
  RMC.derive(pass, salt, ITER_ADMIN).then(function (d) {
    return RMC.encJSON(d.kek, { pub: PROJ.adminPub, priv: PROJ.adminPriv, fp: PROJ.fingerprint });
  }).then(function (box) {
    saveAs(JSON.stringify({ format: "RELAX-MIND-KEY", v: 2, salt: salt, iter: ITER_ADMIN, fp: PROJ.fingerprint, data: box }, null, 1),
           "relaxmind-cle-secours.rmkey", "application/json");
    toast("Clé sauvegardée. Conservez-la hors de cet ordinateur.");
  });
}
function loadKey(file) {
  if (!file) return;
  var pass = prompt("Phrase de passe du fichier de clé :"); if (!pass) return;
  var fr = new FileReader();
  fr.onload = function () {
    var box; try { box = JSON.parse(fr.result); } catch (e) { toast("Fichier illisible."); return; }
    RMC.derive(pass, box.salt, box.iter || ITER_ADMIN)
      .then(function (d) { return RMC.decJSON(d.kek, box.data); })
      .then(function (o) {
        PROJ.adminPub = o.pub; PROJ.adminPriv = o.priv; PROJ.fingerprint = o.fp || "";
        return RMC.importPriv(RMC.ub64(o.priv).buffer).then(function (k) { PRIV = k; });
      })
      .then(function () { renderSecu(); touch(); toast("Clé importée."); })
      .catch(function () { toast("Phrase de passe incorrecte."); });
  };
  fr.readAsText(file);
}

/* ==================================================== DONNÉES REÇUES ===== */
function readRmx(files) {
  if (!PRIV) { toast("Importez d'abord votre clé de secours (onglet Sécurité)."); return; }
  var arr = Array.prototype.slice.call(files || []);
  var seq = Promise.resolve(), added = 0, failed = 0;
  arr.forEach(function (f) {
    seq = seq.then(function () {
      return new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () {
          var pack; try { pack = JSON.parse(fr.result); } catch (e) { failed++; return res(); }
          if (!pack || !pack.wrapAdmin || !pack.data) { failed++; return res(); }
          RMC.rsaDec(PRIV, pack.wrapAdmin)
            .then(function (dekRaw) { return RMC.importDEK(dekRaw); })
            .then(function (dek) { return RMC.decJSON(dek, pack.data); })
            .then(function (S) {
              PROJ.received = PROJ.received.filter(function (r) { return r.pid !== pack.pid; });
              PROJ.received.push({ pid: pack.pid, exported: pack.exported, events: S.events || [], done: S.done || {}, file: f.name });
              added++; res();
            })
            .catch(function () { failed++; res(); });
        };
        fr.readAsText(f);
      });
    });
  });
  seq.then(function () {
    renderRecu(); touch();
    toast(added + " fichier(s) déchiffré(s)" + (failed ? ", " + failed + " illisible(s)" : "") + ".");
  });
}
function renderRecu() {
  $("#d-count").textContent = PROJ.received.length + " fichier(s)";
  var t = $("#d-table");
  if (!PROJ.received.length) { t.innerHTML = '<tr><td class="tiny">Aucune donnée importée.</td></tr>'; return; }
  var h = "<tr><th>Participante</th><th>Séances</th><th>Minutes</th><th>Détente av.</th><th>Détente ap.</th><th>Gain moyen</th><th>Dernière séance</th></tr>";
  PROJ.received.forEach(function (r) {
    var ev = r.events || [], mins = 0, av = [], ap = [], last = 0;
    ev.forEach(function (e) {
      mins += (e.sec || 0) / 60;
      if (typeof e.before === "number") av.push(e.before);
      if (typeof e.after === "number") ap.push(e.after);
      if (e.ts > last) last = e.ts;
    });
    var moy = function (a) { return a.length ? (a.reduce(function (x, y) { return x + y; }, 0) / a.length).toFixed(1) : "—"; };
    var gain = (av.length && ap.length) ? "+" + (moy(ap) - moy(av)).toFixed(1) : "—";
    h += "<tr><td class='mono'>" + esc(r.pid) + "</td><td>" + Object.keys(r.done || {}).length + "</td><td>" + Math.round(mins) +
         "</td><td>" + moy(av) + "</td><td>" + moy(ap) + "</td><td>" + gain + "</td><td class='tiny'>" +
         (last ? new Date(last).toLocaleDateString("fr-FR") : "—") + "</td></tr>";
  });
  t.innerHTML = h;
}
function recuCSV() {
  var L = ["code;seance_id;seance_titre;date;heure;duree_minutes;detente_avant;detente_apres;gain;remarque"];
  PROJ.received.forEach(function (r) {
    (r.events || []).forEach(function (e) {
      var s = PROJ.seances.filter(function (x) { return x.id === e.id; })[0], d = new Date(e.ts);
      var g = (typeof e.before === "number" && typeof e.after === "number") ? (e.after - e.before) : "";
      L.push([r.pid, e.id, '"' + (s ? s.titre : "") + '"', d.toISOString().slice(0, 10), d.toTimeString().slice(0, 5),
              ((e.sec || 0) / 60).toFixed(1).replace(".", ","), e.before == null ? "" : e.before,
              e.after == null ? "" : e.after, g, '"' + String(e.note || "").replace(/"/g, "'") + '"'].join(";"));
    });
  });
  return L.join("\n");
}

/* ==================================================== SUPABASE =========== */
var SQL_SCRIPT =
"-- RELAX MIND — à exécuter une seule fois dans Supabase (SQL Editor)\n" +
"create table if not exists public.rm_uploads (\n" +
"  id          uuid primary key default gen_random_uuid(),\n" +
"  pid         text not null,\n" +
"  fp          text,\n" +
"  n_events    int,\n" +
"  n_done      int,\n" +
"  app         text,\n" +
"  payload     jsonb not null,   -- contenu chiffré : illisible par le serveur\n" +
"  created_at  timestamptz not null default now()\n" +
");\n\n" +
"create index if not exists rm_uploads_pid_idx on public.rm_uploads (pid, created_at desc);\n\n" +
"alter table public.rm_uploads enable row level security;\n\n" +
"-- La clé anonyme embarquée dans l'application ne peut QU'INSÉRER :\n" +
"-- aucune lecture, aucune modification, aucune suppression ne lui est permise.\n" +
"drop policy if exists rm_insert_only on public.rm_uploads;\n" +
"create policy rm_insert_only on public.rm_uploads\n" +
"  for insert to anon with check (\n" +
"    length(pid) between 1 and 64\n" +
"    and pg_column_size(payload) < 200000\n" +
"  );\n\n" +
"-- Facultatif : purge automatique des envois de plus de 18 mois\n" +
"-- delete from public.rm_uploads where created_at < now() - interval '18 months';\n";

function renderSync() {
  var s = PROJ.sync || (PROJ.sync = { on: false, url: "", key: "", service: "", table: "rm_uploads" });
  $("#s-url").value = s.url || ""; $("#s-key").value = s.key || "";
  $("#s-service").value = s.service || ""; $("#s-table").value = s.table || "rm_uploads";
  $("#s-on").checked = !!s.on;
}
function syncHost() {
  try { return new URL(PROJ.sync.url).origin; } catch (e) { return ""; }
}
function testSync() {
  var s = PROJ.sync;
  if (!s.url || !s.key) { toast("Renseignez l'URL et la clé anonyme."); return; }
  toast("Test en cours…");
  fetch(s.url.replace(/\/+$/, "") + "/rest/v1/" + (s.table || "rm_uploads"), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: s.key, Authorization: "Bearer " + s.key, Prefer: "return=minimal" },
    body: JSON.stringify({ pid: "TEST-CONNEXION", n_events: 0, n_done: 0, app: "admin", payload: { test: true } })
  }).then(function (r) {
    toast(r.ok ? "Connexion réussie : une ligne de test a été insérée." : "Échec (HTTP " + r.status + "). Vérifiez l'URL, la clé et le script SQL.");
  }).catch(function () { toast("Connexion impossible : vérifiez l'URL et votre accès Internet."); });
}
function fetchServer() {
  var s = PROJ.sync;
  if (!s.url || !s.service) { toast("Renseignez l'URL et la clé de service (onglet Sécurité)."); return; }
  if (!PRIV) { toast("Importez d'abord votre clé de secours."); return; }
  toast("Récupération en cours…");
  fetch(s.url.replace(/\/+$/, "") + "/rest/v1/" + (s.table || "rm_uploads") + "?select=*&order=created_at.desc&limit=2000", {
    headers: { apikey: s.service, Authorization: "Bearer " + s.service }
  }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (rows) {
      var latest = {};
      rows.forEach(function (r) { if (!latest[r.pid]) latest[r.pid] = r; });   // le plus récent d'abord
      var seq = Promise.resolve(), n = 0;
      Object.keys(latest).forEach(function (pid) {
        if (pid === "TEST-CONNEXION") return;
        var p = latest[pid].payload;
        if (!p || !p.wrapAdmin || !p.data) return;
        seq = seq.then(function () {
          return RMC.rsaDec(PRIV, p.wrapAdmin)
            .then(RMC.importDEK)
            .then(function (dek) { return RMC.decJSON(dek, p.data); })
            .then(function (S) {
              PROJ.received = PROJ.received.filter(function (x) { return x.pid !== pid; });
              PROJ.received.push({ pid: pid, exported: latest[pid].created_at, events: S.events || [], done: S.done || {}, file: "serveur" });
              n++;
            }).catch(function () {});
        });
      });
      return seq.then(function () { renderRecu(); touch(); toast(n + " dossier(s) de participante récupéré(s) et déchiffré(s)."); });
    })
    .catch(function () { toast("Récupération impossible : vérifiez la clé de service et votre connexion."); });
}

/* ==================================================== EXPORT ============= */
function exportConfig() {
  var s = PROJ.sync || {};
  return {
    version: 1,
    etude: PROJ.etude,
    iterations: PROJ.iterations,
    unlockHours: PROJ.unlockHours,
    dureeDefaut: PROJ.dureeDefaut,
    lockMinutes: PROJ.lockMinutes,
    maxAttempts: PROJ.maxAttempts,
    adminPubKey: PROJ.adminPub || null,
    adminFingerprint: PROJ.fingerprint || "",
    participants: PROJ.participants.map(function (p) { return { pid: p.pid, salt: p.salt, verif: p.verif, iter: p.iter }; }),
    audio: PROJ.audioIndex || null,
    sync: (s.on && s.url && s.key) ? { url: s.url.replace(/\/+$/, ""), key: s.key, table: s.table || "rm_uploads" } : null
  };
}
function dataBlock() {
  var seances = PROJ.seances.map(function (s) {
    return { id: s.id, titre: s.titre, theme: s.theme, objectif: s.objectif, canevas: !!s.canevas, texte: s.texte };
  });
  return "<script>\nvar SEANCES = " + JSON.stringify(seances) + ";\n" +
         "var RM_CONFIG = " + JSON.stringify(exportConfig()) + ";\n<\/script>";
}
/* met à jour l'index des enregistrements (durées par bloc) avant tout export */
function refreshAudioIndex() {
  if (!window.RMS) return Promise.resolve();
  return RMS.index().then(function (r) {
    PROJ.audioIndex = Object.keys(r.index).length ? r.index : null;
    touch();
  }).catch(function () {});
}
function checkExport() {
  var c = $("#x-check"), out = [];
  var todo = PROJ.seances.filter(function (s) { return /\[\[\[/.test(s.texte); }).length;
  out.push(item(PROJ.participants.length > 0, PROJ.participants.length + " participante(s) dans la cohorte",
                "Aucune participante : l'application acceptera n'importe quel code (mode démonstration)."));
  out.push(item(!!PROJ.adminPub, "Clé de secours active — les données perdues restent récupérables",
                "Aucune clé de secours : une participante qui perd son code perdra définitivement ses données."));
  out.push(item(todo === 0, "Toutes les séances sont rédigées", todo + " séance(s) contiennent encore une zone [[[ à compléter ]]]"));
  out.push(item(PROJ.iterations >= 200000, "Dérivation de clé : " + PROJ.iterations.toLocaleString("fr-FR") + " tours", "Moins de 200 000 tours : protection affaiblie."));
  var sy = PROJ.sync || {};
  out.push(item(!!(sy.on && sy.url && sy.key), "Transmission automatique activée vers " + (syncHost() || "—"),
                "Transmission automatique désactivée : les participantes devront vous envoyer leur fichier .rmx à la main."));
  var nAudio = PROJ.audioIndex ? Object.keys(PROJ.audioIndex).length : 0;
  out.push(item(nAudio > 0, "Voix enregistrée disponible pour " + nAudio + " séance(s)",
                "Aucune voix enregistrée incluse : les séances seront lues par la synthèse vocale du téléphone."));
  c.innerHTML = out.join("");
  function item(ok, good, bad) {
    return '<div style="display:flex;gap:9px;align-items:flex-start;margin-bottom:7px"><span style="color:' +
      (ok ? "var(--ok)" : "var(--warn)") + '">' + (ok ? "✓" : "!") + '</span><span class="tiny">' + esc(ok ? good : bad) + "</span></div>";
  }
}
function buildHTML() {
  var tpl = document.getElementById("rm-template").textContent.trim();
  if (!tpl || tpl === "__TEMPLATE__") throw new Error("modèle absent");
  var html = decodeURIComponent(escape(atob(tpl)));
  var A = "<!--__RM_DATA_START__-->", B = "<!--__RM_DATA_END__-->";
  var a = html.indexOf(A), b = html.indexOf(B);
  if (a < 0 || b < 0) throw new Error("balises introuvables");
  var out = html.slice(0, a) + A + "\n" + dataBlock() + "\n" + B + html.slice(b + B.length);
  /* la politique de sécurité n'autorise QUE le serveur de l'étude, et rien d'autre */
  var host = (PROJ.sync && PROJ.sync.on) ? syncHost() : "";
  out = out.replace("connect-src 'none'", "connect-src " + (host || "'none'"));
  return out;
}
function buildApp() {
  var out;
  try { out = buildHTML(); }
  catch (e) { toast("Modèle d'application absent : utilisez le fichier RELAX-MIND-ADMIN.html généré par build.py."); return; }
  saveAs(out, "RELAX-MIND.html", "text/html;charset=utf-8");
  toast("Application générée : RELAX-MIND.html");
}
function buildFiles() {
  var seances = PROJ.seances.map(function (s) {
    return { id: s.id, titre: s.titre, theme: s.theme, objectif: s.objectif, canevas: !!s.canevas, texte: s.texte };
  });
  saveAs("/* RELAX MIND — textes générés par la console d'administration */\nvar SEANCES = " +
         JSON.stringify(seances, null, 1) + ";\n", "textes.js", "text/javascript;charset=utf-8");
  setTimeout(function () {
    saveAs("/* RELAX MIND — configuration générée par la console d'administration.\n" +
           "   Ne contient aucun code participante en clair. */\nvar RM_CONFIG = " +
           JSON.stringify(exportConfig(), null, 1) + ";\n", "config.js", "text/javascript;charset=utf-8");
  }, 500);
  toast("textes.js et config.js générés.");
}

/* ==================================================== DÉMARRAGE ========== */
function boot() {
  $("#hd-sub").textContent = PROJ.etude;
  $$(".tabs button").forEach(function (b) {
    b.onclick = function () {
      $$(".tabs button").forEach(function (x) { x.classList.remove("on"); });
      $$(".tab").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on"); $("#t-" + b.dataset.t).classList.add("on");
      if (b.dataset.t === "export") refreshAudioIndex().then(checkExport);
      if (b.dataset.t === "secu") { renderSecu(); renderSync(); }
      if (b.dataset.t !== "revue") rStop();
      if (b.dataset.t !== "voix" && window.RMS) RMS.stop();
    };
  });

  /* textes */
  renderSList(); loadEditor();
  ["e-titre", "e-theme", "e-obj", "e-texte"].forEach(function (id) { $("#" + id).addEventListener("input", saveEditor); });
  $("#b-add").onclick = function () {
    var id = PROJ.seances.reduce(function (m, s) { return Math.max(m, s.id); }, 0) + 1;
    PROJ.seances.push({ id: id, titre: "Nouvelle séance " + id, theme: "", objectif: "", texte: "Bienvenue.\n\n[pause 10]\n\n" });
    cur = PROJ.seances.length - 1; renderSList(); loadEditor(); renderRList(); touch();
  };
  $("#b-del").onclick = function () {
    if (!PROJ.seances.length || !confirm("Supprimer définitivement cette séance ?")) return;
    PROJ.seances.splice(cur, 1); cur = Math.max(0, cur - 1);
    PROJ.seances.forEach(function (s, i) { s.id = i + 1; });
    renderSList(); loadEditor(); renderRList(); touch();
  };
  $("#b-ins").onclick = function () {
    var ta = $("#e-texte"), p = ta.selectionStart, v = ta.value;
    ta.value = v.slice(0, p) + "\n\n[pause 15]\n\n" + v.slice(p);
    ta.focus(); ta.selectionStart = ta.selectionEnd = p + 15; saveEditor();
  };
  $("#b-listen").onclick = function () {
    var ta = $("#e-texte"), from = ta.value.slice(ta.selectionStart);
    rStop(); R.segs = parseTexte(from || ta.value); R.i = 0; R.playing = true; rNext();
    toast("Lecture d'essai — bouton Arrêter pour interrompre.");
  };
  $("#b-stopread").onclick = function () { rStop(); };

  /* participantes */
  renderParts();
  $("#b-gen").onclick = genCodes;
  $("#b-pcsv").onclick = function () {
    if (!PROJ.participants.length) { toast("Aucune participante."); return; }
    saveAs("﻿" + partsCSV(), "relaxmind-codes-participantes.csv", "text/csv;charset=utf-8");
  };
  $("#b-pslips").onclick = function () {
    if (!PROJ.participants.length) { toast("Aucune participante."); return; }
    saveAs(slips(), "relaxmind-fiches-participantes.html", "text/html;charset=utf-8");
    toast("Fichier généré : ouvrez-le et imprimez-le.");
  };
  $("#b-pclear").onclick = function () {
    if (!confirm("Vider entièrement la liste des participantes et leurs codes ?")) return;
    PROJ.participants = []; renderParts(); touch();
  };

  /* revue */
  renderRList(); loadVoices();
  if (synth) synth.onvoiceschanged = loadVoices;
  $("#r-play").onclick = rPlay; $("#r-pause").onclick = rPause;
  $("#r-stop").onclick = function () { rStop(); if (R.id) pickReview(R.id); };
  $("#r-note").addEventListener("input", function () { if (R.id) { PROJ.notes[R.id] = this.value; touch(); renderRList(); } });
  ["r-rate", "r-duree", "r-pitch"].forEach(function (id) { $("#" + id).addEventListener("change", function () { if (R.id) pickReview(R.id); }); });

  /* sécurité */
  renderSecu();
  $("#b-genkey").onclick = genKey;
  $("#b-savekey").onclick = saveKey;
  $("#b-loadkey").onclick = function () { $("#k-file").click(); };
  $("#k-file").onchange = function () { loadKey(this.files[0]); };
  [["c-iter", "iterations"], ["c-lock", "lockMinutes"], ["c-try", "maxAttempts"],
   ["c-unlock", "unlockHours"], ["c-duree", "dureeDefaut"]].forEach(function (p) {
    $("#" + p[0]).addEventListener("change", function () { PROJ[p[1]] = +this.value; touch(); renderSList(); });
  });
  $("#c-etude").addEventListener("input", function () { PROJ.etude = this.value; $("#hd-sub").textContent = this.value; touch(); });

  /* studio voix */
  if (window.RMS) {
    RMS.boot({
      proj: function () { return PROJ; }, kek: function () { return KEK; },
      blocks: blocksOf, toast: toast, esc: esc, touch: touch
    });
  }

  /* serveur */
  renderSync();
  [["s-url", "url"], ["s-key", "key"], ["s-service", "service"], ["s-table", "table"]].forEach(function (p) {
    $("#" + p[0]).addEventListener("input", function () { PROJ.sync[p[1]] = this.value.trim(); touch(); });
  });
  $("#s-on").addEventListener("change", function () { PROJ.sync.on = this.checked; touch(); });
  $("#s-test").onclick = testSync;
  $("#s-sql").onclick = function () {
    var b = $("#s-sqlbox");
    b.style.display = b.style.display === "none" ? "block" : "none";
    b.textContent = SQL_SCRIPT;
  };

  /* données */
  renderRecu();
  $("#b-fetch").onclick = fetchServer;
  $("#b-rmx").onclick = function () { $("#d-file").click(); };
  $("#d-file").onchange = function () { readRmx(this.files); this.value = ""; };
  $("#b-dcsv").onclick = function () {
    if (!PROJ.received.length) { toast("Aucune donnée importée."); return; }
    saveAs("﻿" + recuCSV(), "relaxmind-cohorte-" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8");
  };
  $("#b-dclear").onclick = function () { if (confirm("Vider les données importées ?")) { PROJ.received = []; renderRecu(); touch(); } };

  /* export */
  $("#b-build").onclick = function () { refreshAudioIndex().then(buildApp); };
  $("#b-files").onclick = function () { refreshAudioIndex().then(buildFiles); };
  refreshAudioIndex().then(checkExport);

  /* entête */
  $("#b-quit").onclick = function () { rStop(); persist().then(function () { location.reload(); }); };
  $("#b-savefile").onclick = function () {
    persist().then(function () {
      saveAs(localStorage.getItem(AKEY), "relaxmind-projet-" + new Date().toISOString().slice(0, 10) + ".rmproj", "application/json");
      toast("Projet chiffré enregistré. Gardez-le en lieu sûr.");
    });
  };
  window.addEventListener("beforeunload", function () { try { persist(); } catch (e) {} });
}

gateInit();
window.RMADMIN = {
  get proj() { return PROJ; }, build: buildApp, config: exportConfig,
  html: function () { return refreshAudioIndex().then(buildHTML); }
};
})();
