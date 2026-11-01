use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
/// `Plain`, `Markdown` e `Dbml` são escolhas manuais que nunca mudam sozinhas.
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
    #[default]
    #[serde(other)]
    Auto,
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
