use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    /// Preview desligado: texto puro / código.
    Source,
    /// Código e visão renderizada lado a lado (markdown renderizado, ou o diagrama no DBML).
    Split,
    /// Preview ligado: markdown renderizado (live preview). Também é o que um valor
    /// desconhecido (de uma versão mais nova do app) vira, em vez de invalidar a sessão.
    #[default]
    #[serde(other)]
    Rendered,
}

/// Linguagem escolhida para a aba. `Auto` detecta pelo conteúdo/extensão;
/// `Plain`, `Markdown`, `Dbml`, `Mermaid`, `Latex`, `Json` e `Csv` são escolhas manuais que nunca mudam sozinhas.
///
/// Uma linguagem que esta versão não conhece (gravada por uma versão mais nova) vira `Auto`:
/// sem isso o `session.json` inteiro falharia ao ler e iria para `session.json.corrupt`,
/// deixando o app sem as abas abertas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Plain,
    Markdown,
    Dbml,
    Json,
    Csv,
    Yaml,
    Toml,
    Mermaid,
    Latex,
    #[default]
    #[serde(other)]
    Auto,
}

/// O que a aba mostra. `Text` é o editor de sempre; `Pdf` e `Epub` são abas só de leitura: o
/// arquivo é binário, nunca é gravado pelo app e a sessão guarda só o caminho e a posição.
///
/// Um tipo que esta versão não conhece (gravado por uma versão mais nova) vira `Unknown`, e **não**
/// `Text`: uma aba de texto ligada a um arquivo binário deixaria o usuário gravar por cima dele.
/// `Unknown` é tratada como só leitura e sem conteúdo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TabKind {
    #[default]
    Text,
    Pdf,
    Epub,
    #[serde(other)]
    Unknown,
}

impl TabKind {
    /// Tipo de leitor para o arquivo, pela extensão (`None`: abre como texto, como sempre).
    pub fn for_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
        match ext.as_str() {
            "pdf" => Some(Self::Pdf),
            "epub" => Some(Self::Epub),
            _ => None,
        }
    }

    /// A aba não tem texto editável (e jamais pode ser gravada como arquivo de texto).
    pub fn is_reader(self) -> bool {
        self != Self::Text
    }
}

/// Fim de linha usado ao gravar o arquivo (o editor trabalha sempre com `\n`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Eol {
    #[default]
    Lf,
    Crlf,
}

impl Eol {
    pub fn platform_default() -> Self {
        if cfg!(windows) { Eol::Crlf } else { Eol::Lf }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Encoding {
    #[default]
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
    Windows1252,
}

/// Janela que abriu o app (e que, ao fechar, encerra tudo).
pub const MAIN_WINDOW: &str = "main";

fn main_window() -> String {
    MAIN_WINDOW.to_string()
}

/// Estado de uma aba. O conteúdo NÃO fica aqui: vive em `notes/<id>.md`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TabState {
    pub id: Uuid,
    /// Título exibido (derivado da primeira linha do texto).
    #[serde(default)]
    pub title: String,
    /// `Some` quando a aba aponta para um arquivo real em disco (fase 3).
    #[serde(default)]
    pub path: Option<PathBuf>,
    /// Posição do cursor (offset em UTF-16 code units, como no CodeMirror).
    #[serde(default)]
    pub cursor: usize,
    #[serde(default)]
    pub scroll: f64,
    #[serde(default)]
    pub mode: ViewMode,
    #[serde(default)]
    pub language: Language,
    #[serde(default)]
    pub eol: Eol,
    #[serde(default)]
    pub encoding: Encoding,
    /// Aba ligada a arquivo com edições ainda não gravadas nele.
    #[serde(default)]
    pub dirty: bool,
    /// Janela onde a aba está. Sessões antigas não têm o campo: tudo estava na principal.
    #[serde(default = "main_window")]
    pub window: String,
    /// A visão renderizada (preview/diagrama) está numa janela própria, ligada a esta aba.
    #[serde(default)]
    pub detached: bool,
    /// Grupo (painel) da janela em que a aba aparece. Quem decide e interpreta é a UI.
    #[serde(default)]
    pub group: u32,
    /// Nota de versão aberta pelo app (depois de atualizar, ou em Ajuda > "Ver nota de versão").
    /// O texto vem embutido no app: fechar apaga de vez, sem passar pelo histórico de abas fechadas.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub release_notes: bool,
    /// O que a aba é: texto (editor) ou um leitor de PDF/EPUB. Sessões antigas não têm o campo.
    #[serde(default, skip_serializing_if = "is_text")]
    pub kind: TabKind,
    /// Posição de leitura (página, rolagem, zoom). Opaca para o core: só o leitor a entende.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reader: Option<serde_json::Value>,
    /// Escolhas do usuário para a visão de CSV (separador, cabeçalho, decimal). Opaca para o core:
    /// só a UI a entende e valida (`ui/src/csv/settings.ts`); sem ela vale o automático.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csv: Option<serde_json::Value>,
    /// Aba fixada: mostra um alfinete no lugar do ×, fica à esquerda e não fecha por "Fechar todas",
    /// "Fechar outras" nem "Fechar salvos". Sessões antigas não têm o campo.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// Linguagem de programação escolhida à mão para o destaque de sintaxe (`ts`, `rust`…). Vazia:
    /// vale a detectada pela extensão. Só colore o texto; não muda o tipo de arquivo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_lang: Option<String>,
}

fn is_text(kind: &TabKind) -> bool {
    *kind == TabKind::Text
}

impl TabState {
    pub fn new(id: Uuid) -> Self {
        Self {
            id,
            title: String::new(),
            path: None,
            cursor: 0,
            scroll: 0.0,
            mode: ViewMode::default(),
            language: Language::default(),
            eol: Eol::platform_default(),
            encoding: Encoding::default(),
            dirty: false,
            window: main_window(),
            detached: false,
            group: 0,
            release_notes: false,
            kind: TabKind::Text,
            reader: None,
            csv: None,
            pinned: false,
            code_lang: None,
        }
    }
}

/// Posição e tamanho (pixels físicos) de uma janela flutuante, para reabri-la no mesmo lugar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Janela flutuante (as abas dela têm `TabState::window` igual ao `label`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowState {
    pub label: String,
    #[serde(default)]
    pub active: Option<Uuid>,
    #[serde(default)]
    pub geometry: Option<Geometry>,
    /// Grade de painéis da janela (árvore de divisões). Opaca para o core: só a UI a entende, e
    /// uma versão que não a conheça simplesmente a ignora.
    #[serde(default)]
    pub layout: Option<serde_json::Value>,
}

/// Todas as abas de todas as janelas, na ordem de gravação. `active` é a aba ativa da janela
/// principal (formato antigo, mantido); as das flutuantes ficam em `windows`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub version: u32,
    pub tabs: Vec<TabState>,
    pub active: Option<Uuid>,
    #[serde(default)]
    pub windows: Vec<WindowState>,
}

impl Session {
    pub const CURRENT_VERSION: u32 = 1;

    pub fn empty() -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            tabs: Vec::new(),
            active: None,
            windows: Vec::new(),
        }
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::empty()
    }
}

/// Aba fechada que ainda está na lixeira e pode ser reaberta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClosedTab {
    pub tab: TabState,
    /// Segundos desde 1970.
    pub closed_at: u64,
}
