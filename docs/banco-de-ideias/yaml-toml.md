---
titulo: Suporte a YAML e TOML (nos moldes da visão JSON)
feita: não
versao: —
---

# YAML e TOML

Suportar `Language::Yaml` e `Language::Toml` quase como hoje funciona o JSON: linguagem no editor, árvore ao lado do código, validação com erro sublinhado, formatação, dicas de valor e ligação código ↔ árvore.

## Reaproveitar da arquitetura do JSON

- Toda a lógica no Rust (`crates/core`), sem UI e testável, num módulo por formato (ex.: `yaml.rs`, `toml.rs`), com o **mesmo modelo de nós** do `json.rs` (pré-ordem, `end`, caminho, `hint`) para a UI reaproveitar `tree.ts`/`panel.ts` quase por inteiro.
- Posições em **UTF-16** (as do CodeMirror), erros com linha/coluna.
- Comandos IPC análogos: `*_analyze`, `*_check`, `*_format`.
- Árvore sempre ao lado do código (Ctrl+E, "Árvore em janela separada"), mouse no nó pinta o trecho, cursor abre o nó, caminho na barra de status.
- Extensões: `.yaml`/`.yml`, `.toml` (e arquivos conhecidos como `Cargo.toml`, `pyproject.toml`); também escolha pelo menu Linguagem. Sem detecção por conteúdo.
- Os mesmos limites de tamanho (`MAX_NODES`, tamanho máximo de texto) e o mesmo comportamento tolerante a erro.
- Menu superior do tipo de arquivo (`langMenuItems`) com formatar, indentação, expandir/recolher, copiar caminho.
- Carregado só sob demanda.

## Particularidades

**Preservar o texto do usuário** é a regra de ouro, como no JSON (nunca reescrever o que não foi pedido):

- **YAML**: comentários, âncoras/aliases (`&`, `*`, `<<`), múltiplos documentos (`---`), strings multilinha (`|`, `>`), tipos implícitos (`yes`/`no`, `1e3`, datas). Formatar sem perder comentários é difícil; começar com validar + árvore e só depois formatar, e **recusar** formatar quando perderia comentários (como o JSON faz).
- **TOML**: tabelas (`[a.b]`), arrays de tabelas (`[[a]]`), chaves pontuadas, datas/horas nativas, comentários. Mesmo cuidado com comentários na formatação.
- Decidir entre parser próprio (como no JSON, para ter posições e texto original) e crate existente (ex.: `toml_edit`, que já preserva formatação/comentários e posições; para YAML, avaliar crates com spans). Fazer um pequeno levantamento antes de escolher.

## Dicas de valor

As mesmas do JSON (`url`, `mail`, `image`, `color`…), decididas no Rust; no TOML acrescentar data/hora, se fizer sentido.

## Outras ligações

- Entra no [sumário lateral](sumario-lateral.md) (chaves e tabelas).
- Conversões entre JSON ↔ YAML ↔ TOML ficam como ideia futura.
