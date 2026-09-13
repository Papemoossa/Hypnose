# RELAX MIND — guide de la responsable de l'étude

Application web installable (PWA) de relaxation guidée.
30 séances · déblocage toutes les 48 h · évaluations avant/après · notation des textes · studio multi-voix · espace administrateur.

---

## 1. Essai immédiat

Ouvrez `index.html` dans Chrome (ou déposez le dossier en ligne, voir §4).

| Accès | Identifiant | Code |
|---|---|---|
| **Administratrice** | onglet *Administratrice* | `RELAX@my_mind2026` |
| **Compte de test** | `TEST` | `0000` |

Le **compte de test** ouvre les 30 séances d'un coup, sans aucune attente et sans aucune restriction : c'est avec lui que vous vérifiez l'application de bout en bout.

> Le mot de passe administrateur a été remplacé par `RELAX@my_mind2026`. Seule son empreinte (PBKDF2-SHA256, 200 000 tours) figure dans `config.js` — le mot de passe lui-même n'apparaît nulle part dans le code.

---

## 2. L'espace administrateur

**Tableau de bord** — la progression de chaque participante : pourcentage d'avancement, séances faites, minutes de pratique, gain moyen de détente, note moyenne des textes, date de dernière séance.

**Participantes** — collez les identifiants de l'enquête T0 (un par ligne). Chaque compte reçoit un **code à 4 chiffres** généré aléatoirement. Deux exports : la liste CSV (votre table de correspondance) et des **fiches imprimables** à découper et remettre à l'inclusion. Vous pouvez régénérer le code d'une participante à tout moment sans perdre ses données.

**Textes & cadence** — édition complète de chaque séance (titre, thème, objectif, texte) avec compteur en direct : mots, silences, blocs, durée estimée. `[pause 15]` insère un silence de 15 secondes. Le bouton *Écouter depuis le curseur* teste une formulation sans relire toute la séance.
La **cadence** se règle par séance : vitesse des mots, longueur des silences, durée visée. Cochez « utiliser une cadence propre à cette séance » pour qu'elle prime sur les réglages généraux ; sinon ce sont les réglages de la participante qui s'appliquent.

**Studio voix** — voir §3.

**Synthèse mémoire** — toutes les évaluations compilées : moyennes avant/après, gain, qualité des textes, taux d'observance, tableau par séance, et les remarques libres des participantes. Deux exports CSV, l'un ligne par séance réalisée (pour SPSS ou Excel), l'autre agrégé par séance.

**Réglages** — délai de déblocage, durée visée, nom de l'étude, connexion Supabase, sauvegarde/restauration du projet.

---

## 3. Studio voix — plusieurs voix pour un même texte

Vous pouvez créer **autant de jeux de voix que vous voulez** : « Ma voix douce », « Voix grave », « Voix de Fatou »… Chaque jeu couvre les mêmes textes, et chaque participante choisit celui qu'elle préfère dans son onglet *Voix*.

Le texte est découpé en **blocs** (les paragraphes). Vous enregistrez un bloc, vous l'écoutez, vous le refaites si besoin ; l'application insère elle-même les silences. Vous ne parlez donc que 5 à 6 minutes par séance au lieu d'en enregistrer vingt, et une hésitation ne vous oblige jamais à tout recommencer.

1. *Nouveau jeu de voix* → donnez-lui un nom.
2. Choisissez une séance dans la liste de gauche.
3. Laissez cochée l'option **enchaîner** : après chaque arrêt, l'enregistrement du bloc suivant démarre tout seul.
4. Quand la liste affiche `29/29 ✓`, cliquez sur **Exporter le pack audio**.
5. Décompressez le ZIP à la racine du site pour que les participantes reçoivent les fichiers.

Si un fichier manque ou ne se charge pas, l'application bascule sans interruption sur la voix de synthèse du téléphone. Conseils d'enregistrement : pièce calme, 15–20 cm du micro, débit lent, même volume d'un bloc à l'autre, une séance entière dans la même session.

---

## 4. Mise en ligne sur GitHub Pages

1. Créez un dépôt (par exemple `relax-mind`) et déposez-y **tout le contenu de ce dossier** : `index.html`, `app.js`, `textes.js`, `config.js`, `sw.js`, `manifest.webmanifest`, `icons/`, et le dossier `audio/` si vous avez enregistré vos voix.
2. Settings → Pages → Source : `main` / `root` → Save.
3. Votre adresse apparaît : `https://<votre-compte>.github.io/relax-mind/`

**Installation sur le téléphone des participantes**
Android (Chrome) : ⋮ → *Installer l'application*. iPhone (Safari) : Partager → *Sur l'écran d'accueil*.
L'application fonctionne ensuite **sans connexion**.

> Le dépôt GitHub Pages gratuit est public : tout ce que vous y déposez est lisible. N'y mettez jamais le CSV des codes des participantes ni vos sauvegardes `.rmjson`.

---

## 5. Supabase

1. Exécutez `supabase.sql` dans SQL Editor (une seule fois).
2. Espace administrateur → **Réglages** → collez l'URL du projet, la clé `anon`, la table `rm_seances`, cochez *activer la transmission automatique*, puis **Tester**.
3. À la fin de chaque séance, les données partent toutes seules. Sans réseau, elles restent sur le téléphone et sont envoyées dès le retour de la connexion.

La règle de sécurité fournie n'accorde à la clé embarquée dans l'application que le **dépôt** de nouvelles séances : ni lecture, ni modification, ni suppression. Si vous voulez utiliser le bouton *Récupérer les données du serveur*, décommentez la politique de lecture indiquée à la fin du fichier SQL — sinon exportez depuis le tableau de bord Supabase.

Sans Supabase, l'application fonctionne parfaitement : les données restent sur chaque téléphone et la participante les exporte depuis son onglet *Suivi*.

---

## 6. Ce que vit la participante

1. Elle saisit son identifiant T0 et son code à 4 chiffres.
2. Elle voit les 30 séances ; seules les débloquées sont accessibles.
3. Avant de commencer : **niveau de détente de 0 à 10**.
4. La séance se déroule — voix enregistrée si disponible, sinon voix du téléphone, avec silences, respiration guidée à l'écran et fond sonore facultatif.
5. À la fin : **niveau de détente de 0 à 10**, **note de la qualité du texte de 1 à 10 étoiles**, remarque libre facultative.
6. La séance suivante s'ouvre **48 heures plus tard**. Les séances déjà ouvertes restent accessibles autant de fois qu'elle le souhaite.

Elle règle librement sa voix, la vitesse, la longueur des silences, la durée visée (15 / 20 / 25 / 30 min) et le fond sonore.

---

## 7. Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Interface et styles |
| `app.js` | Toute la logique |
| `textes.js` | Les 30 séances livrées d'origine |
| `config.js` | Mot de passe administrateur, compte de test, réglages de départ |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation et fonctionnement hors ligne |
| `supabase.sql` | Schéma de la base |
| `test.mjs` | 44 tests automatisés du parcours complet |
| `generer-icones.html` | Régénérer les icônes si vous changez de logo |

---

## 8. À vérifier avant d'ouvrir à la cohorte

- [ ] Parcours complet effectué avec le compte `TEST` sur un Android **et** un iPhone
- [ ] Séances 13 à 30 complétées ou retirées (elles contiennent encore une zone à compléter)
- [ ] Séance 1 enregistrée avec votre voix, pack audio déposé en ligne
- [ ] Codes générés à partir des vrais identifiants T0, CSV rangé en lieu sûr, fiches imprimées
- [ ] Supabase testé depuis un vrai téléphone, une ligne visible dans la table
- [ ] Sauvegarde `.rmjson` du projet mise de côté
- [ ] Note d'information et consentement mis à jour (transmission des données, hébergeur, durées de conservation)
