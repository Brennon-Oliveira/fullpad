# Site do Fullpad

Página única estática (HTML, CSS e JS puros, sem build) publicada pelo GitHub Pages.

- `index.html`, `style.css`, `script.js`: a página. Fontes Geist pelo Google Fonts.
- `img/`: um vídeo curto por recurso (`.mp4` H.264 e `.webm` VP9, mudos, em laço) e o `.webp` do primeiro quadro como poster; só tocam quando aparecem na tela (cerca de 3 MB de MP4 no total, contra 18 MB dos GIFs originais).
- `.nojekyll`: o Pages serve os arquivos como estão.

Testar local: `python3 -m http.server -d site 8000`.

Publicar: o workflow `.github/workflows/pages.yml` envia a pasta `site` a cada push na `main` que a toque (Settings > Pages > Source: GitHub Actions).

SEO e compartilhamento (no `<head>` do `index.html`): título, descrição, canonical, Open Graph, Twitter Card e JSON-LD (`SoftwareApplication`) usam a URL `https://fullpad.branaos.com.br/` (a mesma está em `robots.txt`, `sitemap.xml` e `CNAME`). A imagem de compartilhamento é `og-image.png` (1200×630) e os ícones saem de `crates/app/icons/fullpad.svg`.
