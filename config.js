/* ==========================================================================
   RELAX MIND — configuration
   Modifiable depuis l'espace administrateur (onglet « Réglages ») ; ce fichier
   ne fournit que les valeurs de départ.
   ========================================================================== */
var RM_CONFIG = {
  version: "3.2.0",  // v3.1 : branchement sur la nouvelle base Supabase (table ecoute)
  etude: "Auto-hypnose et stress professionnel — district sanitaire de Diourbel",

  /* ---- protocole ---- */
  delaiHeures: 48,        // délai avant le déblocage de la séance suivante
  dureeDefaut: 20,        // durée visée d'une séance, en minutes

  /* ---- compte de test : aucune limite de temps, toutes les séances ouvertes ---- */
  compteTest: { pid: "TEST", pin: "0000", nom: "Compte de test", illimite: true },

  /* ---- mot de passe administrateur ------------------------------------
     Mot de passe en vigueur : RELAX@my_mind2026
     Seule son empreinte est stockée (PBKDF2-SHA256, 200 000 tours).
     Pour le changer : espace administrateur › Réglages › Mot de passe.
     NOTE : sera remplacé par Supabase Auth en Phase B.                    */
  admin: {
    salt: "NbTA/Ahr42gtR/wBmB4+MA==",
    hash: "dBeiUPjQF48mW9jnnfuoynYKzTc/jioNubzB0o5ryIg=",
    iter: 200000
  },

  /* ---- transmission Supabase ----
     Table par défaut : "ecoute" (nouvelle base RELAX MIND).
     URL et clé se saisissent depuis Espace administrateur › Réglages.
     Pour un déploiement rapide, vous pouvez les pré-remplir ici (mais ce
     fichier étant public sur GitHub Pages, préférez la saisie côté admin). */
sync: {
  actif: true,
  url:   "https://uhwblwyedscdzvulvkqh.supabase.co",     // ← ton URL
  key:   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVod2Jsd3llZHNjZHp2dWx2a3FoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMjYyNjcsImV4cCI6MjEwNDkwMjI2N30.2_FmEb2RkgZEEk_wS5XpQMAGDHN-KDsNm0j-8x1wjsM", // ← ta clé anon
  table: "ecoute"
}
};