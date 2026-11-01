# Harness: `docs/` é a fonte de verdade

- Instruções para agentes vivem só em `docs/`. `CLAUDE.md`, `AGENTS.md`, `.claude/` e `.agents/` são **ponteiros**: sem conteúdo, só referência.
- Regra nova: `docs/rules/<nome>.md`. Se vale para o projeto todo, liste-a no `AGENTS.md` da raiz. Se vale para uma pasta, crie **juntos** `.claude/rules/<nome>.md` (com `paths`, corpo `@../../docs/rules/<nome>.md`) e `<pasta>/AGENTS.md` (Codex).
- Skill de projeto: `docs/skills/<nome>/SKILL.md` com o conteúdo, mais os ponteiros `.claude/skills/<nome>/SKILL.md` e `.agents/skills/<nome>/SKILL.md` (mesmo `name` e `description`).
- Não use `.codex/rules` para instruções (são políticas de execução de comandos).
- Mudou comportamento, arquitetura, comandos ou convenção: atualize `docs/` no mesmo commit.
