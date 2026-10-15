# Margen

A local Spanish reader. Hover (mouse) or tap a word to see English in a small popup; select text for a whole-sentence translation. No AI is used for translations — everything comes from open data.

## Run

Requires Node 18+. No npm install needed.

    node scripts/setup.js     # once: downloads ~150 MB of open data (or press Download in the app)
    npm start                 # http://localhost:3210
    npm run lan               # also reachable from your phone on the same Wi-Fi (prints the URL)

On a phone, open the printed URL and use "Add to Home Screen".

## Phone-only web version

`npm run build-web` (after setup) writes `web/`, a static copy that needs no computer once hosted: the dictionary runs in the browser and your texts are stored on the phone. Upload the `web/` folder to any static host over HTTPS (for example Netlify Drop, Cloudflare Pages or GitHub Pages), open the address on your phone and Add to Home Screen. Tap "Save for offline" once to keep the dictionary on the phone (about 100 MB).

Differences from the computer version: Wikipedia works, but Project Gutenberg and LibriVox cannot be fetched by a web page, so paste Gutenberg text under Add text instead.

## Data and licences

- Dictionary, word forms, frequency, sentences: github.com/doozan/spanish_data (Wiktionary, CC BY-SA; Tatoeba, CC BY 2.0 FR)
- Verb tense labels: Fred Jehle verb tables (CC BY-NC-SA, personal use)
- Project Gutenberg (public domain), Spanish Wikipedia (CC BY-SA, with images and English reference article), LibriVox audio (public domain)
- Link-only: ManyThings, Tatoeba, StoryWeaver, Free Kids Books, Cervantes Virtual, Lingua, Bilinguis/Alba

## Security

Binds to 127.0.0.1 unless `--lan`. Host-header check, JSON-only POSTs, host allowlists for downloads and images, path-traversal checks.

## Adding a source

Create `lib/sources/<name>.js` exporting `{id,name,kind,description,placeholder,search(q,{page}),import(id)}` and register it in `lib/sources/index.js`.

## Tests

    npm test
