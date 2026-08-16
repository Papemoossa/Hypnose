/* ==========================================================================
   RELAX MIND — couche cryptographique (partagée app participante / console admin)

   Principes :
   • Rien ne sort de l'appareil en clair : si la transmission automatique est
     activée, seul le contenu déjà chiffré part vers le serveur de l'étude,
     et la politique de sécurité n'autorise que cette seule destination.
   • Les données locales sont chiffrées en AES-256-GCM.
   • La clé de chiffrement (DEK) est aléatoire, puis « emballée » deux fois :
       - avec une clé dérivée du code participante (PBKDF2-SHA256, 250 000 tours) ;
       - avec la clé publique RSA-OAEP-2048 de l'administratrice (séquestre).
     → l'administratrice peut récupérer les données d'une participante qui a
       perdu son code, sans jamais connaître ce code.
   • Le code participante n'est stocké nulle part : seul un vérificateur dérivé
     (non réutilisable pour déchiffrer) est embarqué dans l'application.
   ========================================================================== */
var RMC = (function () {
"use strict";

var SUB = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
var ENC = new TextEncoder(), DEC = new TextDecoder();

function ok() { return !!SUB; }
function rnd(n) { var a = new Uint8Array(n); window.crypto.getRandomValues(a); return a; }
function b64(buf) {
  var b = new Uint8Array(buf), s = "";
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
function ub64(s) {
  var bin = atob(String(s)), a = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
/* normalisation du code : majuscules, espaces et tirets superflus retirés */
function norm(code) { return String(code || "").toUpperCase().replace(/\s+/g, "").replace(/[–—]/g, "-").trim(); }

/* ---- dérivation PBKDF2 : 32 octets de clé + 32 octets de vérificateur ---- */
function derive(secret, salt, iterations) {
  var s = (typeof salt === "string") ? ub64(salt) : salt;
  return SUB.importKey("raw", ENC.encode(secret), "PBKDF2", false, ["deriveBits"])
    .then(function (base) {
      return SUB.deriveBits({ name: "PBKDF2", salt: s, iterations: iterations, hash: "SHA-256" }, base, 512);
    })
    .then(function (bits) {
      var all = new Uint8Array(bits);
      return SUB.importKey("raw", all.slice(0, 32), { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
        .then(function (kek) { return { kek: kek, ver: b64(all.slice(32, 64)) }; });
    });
}

/* ---- AES-GCM ---- */
function aesEnc(key, bytes) {
  var iv = rnd(12);
  return SUB.encrypt({ name: "AES-GCM", iv: iv }, key, bytes)
    .then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
}
function aesDec(key, box) {
  return SUB.decrypt({ name: "AES-GCM", iv: ub64(box.iv) }, key, ub64(box.ct))
    .then(function (pt) { return new Uint8Array(pt); });
}
function encJSON(key, obj) { return aesEnc(key, ENC.encode(JSON.stringify(obj))); }
function decJSON(key, box) { return aesDec(key, box).then(function (b) { return JSON.parse(DEC.decode(b)); }); }

/* ---- clé de données (DEK) ---- */
function newDEK() { return Promise.resolve(rnd(32)); }
function importDEK(raw) { return SUB.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }

/* ---- séquestre RSA-OAEP ---- */
function genAdminKeys() {
  return SUB.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
                         true, ["encrypt", "decrypt"]);
}
function exportPub(k) { return SUB.exportKey("spki", k).then(b64); }
function importPub(s) { return SUB.importKey("spki", ub64(s), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]); }
function exportPriv(k) { return SUB.exportKey("pkcs8", k); }
function importPriv(buf) { return SUB.importKey("pkcs8", buf, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]); }
function rsaEnc(pub, bytes) { return SUB.encrypt({ name: "RSA-OAEP" }, pub, bytes).then(b64); }
function rsaDec(priv, s) { return SUB.decrypt({ name: "RSA-OAEP" }, priv, ub64(s)).then(function (b) { return new Uint8Array(b); }); }

/* ---- empreinte lisible d'une clé publique (contrôle d'intégrité) ---- */
function fingerprint(spkiB64) {
  return SUB.digest("SHA-256", ub64(spkiB64)).then(function (h) {
    var b = new Uint8Array(h), out = [];
    for (var i = 0; i < 8; i++) out.push(("0" + b[i].toString(16)).slice(-2).toUpperCase());
    return out.join(":");
  });
}

/* ---- génération de codes participantes (alphabet sans caractères ambigus) --- */
var ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";      // ni I, O, 0, 1
function secret(len) {
  var a = rnd(len * 2), out = "";
  for (var i = 0; out.length < len; i++) out += ALPHA[a[i % a.length] % ALPHA.length];
  return out.match(/.{1,4}/g).join("-");
}

return {
  ok: ok, rnd: rnd, b64: b64, ub64: ub64, norm: norm,
  derive: derive, aesEnc: aesEnc, aesDec: aesDec, encJSON: encJSON, decJSON: decJSON,
  newDEK: newDEK, importDEK: importDEK,
  genAdminKeys: genAdminKeys, exportPub: exportPub, importPub: importPub,
  exportPriv: exportPriv, importPriv: importPriv, rsaEnc: rsaEnc, rsaDec: rsaDec,
  fingerprint: fingerprint, secret: secret, ALPHA: ALPHA
};
})();
