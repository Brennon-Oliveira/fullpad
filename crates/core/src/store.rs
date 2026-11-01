use crate::atomic::write_atomic;
use crate::fileio;
use crate::error::{Error, IoContext, Result};
use crate::model::{Encoding, Eol, Session, TabState};
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Persistência em disco:
///
/// ```text
/// <root>/session.json      ordem das abas, aba ativa, cursor, modo…
/// <root>/notes/<id>.md     conteúdo de cada nota
/// <root>/trash/<id>.md     notas fechadas (recuperáveis)
/// ```
#[derive(Debug, Clone)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Diretório padrão do SO (`%APPDATA%\fullpad` / `~/.local/share/fullpad`).
    /// `FULLPAD_DATA_DIR` sobrescreve (útil em dev e testes).
    pub fn open_default() -> Result<Self> {
        if let Some(dir) = std::env::var_os("FULLPAD_DATA_DIR") {
            return Ok(Self::new(dir));
        }
        let base = dirs::data_dir().ok_or(Error::NoDataDir)?;
        Ok(Self::new(base.join("fullpad")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn session_path(&self) -> PathBuf {
        self.root.join("session.json")
    }
    fn note_path(&self, id: Uuid) -> PathBuf {
        self.root.join("notes").join(format!("{id}.md"))
    }
    fn trash_path(&self, id: Uuid) -> PathBuf {
        self.root.join("trash").join(format!("{id}.md"))
    }

    // ---- sessão -----------------------------------------------------------

    /// Carrega a sessão. Se não existir, devolve uma vazia. Se estiver
    /// corrompida, preserva o arquivo como `session.json.corrupt` e começa vazia.
    /// Abas cujo arquivo de nota sumiu são descartadas.
    pub fn load_session(&self) -> Result<Session> {
        let path = self.session_path();
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Session::empty()),
            Err(e) => return Err(Error::Io { path, source: e }),
        };
        let mut session: Session = match serde_json::from_slice(&bytes) {
            Ok(s) => s,
            Err(_) => {
                let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
                return Ok(Session::empty());
            }
        };
        session.tabs.retain(|t| self.note_path(t.id).exists());
        if session.active.is_none_or(|a| !session.tabs.iter().any(|t| t.id == a)) {
            session.active = session.tabs.first().map(|t| t.id);
        }
        Ok(session)
    }

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let json = serde_json::to_vec_pretty(session)?;
        write_atomic(&self.session_path(), &json)
    }

    // ---- notas ------------------------------------------------------------

    /// Cria uma nota vazia e devolve o estado inicial da aba.
    pub fn create_note(&self) -> Result<TabState> {
        let id = Uuid::new_v4();
        write_atomic(&self.note_path(id), b"")?;
        Ok(TabState::new(id))
    }

    pub fn read_note(&self, id: Uuid) -> Result<String> {
        let path = self.note_path(id);
        let bytes = std::fs::read(&path).at(&path)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    pub fn write_note(&self, id: Uuid, text: &str) -> Result<()> {
        write_atomic(&self.note_path(id), text.as_bytes())
    }

    /// Abre um arquivo real: cria a aba (com buffer em `notes/`) e devolve o texto.
    pub fn open_file(&self, path: &Path) -> Result<(TabState, String)> {
        let decoded = fileio::read_file(path)?;
        let mut tab = self.create_note()?;
        self.write_note(tab.id, &decoded.text)?;
        tab.path = Some(path.to_path_buf());
        tab.title = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        tab.encoding = decoded.encoding;
        tab.eol = decoded.eol;
        Ok((tab, decoded.text))
    }

    /// Grava o texto no arquivo real e sincroniza o buffer da nota.
    pub fn save_file(
        &self,
        id: Uuid,
        path: &Path,
        text: &str,
        encoding: Encoding,
        eol: Eol,
    ) -> Result<()> {
        fileio::write_file(path, text, encoding, eol)?;
        self.write_note(id, text)
    }

    /// Fecha uma nota movendo-a para `trash/` (nunca apaga de verdade).
    pub fn close_note(&self, id: Uuid) -> Result<()> {
        let from = self.note_path(id);
        let to = self.trash_path(id);
        if let Some(dir) = to.parent() {
            std::fs::create_dir_all(dir).at(dir)?;
        }
        match std::fs::rename(&from, &to) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(Error::Io { path: from, source: e }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::new(dir.path());
        (dir, s)
    }

    #[test]
    fn empty_when_nothing_saved() {
        let (_d, s) = store();
        assert_eq!(s.load_session().unwrap(), Session::empty());
    }

    #[test]
    fn roundtrip_session_and_text() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.title = "Oi".into();
        tab.cursor = 3;
        s.write_note(tab.id, "olá mundo").unwrap();
        let session = Session {
            version: Session::CURRENT_VERSION,
            active: Some(tab.id),
            tabs: vec![tab.clone()],
        };
        s.save_session(&session).unwrap();

        let loaded = s.load_session().unwrap();
        assert_eq!(loaded, session);
        assert_eq!(s.read_note(tab.id).unwrap(), "olá mundo");
    }

    #[test]
    fn corrupt_session_is_preserved_and_ignored() {
        let (d, s) = store();
        std::fs::write(d.path().join("session.json"), b"{ lixo").unwrap();
        assert_eq!(s.load_session().unwrap(), Session::empty());
        assert!(d.path().join("session.json.corrupt").exists());
    }

    #[test]
    fn tabs_without_note_file_are_dropped_and_active_fixed() {
        let (_d, s) = store();
        let a = s.create_note().unwrap();
        let ghost = TabState::new(Uuid::new_v4());
        let session = Session {
            version: 1,
            active: Some(ghost.id),
            tabs: vec![ghost, a.clone()],
        };
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs.len(), 1);
        assert_eq!(loaded.active, Some(a.id));
    }

    #[test]
    fn open_and_save_real_file_keeps_encoding_and_eol() {
        let (d, s) = store();
        let file = d.path().join("nota.md");
        std::fs::write(&file, b"\xEF\xBB\xBF# T\r\nlinha\r\n").unwrap();

        let (tab, text) = s.open_file(&file).unwrap();
        assert_eq!(text, "# T\nlinha\n");
        assert_eq!(tab.title, "nota.md");
        assert_eq!((tab.encoding, tab.eol), (Encoding::Utf8Bom, Eol::Crlf));
        assert_eq!(s.read_note(tab.id).unwrap(), text);

        s.save_file(tab.id, &file, "# T\nnova\n", tab.encoding, tab.eol).unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"\xEF\xBB\xBF# T\r\nnova\r\n");
        assert_eq!(s.read_note(tab.id).unwrap(), "# T\nnova\n");
    }

    #[test]
    fn old_session_without_new_fields_still_loads() {
        let (d, s) = store();
        let t = s.create_note().unwrap();
        let json = format!(
            r#"{{"version":1,"active":"{id}","tabs":[{{"id":"{id}","title":"x","cursor":2,"scroll":0.0,"mode":"source"}}]}}"#,
            id = t.id
        );
        std::fs::write(d.path().join("session.json"), json).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].language, crate::Language::Auto);
        assert!(!loaded.tabs[0].dirty);
    }

    #[test]
    fn dbml_language_survives_session_roundtrip() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.language = crate::Language::Dbml;
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].language, crate::Language::Dbml);
    }

    #[test]
    fn unknown_language_or_mode_does_not_invalidate_the_session() {
        let (d, s) = store();
        let t = s.create_note().unwrap();
        let json = format!(
            r#"{{"version":1,"active":"{id}","tabs":[{{"id":"{id}","title":"x","cursor":2,"scroll":0.0,"mode":"holografico","language":"mermaid"}}]}}"#,
            id = t.id
        );
        std::fs::write(d.path().join("session.json"), json).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs.len(), 1, "a aba tem que sobreviver");
        assert_eq!(loaded.tabs[0].language, crate::Language::Auto);
        assert_eq!(loaded.tabs[0].mode, crate::ViewMode::Rendered);
        assert!(!d.path().join("session.json.corrupt").exists());
    }

    #[test]
    fn split_view_mode_survives_session_roundtrip() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.mode = crate::ViewMode::Split;
        let session = Session { version: 1, active: Some(tab.id), tabs: vec![tab] };
        s.save_session(&session).unwrap();
        assert_eq!(s.load_session().unwrap().tabs[0].mode, crate::ViewMode::Split);
    }

    #[test]
    fn close_moves_to_trash() {
        let (d, s) = store();
        let t = s.create_note().unwrap();
        s.write_note(t.id, "x").unwrap();
        s.close_note(t.id).unwrap();
        assert!(s.read_note(t.id).is_err());
        assert!(d.path().join("trash").join(format!("{}.md", t.id)).exists());
        s.close_note(t.id).unwrap(); // idempotente
    }
}
