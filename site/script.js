(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  /* ---------- hero: brilho que segue o mouse ---------- */
  var hero = $('topo'), glow = $('glow');
  hero.addEventListener('mousemove', function (e) {
    var r = hero.getBoundingClientRect();
    glow.style.left = ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%';
    glow.style.top = ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';
  });

  /* ---------- cards: luz que segue o mouse ---------- */
  document.querySelectorAll('.cards, .guar').forEach(function (box) {
    box.addEventListener('mousemove', function (e) {
      var c = e.target.closest('.card');
      if (!c) return;
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  /* ---------- hero: janela com três arquivos ---------- */
  var ht = 'md', sortDesc = true, open = { app: true, editor: true, abas: false };
  var htDefs = [['md', 'ideias.md', 'Markdown · preview · Ctrl+E troca a visão'], ['csv', 'vendas.csv', ''], ['json', 'config.json', 'JSON · árvore ao lado do código']];
  var base = [['Ana Souza', 'Curitiba', 1240], ['Bruno Lima', 'Ponta Grossa', 380], ['Carla Dias', 'Londrina', 2915], ['Diego Rocha', 'Maringá', 760], ['Elisa Prado', 'Cascavel', 1580], ['Fábio Nunes', 'Curitiba', 495]];
  var brl = function (n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); };

  var MD = '<div class="md vin" aria-label="Exemplo: preview de um arquivo Markdown">' +
    '<p class="mdh s1">Ideias da semana</p>' +
    '<ul class="chk"><li class="s2"><span class="box on" aria-hidden="true"></span><span style="text-decoration: line-through; color: #6b6f7d;">testar o preview de tabela</span></li>' +
    '<li class="s3"><span class="box" aria-hidden="true"></span>abrir o log de 300 MB do servidor sem travar</li></ul>' +
    '<p class="s4" style="font-size: 14px; line-height: 22px; color: #a3a7b5; margin: 14px 0 0;">Meta da semana: <span style="color: #f4f4f1; font-family: \'Times New Roman\', serif; font-style: italic; font-size: 16px;">Σ horas ≥ 12</span></p>' +
    '<div class="mdt s5"><div class="mr hd"><span>dia</span><span>horas</span><span>tarefa</span></div>' +
    '<div class="mr"><span>seg</span><span class="mono">4</span><span>preview</span></div>' +
    '<div class="mr"><span>ter</span><span class="mono">6</span><span>tabela</span></div>' +
    '<div class="mr edit"><span>qua</span><span class="mono">3<span class="cursor" aria-hidden="true"></span></span><span>log</span></div></div></div>';

  function csvView() {
    var sorted = base.slice().sort(function (a, b) { return sortDesc ? b[2] - a[2] : a[2] - b[2]; });
    var h = '<div class="csv vin" aria-label="Exemplo: CSV aberto como tabela"><div class="cr ch"><span>#</span><span>cliente</span><span>cidade</span>' +
      '<button class="sortb" id="sortb" aria-label="Ordenar por valor">valor <span class="mono" style="color: #c8f25a;">' + (sortDesc ? '▾' : '▴') + '</span></button></div>';
    sorted.forEach(function (r, i) {
      h += '<div class="cr"><span class="mono" style="color: #4a4e5c;">' + (i + 1) + '</span><span>' + esc(r[0]) + '</span><span style="color: #a3a7b5;">' + esc(r[1]) + '</span><span class="mono sel">' + brl(r[2]) + '</span></div>';
    });
    return h + '</div>';
  }

  function jsonView() {
    var code = '<div class="jcode mono"><span class="k2">{</span><br>&nbsp;&nbsp;<span class="k1">"app"</span>: {<br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k1">"nome"</span>: <span class="k3">"fullpad"</span>,<br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k1">"janelas"</span>: 2<br>&nbsp;&nbsp;},<br>&nbsp;&nbsp;<span class="k1">"editor"</span>: {<br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k1">"tema"</span>: <span class="k3">"escuro"</span>,<br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k1">"fonte"</span>: 14,<br>&nbsp;&nbsp;&nbsp;&nbsp;<span class="k1">"autosave"</span>: true<br>&nbsp;&nbsp;},<br>&nbsp;&nbsp;<span class="k1">"abas"</span>: [ ... ]<br><span class="k2">}</span></div>';
    var br = function (k, meta) {
      return '<button class="tn br" data-k="' + k + '" style="padding-left: 8px;" aria-expanded="' + !!open[k] + '"><span class="tw ' + (open[k] ? 'open' : '') + '" aria-hidden="true">▸</span><span class="k1">' + k + '</span><span class="tc">' + meta + '</span></button>';
    };
    var lf = function (k, v, vc) {
      return '<div class="tn" style="padding-left: 24px;"><span class="tw" aria-hidden="true"></span><span class="k1">' + k + ':</span><span class="' + vc + '">' + esc(v) + '</span></div>';
    };
    var t = br('app', '2 chaves');
    if (open.app) t += lf('nome', '"fullpad"', 'vs') + lf('janelas', '2', 'vn');
    t += br('editor', '3 chaves');
    if (open.editor) t += lf('tema', '"escuro"', 'vs') + lf('fonte', '14', 'vn') + lf('autosave', 'true', 'vb');
    t += br('abas', '3 itens');
    if (open.abas) t += lf('0', '"ideias.md"', 'vs') + lf('1', '"vendas.csv"', 'vs') + lf('2', '"config.json"', 'vs');
    return '<div class="jsn vin" aria-label="Exemplo: JSON com árvore ao lado do código">' + code + '<div class="jtree" role="tree" aria-label="Árvore do JSON">' + t + '</div></div>';
  }

  function renderHero(full) {
    var tot = base.reduce(function (s, r) { return s + r[2]; }, 0);
    $('htabs').innerHTML = htDefs.map(function (h) {
      return '<button class="tab' + (ht === h[0] ? ' on' : '') + '" role="tab" aria-selected="' + (ht === h[0]) + '" data-v="' + h[0] + '"><span class="sdot" aria-hidden="true"></span>' + h[1] + '</button>';
    }).join('');
    $('hstat').textContent = ht === 'csv' ? 'CSV · coluna valor: 6 células · soma ' + brl(tot) + ' · média ' + brl(tot / 6) : (ht === 'md' ? htDefs[0][2] : htDefs[2][2]);
    if (full) $('hview').innerHTML = ht === 'md' ? MD : (ht === 'csv' ? csvView() : jsonView());
  }
  $('htabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]');
    if (!b || b.dataset.v === ht) return;
    ht = b.dataset.v; renderHero(true);
  });
  $('hview').addEventListener('click', function (e) {
    if (e.target.closest('#sortb')) { sortDesc = !sortDesc; renderHero(true); return; }
    var n = e.target.closest('.tn.br');
    if (n) { open[n.dataset.k] = !open[n.dataset.k]; renderHero(true); }
  });
  renderHero(true);

  /* ---------- formatos ---------- */
  var B = function (n) { return 'img/' + n + '.gif'; };
  var fmts = [
    { name: 'Markdown', ext: '.md', file: 'leia-me.md', img: 'markdown', alt: 'Markdown com live preview, tabela, equação, diagrama Mermaid e a barra de formatação', desc: 'Preview que você edita direto, com tabela, equação, Mermaid e barra de formatação.', cap: 'Markdown: preview editável, tabela em grade, KaTeX e Mermaid no mesmo arquivo.' },
    { name: 'CSV e TSV', ext: '.csv', file: 'vendas.csv', img: 'csv', alt: 'CSV como tabela: ordenar, filtrar, selecionar com estatísticas e ver o código', desc: 'Tabela com ordenação, filtro, estatísticas da seleção e edição de células.', cap: 'CSV: selecione uma coluna e veja soma e média sem abrir planilha.' },
    { name: 'JSON, YAML, TOML', ext: '.json', file: 'config.json', img: 'dados', alt: 'JSON, YAML e TOML em árvore ao lado do código', desc: 'Árvore ao lado do código, para achar a chave sem contar chaves.', cap: 'JSON, YAML e TOML: a árvore acompanha o código.' },
    { name: 'DBML', ext: '.dbml', file: 'banco.dbml', img: 'dbml', alt: 'Diagrama DBML ao lado do código, com zoom e arrastar', desc: 'O diagrama do banco ao lado do código, com zoom e arrastar.', cap: 'DBML: tabelas e relações desenhadas, exportáveis em SVG ou PNG.' },
    { name: 'Mermaid', ext: '.mmd', file: 'fluxo.mmd', img: 'mermaid', alt: 'Diagrama Mermaid ao lado do código', desc: 'O diagrama aparece enquanto você escreve, e exporta em SVG ou PNG.', cap: 'Mermaid: o diagrama ligado ao trecho de código que o gerou.' },
    { name: 'LaTeX', ext: '.tex', file: 'artigo.tex', img: 'latex', alt: 'Equações de um arquivo .tex, uma por cartão', desc: 'As equações do arquivo, uma por cartão. Ele mostra, não compila.', cap: 'LaTeX: cada equação do arquivo num cartão próprio.' },
    { name: 'PDF', ext: '.pdf', file: 'manual.pdf', img: 'pdf', alt: 'PDF: zoom e busca no documento', desc: 'Leitor com busca, zoom e copiar como citação. Nunca grava no arquivo.', cap: 'PDF: busca, zoom e copiar como citação.' },
    { name: 'EPUB', ext: '.epub', file: 'livro.epub', img: 'epub', alt: 'EPUB: sumário, capítulos e busca', desc: 'Sumário, capítulos e busca no livro inteiro.', cap: 'EPUB: sumário, capítulos e busca.' },
    { name: 'Código', ext: '.rs .ts', file: 'main.rs', img: 'codigo', alt: 'Destaque de sintaxe de várias linguagens', desc: 'Destaque de sintaxe para várias linguagens.', cap: 'Código: destaque de sintaxe para as linguagens do dia a dia.' }
  ];
  var cur = 0, manual = false;
  function renderFmts() {
    $('fmtlist').innerHTML = fmts.map(function (f, i) {
      var on = i === cur;
      return '<button class="fbtn' + (on ? ' on' : '') + '" role="tab" aria-selected="' + on + '" data-i="' + i + '"><span class="nm">' + f.name + '<span class="ext">' + f.ext + '</span></span><span class="ds">' + f.desc + '</span>' +
        (on ? '<span class="prog' + (manual ? ' stop' : '') + '" aria-hidden="true"><i></i></span>' : '') + '</button>';
    }).join('');
    var f = fmts[cur];
    $('curfile').textContent = f.file;
    $('curcap').textContent = f.cap;
    $('shot').innerHTML = '<div class="in"><img src="' + B(f.img) + '" alt="' + esc(f.alt) + '"></div>';
  }
  $('fmtlist').addEventListener('click', function (e) {
    var b = e.target.closest('[data-i]');
    if (!b) return;
    cur = +b.dataset.i; manual = true; renderFmts();
  });
  renderFmts();
  setInterval(function () { if (!manual) { cur = (cur + 1) % fmts.length; renderFmts(); } }, 5200);

  /* ---------- números de linha que correm ---------- */
  var lines = [];
  for (var i = 0; i < 2; i++) for (var n = 2999980; n < 3000000; n++) lines.push('<span>' + n.toLocaleString('pt-BR') + '</span>');
  $('rushlines').innerHTML = lines.join('');

  /* ---------- paleta de comandos ---------- */
  var allCmds = [
    ['Salvar todas as abas', 'Ctrl+Alt+S'], ['Reabrir aba fechada', 'Ctrl+Shift+T'], ['Histórico de abas', 'Ctrl+Shift+H'],
    ['Dividir painel', 'Ctrl+\\'], ['Dividir painel na vertical', 'Ctrl+Shift+\\'], ['Ir para a linha', 'Ctrl+G'],
    ['Buscar no arquivo', 'Ctrl+F'], ['Buscar em todas as abas', 'Ctrl+Shift+F'], ['Trocar visão do Markdown', 'Ctrl+E'],
    ['Recarregar do disco', 'F5'], ['Exportar como PDF', ''], ['Exportar como HTML', ''], ['Copiar como HTML', ''],
    ['Tema claro', ''], ['Tema escuro', ''], ['Nova janela', '']
  ];
  var norm = function (s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); };
  function renderCmds() {
    var q = norm($('palq').value.trim());
    var fuzzy = function (t) { var j = 0, m = norm(t); for (var i = 0; i < m.length && j < q.length; i++) if (m[i] === q[j]) j++; return j === q.length; };
    var res = allCmds.filter(function (c) { return !q || fuzzy(c[0]); }).slice(0, 7);
    $('cmdlist').innerHTML = res.map(function (c) { return '<li><span class="cm">' + esc(c[0]) + '</span><span class="sc">' + esc(c[1]) + '</span></li>'; }).join('');
    $('nocmd').hidden = res.length > 0;
  }
  $('palq').addEventListener('input', renderCmds);
  renderCmds();

  /* ---------- atalhos ---------- */
  var keys = [
    ['Paleta de comandos', 'Ctrl+P'], ['Busca global', 'Ctrl+Shift+F'], ['Reabrir aba', 'Ctrl+Shift+T'],
    ['Histórico de abas', 'Ctrl+Shift+H'], ['Salvar todas', 'Ctrl+Alt+S'], ['Ir para a linha', 'Ctrl+G'],
    ['Visões do Markdown', 'Ctrl+E'], ['Negrito, itálico, link', 'Ctrl+B I K'], ['Dividir painel', 'Ctrl+\\'],
    ['Buscar', 'Ctrl+F'], ['Desfazer, refazer', 'Ctrl+Z Y'], ['Recarregar do disco', 'F5']
  ];
  $('keys').innerHTML = keys.map(function (k) { return '<div class="key"><span>' + k[0] + '</span><kbd>' + k[1] + '</kbd></div>'; }).join('');
})();
