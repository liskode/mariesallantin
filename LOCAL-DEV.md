# Prévisualiser le site en local

Les pages qui chargent `works.json`, `titles.txt` ou des images via **`fetch()`** ne fonctionnent pas correctement en ouvrant un fichier en **`file://`** (double-clic sur `catalogue.html`). Il faut un **petit serveur HTTP** lancé depuis la **racine du dépôt** (là où se trouvent `index.html`, `catalogue.html`, le dossier `media/`, etc.).

## Option 1 — Python (souvent déjà installé)

```bash
cd /chemin/vers/mariesallantin
python3 -m http.server 8765
```

Puis dans le navigateur :

- **Catalogue (gestion)** : [http://localhost:8765/catalogue.html](http://localhost:8765/catalogue.html)  
- **Édition des légendes** : [http://localhost:8765/catalogue-legende.html](http://localhost:8765/catalogue-legende.html)  
- **Accueil du site** : [http://localhost:8765/](http://localhost:8765/)

Les images du catalogue v2 doivent être sous **`media/catalogue/`** (chemins du type `media/catalogue/nom-fichier.jpeg`).

Si **`media/works_numero.txt`** est présent, le script de build l’utilise par défaut (sinon `data/catalogue-filenames.txt`) : les **id** `MS0001` … sont lus dans chaque nom de fichier, et les légendes suivent la convention « underscore » de ce fichier.

### Préfixe unique `MS0001-` … sur les fichiers

Pour numéroter les fichiers comme dans `works.json` (ordre = lignes de `data/catalogue-filenames.txt`) :

```bash
node scripts/prefix-ms-catalogue-files.mjs --dry-run   # prévisualiser
node scripts/prefix-ms-catalogue-files.mjs              # renommer + mettre à jour la liste
node scripts/build-works-from-list.mjs                  # régénérer media/works.json
```

## Option 2 — `npx serve`

```bash
cd /chemin/vers/mariesallantin
npx --yes serve . -p 8765
```

Même URL : `http://localhost:8765/catalogue.html`.

## Sous-domaine `catalogue.mariesallantin.art`

Une redirection est définie dans **`index.html`** : sur ce sous-domaine uniquement, la racine **`/`** envoie vers **`/catalogue.html`**. Le fichier **`catalogue.html`** sur le domaine principal (`mariesallantin.art/catalogue.html`) n’est pas modifié par ce mécanisme.

Côté hébergement : même dépôt GitHub Pages, DNS **CNAME** `catalogue` → cible GitHub, et ajouter le domaine personnalisé dans les réglages Pages si besoin (certificat HTTPS).
