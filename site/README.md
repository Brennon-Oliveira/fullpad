# Site do Fullpad

Página única estática (HTML, CSS e JS puros, sem build) publicada pelo GitHub Pages.

- `index.html`, `style.css`, `script.js`: a página. Fontes Geist pelo Google Fonts.
- `img/`: os GIFs de cada recurso (tamanho total em torno de 18 MB; carregam sob demanda).
- `.nojekyll`: o Pages serve os arquivos como estão.

Testar local: `python3 -m http.server -d site 8000`.

Publicar: Settings > Pages > Source "Deploy from a branch", branch `main`, pasta `/site` (o Pages só aceita `/` ou `/docs`; se `/site` não aparecer, use um workflow que publique a pasta `site`).
