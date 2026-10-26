# Bilan des tests — Mon Bureau Intelligent

Ce bilan porte sur la version 1.0.0. La **version 1.1.0** ajoute l'identité visuelle Bridgestone (outil interne : logo dans l'application, l'installeur et les icônes, rouge Bridgestone par défaut) et corrige une erreur à la fermeture (icône de la zone de notification déjà détruite par Electron). Pour la 1.1.0 : 75 tests unitaires réussis, 26/26 vérifications de bout en bout réussies sur deux exécutions consécutives, compilation et tests sous Windows par GitHub Actions.

Ce document indique précisément ce qui a été testé, comment, et ce qui n'a **pas** pu l'être.

## Environnement de développement

- Développement et compilation : **Linux (Ubuntu 24.04)**, Node.js 22, Electron 44.9.3.
- Les `.exe` Windows ont été **réellement compilés** (installeur NSIS + portable) par compilation croisée avec electron-builder et Wine.
- **Aucun PC Windows 10/11 n'était disponible.** L'application n'a donc pas été lancée sur un vrai Windows ; elle l'a été :
  - sous Linux (même code, même Electron) pour toutes les fonctionnalités communes ;
  - sous **Wine 9** (implémentation de Windows sous Linux) pour l'exécutable Windows empaqueté lui-même.

## 1. Tests automatisés — `npm test` (Vitest)

**75 tests, tous réussis.**

| Fichier | Tests | Ce qui est vérifié |
| --- | --- | --- |
| `tests/shared/dates.test.ts` | 6 | Dates réelles (29 février…), heures, calcul de jours insensible au passage à l'heure d'hiver, semaines du lundi, libellés français (« Demain », « Jeudi », « 12 nov. »), durées relatives |
| `tests/shared/validation.test.ts` | 13 | Champs obligatoires, longueurs, dates/heures/priorités/statuts invalides, heure sans date, rappels, données non-objet (IPC malveillant), caractères de contrôle, projets, notes, raccourcis clavier, paramètres partiels et réparation de paramètres corrompus |
| `tests/shared/quickParse.test.ts` | 10 | Saisie rapide en français : jours relatifs, jours de la semaine, dates explicites (et dates impossibles), heures, « ce soir », priorités, projets accentués, nettoyage du titre |
| `tests/shared/queries.test.ts` | 10 | Retards, vues Aujourd'hui / À venir / Priorités / Projets, tri, recherche sans accents, filtres, statistiques et série de jours |
| `tests/shared/reminders.test.ts` | 5 | Calcul du déclenchement, rappels dus / trop anciens, réarmement si l'échéance change, descriptions, résumé quotidien |
| `tests/main/dataService.test.ts` | 20 | **Base SQLite réelle** : schéma et WAL, persistance après fermeture/réouverture, **récupération automatique d'une base corrompue depuis la sauvegarde**, base vide si aucune sauvegarde, rotation des sauvegardes ; CRUD des tâches avec événements, erreurs en français, date de fin, retrait heure/rappels sans date, rappel par défaut, saisie rapide (projet créé, heure passée → demain), report, duplication, rappels déclenchés/réarmés/reportés ; projets (doublons, suppression), notes, paramètres ; export/import (remplacement, fusion, fichier étranger), restauration de sauvegarde |
| `tests/main/reminderScheduler.test.ts` | 5 | Déclenchement unique à l'heure, rappels anciens ignorés, tâches terminées ignorées, résumé quotidien unique, rappel reporté |
| `tests/main/desktopGuard.test.ts` | 4 | Intégration Win32 inactive hors Windows ; fichier témoin autour du premier appel de chaque fonction native ; **désactivation automatique** après un appel qui ne s'est pas terminé, puis réactivation ; repli si Koffi est absent |
| `tests/main/watchdog.test.ts` | 2 | Chien de garde : aucune action tant que l'application répond ; **arrêt puis relance** d'une application figée (dans la topologie réelle : le processus figé est le parent du canal de surveillance) |

## 2. Tests de bout en bout — `npm run test:e2e` (Playwright + vraie application Electron)

L'application compilée est lancée, pilotée comme par un utilisateur, fermée, puis relancée.
**26 vérifications, toutes réussies, sur 3 exécutions consécutives** (Linux + Xvfb 1920×1080) :

1. Premier lancement : tableau de bord + 4 widgets par défaut, chacun dans **sa propre fenêtre native**
2. Interface en français
3. Saisie rapide en langage naturel (« Appeler Paul demain 14h #Travail !urgent » → date, heure, projet créé, priorité, rappel par défaut)
4. Création depuis la fenêtre du widget « Aujourd'hui » (échéance du jour appliquée)
5. Mise à jour en temps réel des autres fenêtres
6. Éditeur : message « Le titre est obligatoire »
7. Éditeur : création complète (description, date, heure, priorité, statut, rappel « 1 h avant »)
8. Recherche sans accents
9. Terminer une tâche en cochant dans un widget
10. Notes rapides : enregistrement automatique
11. Affichage / masquage individuel des widgets
12. Option « Toujours au premier plan »
13. Position et taille mémorisées après déplacement
14. Aimantation au bord de l'écran
15. **Redimensionnement à la souris** (curseur réel déplacé avec xdotool sur la poignée)
16. Menus contextuels natifs (tâche, options du widget)
17. **Stress** : 25 cycles rapides d'ouverture/fermeture de widgets pendant des mises à jour, sans erreur
18. Fenêtre de saisie rapide globale
19. Fenêtre de rappel affichée à l'échéance
20. Thème sombre appliqué à toutes les fenêtres
21. Valeur de paramètre invalide refusée
22. Captures d'écran (`docs/captures/`)
23. **Après redémarrage** : tâches, notes, projets et paramètres conservés
24. **Après redémarrage** : position, taille, visibilité et « premier plan » des widgets restaurés
25. Base SQLite et sauvegarde quotidienne présentes sur le disque
26. Aucune erreur dans le journal de l'application

> Ce test a permis de trouver et corriger deux défauts réels : une erreur intermittente « Object has been destroyed » (message envoyé à une fenêtre en cours de fermeture) et des erreurs journalisées à tort quand un widget est fermé pendant son chargement. Le scénario de stress (n° 17) a été ajouté pour les reproduire.

## 3. Vérification des livrables — `npm run verify:release`

Toutes les vérifications passent : installeur et portable sont des exécutables Windows valides et des programmes NSIS ; l'exécutable principal est en **x64 (PE32+)**, sous-système **graphique** (pas de console) ; l'archive contient le processus principal, le preload et l'interface ; le module natif Koffi **Windows x64** est extrait hors de l'archive ; les icônes sont présentes ; React est intégré au bundle et les binaires Koffi des autres plateformes sont exclus.

## 4. Exécutable Windows réel sous Wine 9

Le fichier `release/win-unpacked/MonBureauIntelligent.exe` (celui que contiennent l'installeur et la version portable) a été lancé sous Wine :

| Vérifié | Résultat |
| --- | --- |
| L'exécutable Windows démarre, le runtime Node d'Electron fonctionne | ✔ (journal : « Démarrage v1.0.0 (win32, Electron 44.9.3) ») |
| **SQLite** (`node:sqlite`) dans la version Windows : création de la base, migration | ✔ |
| Chargement du binaire **Koffi `win32_x64`** depuis l'archive empaquetée | ✔ (« Intégration Win32 active ») |
| Icône de zone de notification, raccourci clavier global (`RegisterHotKey`) | ✔ (application de test Electron minimale) |
| **Chien de garde + garde-fou** : un appel natif bloque → arrêt du processus figé après 15 s → relance automatique → intégration Win32 désactivée → démarrage normal | ✔ (journaux ci-dessous) |
| **Installeur** : pages en français, choix « pour moi / tous les utilisateurs », choix du dossier, installation dans `%LOCALAPPDATA%\Programs\MonBureauIntelligent`, page de fin avec « Lancer Mon Bureau Intelligent » | ✔ ([options](captures/installeur-options.png), [dossier](captures/installeur-dossier.png), [fin](captures/installeur-fin.png)) |
| Raccourcis **Menu Démarrer** et **Bureau** créés ; entrée « Applications » du registre (nom, version, icône, désinstalleur) | ✔ |
| Lancement de l'application en fin d'installation, qui **inscrit le démarrage automatique** (`HKCU\…\Run`, avec `--hidden`) | ✔ |
| **Désinstalleur** : pages en français, question « Supprimer aussi vos données ? » (Non par défaut), suppression du programme, des raccourcis, de l'entrée de registre **et du démarrage automatique** ; données conservées en répondant « Non » | ✔ ([capture](captures/desinstallation-donnees.png)) |

```
11:21:37 [INFO]  Démarrage v1.0.0 (win32, Electron 44.9.3)
11:21:37 [INFO]  Intégration Win32 active
11:21:38 [INFO]  Migration du schéma vers la version 1
         (appel natif bloqué sous Wine)
11:21:54 chien de garde : Aucun signal depuis 15 s : arrêt du processus 268
11:21:57 chien de garde : Relance : …\MonBureauIntelligent.exe --no-sandbox --disable-gpu --relance-securite
11:21:58 [INFO]  Démarrage v1.0.0 (win32, Electron 44.9.3)
11:21:58 [ERROR] Intégration Win32 désactivée automatiquement : l'appel système « GetForegroundWindow » ne s'est pas terminé lors du lancement précédent
11:21:58 [WARN]  Relance automatique après un blocage au démarrage
```

**Limites de Wine constatées (et pourquoi elles ne concernent pas Windows) :**

- **Les fenêtres Electron 44 ne s'affichent pas sous Wine 9** : même une application Electron vide (sans aucun code de ce projet) plante dès l'ouverture d'une fenêtre, quelles que soient les options de rendu essayées. L'interface a donc été testée sous Linux (même version d'Electron, même code).
- **Certains appels Win32 via Koffi bloquent sous Wine** (`SetWindowLongW`, `DestroyWindow`, `GetForegroundWindow`…) alors que d'autres passent (`FindWindowW`, `CreateWindowExW`, `GetWindowLongPtrW`, `SendMessageW`). Koffi exécute les appels sur une pile dédiée en mettant à jour les champs `StackBase/StackLimit` du TEB, ce que gère Windows mais pas le répartiteur d'appels système de Wine 9. C'est cette situation qui a servi de banc d'essai réel au garde-fou et au chien de garde.

Pour l'installation sous Wine, une variante de test de l'installeur (non livrée) neutralise le contrôle « application en cours d'exécution » d'electron-builder : sous Wine, le tube `tasklist | find` qu'il utilise renvoie un faux positif. Ce contrôle standard fonctionne sous Windows et reste actif dans l'installeur livré.

**Défauts trouvés et corrigés grâce à ces essais :**

1. le chien de garde quittait à la fermeture du canal IPC provoquée par… son propre arrêt forcé du processus principal ;
2. le chien de garde était tué avec le processus principal : sous Windows, libuv place les processus enfants dans un *job* « tuer à la fermeture » — il est désormais lancé en processus détaché. Ce défaut se serait produit à l'identique sur un vrai Windows ;
3. l'installeur était en anglais : electron-builder ignore la langue choisie si l'installeur n'est pas déclaré « multilingue » — il est désormais généré avec le français pour seule langue (et un bandeau latéral aux couleurs de l'application).

L'ancienne technique d'« ancrage » (fenêtre de l'Explorateur `Progman` comme propriétaire des widgets) a été abandonnée au profit d'une détection de « Afficher le bureau » sans lien avec l'Explorateur (voir README, §5).

## 5. Ce qui n'a PAS pu être testé (nécessite un vrai Windows 10/11)

| Fonction | Statut | Pourquoi / risque |
| --- | --- | --- |
| Installation et désinstallation sur un vrai Windows | Testé sous Wine uniquement (§4) | Comportement standard d'electron-builder ; le script NSIS personnalisé (démarrage automatique, question sur les données) a été exécuté avec succès sous Wine. |
| Appels Win32 via Koffi (style fenêtre outil, détection « Afficher le bureau », mode discret) | Non testé sur Windows | Sous Wine, certains appels bloquent (limite de Wine, voir §4). Si cela arrivait sous Windows, le **chien de garde** relancerait l'application en moins de 20 s, sans l'intégration Win32 (fonctions concernées : style « fenêtre outil », maintien visible avec Win+D, mode discret). |
| Notifications Windows natives | Non testé | API standard d'Electron (identifiant d'application enregistré par l'installeur). La fenêtre de rappel intégrée, testée, fonctionne dans tous les cas. |
| Démarrage automatique à l'ouverture de session | Inscription vérifiée sous Wine (§4) | La clé `HKCU\…\Run` est bien écrite par l'application et retirée par le désinstalleur ; le lancement effectif à l'ouverture de session n'a pas pu être observé. |
| Raccourcis clavier globaux | Non testé (pas de clavier réel sous Xvfb) | API standard `globalShortcut` ; l'état « Indisponible » est affiché si un raccourci est déjà pris. |
| Barre de titre intégrée (boutons Réduire/Agrandir/Fermer) | Non testé | API standard `titleBarOverlay`, propre à Windows. |
| Comportement multi-écrans et mise à l'échelle (125 %, 150 %) | Partiellement | Logique de repositionnement testée en code ; non observée sur du matériel réel. |

**Recommandation :** avant une diffusion large, faire un essai de 10 minutes sur un PC Windows 10 et un PC Windows 11 (installation, widgets, Win+D, rappel, redémarrage, désinstallation) ou lancer le workflow GitHub Actions fourni (`windows-latest`), qui compile et teste sur un vrai Windows.
