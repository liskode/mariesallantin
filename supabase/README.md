# Supabase — catalogue Marie Sallantin

Projet : `https://leezsypadtvypdgqgvtk.supabase.co`

## État actuel (schéma v2)

- Fichier unique : `migrations/20250617000000_initial_catalogue_schema.sql`
- **Seed des codes** uniquement (séries, formats, techniques, statuts publication/photo, types de médias)
- Table `works` **vide** — pas d’import des anciennes œuvres
- Dimensions physiques : `width_cm`, `height_cm` (décimales, optionnelles)
- Publication : table `publication_statuses` (`N`, `C`, `W`) → FK `works.publication_status_code`
- Photo : table `photo_statuses` (`OK`, `HQ`, `LQ`, `REDO`) → FK `works.photo_status_code`
- Médias liés : `related_media` + liaisons `related_media_works` / `related_media_series`
- Clé œuvre stable : `MS####` ; image : `{id}.jpeg`

**Attention** : ré-exécuter le SQL sur un projet déjà migré **supprime et recrée** les tables catalogue (données œuvres/médias perdues si présentes).

## Appliquer le schéma (sans CLI)

1. Ouvrir [Supabase Dashboard](https://supabase.com/dashboard) → projet **leezsypadtvypdgqgvtk**
2. **SQL Editor** → New query
3. Coller le contenu de `migrations/20250617000000_initial_catalogue_schema.sql`
4. **Run**
5. Vérifier dans **Table Editor** : `series`, `formats`, `techniques`, `works` (vide), `work_series`

## Variables d’environnement (ne pas committer les clés)

Copier `.env.example` vers `.env` à la racine du dépôt :

```bash
cp .env.example .env
```

Récupérer dans **Project Settings → API** :

| Variable | Où la trouver |
|----------|----------------|
| `SUPABASE_URL` | Project URL (déjà connue) |
| `SUPABASE_ANON_KEY` | `anon` `public` — utilisable dans le navigateur (avec RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` — **serveur / scripts uniquement**, jamais dans le site public |

## Storage (plus tard)

Bucket suggéré : `catalogue`  
Fichiers : `MS0024.jpeg`, miniatures `MS0024.webp`  
Policies à définir quand l’upload sera branché.

## Import works.json → Supabase

1. Exécuter `migrations/20250617140000_collectors_work_messages.sql` dans le SQL Editor
2. Renseigner `.env` : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (requis pour l’import)
3. `npm install` puis :

```bash
npm run supabase:import-works
# ou : node scripts/import-works-to-supabase.mjs chemin/vers/works.json
```

## Collectionneurs (provenance)

1. Exécuter `migrations/20250617150000_collectors_type.sql` (type : Galerie / Institutions / Particulier)
2. Exécuter `migrations/20250617160000_collectors_code_pk.sql` (clé stable `code` COL####, `name` éditable)
3. `npm run supabase:update-collectors`

Détection depuis `title` / `filename_original` / nom de fichier media : `*`, `COL`, `COLPART`, `col part`, `Coll.` + nom.  
Normalisation : NF / Galerie Nicole Ferry → **Nicole Ferry** (Galerie) ; FNAC → **Fond National d'Art Contemporain** (Institutions) ; sans nom → **non précisé**.

### Éditeur web (local)

```bash
npm run collectors:api
# puis http://127.0.0.1:47832/
```

Mot de passe : `MS75` (`CATALOGUE_EDITOR_TOKEN`). L’API locale utilise `SUPABASE_SERVICE_ROLE_KEY` depuis `.env`.

### Éditeur en ligne (GitHub Pages + Edge Function)

La page statique `collectors.html` appelle l’Edge Function `collectors-api` (service role côté serveur, jamais exposé au navigateur).

**1. Déployer la fonction** (une fois, ou après modification de `supabase/functions/collectors-api/`) :

```bash
# Installer la CLI : https://supabase.com/docs/guides/cli
brew install supabase/tap/supabase   # macOS

cd /chemin/vers/mariesallantin
supabase login
supabase link --project-ref leezsypadtvypdgqgvtk

# Secrets (Dashboard → Edge Functions → Secrets, ou CLI) :
#   CATALOGUE_EDITOR_TOKEN=MS75
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY : fournis automatiquement par Supabase (ne pas les définir).

supabase secrets set CATALOGUE_EDITOR_TOKEN=MS75

supabase functions deploy collectors-api --no-verify-jwt
```

`verify_jwt = false` est déjà dans `supabase/config.toml` : l’accès est protégé par le mot de passe `MS75` dans la requête, pas par un compte Supabase.

**2. Configurer le site** — dans `media/collectors-config.json`, renseigner la clé **anon** (publique, depuis Project Settings → API) :

```json
{
  "supabaseUrl": "https://leezsypadtvypdgqgvtk.supabase.co",
  "collectorsApiUrl": "https://leezsypadtvypdgqgvtk.supabase.co/functions/v1/collectors-api",
  "anonKey": "eyJhbGciOiJIUzI1NiIs..."
}
```

**3. Publier** — merger `supabase-migration` sur `main` / pousser vers GitHub Pages.

**URL** : `https://mariesallantin.art/collectors.html` (ou votre domaine GitHub Pages).

Les vignettes au survol utilisent `media/works.json` et `media/catalogue/_thumbs/` déjà hébergés sur le site.

### Éditeur séries (en ligne)

1. Exécuter `migrations/20250617170000_series_metadata.sql` dans le SQL Editor
2. Déployer l’Edge Function :

```bash
supabase secrets set CATALOGUE_EDITOR_TOKEN=MS75
supabase functions deploy series-api --no-verify-jwt
```

3. Ouvrir **https://mariesallantin.art/series.html** (mot de passe `MS75`)

Champs éditables : libellé, icône (`icon_work_id` = MS####), `year_start`, `year_end`, `description` (texte libre, paragraphes conservés).

Développement local : `npm run series:api` → http://127.0.0.1:47833/

### Éditeur formats & techniques (en ligne)

1. Exécuter `migrations/20250617180000_formats_dimensions.sql` dans le SQL Editor
2. Déployer l’Edge Function :

```bash
supabase functions deploy codes-api --no-verify-jwt --project-ref leezsypadtvypdgqgvtk
```

3. Ouvrir **https://mariesallantin.art/codes-editor.html** (mot de passe `MS75`)

Deux panneaux côte à côte : formats (code, libellé, largeur/hauteur cm) et techniques (code, libellé). Boutons **+ Nouveau** pour ajouter un code vide puis compléter la ligne.

Développement local : `npm run codes:api` → http://127.0.0.1:47834/

## Prochaines étapes

1. Brancher l’éditeur catalogue (mode MS75) vers Supabase
2. Optionnel : export `works.json` pour GitHub Pages tant que le site reste statique
