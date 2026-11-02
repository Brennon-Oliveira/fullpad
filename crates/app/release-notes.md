## Novidades

- Arquivos JSON (`.json`, `.jsonc`, `.geojson`) abrem com uma árvore ao lado do texto: listas e objetos se expandem e recolhem, e Ctrl+clique abre tudo abaixo do nó. Para JSON colado numa nota, escolha Linguagem > JSON.
- Na árvore, links abrem no navegador, cores como `#ff8800` ou `rgb(10,120,200)` ganham um quadradinho colorido e imagens (por link ou arquivo do seu computador) aparecem numa miniatura ao passar o mouse.
- Passar o mouse num item da árvore mostra a linha dele no texto, e o cursor do texto destaca o item na árvore. O caminho do item (como `$.lista[0].nome`) aparece na barra de status.
- Novo menu "JSON": formatar o documento ou a seleção (Alt+Shift+F), minificar, ordenar chaves e escolher a indentação. Também está no botão direito, no texto e em cada item da árvore, com copiar caminho, chave e valor.
- Erros de sintaxe no JSON ficam sublinhados no texto, com a mensagem ao passar o mouse, e o texto ganha cores e blocos que dobram.

## Melhorias

- Formatar o JSON não altera números nem chaves repetidas (por exemplo, `12345678901234567890` continua igual). Se houver comentários, o Fullpad avisa em vez de apagá-los.
- Em JSONs muito grandes (mais de 300 mil itens) a árvore não é montada, mas o texto continua editável.
