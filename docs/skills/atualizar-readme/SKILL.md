---
name: atualizar-readme
description: "Atualiza o README.md do Fullpad (e o README do repositório de releases) com o que mudou: sem --full, só os trechos afetados pela explicação dada; com --full, regera tudo, mas só depois de o usuário responder exatamente \"Autorizo regerar todo o README.md\". Com --record, grava GIFs e/ou prints novos ou refeitos do que está sendo documentado. Use quando pedirem para atualizar, corrigir ou regerar o README, ou para gravar GIFs do app."
argument-hint: "[--full] [--record] [explicação do que documentar]"
---

# Atualizar README

Mantém o `README.md` do repositório de código em dia com o app. O README do repositório de releases (`Brennon-Oliveira/fullpad-releases`) espelha as **features e GIFs**, sem nenhuma menção a código além do link para o repositório de código.

## Argumentos

```
/atualizar-readme [--full] [--record] [explicação do que documentar]
```

- **Explicação** (o texto depois das flags): o que deve entrar ou mudar no README (uma feature nova, um comportamento corrigido, uma seção desatualizada). **Sem `--full`, ela é obrigatória**: se não veio, pergunte o que documentar antes de mexer em qualquer arquivo. Com `--full`, é opcional (serve de orientação).
- **Sem `--full`**: só atualizações específicas. Altere **apenas** os trechos que a explicação atinge (uma seção, uma linha da lista de recursos, uma linha da tabela por tipo de arquivo, um GIF). O resto do arquivo não é tocado, nem para "melhorar o texto".
- **`--full`**: regerar o README inteiro. Veja a confirmação abaixo.
- **`--record`**: a explicação envolve algo que vale mostrar em **GIF e/ou print**: grave os novos ou regrave os existentes (passo 3). Sem a flag, não grave nada, nem reaproveite a gravação para "aproveitar".

## Confirmação obrigatória do `--full`

Regerar tudo sobrescreve texto escrito à mão. Com `--full`:

1. **Pare antes de qualquer alteração** e diga o que será refeito (o `README.md` inteiro e, por consequência, o do repositório de releases).
2. Peça que a pessoa responda **exatamente** `Autorizo regerar todo o README.md`.
3. Só siga se a resposta for **essa frase, igual, sem acréscimo nem variação**. "sim", "pode", "ok", a frase com palavra trocada ou qualquer outra coisa **não valem**: repita o pedido, ou, se a pessoa desistiu, termine sem alterar nada.
4. A autorização não vale para a próxima chamada: a cada `--full`, peça de novo. Autorização anterior da conversa não conta.
5. Mesmo com `--full`, `--approve` não existe aqui: a confirmação não pode ser dispensada por quem chamou (nem pela `gerar-versao`; a `gerar-versao --readme` nunca passa `--full`).

## 1. Entender o que mudou

- Leia o `README.md` atual e a explicação. Confira no código e em `docs/AGENTS.md` o que de fato existe: **não documente o que o app não faz**. Se a explicação cita algo que não está implementado, pare e avise.
- Descubra onde o assunto entra: seção de GIF, "lista completa de recursos", tabela de tipos de arquivo, instalação, build.
- Escreva em português, com acentuação correta, no tom do resto do README, sem mencionar números de issue.

## 2. Editar o README

- Sem `--full`: edite só os trechos afetados (`Edit`), mantendo a ordem, o sumário e os links. Recurso novo entra na lista completa de recursos e, se tem GIF, na seção do GIF e no sumário.
- Com `--full` (já autorizado): reescreva a partir do estado atual do app e dos arquivos de `docs/`, mantendo as seções existentes (sumário, por que, tabela por tipo de arquivo, seções de GIF, lista completa de recursos, instalação com a nota do SmartScreen, build, contribuir, licença, link do repositório de releases).
- Links relativos (`docs/img/...`) e o link `https://github.com/Brennon-Oliveira/fullpad-releases/releases/latest` precisam continuar valendo.

## 3. Gravar (só com `--record`)

Use `scripts/gifs/` (cabeçalho do `gravar.sh`: Windows, janela do Fullpad maximizada numa tela de 2582×1550, Python 3.12/3.13 com Pillow e numpy; `PY=/tmp/gifs/bin/python`).

1. Decida o que gravar: GIF de cena nova ou regravação de uma existente (`scripts/gifs/gravar.sh <cena>`; as cenas ficam no próprio `gravar.sh`, uma por recurso), e/ou print (um quadro `.png` em `docs/img/`). Cena nova: acrescente-a ao `gravar.sh` com o mesmo estilo (`nav` abre a aba pela paleta sem gravar, `r`/`x` ligam e desligam a gravação, nada edita arquivo nem exporta). Se o recurso precisa de um arquivo para aparecer, ele vem de `examples/` ([../../rules/exemplos.md](../../rules/exemplos.md)).
2. **Avise a pessoa antes de começar**: o script usa mouse e teclado de verdade. Ela precisa **clicar na janela do Fullpad em até 60 s** (o Windows não deixa o programa trazer a janela) e **não tocar no mouse nem no teclado** até terminar (mexer o mouse aborta, de propósito). Espere o ok. O app instalado precisa ser uma versão que **já tenha** o recurso: se o recurso é do código de agora e o app aberto é antigo, diga isso e **não grave com a versão errada**. Não gere build do Windows por conta própria para isso: peça à pessoa.
3. Grave e **confira os quadros** antes de usar: popup de ditado do Windows, toast de outro programa, tooltip com o caminho completo de um arquivo, lista da paleta com caminhos da máquina, título de arquivo que não é de exemplo. O `montar.py` descarta os dois primeiros casos conhecidos; o resto é conferência visual (`Read` do GIF/quadro). Se vazou algo, regrave com o ponteiro longe das abas.
4. Referencie no README com `docs/img/<nome>.gif` (largura típica 960, ≤ ~1,5 MB cada; veja o tamanho). Se a gravação abortou, relate e **não use** GIF pela metade.

## 4. Espelhar no repositório de releases

Só se o README ou os GIFs mudaram em algo que o README de lá mostra (features, GIFs). Clone/atualize `Brennon-Oliveira/fullpad-releases` num diretório temporário, ajuste o `README.md` de lá (mesmo conteúdo de features e GIFs, **sem menções a código** além do link do repositório de código, nem a build, contribuição ou issues) e copie os GIFs novos para `img/`. **Este é um repositório público, fora deste**: mostre a diferença e **peça o ok** antes de dar push (push com `git -c credential.helper='!gh auth git-credential'`, o SSH não funciona).

## 5. Commit e relato

- Commite no repositório de código seguindo [../../rules/commits.md](../../rules/commits.md) (`docs(readme): …`; GIFs no mesmo commit do trecho que os usa). **Sem push**, a menos que peçam.
- Relate: o que mudou no README (trechos), GIFs/prints gravados ou refeitos (com tamanho), o que foi ou não espelhado no repositório de releases. Não gere build do `.exe` por causa desta skill.
