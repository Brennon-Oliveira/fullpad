; Fullpad: integração com o Windows (abrir por padrão e "Abrir com").
;
; Incluído pelo template (installer.nsi, via `installerHooks`) depois das variáveis do Tauri.
; A instalação é por usuário: tudo vai para HKCU. Duas escolhas, feitas na página
; "Integração com o Windows" e lembradas em HKCU\Software\Fullpad para as atualizações:
;
;   AssocDefault  .md/.markdown/.dbml/.dbmlx abrem no Fullpad por padrão.
;   AssocOpenWith o Fullpad aparece em "Abrir com" nos arquivos de texto em geral.
;
; O Windows não deixa um instalador passar por cima do programa que o usuário já escolheu
; (UserChoice). Nesse caso o instalador oferece abrir as Configurações na página do Fullpad.

!include nsDialogs.nsh
!include LogicLib.nsh

!define FP_KEY "Software\Fullpad"
!define FP_CLASSES "Software\Classes"
!define FP_APP "${FP_CLASSES}\Applications\${MAINBINARYNAME}.exe"
!define FP_ICON "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
!define FP_OPEN "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!define FP_FILEEXTS "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts"

Var FpDefault     ; 1: abrir markdown/DBML por padrão
Var FpOpenWith    ; 1: "Abrir com" nos arquivos de texto
Var FpChkDefault
Var FpChkOpenWith
Var FpNeedsChoice ; 1: outro programa já é a escolha do usuário para algum tipo nosso

; ---- listas de tipos --------------------------------------------------------

; Tipos do Fullpad (podem virar padrão): extensão e ProgID.
!macro FP_EACH_OWN M
  !insertmacro ${M} "md" "Fullpad.md"
  !insertmacro ${M} "markdown" "Fullpad.md"
  !insertmacro ${M} "dbml" "Fullpad.dbml"
  !insertmacro ${M} "dbmlx" "Fullpad.dbml"
!macroend

; Texto em geral: só ganha o "Abrir com". Além destes, todo arquivo que o Windows já marca como
; texto (PerceivedType=text) recebe o Fullpad pelo SystemFileAssociations\text.
!macro FP_EACH_TEXT M
  !insertmacro ${M} "txt" "Fullpad.text"
  !insertmacro ${M} "log" "Fullpad.text"
  !insertmacro ${M} "ini" "Fullpad.text"
  !insertmacro ${M} "cfg" "Fullpad.text"
  !insertmacro ${M} "conf" "Fullpad.text"
  !insertmacro ${M} "env" "Fullpad.text"
  !insertmacro ${M} "properties" "Fullpad.text"
  !insertmacro ${M} "csv" "Fullpad.text"
  !insertmacro ${M} "tsv" "Fullpad.text"
  !insertmacro ${M} "json" "Fullpad.text"
  !insertmacro ${M} "jsonc" "Fullpad.text"
  !insertmacro ${M} "xml" "Fullpad.text"
  !insertmacro ${M} "yaml" "Fullpad.text"
  !insertmacro ${M} "yml" "Fullpad.text"
  !insertmacro ${M} "toml" "Fullpad.text"
  !insertmacro ${M} "sql" "Fullpad.text"
  !insertmacro ${M} "nfo" "Fullpad.text"
  !insertmacro ${M} "srt" "Fullpad.text"
  !insertmacro ${M} "html" "Fullpad.text"
  !insertmacro ${M} "htm" "Fullpad.text"
  !insertmacro ${M} "css" "Fullpad.text"
  !insertmacro ${M} "scss" "Fullpad.text"
  !insertmacro ${M} "js" "Fullpad.text"
  !insertmacro ${M} "mjs" "Fullpad.text"
  !insertmacro ${M} "cjs" "Fullpad.text"
  !insertmacro ${M} "jsx" "Fullpad.text"
  !insertmacro ${M} "ts" "Fullpad.text"
  !insertmacro ${M} "tsx" "Fullpad.text"
  !insertmacro ${M} "py" "Fullpad.text"
  !insertmacro ${M} "rs" "Fullpad.text"
  !insertmacro ${M} "go" "Fullpad.text"
  !insertmacro ${M} "java" "Fullpad.text"
  !insertmacro ${M} "c" "Fullpad.text"
  !insertmacro ${M} "h" "Fullpad.text"
  !insertmacro ${M} "cpp" "Fullpad.text"
  !insertmacro ${M} "hpp" "Fullpad.text"
  !insertmacro ${M} "cs" "Fullpad.text"
  !insertmacro ${M} "php" "Fullpad.text"
  !insertmacro ${M} "rb" "Fullpad.text"
  !insertmacro ${M} "lua" "Fullpad.text"
  !insertmacro ${M} "sh" "Fullpad.text"
  !insertmacro ${M} "bat" "Fullpad.text"
  !insertmacro ${M} "cmd" "Fullpad.text"
  !insertmacro ${M} "ps1" "Fullpad.text"
!macroend

; Associações gravadas pelo instalador 0.1.0 (o padrão do Tauri): ProgIDs "Markdown", "Texto" e "DBML".
!macro FP_EACH_LEGACY M
  !insertmacro ${M} "md" "Markdown"
  !insertmacro ${M} "markdown" "Markdown"
  !insertmacro ${M} "txt" "Texto"
  !insertmacro ${M} "dbml" "DBML"
  !insertmacro ${M} "dbmlx" "DBML"
!macroend

; ---- gravar -----------------------------------------------------------------

!macro FP_PROGID ID DESC
  WriteRegStr HKCU "${FP_CLASSES}\${ID}" "" "${DESC}"
  WriteRegStr HKCU "${FP_CLASSES}\${ID}\DefaultIcon" "" "${FP_ICON}"
  ; sem rótulo no verbo: o Windows mostra "Abrir", no idioma dele
  WriteRegStr HKCU "${FP_CLASSES}\${ID}\shell\open\command" "" "${FP_OPEN}"
!macroend

; Aparece em "Abrir com" para a extensão (sem virar o padrão).
!macro FP_OPENWITH EXT PROGID
  WriteRegStr HKCU "${FP_CLASSES}\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "${FP_APP}\SupportedTypes" ".${EXT}" ""
!macroend

; Padrão da extensão. Só vale se o usuário não escolheu outro programa no Windows (UserChoice).
!macro FP_SET_DEFAULT EXT PROGID
  ReadRegStr $0 HKCU "${FP_CLASSES}\.${EXT}" ""
  ${If} $0 != "${PROGID}"
    WriteRegStr HKCU "${FP_CLASSES}\.${EXT}" "Fullpad_backup" "$0"
  ${EndIf}
  WriteRegStr HKCU "${FP_CLASSES}\.${EXT}" "" "${PROGID}"
  WriteRegStr HKCU "${FP_KEY}\Capabilities\FileAssociations" ".${EXT}" "${PROGID}"
  ReadRegStr $0 HKCU "${FP_FILEEXTS}\.${EXT}\UserChoice" "ProgId"
  ${If} $0 != ""
  ${AndIf} $0 != "${PROGID}"
    StrCpy $FpNeedsChoice 1
  ${EndIf}
!macroend

; ---- desfazer ---------------------------------------------------------------

; Apaga a chave só se ela ficou vazia (sem subchaves e sem valores de outros programas).
!macro FP_DELETE_IF_EMPTY KEY
  DeleteRegKey /ifnosubkeys /ifnovalues HKCU "${KEY}"
!macroend

; Desfaz o que FP_OPENWITH e FP_SET_DEFAULT gravaram, devolvendo o padrão anterior.
!macro FP_UNSET EXT PROGID
  ReadRegStr $0 HKCU "${FP_CLASSES}\.${EXT}" ""
  ${If} $0 == "${PROGID}"
    ReadRegStr $1 HKCU "${FP_CLASSES}\.${EXT}" "Fullpad_backup"
    ${If} $1 == ""
      DeleteRegValue HKCU "${FP_CLASSES}\.${EXT}" ""
    ${Else}
      WriteRegStr HKCU "${FP_CLASSES}\.${EXT}" "" "$1"
    ${EndIf}
  ${EndIf}
  DeleteRegValue HKCU "${FP_CLASSES}\.${EXT}" "Fullpad_backup"
  DeleteRegValue HKCU "${FP_CLASSES}\.${EXT}\OpenWithProgids" "${PROGID}"
  !insertmacro FP_DELETE_IF_EMPTY "${FP_CLASSES}\.${EXT}\OpenWithProgids"
  !insertmacro FP_DELETE_IF_EMPTY "${FP_CLASSES}\.${EXT}"
!macroend

; Desfaz a associação do instalador 0.1.0 (APP_ASSOCIATE do Tauri), se ainda for nossa.
!macro FP_UNSET_LEGACY EXT NAME
  ReadRegStr $0 HKCU "${FP_CLASSES}\${NAME}\shell\open\command" ""
  ${If} $0 == "${FP_OPEN}"
    ReadRegStr $1 HKCU "${FP_CLASSES}\.${EXT}" ""
    ${If} $1 == "${NAME}"
      ReadRegStr $1 HKCU "${FP_CLASSES}\.${EXT}" "${NAME}_backup"
      ${If} $1 == ""
        DeleteRegValue HKCU "${FP_CLASSES}\.${EXT}" ""
      ${Else}
        WriteRegStr HKCU "${FP_CLASSES}\.${EXT}" "" "$1"
      ${EndIf}
    ${EndIf}
    DeleteRegValue HKCU "${FP_CLASSES}\.${EXT}" "${NAME}_backup"
    !insertmacro FP_DELETE_IF_EMPTY "${FP_CLASSES}\.${EXT}"
  ${EndIf}
!macroend

!macro FP_DELETE_LEGACY_PROGID NAME
  ReadRegStr $0 HKCU "${FP_CLASSES}\${NAME}\shell\open\command" ""
  ${If} $0 == "${FP_OPEN}"
    DeleteRegKey HKCU "${FP_CLASSES}\${NAME}"
  ${EndIf}
!macroend

; Remove toda a integração (antes de gravar de novo, e ao desinstalar). As escolhas ficam.
!macro FP_CLEANUP
  !insertmacro FP_EACH_LEGACY FP_UNSET_LEGACY
  !insertmacro FP_DELETE_LEGACY_PROGID "Markdown"
  !insertmacro FP_DELETE_LEGACY_PROGID "Texto"
  !insertmacro FP_DELETE_LEGACY_PROGID "DBML"

  !insertmacro FP_EACH_OWN FP_UNSET
  !insertmacro FP_EACH_TEXT FP_UNSET
  DeleteRegKey HKCU "${FP_CLASSES}\Fullpad.md"
  DeleteRegKey HKCU "${FP_CLASSES}\Fullpad.dbml"
  DeleteRegKey HKCU "${FP_CLASSES}\Fullpad.text"
  DeleteRegKey HKCU "${FP_APP}"
  DeleteRegKey HKCU "${FP_CLASSES}\SystemFileAssociations\text\OpenWithList\${MAINBINARYNAME}.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Fullpad"
  DeleteRegKey HKCU "${FP_KEY}\Capabilities"
!macroend

!macro FP_NOTIFY_SHELL
  System::Call 'shell32::SHChangeNotify(i ${SHCNE_ASSOCCHANGED}, i 0, p 0, p 0)'
!macroend

; ---- escolhas ---------------------------------------------------------------

; Padrão: as duas marcadas. Uma instalação anterior (ou a atualização automática, que não mostra
; a página) usa o que foi escolhido da última vez.
Function FpLoadChoices
  StrCpy $FpDefault 1
  StrCpy $FpOpenWith 1
  ReadRegStr $0 HKCU "${FP_KEY}" "AssocDefault"
  ${If} $0 == "0"
    StrCpy $FpDefault 0
  ${EndIf}
  ReadRegStr $0 HKCU "${FP_KEY}" "AssocOpenWith"
  ${If} $0 == "0"
    StrCpy $FpOpenWith 0
  ${EndIf}
FunctionEnd

Function FpPage
  ${If} $PassiveMode = 1
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Integração com o Windows" "Escolha como o Fullpad aparece para os seus arquivos."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0 100% 12u "Abrir arquivos Markdown e DBML com o Fullpad por padrão"
  Pop $FpChkDefault
  ${NSD_CreateLabel} 12u 14u 286u 28u "Arquivos .md, .markdown, .dbml e .dbmlx abrem no Fullpad com dois cliques. Se você já escolheu outro programa para eles, o Windows pede a sua confirmação nas Configurações."
  Pop $0

  ${NSD_CreateCheckbox} 0 52u 100% 12u "Mostrar o Fullpad em $\"Abrir com$\" nos arquivos de texto"
  Pop $FpChkOpenWith
  ${NSD_CreateLabel} 12u 66u 286u 28u "Texto em geral (.txt, .log, .json, .csv, .xml, .yaml, código...) ganha a opção no menu $\"Abrir com$\", sem mudar o programa que abre esses arquivos hoje."
  Pop $0

  ${If} $FpDefault = 1
    ${NSD_Check} $FpChkDefault
  ${EndIf}
  ${If} $FpOpenWith = 1
    ${NSD_Check} $FpChkOpenWith
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function FpPageLeave
  ${NSD_GetState} $FpChkDefault $FpDefault
  ${NSD_GetState} $FpChkOpenWith $FpOpenWith
FunctionEnd

; ---- ganchos do Tauri ---------------------------------------------------------

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $FpNeedsChoice 0
  !insertmacro FP_CLEANUP

  ${If} $FpDefault = 1
  ${OrIf} $FpOpenWith = 1
    !insertmacro FP_PROGID "Fullpad.md" "Documento Markdown"
    !insertmacro FP_PROGID "Fullpad.dbml" "Diagrama DBML"
    !insertmacro FP_PROGID "Fullpad.text" "Documento de texto"
    WriteRegStr HKCU "${FP_APP}" "FriendlyAppName" "${PRODUCTNAME}"
    WriteRegStr HKCU "${FP_APP}\DefaultIcon" "" "${FP_ICON}"
    WriteRegStr HKCU "${FP_APP}\shell\open\command" "" "${FP_OPEN}"
    !insertmacro FP_EACH_OWN FP_OPENWITH
    ; Configurações > Aplicativos padrão > Fullpad
    WriteRegStr HKCU "${FP_KEY}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
    WriteRegStr HKCU "${FP_KEY}\Capabilities" "ApplicationDescription" "Editor de notas e markdown"
    WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCTNAME}" "${FP_KEY}\Capabilities"
  ${EndIf}

  ${If} $FpDefault = 1
    !insertmacro FP_EACH_OWN FP_SET_DEFAULT
  ${EndIf}

  ${If} $FpOpenWith = 1
    !insertmacro FP_EACH_TEXT FP_OPENWITH
    WriteRegStr HKCU "${FP_CLASSES}\SystemFileAssociations\text\OpenWithList\${MAINBINARYNAME}.exe" "" ""
  ${EndIf}

  WriteRegStr HKCU "${FP_KEY}" "AssocDefault" "$FpDefault"
  WriteRegStr HKCU "${FP_KEY}" "AssocOpenWith" "$FpOpenWith"
  !insertmacro FP_NOTIFY_SHELL

  ; outro programa já é a escolha do usuário: só ele pode trocar, nas Configurações
  ${If} $FpNeedsChoice = 1
  ${AndIf} $PassiveMode <> 1
  ${AndIf} $UpdateMode <> 1
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONINFORMATION "Outro programa já abre arquivos Markdown ou DBML neste computador, e o Windows só deixa você mesmo trocar.$\r$\n$\r$\nAbrir as Configurações para definir o Fullpad como padrão?" IDNO +2
    ExecShell "open" "ms-settings:defaultapps?registeredAppUser=${PRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; a atualização reinstala por cima: a integração e as escolhas ficam
  ${If} $UpdateMode <> 1
    !insertmacro FP_CLEANUP
    DeleteRegKey HKCU "${FP_KEY}"
    !insertmacro FP_NOTIFY_SHELL
  ${EndIf}
!macroend
