# Miniatures WebP du catalogue

Les fichiers `.webp` ici sont générés automatiquement à partir des images référencées dans `media/works.json` (chemins `catalogue/…`).

À la racine du dépôt :

```bash
npm install
npm run catalogue:thumbs
```

- Les miniatures **manquantes** sont créées.
- Une miniature est **régénérée** si l’image source est plus récente qu’elle.
- `--force` : tout régénérer. `--dry-run` : prévisualiser sans écrire.

Après avoir ajouté ou remplacé des fichiers sous `media/catalogue/`, régénérez `works.json` si besoin puis relancez `npm run catalogue:thumbs`.

Sur la page catalogue, le navigateur charge d’abord ces WebP ; en cas d’absence (fichier pas encore généré), l’affichage retombe sur l’image pleine résolution.
