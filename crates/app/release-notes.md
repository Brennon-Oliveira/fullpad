## Novidades

- **Arquivos gigantes**: arquivos de texto acima de 20 MB (um CSV de 15 GB, um log de centenas de MB, Markdown, JSON...) abrem sem ser lidos por inteiro. Dá para rolar pelo arquivo todo, ir a qualquer linha (Ctrl+G), buscar no disco (Ctrl+F) e editar, sem travar o app nem gastar a memória da máquina.
- **Abrir não carrega**: a aba de um arquivo grande mostra o nome e o tamanho, e o arquivo só é lido quando você clica em **Carregar arquivo** (reabrir o Fullpad não lê arquivos de GB). **Abrir direto na linha** pergunta o número da linha e vai direto para ela: a tela aparece na hora e o índice de linhas segue em segundo plano.
- **CSV gigante vira tabela editável**: a primeira coluna é a linha do arquivo, dá para editar célula por célula e a tabela rola junto com o código. Ordenar e filtrar não valem nesses arquivos.
- **Desfazer em todo o arquivo**: Ctrl+Z e Ctrl+Y valem também nos trechos que já saíram da tela: o Fullpad volta até lá, desfaz e mostra onde foi. Nada se perde ao fechar o app.
- **Salvar arquivo gigante com escolha**: trocar um valor por outro do mesmo tamanho grava no lugar, na hora. Se o tamanho mudou, uma janela explica e recomenda entre **salvar com segurança** (monta o arquivo novo ao lado, só troca o original no fim, dá para cancelar e mostra o andamento) e **salvar direto** (regrava só do ponto editado em diante, sem espaço extra e sem proteção contra queda).

## Correções

- Na tabela do CSV, editar uma célula logo depois de outra edição agora espera a tabela atualizar, em vez de recusar com "A tabela está atualizando; tente de novo".
