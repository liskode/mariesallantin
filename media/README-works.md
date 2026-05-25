# Fichier `works.json` (v2)

Source principale du catalogue : **`media/works.json`**.  
Repli : `titles.txt` si `works.json` absent ou invalide.

## Emplacement des images

Les fichiers listés dans `works` ont un champ **`media`** du type `catalogue/NomDuFichier.jpeg` : les images doivent être dans **`media/catalogue/`** (les anciens dossiers par série sous `media/` restent inchangés pour l’instant).

## Champs par œuvre

| Champ | Description |
|--------|-------------|
| `id` | Identifiant stable **`MS0001` … `MS9999`** (4 chiffres). Utilisé dans `catalog-state.json`. |
| `media` | Chemin sous `media/` (ex. `catalogue/ABSTR-….jpeg`). |
| `title` | Légende (générée depuis le nom de fichier : partie après le dernier tiret « sémantique », voir script). |
| `series` | Liste des **codes** de séries (5 caractères extraits du nom, sauf `PHOTO`). |
| `photo` | **`OK`** \| **`Redo`** (présence du code `PHOTO` dans le nom) \| **`HQ`** (manuel, haute qualité). |
| `dimensions` | Chaîne du type `2400x1800` (pixels), remplie par le script si le fichier est présent (`sips` sur macOS). |
| `tailleMo` | Taille fichier en mégaoctets, idem. |

## Régénérer depuis la liste de noms

1. Mettre à jour `data/catalogue-filenames.txt` (un nom de fichier par ligne, comme exporté depuis votre outil).
2. Copier les fichiers image dans `media/catalogue/`.
3. Lancer depuis la racine du dépôt :

```bash
node scripts/build-works-from-list.mjs
```

Chemins optionnels :

```bash
node scripts/build-works-from-list.mjs /chemin/vers/liste.txt /chemin/vers/dossier_images
```

Sans images locales, `dimensions` et `tailleMo` restent absents dans le JSON jusqu’à la prochaine exécution avec les fichiers en place.

## Ancienne chaîne `titles.txt`

Le script `scripts/generate-works-json.mjs` (déprécié pour la galerie principale) servait à l’ancienne arborescence par dossiers ; la galerie lit désormais **`works.json`** en priorité.
