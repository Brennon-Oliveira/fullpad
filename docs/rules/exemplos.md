# Exemplos (`examples/`)

Os arquivos de `examples/` existem para **mostrar o app funcionando**: quem abre um deles deve ver, em poucos segundos, o que o Fullpad faz com aquele tipo. Também são o material de teste manual de cada recurso.

## Como deve ser um exemplo

- **Um arquivo por tipo**, chamado `example.<ext>`. Tipo novo suportado pelo app ganha o seu.
- **Mostre o máximo de recursos do tipo**, não o mínimo. Cada recurso da linguagem ou da visão que o app trata (ou trata de um jeito especial) aparece pelo menos uma vez, incluindo os casos de borda que já deram problema: número enorme no JSON, chave repetida, célula com aspas e quebra de linha no CSV, bloco de código sem fechar no markdown.
- **Nada genérico nem irrelevante.** Sem `foo`/`bar`, sem "lorem ipsum", sem trechos que não exercitam nada. Cada trecho tem de ser uma coisa que o app faz de um jeito visível. Conteúdo fictício e plausível (o PDF, o EPUB e o DBML falam de assuntos reais do universo inventado), nunca dados de pessoas, empresas ou segredos de verdade.
- **Nem curto, nem exagerado.** Longo o bastante para **forçar rolagem** (passe de uns 80 linhas, mais que uma tela, para testar sumário, rolagem sincronizada e posição lembrada) e curto o bastante para ser lido: acima de ~250 linhas, corte repetição. Exceção: arquivo gerado para testar volume (`example.json`, `example.csv`), que vem dos scripts de `_gerar/`.
- **Organizado em seções** com títulos (ou comentários, nos formatos sem títulos), para o sumário lateral e a paleta (`@`) terem o que listar.
- **Texto em português**, com acentuação correta, como o resto do projeto.

## Manter em dia

- Recurso novo que muda o que o app faz com um tipo (diagramas Mermaid no markdown, equações, uma opção nova do CSV…): **acrescente-o ao exemplo do tipo no mesmo commit** da funcionalidade. Se o recurso ganhou um tipo de arquivo próprio (`.mmd`, `.tex`), crie o `example.<ext>`.
- A tabela de `examples/README.md` descreve, em uma linha, **o que abrir para ver** em cada arquivo. Arquivo novo ou recurso novo atualiza essa linha.
- Mudou um exemplo gerado: altere o script em `examples/_gerar/` e rode-o, nunca edite o resultado à mão (`dados.py`, `pdf.py`, `epub.py`; instruções no README).
- Abra o exemplo no app antes de entregar: se o recurso não aparece ali, ele ainda não está pronto.
- O que for ideia ou problema achado ao abrir um exemplo vai para uma issue ([issues.md](issues.md)), não para um comentário no arquivo.
