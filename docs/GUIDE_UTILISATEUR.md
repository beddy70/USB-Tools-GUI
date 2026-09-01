# Guide utilisateur — Turbo Everdrive USB Tools GUI

*[English version](GUIDE_UTILISATEUR.en.md)*

Ce guide s'adresse à l'utilisateur de l'application, pas au développeur (pour
l'architecture technique, le protocole ou la compilation, voir
[`README.md`](../README.md), [`docs/PROTOCOL.md`](PROTOCOL.md) et
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)).

## Sommaire

1. [Ce qu'il vous faut](#ce-quil-vous-faut)
2. [Installation (Windows)](#installation-windows)
3. [Premier lancement et connexion](#premier-lancement-et-connexion)
4. [Onglet GAMES](#onglet-games)
5. [Accès mobile](#accès-mobile)
6. [Onglet Carte SD](#onglet-carte-sd)
7. [Onglet Jouer](#onglet-jouer)
8. [Onglet Mémoire](#onglet-mémoire)
9. [Onglet Sprites](#onglet-sprites)
10. [Dépannage](#dépannage)
11. [Grille de test (QA)](#grille-de-test-qa)
12. [Questions fréquentes](#questions-fréquentes)

## Ce qu'il vous faut

- Une carte **Turbo EverDrive Pro** ou **Core**, branchée en USB à l'ordinateur
  (câble **données**, pas un câble charge-seule).
- Une console **PC-Engine / TurboGrafx-16** allumée, avec la cartouche
  branchée et **le menu de la carte affiché à l'écran**. C'est important :
  la liaison USB de la carte ne répond que lorsque son menu est actif — pas
  pendant qu'un jeu tourne (voir [Dépannage](#dépannage)).
- Windows 10/11 64 bits (le WebView2 Runtime est en général déjà installé ;
  sinon, Windows vous proposera de l'installer).

## Installation (Windows)

1. Dézippez `edlink-app-win64.zip` dans un dossier de votre choix.
2. Gardez tous les fichiers ensemble dans ce même dossier (`edlink-app.exe`
   a besoin de `WebView2Loader.dll` à côté de lui).
3. Double-cliquez sur `edlink-app.exe`.

Le dossier contient aussi :
- `edlink-cli.exe` — la version en ligne de commande (voir `LISEZ-MOI.txt`
  pour ses commandes), utile pour du dépannage avancé.
- `qa-checklist.html` — une grille de test à ouvrir dans un navigateur, voir
  [Grille de test (QA)](#grille-de-test-qa).

## Premier lancement et connexion

1. Ouvrez l'application. L'onglet **🔌 Connexion** s'affiche.
2. Choisissez le port série dans la liste déroulante (les cartes EverDrive
   apparaissent en général automatiquement), ou laissez le mode automatique.
3. Cliquez **Connecter**.
4. Une fois connecté, le bandeau en haut à droite passe au vert (« Connecté »)
   et une carte d'informations affiche le nom de la carte, sa version, etc.

Si rien ne se connecte, voir [Dépannage](#dépannage).

## Onglet GAMES

L'onglet **🕹️ GAMES** est la façon la plus rapide de retrouver et lancer un
jeu : une liste de catégories colorées façon borne d'arcade, puis une
mosaïque de pochettes.

### Organiser ses jeux

L'onglet attend cette arborescence sur la carte SD :

```
sd:/GAMES
 ├─ Action
 │   ├─ Bloody Wolf (U).pce
 │   └─ ...
 ├─ RPG
 │   └─ ...
 └─ Plateforme
     └─ ...
```

Chaque **sous-dossier de premier niveau** de `sd:/GAMES` devient une
catégorie ; les fichiers ROM (`.pce`, `.sgx`, `.rom`, `.bin`) qu'il contient
apparaissent dans sa mosaïque.

Si `sd:/GAMES` (ou votre dossier de base) **ne contient aucun sous-dossier**,
une catégorie virtuelle **GAMES** apparaît automatiquement dans la liste pour
donner accès directement aux ROM posées à la racine — pas besoin de créer un
sous-dossier juste pour un ou deux jeux. Dès qu'au moins une vraie catégorie
existe, un fichier resté à la racine sans sous-dossier n'apparaît plus que
dans l'onglet **Carte SD** (vue Liste/Icônes).

Une catégorie virtuelle **❤️ Favoris** est, elle, toujours présente en tête
de liste — voir [plus bas](#les-favoris).

Le dossier de base n'est pas obligatoirement `sd:/GAMES` : cliquez
**⚙ Changer le dossier de jeux** en haut de l'onglet pour indiquer un autre
chemin (ex. `sd:/ROMS`). Ce choix est mémorisé sur cet ordinateur.

### Naviguer

- Cliquez une **catégorie** → sa mosaïque de jeux s'affiche, avec la jaquette
  de chaque jeu quand elle est trouvée.
- **← Catégories** en haut de la mosaïque revient à la liste.
- Cliquez un **jeu** → sa fiche détaillée s'ouvre : taille du fichier, chemin
  sur la carte, écran-titre et capture en jeu (quand ils sont trouvés — ils
  alternent automatiquement toutes les 2 secondes), bouton **♡/♥** (favoris),
  boutons **▶ Jouer** et **⬇ Télécharger**.
- **Clic droit** sur une vignette de la mosaïque ouvre le même menu
  contextuel que dans l'onglet Carte SD (Jouer, Renommer, Télécharger,
  Effacer).

### Les favoris

Dans la fiche détaillée d'un jeu, le bouton **♡** (en haut, à côté de la
croix de fermeture) l'ajoute aux favoris — il devient **♥**. Cliquez à
nouveau dessus pour le retirer.

Ces jeux sont ensuite regroupés dans la catégorie virtuelle **❤️ Favoris**,
en tête de la liste des catégories de l'onglet GAMES — pratique pour
retrouver ses jeux préférés sans se souvenir dans quelle catégorie ils sont
rangés. La liste des favoris est mémorisée sur cet ordinateur (stockage
local du navigateur intégré) ; renommer ou effacer un jeu depuis le menu
contextuel garde cette liste à jour automatiquement.

### Les pochettes

Deux sources de pochettes sont disponibles, au choix via le menu déroulant
en haut de l'onglet :

- **🌐 Réseau (Libretro)** — comportement par défaut. Les jaquettes viennent
  de la base communautaire [Libretro
  Thumbnails](https://github.com/libretro-thumbnails) : ça nécessite une
  connexion Internet (uniquement pour télécharger les images — jamais pour
  parler à la carte), et les résultats sont mis en cache sur l'ordinateur
  pour ne plus jamais retaper le réseau pour un jeu déjà vu.
- **💾 Local (DB_Thumbnails)** — lit les images directement dans un dossier
  de votre choix, sans connexion Internet. Cliquez le bouton **📁** qui
  apparaît à côté du menu déroulant pour choisir ce dossier ; tant qu'aucun
  dossier n'est choisi, un message d'avertissement s'affiche et aucune
  pochette n'est cherchée. Le dossier doit contenir directement (sans
  sous-dossier intermédiaire) les images au format des dépôts Libretro
  Thumbnails :
  ```
  DB_Thumbnails/
   ├─ Named_Boxarts/<Titre> (Région).png   ← jaquette
   ├─ Named_Snaps/<Titre> (Région).png     ← capture en jeu
   └─ Named_Titles/<Titre> (Région).png    ← écran-titre
  ```
  (le dossier `Named_Logos` visible dans certains dépôts n'est pas utilisé
  par l'application). Le plus simple est de récupérer ces trois dossiers
  depuis un dépôt Libretro Thumbnails PC-Engine/SuperGrafx et de les
  regrouper à plat dans `DB_Thumbnails`, sans garder le sous-dossier du
  dépôt d'origine.

Dans les deux modes, la correspondance entre le nom du fichier ROM et le nom
utilisé par la base n'est pas toujours exacte (conventions de nommage
différentes) : quand elle n'est qu'**approchée**, un badge de pourcentage
apparaît sur la vignette et dans la fiche détaillée. En dessous d'un certain
seuil de ressemblance, ou si aucune correspondance n'est trouvée, la
vignette reste sans jaquette.

**Pour corriger une jaquette manquante ou erronée** : survolez la vignette
dans la mosaïque, cliquez le petit bouton **⚙** qui apparaît, et indiquez le
titre exact tel qu'il figure dans la base choisie (sans l'extension). C'est
mémorisé pour les prochaines fois.

## Accès mobile

Dans l'onglet **🔌 Connexion**, la carte **📱 Accès mobile** permet de
retrouver une version simplifiée de l'onglet GAMES (catégories, mosaïque
avec pochettes, lancement d'un jeu) depuis le navigateur d'un smartphone
connecté au **même réseau Wi-Fi** que l'ordinateur.

1. Cliquez **▶ Démarrer**. Un QR code et une adresse (ex.
   `http://192.168.1.23:4590`) apparaissent.
2. Sur le téléphone, scannez le QR code avec l'appareil photo, ou tapez
   l'adresse dans un navigateur.
3. La page mobile affiche les mêmes catégories que l'ordinateur (y compris
   la catégorie virtuelle GAMES si le dossier de base n'a pas de
   sous-dossier — voir [Onglet GAMES](#onglet-games) — mais pas les
   Favoris, voir plus bas) et les mêmes pochettes (réseau ou locale, selon
   la source choisie sur l'ordinateur). Toucher un jeu propose de le
   lancer directement sur la console.
4. **⏹ Arrêter** ferme le serveur — plus personne ne peut y accéder.

> ⚠️ **Sans authentification.** Ce serveur est pensé pour un réseau Wi-Fi
> domestique de confiance : n'importe qui sur ce réseau peut y accéder tant
> qu'il est démarré, et il ne doit **jamais** être exposé sur Internet (pas
> de redirection de port sur votre box/routeur). Éteignez-le si vous ne
> l'utilisez pas.

**Limites de la version mobile** (volontairement plus simple que le
bureau) : pas de catégorie Favoris (liste stockée dans le navigateur de
l'ordinateur, non partagée), pas de changement de dossier de jeux ni de
source de pochette depuis le téléphone — ces réglages restent ceux
configurés sur l'ordinateur. La connexion à la carte (USB) se fait
toujours depuis l'ordinateur, jamais depuis le téléphone.

## Onglet Carte SD

L'onglet **📤 Carte SD** est un explorateur de fichiers classique.

- **⬆** remonte au dossier parent, **⟳** actualise, **▦ / ☰** basculent entre
  vue en icônes et vue en liste.
- **📂 Importer…** envoie un fichier depuis votre ordinateur vers le dossier
  actuellement affiché.
- **Glissez-déposez** un ou plusieurs fichiers directement dans la fenêtre
  pour les envoyer.
- **Double-cliquez** un fichier ROM pour le lancer directement sur la
  console ; double-cliquez un dossier pour l'ouvrir.
- **Clic droit** sur un fichier ouvre un menu :
  - **▶ Jouer** — déploie et lance la ROM ;
  - **✏️ Renommer…** — attention, il n'existe pas de renommage natif dans le
    protocole de la carte : cette opération recopie entièrement le fichier
    sous le nouveau nom puis efface l'original (un peu plus lent qu'un vrai
    renommage sur une grosse ROM) ;
  - **⬇ Télécharger…** — enregistre le fichier sur votre ordinateur ;
  - **🗑 Effacer** — supprime le fichier de la carte (demande confirmation).

## Onglet Jouer

Un raccourci simple : **Choisir et lancer…** ouvre un sélecteur de fichier
sur votre ordinateur, envoie la ROM choisie sur la carte SD puis la lance —
en une seule étape, sans avoir besoin qu'elle soit déjà sur la carte.

**🔄 Réinitialiser la console** redémarre la console (utile si un jeu plante
ou pour revenir au menu de la carte).

**Capturer l'écran** affiche une image du menu de la carte (pas d'un jeu en
cours — voir [Dépannage](#dépannage)).

> ⚠️ **Capture d'écran, onglet Mémoire et onglet Sprites ne sont pas encore
> stables sur matériel réel** : ces fonctions lisent le bus ou la mémoire
> vidéo de la console pendant qu'elle tourne, ce qui peut **planter le jeu
> en cours** sur certaines cartes (retour au menu, voire blocage). Utilisez-
> les avec prudence en pleine partie, et n'hésitez pas à réinitialiser la
> console si besoin.

## Onglet Mémoire

Visualiseur en lecture seule de la mémoire de la carte.

- **RAM** : sur une vraie carte, chaque lecture interrompt brièvement la
  console (elle partage le même bus) — l'onglet passe donc en mode
  prudent : petits blocs, uniquement à la demande via **Rafraîchir**, jamais
  de lecture automatique en continu.
- **VRAM / CRAM** : instantané pris via le menu de la carte (comme la
  capture d'écran) — il faut donc que **le menu de la carte soit affiché**,
  pas un jeu en cours.

## Onglet Sprites

Planche de tuiles décodées depuis la VRAM (nécessite, comme ci-dessus, que
le menu de la carte soit affiché).

- Choisissez la **taille de cellule** : 8×8 (juste le fond) ou l'une des 6
  tailles réelles de sprite du VDC (16×16 à 32×64), la **palette** et le
  **zoom**.
- Cliquez une cellule pour voir son adresse VRAM et son numéro de motif.
- **Glissez** pour sélectionner un rectangle de cellules ; l'export PNG
  n'enregistre alors que cette sélection.
- **🔒 Locker** recadre l'affichage sur la seule sélection (le reste de la
  VRAM disparaît) — pratique pour suivre un même sprite au fil de plusieurs
  captures (ex. une animation) : la sélection reste posée sur la même zone
  même si vous changez la taille de cellule ou le nombre de colonnes.
- **✕ Sélection** (ou la touche <kbd>Échap</kbd>) efface la sélection et
  revient à la planche complète.

## Dépannage

**Rien ne se connecte / le port n'apparaît pas**
- Vérifiez que la console est allumée et que le **menu de la carte est bien
  affiché à l'écran**.
- Vérifiez que le câble USB transmet des données (pas un câble « charge
  seule »).
- Réessayez **Connecter** — un simple débranchement/rebranchement du câble
  suffit parfois à faire réapparaître le port.

**Message « connexion perdue » en cours d'utilisation**
- Une erreur de communication a rendu le port inutilisable pour le reste de
  la session (rare, observé sur certaines configurations Windows). L'appli
  le détecte et repasse automatiquement en « Déconnecté » plutôt que de
  répéter la même erreur en boucle : cliquez simplement **Connecter** à
  nouveau.

**« Capture d'écran » ou l'onglet Mémoire (VRAM/CRAM) échouent**
- Ces fonctions lisent la mémoire vidéo **via le menu de la carte** : elles
  ne fonctionnent que quand ce menu est affiché à l'écran, jamais pendant
  qu'un jeu tourne. Revenez au menu de la carte (bouton **Réinitialiser la
  console** si besoin) puis réessayez.

**Le listing de l'onglet Carte SD échoue (timeout)**
- Protocole encore en cours de validation sur certaines cartes — voir
  [`docs/PROTOCOL.md`](PROTOCOL.md) pour l'état exact et comment nous
  remonter une trace de diagnostic si le problème persiste chez vous.

**Aucune pochette ne s'affiche dans l'onglet GAMES**
- Vérifiez la connexion Internet de l'ordinateur (nécessaire uniquement pour
  télécharger les images, pas pour parler à la carte).
- Le jeu peut simplement ne pas avoir de correspondance suffisamment fiable
  dans la base — associez-le manuellement via le bouton **⚙** de sa
  vignette (voir [Onglet GAMES](#onglet-games)).

## Grille de test (QA)

`qa-checklist.html` (fourni à côté de l'application) est un formulaire de
validation autonome à ouvrir dans un navigateur : aucune installation,
aucune donnée envoyée nulle part. Il liste les points à vérifier après une
mise à jour (connexion, transferts, lecture mémoire…), avec statut et
capture d'écran par ligne, et génère un rapport Markdown prêt à partager.

## Questions fréquentes

**Dois-je garder la console allumée en permanence ?**
Oui, tant que vous utilisez l'application — la liaison USB de la carte
dépend de l'alimentation de la console.

**Puis-je utiliser l'application sans connexion Internet ?**
Oui, y compris les jaquettes de l'onglet GAMES en choisissant la source
**💾 Local (DB_Thumbnails)** (voir plus haut) : la connexion à la carte, le
transfert de fichiers, la capture d'écran, la mémoire, les sprites et les
favoris fonctionnent entièrement hors ligne. Seule la source **🌐 Réseau**
des jaquettes nécessite Internet.

**Où sont mémorisés le dossier de jeux et les associations de jaquettes ?**
Dans le stockage local du navigateur intégré à l'application, propre à cet
ordinateur — ça ne voyage pas avec la carte SD ni avec un export.
