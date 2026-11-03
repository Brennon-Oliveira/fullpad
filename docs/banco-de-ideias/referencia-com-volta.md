---
titulo: Referência com volta (link da nota para o ponto do PDF/EPUB)
feita: não
versao: —
---

# Referência com volta

Um link dentro da nota que leva de volta ao ponto exato do PDF ou EPUB. No leitor, "Copiar referência" gera algo como `[Nome do livro, p. 42](fullpad-leitor://...)`. Ao clicar no link (duplo clique ou Ctrl+clique, como nos links de hoje), o Fullpad abre ou ativa a aba do arquivo e vai direto à página (PDF) ou ao capítulo e posição (EPUB). A nota deixa de ser só uma cópia do trecho e vira um índice que volta à fonte.

Depende do [leitor de PDF e EPUB](leitor-pdf-epub.md) (a base binária e a posição de leitura).

## Pontos a decidir

- **Esquema do link e identidade do arquivo.** O caminho cru quebra se o arquivo for movido. Alternativas: identificar por um hash/ID do arquivo guardado no registro de posições, com o caminho só como dica.
- **Segurança.** Um link colado de fora poderia apontar para qualquer caminho. A aba só mostra o botão "Carregar" e não lê nada sozinha, o que reduz o risco; mesmo assim avaliar confirmação ao abrir um arquivo que o usuário nunca abriu. Vale a regra do projeto: o app só lê o que o usuário abriu explicitamente.
- **Arquivo movido.** O link cai no fluxo "Localizar arquivo…" do leitor.
- **Onde mexe no que já existe.** `ui/src/links.ts` hoje só abre `http`/`https`/`mailto`; seria preciso reconhecer o esquema novo. A mudança é pequena e aditiva, mas toca em código atual, por isso fica fora da entrega do leitor.

## Fora de escopo

- Voltar a um trecho específico por busca de texto (só página/capítulo e posição).
- Links entre notas.
