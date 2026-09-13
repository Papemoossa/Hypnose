/* ==========================================================================
   RELAX MIND — configuration
   Modifiable depuis l'espace administrateur (onglet « Réglages ») ; ce fichier
   ne fournit que les valeurs de départ.
   ========================================================================== */
var RM_CONFIG = {
  version: "3.0.0",
  etude: "Auto-hypnose et stress professionnel — district sanitaire de Diourbel",

  /* ---- protocole ---- */
  delaiHeures: 48,        // délai avant le déblocage de la séance suivante
  dureeDefaut: 20,        // durée visée d'une séance, en minutes

  /* ---- compte de test : aucune limite de temps, toutes les séances ouvertes ---- */
  compteTest: { pid: "TEST", pin: "0000", nom: "Compte de test", illimite: true },

  /* ---- mot de passe administrateur ------------------------------------
     Mot de passe en vigueur : RELAX@my_mind2026
     Seule son empreinte est stockée (PBKDF2-SHA256, 200 000 tours).
     Pour le changer : espace administrateur › Réglages › Mot de passe.     */
  admin: {
    salt: "NbTA/Ahr42gtR/wBmB4+MA==",
    hash: "dBeiUPjQF48mW9jnnfuoynYKzTc/jioNubzB0o5ryIg=",
    iter: 200000
  },

  /* ---- transmission Supabase (facultative) ---- */
  sync: { actif: false, url: "", key: "", table: "rm_seances" }
};
