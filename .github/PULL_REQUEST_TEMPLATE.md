<!-- Título no formato dos commits: tipo(escopo): resumo no imperativo, em português. Veja o CONTRIBUTING.md. -->

## O que muda para quem usa

<!-- O efeito da mudança, não os arquivos alterados. -->

## Por quê

<!-- Contexto, decisão, o que foi descartado. Se resolve uma issue: Refs #n -->

## Como testei

<!-- Comandos que rodou e o que viu no app (use FULLPAD_DATA_DIR de teste). -->

## Lista de conferência

- [ ] `cargo test -p fullpad-core`, `pnpm --dir ui exec vitest run` e `pnpm --dir ui build` passam
- [ ] Abri o app e vi a mudança funcionando
- [ ] Testes novos para o que mudou (obrigatório em `crates/core`)
- [ ] `docs/` e `examples/` atualizados
- [ ] Mexi em dependências: rodei `python3 scripts/gerar-licencas.py` e commitei o resultado
- [ ] Nenhuma gravação fora de `write_atomic`; nenhum `import` estático de biblioteca pesada
- [ ] Commits no formato do projeto, em português
