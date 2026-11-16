# Arquivos grandes (modo de lotes do Fullpad)

Geradores de arquivos **enormes** para ver e testar o modo de arquivo grande (issue #19): o Fullpad abre um
arquivo de texto acima de 20 MB sem lê-lo inteiro, rola, vai para a linha, busca, edita e salva em fluxo.

**Os arquivos gerados não ficam no projeto** (`examples/large/grande.*` está no `.gitignore`): rode o script quando
quiser testar. Só precisa de Python 3 (biblioteca padrão, nada para instalar).

## Como gerar

Da raiz do repositório, um script por tipo; o argumento é o **tamanho aproximado em MB** (1 MB = 1.048.576 bytes;
aceita decimal; padrão 100):

```sh
python3 examples/large/gerar_txt.py  300     # examples/large/grande.txt  (~300 MB, um log)
python3 examples/large/gerar_md.py   100     # examples/large/grande.md   (~100 MB, um relatório longo)
python3 examples/large/gerar_csv.py  200     # examples/large/grande.csv  (~200 MB)
python3 examples/large/gerar_json.py 150     # examples/large/grande.json (~150 MB, lista de objetos)
```

Opções:

- `--saida CAMINHO` (ou `-o`): grava em outro lugar (outra pasta, outro disco, ou fora do repositório).
- `gerar_json.py --minificado`: o JSON inteiro numa **linha só** (o caso de um arquivo de 200 MB sem quebras).

Em Windows use `py` no lugar de `python3`. O tamanho sai a poucos por cento do pedido; o mesmo pedido gera sempre
o mesmo arquivo. Para o Fullpad abrir em modo de lotes o arquivo precisa ter **mais de 20 MB**; abaixo disso ele
abre pelo caminho normal (útil para comparar). Um arquivo de 300 MB leva alguns segundos para gerar e ocupa 300 MB
de disco: apague quando terminar.

## O que há em cada um

Todos têm acentos e emoji, uma palavra **RARA** espalhada (para a busca achar longe) e, no meio, **uma linha
gigante** (até 3 MB, sem quebra), que o Fullpad mostra em segmentos marcados com `↳` na margem.

| Arquivo | Conteúdo | Casos de borda |
|---|---|---|
| `grande.txt` | log: `data [NÍVEL] ação N concluída…` | linha gigante; 30 linhas em **CRLF** num arquivo em LF; RARA a cada 250 mil linhas |
| `grande.md` | capítulos com títulos, listas, tabela, bloco de código, equação | parágrafo gigante de uma linha; RARA a cada 500 capítulos. Abre **só como texto** (sem a visão renderizada) |
| `grande.csv` | `id,nome,cidade,valor,data,observacao` | células entre aspas com vírgula e `""`; células com **quebra de linha dentro**; célula gigante; RARA. Abre **como texto**, sem a tabela (a tabela indexaria o arquivo inteiro na memória) |
| `grande.json` | lista de objetos, um por linha (JSON válido) | objeto com string gigante; `null`, booleanos, listas; RARA. Abre **como texto**, sem a árvore |

## O que testar no app

Abra o arquivo (Ctrl+O ou arraste para a janela):

1. **Abre na hora**, com o aviso fixo no topo, o tamanho e o total de linhas na barra de status e a barra de rolagem
   do **arquivo** à direita (arraste o polegar: vai para a linha daquela altura).
2. `Ctrl+G` e uma linha (`2000000`): vai direto, sem ler o arquivo. `arquivo:42` na paleta (`Ctrl+P`) também.
3. `Ctrl+F` e `RARA`: a busca roda no arquivo todo, os resultados chegam aos poucos ("3 de 17+"); digitar outra
   coisa cancela a anterior.
4. Vá até a **linha gigante** (no meio): aparece em segmentos com `↳` na margem; edite dentro dela e salve: o arquivo
   **não ganha quebra de linha** nenhuma.
5. **Edite** perto da divisa de dois lotes (a cada 5.000 linhas), apague a quebra de linha entre eles, e salve
   (`Ctrl+S`): só os lotes editados são regravados, o resto do arquivo sai igual (`fc /b` ou `cmp` com a cópia).
6. Feche o app com alterações **não salvas** e abra de novo: elas voltam.
7. Mude o arquivo por fora (acrescente uma linha com outro programa): aparece a faixa "foi alterado fora do
   Fullpad"; salvar recusa e só oferece recarregar.

## Testes dos geradores

```sh
python3 -m unittest discover -s examples/large -p "test_*.py" -v
```

Gera cada tipo com ~1 MB e confere: tamanho, UTF-8, CSV e JSON **válidos** (lidos por `csv` e `json` de verdade,
inclusive o `--minificado`), os casos de borda acima e que o mesmo pedido gera o mesmo arquivo.
