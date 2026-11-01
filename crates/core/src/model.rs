use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    /// Preview ligado: markdown renderizado (live preview).
    #[default]
    Rendered,
    /// Preview desligado: texto puro / código.
    Source,
}

/// Linguagem escolhida para a aba. `Auto` detecta pelo conteúdo/extensão;
/// `Plain`, `Markdown` e `Dbml` são escolhas manuais que nunca mudam sozinhas.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    Auto,
    Plain,
    Markdown,
    Dbml,
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub version: u32,
    pub tabs: Vec<TabState>,
    pub active: Option<Uuid>,
}

impl Session {
    pub const CURRENT_VERSION: u32 = 1;

    pub fn empty() -> Self {
        Self {
            version: Self::CURRENT_VERSION,
            tabs: Vec::new(),
            active: None,
        }
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::empty()
    }
}
