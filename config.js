/* ==========================================================================
   RELAX MIND — configuration de la cohorte
   Ce fichier est REGÉNÉRÉ automatiquement par la console d'administration.
   Ne le modifiez pas à la main, sauf pour un test rapide.

   Il ne contient AUCUN code participante en clair : seulement, pour chaque
   participante, un sel aléatoire et un vérificateur dérivé (PBKDF2), qui ne
   permettent ni de retrouver le code, ni de déchiffrer les données.
   ========================================================================== */
var RM_CONFIG = {
  version: 1,
  etude: "Auto-hypnose et stress professionnel",
  iterations: 250000,      // tours PBKDF2 pour dériver la clé depuis le code
  unlockHours: 72,         // délai entre deux séances
  dureeDefaut: 20,         // durée cible d'une séance, en minutes
  lockMinutes: 15,         // verrouillage automatique après inactivité
  maxAttempts: 8,          // tentatives avant blocage temporaire prolongé
  adminPubKey: null,       // clé publique de séquestre (base64 SPKI)
  adminFingerprint: "",    // empreinte lisible de cette clé
  participants: [],        // [{ pid, salt, verif }]
  audio: null,             // voix enregistrée : { "1": { ext:"webm", blocks:{ "0":{d:12.4} } } }
  sync: null               // transmission : { url, key, table } — clé anonyme, insertion seule
};
