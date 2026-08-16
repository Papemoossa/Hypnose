/* ==========================================================================
   RELAX MIND — Studio d'enregistrement de la voix (console d'administration)

   Principe : le texte est découpé en blocs (= paragraphes). Vous enregistrez
   un bloc à la fois, vous le réécoutez, vous le refaites si besoin.
   L'application insère elle-même les silences : vous ne parlez que 5 à 6
   minutes par séance au lieu d'en enregistrer vingt.

   Les enregistrements sont conservés chiffrés (AES-256-GCM) dans le navigateur
   et exportés en un dossier audio/ compressé (ZIP) à déposer avec le site.
   ========================================================================== */
var RMS = (function () {
"use strict";

var A = null;                       // pont fourni par admin.js
var DB = null, sid = null, sel = 0, blocks = [], rec = null, chunks = [], t0 = 0, timer = null, stream = null;
var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }

/* ---------------------------------------------------------- IndexedDB --- */
function open() {
  if (DB) return Promise.resolve(DB);
  return new Promise(function (res, rej) {
    var r = indexedDB.open("relaxmind-studio", 1);
    r.onupgradeneeded = function () {
      var db = r.result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
    };
    r.onsuccess = function () { DB = r.result; res(DB); };
    r.onerror = function () { rej(r.error); };
  });
}
function tx(mode) { return open().then(function (db) { return db.transaction("audio", mode).objectStore("audio"); }); }
function put(rec_) { return tx("readwrite").then(function (st) { return new Promise(function (res, rej) { var q = st.put(rec_); q.onsuccess = res; q.onerror = function () { rej(q.error); }; }); }); }
function get(id) { return tx("readonly").then(function (st) { return new Promise(function (res) { var q = st.get(id); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; }); }); }
function del(id) { return tx("readwrite").then(function (st) { return new Promise(function (res) { var q = st.delete(id); q.onsuccess = res; q.onerror = res; }); }); }
function all() { return tx("readonly").then(function (st) { return new Promise(function (res) { var q = st.getAll(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; }); }); }

/* --------------------------------------------------------- empreinte ---- */
function hash(txt) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)).then(function (h) {
    var b = new Uint8Array(h), s = "";
    for (var i = 0; i < 8; i++) s += ("0" + b[i].toString(16)).slice(-2);
    return s;
  });
}

/* ------------------------------------------------------------- format --- */
function mime() {
  var c = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];
  for (var i = 0; i < c.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i];
  return "";
}
function extOf(m) { return /ogg/.test(m) ? "ogg" : /mp4/.test(m) ? "m4a" : "webm"; }

/* ============================================================ RENDU ===== */
function renderList() {
  var c = $("#a-list"); if (!c) return; c.innerHTML = "";
  A.proj().seances.forEach(function (s) {
    var b = el("button", sid === s.id ? "on" : "", "<b>" + s.id + ". " + A.esc(s.titre) + "</b><div class='t2' id='a-prog-" + s.id + "'>…</div>");
    b.onclick = function () { pick(s.id); };
    c.appendChild(b);
    progress(s.id);
  });
}
function progress(id) {
  var s = A.proj().seances.filter(function (x) { return x.id === id; })[0]; if (!s) return;
  var bl = A.blocks(s.texte).filter(function (b) { return b.t === "s"; });
  all().then(function (rows) {
    var mine = rows.filter(function (r) { return r.sid === id; });
    var okc = 0, dur = 0;
    bl.forEach(function (b) {
      var r = mine.filter(function (x) { return x.k === b.k; })[0];
      if (r) { dur += r.dur || 0; if (r.hash === b.h) okc++; }
    });
    var e = document.getElementById("a-prog-" + id);
    if (e) e.innerHTML = okc + "/" + bl.length + " blocs" + (dur ? " · " + Math.round(dur / 60) + " min" : "") +
      (okc === bl.length && bl.length ? " <span style='color:var(--ok)'>✓</span>" : "");
  });
}
function pick(id) {
  stopRec(true);
  sid = id; sel = 0;
  var s = A.proj().seances.filter(function (x) { return x.id === id; })[0];
  $("#a-titre").textContent = s.titre;
  Promise.all(A.blocks(s.texte).filter(function (b) { return b.t === "s"; }).map(function (b) {
    return hash(b.text).then(function (h) { b.h = h; return b; });
  })).then(function (bl) { blocks = bl; renderBlocks(); renderList(); });
}
function renderBlocks() {
  var t = $("#a-table"); if (!t) return;
  if (!blocks.length) { t.innerHTML = "<tr><td class='tiny'>Sélectionnez une séance.</td></tr>"; return; }
  all().then(function (rows) {
    var mine = {};
    rows.forEach(function (r) { if (r.sid === sid) mine[r.k] = r; });
    var h = "<tr><th style='width:34px'>#</th><th>Texte à lire</th><th style='width:110px'>État</th><th style='width:220px'></th></tr>";
    blocks.forEach(function (b, i) {
      var r = mine[b.k];
      var etat = !r ? "<span class='pill no'>à enregistrer</span>"
        : (r.hash !== b.h ? "<span class='pill' style='color:var(--warn)'>texte modifié</span>"
                          : "<span class='pill ok'>" + Math.round(r.dur) + " s</span>");
      h += "<tr" + (i === sel ? " style='background:rgba(56,176,168,.10)'" : "") + "><td class='mono'>" + (b.k + 1) + "</td>" +
        "<td style='max-width:520px'>" + A.esc(b.text.length > 260 ? b.text.slice(0, 260) + "…" : b.text) + "</td>" +
        "<td>" + etat + "</td><td style='white-space:nowrap'>" +
        "<button class='btn ghost' style='padding:5px 9px;font-size:12px' data-go='" + i + "'>Sélectionner</button> " +
        (r ? "<button class='btn ghost' style='padding:5px 9px;font-size:12px' data-play='" + b.k + "'>Écouter</button> " +
             "<button class='btn ghost' style='padding:5px 9px;font-size:12px' data-del='" + b.k + "'>Effacer</button>" : "") +
        "</td></tr>";
    });
    t.innerHTML = h;
    $$("#a-table [data-go]").forEach(function (x) { x.onclick = function () { sel = +x.dataset.go; renderBlocks(); focusBlock(); }; });
    $$("#a-table [data-play]").forEach(function (x) { x.onclick = function () { playBlock(+x.dataset.play); }; });
    $$("#a-table [data-del]").forEach(function (x) { x.onclick = function () { del(sid + ":" + x.dataset.del).then(function () { renderBlocks(); progress(sid); }); }; });
    focusBlock();
    progress(sid);
  });
}
function focusBlock() {
  var b = blocks[sel];
  $("#a-current").textContent = b ? b.text : "—";
  $("#a-pos").textContent = b ? "Bloc " + (sel + 1) + " / " + blocks.length : "—";
}

/* ========================================================= ENREGISTREMENT */
function askMic() {
  if (stream) return Promise.resolve(stream);
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
  }).then(function (s) { stream = s; return s; });
}
function startRec() {
  var b = blocks[sel]; if (!b) { A.toast("Sélectionnez d'abord une séance."); return; }
  var m = mime(); if (!m) { A.toast("Ce navigateur ne permet pas d'enregistrer. Utilisez Chrome ou Firefox."); return; }
  askMic().then(function (s) {
    chunks = [];
    rec = new MediaRecorder(s, { mimeType: m, audioBitsPerSecond: 48000 });
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () { finishRec(new Blob(chunks, { type: m }), m, b); };
    t0 = Date.now(); rec.start();
    $("#a-rec").textContent = "■ Arrêter"; $("#a-rec").classList.add("red");
    $("#a-dot").style.display = "inline-block";
    timer = setInterval(function () { $("#a-timer").textContent = ((Date.now() - t0) / 1000).toFixed(1) + " s"; }, 100);
  }).catch(function () { A.toast("Micro refusé ou indisponible."); });
}
function stopRec(silent) {
  if (rec && rec.state === "recording") { try { rec.stop(); } catch (e) {} }
  rec = null;
  clearInterval(timer); timer = null;
  var r = $("#a-rec"); if (r) { r.textContent = "● Enregistrer ce bloc"; r.classList.remove("red"); }
  var d = $("#a-dot"); if (d) d.style.display = "none";
  if (silent) chunks = [];
}
function finishRec(blob, m, b) {
  var dur = (Date.now() - t0) / 1000;
  if (dur < 0.4) { A.toast("Enregistrement trop court."); return; }
  blob.arrayBuffer().then(function (buf) {
    return RMC.aesEnc(A.kek(), new Uint8Array(buf));
  }).then(function (box) {
    return put({ id: sid + ":" + b.k, sid: sid, k: b.k, hash: b.h, dur: dur, ext: extOf(m), mime: m, iv: box.iv, ct: box.ct, at: Date.now() });
  }).then(function () {
    A.toast("Bloc " + (b.k + 1) + " enregistré (" + dur.toFixed(1) + " s).");
    renderBlocks();
    if ($("#a-auto").checked && sel < blocks.length - 1) {
      sel++; renderBlocks();
      setTimeout(startRec, 700);
    }
  }).catch(function () { A.toast("Échec de l'enregistrement."); });
}
function playBlock(k) {
  get(sid + ":" + k).then(function (r) {
    if (!r) return;
    return RMC.aesDec(A.kek(), { iv: r.iv, ct: r.ct }).then(function (bytes) {
      var url = URL.createObjectURL(new Blob([bytes], { type: r.mime || "audio/webm" }));
      var au = $("#a-audio"); au.src = url; au.play();
      au.onended = function () { URL.revokeObjectURL(url); };
    });
  });
}

/* =============================================================== ZIP ==== */
var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {                                   // [{name, data:Uint8Array}] — méthode « stockage »
  var parts = [], central = [], off = 0, enc = new TextEncoder();
  function u32(v) { return new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]); }
  function u16(v) { return new Uint8Array([v & 255, (v >> 8) & 255]); }
  files.forEach(function (f) {
    var name = enc.encode(f.name), c = crc32(f.data), len = f.data.length;
    var lh = [].concat(
      Array.from(u32(0x04034b50)), Array.from(u16(20)), Array.from(u16(0)), Array.from(u16(0)),
      Array.from(u16(0)), Array.from(u16(0x21)), Array.from(u32(c)), Array.from(u32(len)), Array.from(u32(len)),
      Array.from(u16(name.length)), Array.from(u16(0)));
    parts.push(new Uint8Array(lh), name, f.data);
    central.push({ name: name, crc: c, len: len, off: off });
    off += lh.length + name.length + len;
  });
  var cd = [], cdStart = off;
  central.forEach(function (e) {
    var h = [].concat(
      Array.from(u32(0x02014b50)), Array.from(u16(20)), Array.from(u16(20)), Array.from(u16(0)), Array.from(u16(0)),
      Array.from(u16(0)), Array.from(u16(0x21)), Array.from(u32(e.crc)), Array.from(u32(e.len)), Array.from(u32(e.len)),
      Array.from(u16(e.name.length)), Array.from(u16(0)), Array.from(u16(0)), Array.from(u16(0)), Array.from(u16(0)),
      Array.from(u32(0)), Array.from(u32(e.off)));
    cd.push(new Uint8Array(h), e.name);
    off += h.length + e.name.length;
  });
  var eocd = [].concat(
    Array.from(u32(0x06054b50)), Array.from(u16(0)), Array.from(u16(0)),
    Array.from(u16(central.length)), Array.from(u16(central.length)),
    Array.from(u32(off - cdStart)), Array.from(u32(cdStart)), Array.from(u16(0)));
  return new Blob(parts.concat(cd, [new Uint8Array(eocd)]), { type: "application/zip" });
}

/* -------------------------------------------------------- index audio -- */
function buildIndex() {
  var P = A.proj();
  return all().then(function (rows) {
    var idx = {}, seq = Promise.resolve(), files = [];
    P.seances.forEach(function (s) {
      seq = seq.then(function () {
        var bl = A.blocks(s.texte).filter(function (b) { return b.t === "s"; });
        var mine = rows.filter(function (r) { return r.sid === s.id; });
        if (!mine.length) return;
        var ent = { ext: mine[0].ext || "webm", blocks: {} }, sub = Promise.resolve();
        bl.forEach(function (b) {
          var r = mine.filter(function (x) { return x.k === b.k; })[0];
          if (!r) return;
          sub = sub.then(function () {
            return RMC.aesDec(A.kek(), { iv: r.iv, ct: r.ct }).then(function (bytes) {
              var nm = "audio/s" + (s.id < 10 ? "0" + s.id : s.id) + "/b" + ("00" + b.k).slice(-3) + "." + (r.ext || "webm");
              files.push({ name: nm, data: bytes });
              ent.blocks[b.k] = { d: Math.round(r.dur * 10) / 10 };
            });
          });
        });
        return sub.then(function () { if (Object.keys(ent.blocks).length) idx[s.id] = ent; });
      });
    });
    return seq.then(function () { return { index: idx, files: files }; });
  });
}
function exportZip() {
  A.toast("Préparation du pack audio…");
  buildIndex().then(function (r) {
    if (!r.files.length) { A.toast("Aucun enregistrement à exporter."); return; }
    r.files.push({ name: "audio/index.json", data: new TextEncoder().encode(JSON.stringify(r.index)) });
    var blob = zip(r.files), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "audio-relax-mind.zip";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    A.toast(r.files.length - 1 + " fichiers audio exportés.");
  }).catch(function () { A.toast("Échec de l'export audio."); });
}

/* ============================================================== BOOT ==== */
function boot(bridge) {
  A = bridge;
  renderList();
  $("#a-rec").onclick = function () { if (rec && rec.state === "recording") stopRec(); else startRec(); };
  $("#a-prev").onclick = function () { if (sel > 0) { sel--; renderBlocks(); } };
  $("#a-next").onclick = function () { if (sel < blocks.length - 1) { sel++; renderBlocks(); } };
  $("#a-replay").onclick = function () { if (blocks[sel]) playBlock(blocks[sel].k); };
  $("#a-zip").onclick = exportZip;
  $("#a-wipe").onclick = function () {
    if (!confirm("Effacer TOUS les enregistrements de toutes les séances ?")) return;
    open().then(function (db) { db.transaction("audio", "readwrite").objectStore("audio").clear().onsuccess = function () { renderBlocks(); renderList(); A.toast("Enregistrements effacés."); }; });
  };
  $("#a-fmt").textContent = mime() ? extOf(mime()).toUpperCase() + " / Opus" : "non disponible";
}

return { boot: boot, index: buildIndex, stop: function () { stopRec(true); if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; } } };
})();
