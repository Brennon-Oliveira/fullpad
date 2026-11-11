# Segurança

O Fullpad abre arquivos de origem desconhecida (Markdown, CSV, JSON, PDF, EPUB...) e guarda texto das pessoas, então tratamos relatos de segurança com prioridade.

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o relato privado do GitHub: na aba **Security** do repositório, clique em **Report a vulnerability** e descreva:

- o que acontece e qual o impacto;
- como reproduzir (de preferência com um arquivo pequeno que dispare o problema);
- a versão do Fullpad e o sistema.

Você receberá uma resposta em alguns dias. Depois da correção publicada, o crédito é seu, se você quiser.

## O que conta como vulnerabilidade

- Abrir um arquivo (PDF, EPUB, Markdown, CSV, JSON...) que execute código, acesse a rede ou leia ou grave fora do que a pessoa abriu.
- Um arquivo pequeno que trave ou esgote a memória do app (bomba de compressão, expansão de entidades XML e semelhantes).
- Qualquer jeito de **perder texto** ou de **sobrescrever um arquivo sem confirmação**.
- Falha na verificação das atualizações automáticas.

## Versões suportadas

Só a **última versão** publicada em [fullpad-releases](https://github.com/Brennon-Oliveira/fullpad-releases/releases/latest) recebe correções de segurança; o app se atualiza sozinho.

## Como o app se protege (resumo)

PDF, EPUB e Markdown abrem sem executar scripts e sem rede; links só `http`, `https` e `mailto`; o EPUB passa por lista de permissão de HTML e CSS e roda num quadro isolado; o PDF é verificado contra bomba de compressão antes de abrir; toda gravação é atômica. Os detalhes estão em [`docs/AGENTS.md`](docs/AGENTS.md).
