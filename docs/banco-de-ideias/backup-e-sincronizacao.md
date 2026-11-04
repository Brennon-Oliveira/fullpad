---
titulo: Backup e sincronização
feita: não
versao: —
---

# Backup e sincronização

> **Estado: ideia muito futura.** Registrada para não se perder; nada a planejar agora.

Exportar tudo (sessão, notas, lixeira) para um arquivo e importar de volta; opcionalmente apontar a pasta de dados para uma pasta de nuvem (OneDrive, Dropbox) para usar o mesmo conteúdo em mais de um computador.

## Por que

A promessa do app é que nada se perde, mas hoje tudo mora numa pasta só, na máquina do usuário (`%APPDATA%\fullpad`).

## Perguntas para quando chegar a hora

- Formato do backup (um `.zip` com a pasta de dados, ou algo que dê para abrir à mão).
- Importar: substitui tudo ou mescla com o que já existe; o que fazer com ids repetidos.
- **Duas máquinas na mesma pasta**: conflito de `session.json` e de notas editadas nos dois lados; o app só garante instância única por máquina.
- Backup automático periódico, com quantas cópias guardar.
- Criptografar o backup (liga com a ideia de notas protegidas por senha, que também está só como pensamento).

## Pontos de apoio

- Toda gravação já é atômica e o `session.json` ilegível já vai para `.corrupt`: a base para um backup consistente existe ([persistência](../rules/persistencia.md)).
