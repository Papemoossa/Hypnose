// ============================================================================
// RELAX MIND — Étape D : Historique des séances
//
// MODIFICATIONS À APPLIQUER DANS app.js
// Ce fichier documente chaque changement avec le contexte avant/après.
// ============================================================================

// ──────────────────────────────────────────────────────────────────────────
// MODIFICATION 1 : Ajouter la fonction tirerHistorique()
// EMPLACEMENT : après la fonction envoyer(), avant la section CSV
// ──────────────────────────────────────────────────────────────────────────

/* Étape D — Récupération de l'historique depuis Supabase après connexion.
   Appelle la RPC historique_participante (SECURITY DEFINER) qui vérifie
   le code avant de renvoyer les écoutes. Fusionne sans doublons. */
function tirerHistorique(pid, code) {
  if (!syncOK()) return Promise.resolve(0);
  if (!navigator.onLine) return Promise.resolve(0);
  if (!code) return Promise.resolve(0);

  return rpcSupabase("historique_participante", {
    p_pid: pid.toUpperCase(),
    p_code: code.toLowerCase()
  })
  .then(function (res) {
    if (!res || !res.ok || !res.ecoutes) return 0;

    // Index des refs déjà connues localement
    var connus = {};
    DB.sessions.forEach(function (s) { connus[s.id] = 1; });

    var n = 0;
    res.ecoutes.forEach(function (e) {
      var ref = e.ref || ("srv_" + e.fin);
      if (connus[ref]) return;  // déjà présent localement ET a tester pour voir 

      DB.sessions.push({
        id:       ref,
        pid:      e.pid,
        sid:      e.seance_numero,
        debut:    e.debut ? +new Date(e.debut) : +new Date(e.fin),
        fin:      +new Date(e.fin),
        duree:    e.duree_sec || 0,
        avant:    e.detente_avant,
        apres:    e.detente_apres,
        etoiles:  e.qualite_texte,
        remarque: e.remarque || "",
        envoye:   1   // déjà sur le serveur, pas besoin de renvoyer
      });
      n++;
    });

    if (n > 0) saveNow();
    return n;
  })
  .catch(function (err) {
    try { console.warn("[RELAX MIND] Historique impossible :", err); } catch (e) {}
    return 0;
  });
}


// ──────────────────────────────────────────────────────────────────────────
// MODIFICATION 2 : Appeler tirerHistorique après connexion réussie
// EMPLACEMENT : dans entrerPartSupabase(), bloc "res.ok" de l'étape 2
//
// AVANT (lignes existantes) :
//   if (res.ok) {
//     // Sauver en local pour le hors-ligne
//     if (!DB.users.some(...)) { DB.users.push(...); }
//     else { DB.users.forEach(...); }
//     saveNow();
//     ETAT.role = "part"; ETAT.pid = res.pid; ETAT._p = prefs(res.pid);
//     try { LS.setItem(CLE_SESS, JSON.stringify({ role: "part", pid: res.pid })); } catch (e) {}
//     aller("seances");
//   }
//
// APRÈS :
//   if (res.ok) {
//     // Sauver en local pour le hors-ligne
//     if (!DB.users.some(...)) { DB.users.push(...); }
//     else { DB.users.forEach(...); }
//     saveNow();
//     ETAT.role = "part"; ETAT.pid = res.pid; ETAT._p = prefs(res.pid);
//     try { LS.setItem(CLE_SESS, JSON.stringify({ role: "part", pid: res.pid })); } catch (e) {}
//
//     // Étape D : récupérer l'historique depuis Supabase
//     tirerHistorique(res.pid, code).then(function (n) {
//       if (n > 0) toast(n + " séance(s) récupérée(s) depuis le serveur.");
//       aller("seances");
//     });
//   }
// ──────────────────────────────────────────────────────────────────────────


// ──────────────────────────────────────────────────────────────────────────
// MODIFICATION 3 : Aussi récupérer l'historique à la reprise de session
// EMPLACEMENT : dans init(), bloc de restauration de session participante
//
// AVANT :
//   if (s && s.role === "part" && DB.users.some(function (u) { return u.pid === s.pid; })) {
//     ETAT.role = "part"; ETAT.pid = s.pid; ETAT._p = prefs(s.pid);
//     aller("seances");
//   }
//
// APRÈS :
//   if (s && s.role === "part" && DB.users.some(function (u) { return u.pid === s.pid; })) {
//     ETAT.role = "part"; ETAT.pid = s.pid; ETAT._p = prefs(s.pid);
//     // Étape D : récupérer en arrière-plan l'historique éventuel
//     var u_local = DB.users.filter(function (u) { return u.pid === s.pid; })[0];
//     if (u_local && u_local.pin) {
//       tirerHistorique(s.pid, u_local.pin).then(function (n) {
//         if (n > 0) { rendreListe(); rendreJournal(); toast(n + " séance(s) synchronisée(s)."); }
//       });
//     }
//     aller("seances");
//   }
// ──────────────────────────────────────────────────────────────────────────


// ──────────────────────────────────────────────────────────────────────────
// MODIFICATION 4 (optionnelle) : Bouton "Synchroniser" dans le journal
// EMPLACEMENT : dans rendreJournal(), après majEtatSync()
//
// Le bouton "Envoyer mes données" existe déjà (#b-envoyer).
// On ajoute un comportement bidirectionnel : envoyer + récupérer.
//
// Remplacer le handler de #b-envoyer dans init() :
//
// AVANT :
//   $("#b-envoyer").onclick = function () { envoyer(false); };
//
// APRÈS :
//   $("#b-envoyer").onclick = function () {
//     envoyer(false).then(function () {
//       var u_local = DB.users.filter(function (u) { return u.pid === ETAT.pid; })[0];
//       if (u_local && u_local.pin) {
//         return tirerHistorique(ETAT.pid, u_local.pin);
//       }
//       return 0;
//     }).then(function (n) {
//       if (n > 0) { rendreListe(); rendreJournal(); toast(n + " séance(s) récupérée(s) du serveur."); }
//     });
//   };
// ──────────────────────────────────────────────────────────────────────────