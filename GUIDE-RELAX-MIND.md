# RELAX MIND — Guide de la responsable de l'étude

Application de relaxation guidée / auto-hypnose à domicile, avec **console d'administration** séparée.
30 séances · codes d'accès personnels · données chiffrées · déverrouillage toutes les 72 h · revue libre pour l'administratrice.

---

## 1. Les deux fichiers, et la règle à ne jamais oublier

| Fichier | Pour qui | Règle |
|---|---|---|
| **`RELAX-MIND-ADMIN.html`** | Vous seule | Reste **sur votre ordinateur**. Ne jamais le mettre en ligne, ne jamais l'envoyer. |
| **`RELAX-MIND.html`** (généré par la console) | Les participantes | C'est ce fichier — et lui seul — que vous distribuez ou mettez en ligne. |

Le fichier participante ne contient **ni les codes d'accès, ni votre clé privée, ni la moindre fonction d'administration**. Cela a été vérifié automatiquement : quatre tests du fichier `test.mjs` cherchent explicitement ces éléments dans l'application générée et échouent si l'un d'eux apparaît.

Autres fichiers du dossier :

| Fichier | Rôle |
|---|---|
| `index.html`, `app.js`, `crypto.js`, `textes.js`, `config.js` | Version « dossier » de l'app participante, à mettre en ligne |
| `sw.js`, `manifest.webmanifest`, `icons/`, `_headers` | Installation sur téléphone, mode hors ligne, en-têtes de sécurité |
| `admin.html`, `admin.js` | Sources de la console |
| `build.py` | Régénère les deux fichiers autonomes |
| `test.mjs` | 51 tests automatisés (parcours, chiffrement, récupération, résistance) |

---

## 2. Premier démarrage de la console

1. Ouvrez **`RELAX-MIND-ADMIN.html`** dans Chrome, Edge ou Firefox.
2. Créez votre **phrase de passe administratrice** — au moins 12 caractères, idéalement quatre mots (`lune-tranquille-diourbel-2026`).
   Elle chiffre vos textes, les codes de vos participantes et votre clé de secours. **Elle ne peut pas être réinitialisée.** Notez-la ailleurs.
3. Onglet **Sécurité** → *Générer la clé de secours*, puis **immédiatement** *Sauvegarder la clé (fichier)*.
   Rangez ce `.rmkey` ailleurs que sur votre ordinateur (clé USB, coffre, e-mail chiffré à vous-même).
4. Onglet **Participantes & codes** → collez vos identifiants T0, générez les codes.
5. Onglet **Générer l'application** → vérifiez la liste de contrôle, puis *Générer RELAX-MIND.html*.

Bouton **Enregistrer le projet** (en haut) : télécharge une sauvegarde chiffrée `.rmproj` de tout votre travail. Faites-le régulièrement — si vous changez d'ordinateur ou videz votre navigateur, c'est votre seul filet.

---

## 3. Onglet « Textes des séances »

Édition directe de chaque séance : titre, thème, objectif, texte.

- **`[pause 15]`** insère un silence de 15 secondes (bouton *Insérer [pause 15]* ou saisie directe).
- Le compteur affiche en direct : nombre de mots, nombre de silences, durée estimée, et signale si la séance contient encore une zone `[[[ à compléter ]]]`.
- **Écouter à partir du curseur** : lit le texte à voix haute depuis l'endroit où vous avez cliqué — pratique pour tester une formulation sans réécouter toute la séance.
- Vous pouvez ajouter ou supprimer des séances (les numéros se réajustent).

Les 12 premières séances sont entièrement rédigées et couvrent votre programme de 6 semaines à raison de 2 séances par semaine. Les 18 suivantes sont des canevas : l'induction et le retour sont déjà écrits, seul le corps est à remplacer.

> **Durée automatique** : vous n'avez pas à calibrer la longueur. L'application étire les silences pour atteindre la durée choisie par la participante (15, 20, 25 ou 30 min), sans jamais raccourcir un silence que vous avez écrit.

---

## 4. Onglet « Participantes & codes »

Collez les **identifiants de l'enquête T0** (un par ligne, par exemple `T0-001`). Pour chacun, la console génère :

```
T0-001-ELM2-FQNB-YFX7
└─┬──┘ └──────┬──────┘
identifiant   secret aléatoire (12 caractères, ~60 bits)
```

Ce qui part dans l'application distribuée : uniquement `pid`, un **sel aléatoire** et un **vérificateur** dérivé par PBKDF2. Le code lui-même n'y figure sous aucune forme réversible.

Deux exports :

- **Exporter la liste (CSV)** — votre table de correspondance identifiant T0 ↔ code. À conserver comme un document sensible.
- **Fiches à remettre (imprimable)** — une fiche par participante, avec son code et la consigne d'usage, à découper et distribuer à l'inclusion.

La saisie du code est tolérante : majuscules/minuscules, espaces et tirets superflus sont ignorés.

---

## 5. Onglet « Ma voix (studio) » — enregistrer vos séances

Oui, vos audios peuvent être **votre propre voix** : c'est même la meilleure option pour l'acceptabilité et pour la qualité hypnotique. La console enregistre directement depuis le micro de votre ordinateur.

**Le principe : paragraphe par paragraphe.** Le texte est découpé en *blocs* (un bloc = un paragraphe). Vous enregistrez un bloc, vous l'écoutez, vous le refaites si vous n'êtes pas satisfaite. L'application insère elle-même les silences.

Trois conséquences très concrètes :

- Pour la séance 1, vous ne parlez que **5 à 6 minutes** au total, réparties sur 29 blocs, au lieu d'enregistrer 20 minutes de silences.
- Une hésitation sur un paragraphe ne vous oblige jamais à recommencer la séance.
- Si vous modifiez un texte plus tard, seul le bloc concerné est signalé « texte modifié » : les autres restent valables.

**Mode opératoire pour la séance 1 :**

1. Onglet **Ma voix**, cliquez sur « 1. Premier souffle ».
2. Laissez cochée l'option **enchaîner automatiquement**.
3. Cliquez sur **● Enregistrer ce bloc**, lisez le paragraphe affiché en gros, cliquez sur **■ Arrêter**. L'enregistrement du bloc suivant démarre tout seul après une seconde.
4. Réécoutez ce qui vous semble douteux, refaites les blocs concernés.
5. Quand la liste affiche **29/29 ✓**, cliquez sur **Exporter le pack audio (ZIP)**.
6. Décompressez ce ZIP à la racine du site : vous obtenez un dossier `audio/`. Déposez-le en ligne avec le reste.
7. Regénérez l'application (onglet *Générer l'application*) pour qu'elle sache que la voix existe.

**Conseils d'enregistrement** : pièce calme, fenêtres fermées, 15–20 cm du micro, débit lent, volume constant d'un bloc à l'autre. Enregistrez une séance entière dans la même session — un changement de pièce ou d'heure s'entend.

**Poids** : environ 1 à 2 Mo par séance en Opus. Les 30 séances tiennent dans 30 à 50 Mo, téléchargés une seule fois puis conservés hors ligne par le téléphone.

**Repli automatique** : si un fichier audio manque ou ne se charge pas, l'application bascule sans interruption sur la voix de synthèse. La participante peut aussi choisir elle-même, dans l'onglet *Voix*, entre votre voix et une voix du téléphone.

---

## 6. Onglet « Revue libre » — votre demande

Toutes les séances y sont accessibles **immédiatement**, sans le délai de 72 h et sans qu'aucune donnée soit enregistrée.

- Lecture avec la voix, la vitesse, la hauteur et la durée cible de votre choix.
- Réglage **Silences : réels / ×4 / ×20 / instantanés** — pour relire les 30 séances en une session de travail au lieu de dix heures d'écoute.
- Un champ **remarques** par séance : vos notes de révision sont enregistrées dans le projet chiffré et signalées par « noté » dans la liste. C'est là que vous consignez ce que vous voulez me faire remonter.

Le délai de 72 h reste, lui, pleinement actif dans l'application des participantes : les tests le vérifient.

---

## 7. Transmission automatique des données (Supabase)

Les données remontent **toutes seules** à la fin de chaque séance, sans aucun geste de la participante, tout en restant illisibles pour le serveur.

**Comment cela reste sûr.** La charge envoyée est exactement celle du fichier `.rmx` : elle est déjà chiffrée avec **votre clé publique** avant de partir. Supabase ne fait que stocker un bloc opaque. Mieux : la règle de sécurité SQL n'accorde à la clé publique embarquée dans l'application **que le droit d'insérer** — ni lecture, ni modification, ni suppression. Et la politique de sécurité de l'application générée n'autorise **qu'une seule destination réseau au monde** : votre projet Supabase. Toute autre tentative de connexion est bloquée par le navigateur lui-même.

**Mise en place, une seule fois :**

1. Créez un projet gratuit sur <https://supabase.com>.
2. SQL Editor → collez le contenu de `supabase.sql` (ou onglet *Sécurité* → *Voir le script SQL*) → Run.
3. Settings → API : copiez l'**URL du projet** et la clé **anon / publishable**.
4. Console → onglet **Sécurité** → collez URL, clé anonyme, table `rm_uploads`, cochez **activer la transmission automatique**, puis **Tester la connexion**.
5. Collez également votre clé **service_role** : elle reste dans la console, n'est jamais distribuée, et permet le bouton *Récupérer depuis le serveur*.
6. Regénérez l'application.

**Récupération** : onglet *Données reçues* → **Récupérer depuis le serveur**. La console télécharge les envois, garde le plus récent par participante, les déchiffre avec votre clé de secours et les agrège dans le tableau exportable en CSV.

**Comportement hors ligne** : sans réseau, l'application enregistre localement et affiche « en attente de réseau ». L'envoi part tout seul dès que la connexion revient, ou à la prochaine ouverture. La participante peut aussi forcer l'envoi et garde le bouton de sauvegarde `.rmx` manuelle.

**Trois points à traiter dans votre dossier d'éthique** : la transmission n'est plus locale-seule, il faut donc (a) l'annoncer dans la note d'information et le consentement, (b) préciser l'hébergeur et la région du serveur Supabase, (c) mentionner que les données transmises sont chiffrées de bout en bout et pseudonymisées par le code T0. La section correspondante est déjà rédigée dans `NOTE-SECURITE-ET-DONNEES.md`.

---

## 8. Onglet « Données reçues » — récupération

Les participantes vous envoient un fichier **`.rmx`** (sauvegarde chiffrée, bouton *Télécharger une sauvegarde chiffrée* dans leur onglet Journal).

Déposez ces fichiers ici : ils sont déchiffrés **localement** avec votre clé de secours, agrégés dans un tableau (séances, minutes, détente avant/après, gain moyen, dernière séance), et exportables en un seul CSV pour votre analyse.

**C'est aussi la voie de secours** : si une participante perd son code, ses données restent récupérables par vous, car la clé de chiffrement est également scellée avec votre clé publique. Sans votre clé de secours, personne — pas même moi — ne peut les rouvrir.

---

## 9. Onglet « Sécurité » — ce qui protège l'application

| Menace | Réponse |
|---|---|
| Téléphone perdu, volé, prêté | Données chiffrées **AES-256-GCM**. Sans le code, elles sont inexploitables, même en extrayant le stockage du navigateur. |
| Quelqu'un devine le code | Clé dérivée par **PBKDF2-SHA256, 250 000 tours** : chaque essai coûte ~0,3 s. Avec un secret de 12 caractères (~60 bits), une attaque hors ligne est hors de portée. Ralentissement exponentiel après 3 essais dans l'application. |
| Lecture du code dans l'app distribuée | Le code n'y est pas. Seul un vérificateur dérivé y figure ; il ne permet pas de déchiffrer. |
| Interception réseau / fuite de données | Aucune requête n'est possible : `connect-src 'none'` dans la politique de sécurité du contenu. Aucun serveur, aucun cookie, aucun traceur, aucune bibliothèque externe. |
| Appareil laissé ouvert | Verrouillage automatique après 15 minutes d'inactivité (réglable) + bouton *Verrouiller*. Le code est redemandé à chaque ouverture. |
| Injection de contenu (XSS), clickjacking | CSP stricte, `object-src 'none'`, `base-uri 'none'` ; fichier `_headers` fourni pour ajouter `frame-ancestors`, HSTS et `X-Frame-Options` à la mise en ligne. |
| Perte du code par la participante | Séquestre **RSA-OAEP-2048** : vous seule pouvez rouvrir les données. |
| Vol de votre ordinateur | Le projet admin (textes, codes, clé privée) est lui-même chiffré par votre phrase de passe, avec 400 000 tours PBKDF2. |

Paramètres ajustables dans l'onglet : tours PBKDF2, minutes avant verrouillage, tentatives avant blocage, délai entre séances, durée cible, nom de l'étude.

**Les limites, dites franchement.** Aucune application locale ne résiste à un téléphone déjà compromis par un logiciel espion, ni à une participante qui donne son code. Un secret de 8 caractères (option la plus courte) offre 40 bits : suffisant ici, mais gardez 12 par défaut. Et si vous perdez à la fois votre phrase de passe **et** votre fichier `.rmkey`, rien n'est récupérable — c'est le prix d'un chiffrement réel, sans porte dérobée.

---

## 10. Mise en ligne (pour l'installation sur téléphone)

1. Onglet **Générer l'application** → *Générer textes.js + config.js*.
2. Remplacez ces deux fichiers dans le dossier du projet.
3. Déposez le dossier (sans `admin.html`, sans `RELAX-MIND-ADMIN.html`, sans `.rmproj`, sans `.rmkey`) sur <https://app.netlify.com/drop> ou GitHub Pages.
4. Diffusez le lien https obtenu.

**Android (Chrome)** : menu ⋮ → « Installer l'application ». **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».

Le fichier `_headers` fourni applique automatiquement les en-têtes de sécurité sur Netlify.

Pour un vrai `.apk` : <https://www.pwabuilder.com> → collez l'adresse → *Package for stores → Android*.

---

## 11. Voix de synthèse (repli)

L'application utilise les voix installées sur le téléphone, regroupées en féminines / masculines, avec écoute d'essai, 4 tons prédéfinis et réglages fins.

- **Android** : Paramètres › Système › Langues et saisie › Synthèse vocale → « Services de synthèse vocale Google » + langue **Français**.
- **iPhone** : Réglages › Accessibilité › Contenu énoncé › Voix › Français.

Faites ce réglage **avec chaque participante à l'inclusion** et notez la voix choisie : c'est le premier facteur d'abandon, et une variable utile pour votre volet qualitatif.

---

## 12. Données recueillies

| Colonne | Contenu |
|---|---|
| `code` | Identifiant T0 de la participante |
| `seance_id`, `seance_titre` | Séance écoutée |
| `date`, `heure` | Horodatage de fin |
| `duree_minutes` | Temps d'écoute réel |
| `detente_avant`, `detente_apres` | Auto-évaluation 0–10 |
| `gain` | Différence après − avant |
| `remarque` | Commentaire libre |

Pour le mémoire : **adhésion au protocole** (séances complétées / 12 attendues, régularité), mesure **intra-séance** répétée complétant les comparaisons PSS-10 et MBI en T0/T1, et verbatims courts pour le qualitatif.

---

## 13. Avant de lancer la cohorte

- [ ] Phrase de passe notée en lieu sûr, clé `.rmkey` sauvegardée hors de l'ordinateur
- [ ] Textes des séances 1 à 12 relus en revue libre, remarques consignées
- [ ] Séances 13 à 30 complétées ou supprimées
- [ ] Codes générés à partir des identifiants T0 réels, CSV rangé en lieu sûr, fiches imprimées
- [ ] Application générée, testée sur un Android **et** un iPhone avec un vrai code
- [ ] Séance 1 enregistrée avec votre voix, pack audio exporté et déposé en ligne
- [ ] Projet Supabase créé, script SQL exécuté, connexion testée depuis un vrai téléphone
- [ ] Circuit de secours des `.rmx` défini (WhatsApp, e-mail) et testé une fois de bout en bout
- [ ] Sauvegarde `.rmproj` du projet admin
- [ ] Note d'information et consentement mis à jour avec la section « Sécurité et données » (voir `NOTE-SECURITE-ET-DONNEES.md`)

---

*Vocabulaire : conformément au choix méthodologique du mémoire, l'interface et les textes emploient « relaxation guidée » et « concentration mentale » plutôt qu'un vocabulaire hypnotique explicite.*
