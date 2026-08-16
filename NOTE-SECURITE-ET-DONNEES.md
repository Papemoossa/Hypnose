# RELAX MIND — Note sur la sécurité et la protection des données

*Annexe rédigée pour être jointe au protocole, au dossier de comité d'éthique et à la note d'information des participantes. Adaptez les mentions entre crochets.*

---

## 1. Nature du traitement

L'application RELAX MIND est un support d'intervention utilisé par les participantes de l'étude [titre de l'étude] pour réaliser à domicile des séances de relaxation guidée.

Elle enregistre, pour chaque séance réalisée : la date et l'heure, la durée d'écoute, une auto-évaluation du niveau de détente avant et après (échelle 0–10) et une remarque libre facultative.

**Aucune donnée d'identité n'est saisie** : ni nom, ni prénom, ni date de naissance, ni numéro de téléphone, ni adresse, ni donnée de localisation. La participante est identifiée par le seul code de l'enquête T0.

## 2. Architecture et transmission

L'application fonctionne sur le téléphone de la participante, y compris hors connexion. Il n'existe ni compte utilisateur, ni identification nominative, ni service tiers de mesure d'audience.

À la fin de chaque séance, les données de pratique sont transmises automatiquement à l'investigatrice, **après avoir été chiffrées sur le téléphone avec la clé publique de l'investigatrice**. L'hébergeur [nom de l'hébergeur, région] ne stocke qu'un bloc chiffré qu'il ne peut pas déchiffrer : il joue le rôle d'une boîte aux lettres scellée.

Deux garde-fous techniques encadrent cette transmission :

- la politique de sécurité du contenu de l'application n'autorise **qu'une seule destination réseau**, celle du serveur de l'étude ; toute autre connexion est bloquée par le navigateur lui-même ;
- la règle de sécurité de la base (RLS) n'accorde à la clé publique embarquée dans l'application **que le droit d'insérer** : aucune lecture, aucune modification, aucune suppression n'est possible depuis un téléphone, y compris pour les envois d'une autre participante.

En l'absence de réseau, les données restent chiffrées sur le téléphone et sont transmises automatiquement au retour de la connexion. La participante dispose en outre d'un export manuel chiffré.

L'application ne contient aucune bibliothèque externe, aucun cookie et aucun traceur.

## 3. Chiffrement des données

| Élément | Mesure |
|---|---|
| Données de pratique sur le téléphone | Chiffrement **AES-256-GCM** (chiffrement authentifié) |
| Clé de chiffrement | Aléatoire, 256 bits, générée sur l'appareil |
| Protection de cette clé | Dérivation **PBKDF2-SHA256, 250 000 itérations**, à partir du code d'accès personnel et d'un sel aléatoire propre à chaque participante |
| Code d'accès | Jamais stocké, ni en clair ni sous forme réversible ; seul un vérificateur dérivé, inutilisable pour déchiffrer, est présent |
| Transmission automatique | Charge chiffrée avec la clé publique de l'investigatrice avant l'envoi ; le serveur ne détient aucune clé de déchiffrement |
| Transfert manuel de secours | Fichier `.rmx` chiffré, déchiffrable uniquement avec la clé privée de l'investigatrice |
| Droits du serveur | Insertion seule (RLS) ; aucune lecture possible avec la clé embarquée dans l'application |
| Destinations réseau autorisées | Une seule, celle du serveur de l'étude, imposée par la politique de sécurité du contenu |
| Séquestre de récupération | **RSA-OAEP-2048** : la clé de données est également scellée avec la clé publique de l'investigatrice |
| Poste de l'investigatrice | Console d'administration chiffrée par une phrase de passe (PBKDF2-SHA256, 400 000 itérations) |

En cas de perte ou de vol du téléphone, les données sont inexploitables sans le code d'accès personnel, y compris par extraction directe du stockage du navigateur.

## 4. Contrôle d'accès

- Le code d'accès personnel est exigé à chaque ouverture de l'application.
- Verrouillage automatique après [15] minutes d'inactivité.
- Ralentissement exponentiel après trois tentatives erronées, avec blocage temporaire.
- Aucun accès administrateur, aucune porte dérobée et aucun mécanisme de contournement ne sont présents dans l'application distribuée aux participantes. La gestion des textes et des codes se fait dans un fichier distinct, conservé hors ligne par l'investigatrice.

## 5. Rôle de la participante

La participante conserve la maîtrise de ses données :

- elle décide seule d'exporter et de transmettre son fichier ;
- elle peut effacer l'intégralité de ses données depuis l'application, à tout moment, sans justification ;
- elle peut cesser sa participation à tout moment ;
- elle peut demander à l'investigatrice la suppression des données déjà transmises.

## 6. Conservation

Les envois sont conservés sous forme chiffrée sur le serveur de l'étude pendant [durée], puis purgés. Les fichiers reçus et le tableau agrégé sont conservés par l'investigatrice sur [support / poste], sous forme chiffrée, pendant [durée] à compter de la fin de l'étude, puis détruits. La table de correspondance identifiant T0 ↔ code d'accès est conservée séparément des données de pratique et détruite à [échéance].

## 7. Limites déclarées

Par honnêteté méthodologique, les limites suivantes sont explicitement reconnues :

- La protection repose sur le code d'accès personnel : sa divulgation par la participante annule la confidentialité de ses propres données.
- Un téléphone déjà compromis par un logiciel malveillant échappe à toute protection applicative.
- Le chiffrement est réel et sans porte dérobée : la perte simultanée, par l'investigatrice, de sa phrase de passe et de son fichier de clé de secours rendrait les données définitivement irrécupérables.
- Les auto-évaluations de détente sont déclaratives et soumises aux biais habituels de ce type de mesure.
- La transmission automatique implique un hébergeur tiers : celui-ci ne peut pas lire les données, mais il connaît l'existence d'un envoi, son horodatage et le code T0 associé (métadonnées de routage). Ces métadonnées ne comportent aucune donnée d'identité.
- Les enregistrements audio des séances sont produits par l'investigatrice ; ils ne contiennent aucune donnée de participante et sont diffusés à l'ensemble de la cohorte.

## 8. Vérifications effectuées

L'application est accompagnée d'une suite de 51 tests automatisés exécutés à chaque génération, qui vérifient notamment :

- l'absence, dans l'application distribuée, de tout code d'accès en clair, de la clé privée et de toute fonction d'administration ;
- l'illisibilité effective des données stockées sur l'appareil ;
- le refus d'un code erroné et l'impossibilité d'ouvrir le coffre d'une autre participante ;
- le fonctionnement de la voie de récupération par clé de secours ;
- l'activation du ralentissement après tentatives répétées ;
- le maintien du délai de 72 heures entre deux séances ;
- l'absence de toute donnée lisible dans ce qui transite vers le serveur ;
- la restriction de la politique de sécurité à la seule adresse du serveur de l'étude ;
- l'absence de la clé de service (droits étendus) dans l'application distribuée.

---

*Document généré pour l'étude [titre]. Investigatrice : [nom, fonction, institution]. Date : [date].*
