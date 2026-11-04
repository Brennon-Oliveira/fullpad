---
titulo: Ferramentas de texto (decodificar, gerar, transformar, dados falsos)
feita: não
versao: —
---

# Ferramentas de texto

Um conjunto de utilitários que trabalham com o texto que está no editor, sem sair do app. Esta nota é para **planejar**: levantar o que faz sentido, o que é mais usado e onde moram na interface, antes de escolher o que entra primeiro.

## Candidatas

**Decodificar e inspecionar**
- Token JWT: mostrar cabeçalho e corpo decodificados, datas (`exp`, `iat`) legíveis e se está expirado. Só decodifica; **não valida assinatura** nem pede chave.
- Base64 (codificar/decodificar), URL encode/decode, entidades HTML.
- Timestamp Unix ↔ data legível, com fuso.
- Hash de um texto (MD5, SHA-1, SHA-256), contagem de palavras, caracteres, linhas e bytes.

**Gerar**
- GUID/UUID (v4, v7), em lote; senha aleatória; texto de exemplo (lorem ipsum); número aleatório; data/hora atual em formatos.

**Transformar**
- Maiúsculas/minúsculas, `camelCase`/`snake_case`/`kebab-case`, ordenar linhas, remover duplicadas, inverter, aparar espaços, numerar linhas, juntar/quebrar linhas.
- Conversão entre JSON, YAML e TOML (pendência já anotada em [yaml-toml](yaml-toml.md)), JSON ↔ CSV.
- Escapar/desescapar texto (JSON, regex, strings de código).

**Dados falsos**
- Gerar dados de exemplo num JSON (nomes, e-mails, datas, CPF/CNPJ válidos de teste, endereços), a partir de um esquema simples ou de um modelo preenchido (`{{nome}}`), com a quantidade pedida.

## Onde moram

- Como **comandos da [paleta](paleta-de-comandos.md)** (`>`), sobre a seleção ou o arquivo todo, que já lê os menus. Provavelmente um menu "Ferramentas" no topo, para os comandos aparecerem na paleta sem trabalho extra.
- Resultado: substituir a seleção, inserir no cursor, abrir numa nota nova ou só mostrar num painel/mensagem (decodificar não deve mexer no texto).
- Os que são específicos de um tipo de arquivo (JWT em strings de JSON, dados falsos no JSON) podem entrar também no menu do tipo, como o "JSON" já tem.

## Pontos a decidir

- Quais entram primeiro (sugestão: JWT, UUID, Base64, timestamp, transformar linhas) e quais são só vontade.
- Lógica em `crates/core` (testável, sem UI) ou na UI: geradores e hashes combinam melhor com o Rust (dependências pequenas, testes); transformar linhas é trivial na UI.
- Gerador de dados falsos: biblioteca pronta (`fake`) ou lista própria em português; reprodutível com uma semente.
- Segurança: JWT e senhas são sensíveis; nunca enviar para fora, nada de rede e nada gravado em histórico além do que o usuário colar no editor.

## Cuidados

- Cada ferramenta é uma transação do editor (um passo no Ctrl+Z).
- Tudo com teste; as puras como funções sem DOM.
