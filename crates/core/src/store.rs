use crate::atomic::write_atomic;
use crate::fileio;
use crate::error::{Error, IoContext, Result};
use crate::model::{ClosedTab, Encoding, Eol, Language, Session, TabKind, TabState, ViewMode};
use crate::reader;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Quantas posições de leitura (uma por arquivo) o app lembra.
const MAX_REMEMBERED: usize = 2000;

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct Positions {
    #[serde(default)]
    entries: std::collections::BTreeMap<String, RememberedPosition>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct RememberedPosition {
    /// Opaca para o core: só o leitor a entende.
    pos: serde_json::Value,
    /// Segundos desde 1970 da última gravação.
    #[serde(default)]
    at: u64,
}

/// Persistência em disco:
///
/// ```text
/// <root>/session.json      ordem das abas, aba ativa, cursor, modo…
/// <root>/notes/<id>.md     conteúdo de cada nota
/// <root>/trash/<id>.md     notas fechadas (recuperáveis)
/// <root>/reader-positions.json   última posição de leitura por arquivo PDF/EPUB
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

    fn trash_meta_path(&self, id: Uuid) -> PathBuf {
        self.root.join("trash").join(format!("{id}.json"))
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
        session.active = session.active_of(crate::MAIN_WINDOW);
        session.prune_windows();
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

    /// Nota de versão: markdown, aberta renderizada, com o título "Nota de versão V<versão>".
    pub fn create_release_notes(&self, version: &str, notes: &str) -> Result<(TabState, String)> {
        let title = format!("Nota de versão V{version}");
        let text = format!("# {title}\n\n{}\n", notes.trim());
        let mut tab = self.create_note()?;
        self.write_note(tab.id, &text)?;
        tab.title = title;
        tab.language = Language::Markdown;
        tab.mode = ViewMode::Rendered;
        tab.release_notes = true;
        Ok((tab, text))
    }

    /// Registra a versão em execução e diz se o app acabou de ser atualizado: a versão gravada da
    /// última execução é outra. Sem versão gravada (até a 0.2.1 o app não gravava), conta como
    /// atualização se já havia sessão; numa instalação nova, não.
    pub fn note_running_version(&self, version: &str) -> Result<bool> {
        let path = self.root.join("version");
        let previous = match std::fs::read_to_string(&path) {
            Ok(v) => Some(v.trim().to_string()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(Error::Io { path, source: e }),
        };
        if previous.as_deref() == Some(version) {
            return Ok(false);
        }
        let used_before = previous.is_some() || self.session_path().exists();
        write_atomic(&path, version.as_bytes())?;
        Ok(used_before)
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

    /// Abre um PDF/EPUB como aba só de leitura. Não lê o arquivo (só confere que existe): a nota
    /// em `notes/` fica vazia, só para a aba seguir o mesmo caminho das outras (sessão, lixeira,
    /// mover entre janelas). O conteúdo continua sendo do arquivo do usuário, que nunca é gravado.
    pub fn open_reader(&self, path: &Path) -> Result<TabState> {
        let kind = TabKind::for_path(path).ok_or_else(|| Error::Invalid(format!("{} não é um PDF nem um EPUB", path.display())))?;
        if reader::status(path)? == reader::FileStatus::Missing {
            return Err(Error::Invalid(format!("arquivo não encontrado: {}", path.display())));
        }
        let mut tab = self.create_note()?;
        tab.path = Some(path.to_path_buf());
        tab.title = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        tab.kind = kind;
        Ok(tab)
    }

    /// Caminho do arquivo de uma aba de leitura. É o único jeito de a UI pedir bytes: só se lê o
    /// arquivo de uma aba que o usuário abriu como PDF/EPUB, nunca um caminho qualquer.
    pub fn reader_file(&self, id: Uuid) -> Result<(TabKind, PathBuf)> {
        let session = self.load_session()?;
        let tab = session.tabs.iter().find(|t| t.id == id).ok_or_else(|| Error::Invalid("aba não encontrada".into()))?;
        match (tab.kind, &tab.path) {
            (kind @ (TabKind::Pdf | TabKind::Epub), Some(path)) => Ok((kind, path.clone())),
            _ => Err(Error::Invalid("a aba não é um leitor de PDF ou EPUB".into())),
        }
    }

    // ---- posição de leitura por arquivo ------------------------------------------

    fn positions_path(&self) -> PathBuf {
        self.root.join("reader-positions.json")
    }

    fn load_positions(&self) -> Positions {
        let path = self.positions_path();
        let Ok(bytes) = std::fs::read(&path) else { return Positions::default() };
        serde_json::from_slice(&bytes).unwrap_or_else(|_| {
            // ilegível: guarda de lado e recomeça (perder posições de leitura não é grave)
            let _ = std::fs::rename(&path, path.with_extension("json.corrupt"));
            Positions::default()
        })
    }

    /// Última posição de leitura lembrada para o arquivo de identidade `key` (`reader::fingerprint`).
    pub fn reader_position(&self, key: &str) -> Option<serde_json::Value> {
        reader::is_fingerprint(key).then(|| self.load_positions().entries.get(key).map(|r| r.pos.clone())).flatten()
    }

    /// Lembra a posição de leitura do arquivo. Guarda as `MAX_REMEMBERED` mais recentes.
    pub fn remember_reader_position(&self, key: &str, pos: serde_json::Value) -> Result<()> {
        if !reader::is_fingerprint(key) {
            return Err(Error::Invalid("identidade de arquivo inválida".into()));
        }
        let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut all = self.load_positions();
        all.entries.insert(key.to_string(), RememberedPosition { pos, at });
        if all.entries.len() > MAX_REMEMBERED {
            let mut by_age: Vec<(u64, String)> = all.entries.iter().map(|(k, v)| (v.at, k.clone())).collect();
            by_age.sort();
            for (_, k) in by_age.into_iter().take(all.entries.len() - MAX_REMEMBERED) {
                all.entries.remove(&k);
            }
        }
        write_atomic(&self.positions_path(), &serde_json::to_vec(&all)?)
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
        // última trava: o texto de uma aba de PDF/EPUB (vazio) jamais pode ir parar no arquivo dele
        if self.load_session()?.tabs.iter().any(|t| t.id == id && t.kind.is_reader()) {
            return Err(Error::Invalid("abas de PDF e EPUB são só de leitura".into()));
        }
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

    /// Fecha a aba guardando o estado dela (título, arquivo, linguagem…) ao lado do texto, para
    /// poder reabri-la depois (`list_closed`/`restore_note`).
    pub fn close_tab(&self, tab: &TabState) -> Result<()> {
        if tab.release_notes {
            // texto embutido no app (refeito em "Ver nota de versão"): não vai para o histórico
            let path = self.note_path(tab.id);
            return match std::fs::remove_file(&path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(Error::Io { path, source: e }),
                _ => Ok(()),
            };
        }
        let closed_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let meta = ClosedTab { tab: tab.clone(), closed_at };
        if self.note_path(tab.id).exists() {
            write_atomic(&self.trash_meta_path(tab.id), &serde_json::to_vec(&meta)?)?;
        }
        self.close_note(tab.id)
    }

    /// Abas fechadas que podem ser reabertas, da mais recente para a mais antiga.
    pub fn list_closed(&self, limit: usize) -> Vec<ClosedTab> {
        let Ok(rd) = std::fs::read_dir(self.root.join("trash")) else { return vec![] };
        let mut all: Vec<ClosedTab> = rd
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| serde_json::from_slice::<ClosedTab>(&std::fs::read(e.path()).ok()?).ok())
            .filter(|c| self.trash_path(c.tab.id).exists())
            .collect();
        all.sort_by(|a, b| b.closed_at.cmp(&a.closed_at));
        all.truncate(limit);
        all
    }

    /// Tira a nota da lixeira e devolve a aba (com o estado de quando foi fechada) e o texto.
    pub fn restore_note(&self, id: Uuid) -> Result<(TabState, String)> {
        let meta_path = self.trash_meta_path(id);
        let bytes = std::fs::read(&meta_path).at(&meta_path)?;
        let meta: ClosedTab = serde_json::from_slice(&bytes)?;
        let from = self.trash_path(id);
        let to = self.note_path(id);
        if let Some(dir) = to.parent() {
            std::fs::create_dir_all(dir).at(dir)?;
        }
        std::fs::rename(&from, &to).at(&from)?;
        let _ = std::fs::remove_file(&meta_path);
        let text = self.read_note(id)?;
        Ok((meta.tab, text))
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
    fn release_notes_close_without_history() {
        let (_d, s) = store();
        let (tab, text) = s.create_release_notes("1.2.3", "## Novidades\n- algo\n").unwrap();
        assert_eq!(tab.title, "Nota de versão V1.2.3");
        assert!(text.starts_with("# Nota de versão V1.2.3\n\n## Novidades"));
        assert_eq!(s.read_note(tab.id).unwrap(), text);
        s.close_tab(&tab).unwrap();
        assert!(s.list_closed(10).is_empty());
        assert!(s.read_note(tab.id).is_err());

        // uma nota comum continua indo para o histórico
        let other = s.create_note().unwrap();
        s.close_tab(&other).unwrap();
        assert_eq!(s.list_closed(10).len(), 1);
    }

    #[test]
    fn release_notes_flag_survives_session_roundtrip() {
        let (_d, s) = store();
        let (tab, _) = s.create_release_notes("1.0.0", "x").unwrap();
        let mut session = Session::empty();
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        assert!(s.load_session().unwrap().tabs[0].release_notes);
        // abas comuns não gravam o campo
        let plain = serde_json::to_string(&TabState::new(Uuid::new_v4())).unwrap();
        assert!(!plain.contains("release_notes"));
    }

    #[test]
    fn running_version_detects_updates() {
        let (_d, s) = store();
        assert!(!s.note_running_version("0.3.0").unwrap(), "instalação nova não é atualização");
        assert!(!s.note_running_version("0.3.0").unwrap(), "mesma versão");
        assert!(s.note_running_version("0.3.1").unwrap(), "versão nova");
        assert!(!s.note_running_version("0.3.1").unwrap());
    }

    #[test]
    fn running_version_without_record_counts_existing_session() {
        let (_d, s) = store();
        s.save_session(&Session::empty()).unwrap(); // usado por uma versão que não gravava a versão
        assert!(s.note_running_version("0.3.0").unwrap());
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
            windows: vec![],
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
            windows: vec![],
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
    fn json_language_survives_session_roundtrip() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.language = crate::Language::Json;
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].language, crate::Language::Json);
    }

    #[test]
    fn csv_language_and_settings_survive_session_roundtrip() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.language = crate::Language::Csv;
        tab.csv = Some(serde_json::json!({ "delimiter": ";", "header": false, "decimal": "," }));
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].language, crate::Language::Csv);
        assert_eq!(loaded.tabs[0].csv, tab.csv, "a escolha manual do separador sobrevive a reiniciar");
    }

    #[test]
    fn pinned_and_code_lang_survive_roundtrip_and_old_sessions_lack_them() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        let json = serde_json::to_string(&tab).unwrap();
        assert!(!json.contains("pinned") && !json.contains("code_lang"), "{json}");
        tab.pinned = true;
        tab.code_lang = Some("rust".into());
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert!(loaded.tabs[0].pinned);
        assert_eq!(loaded.tabs[0].code_lang.as_deref(), Some("rust"));
        let old = r#"{"id":"00000000-0000-0000-0000-000000000001","title":"x"}"#;
        let t: crate::TabState = serde_json::from_str(old).unwrap();
        assert!(!t.pinned && t.code_lang.is_none());
    }

    #[test]
    fn tab_without_csv_settings_does_not_write_the_field() {
        let (_d, s) = store();
        let tab = s.create_note().unwrap();
        let json = serde_json::to_string(&tab).unwrap();
        assert!(!json.contains("csv"), "{json}");
        let old = r#"{"id":"00000000-0000-0000-0000-000000000001","title":"x","language":"csv"}"#;
        let t: crate::TabState = serde_json::from_str(old).unwrap();
        assert_eq!((t.language, t.csv), (crate::Language::Csv, None));
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
        let session = Session { version: 1, active: Some(tab.id), tabs: vec![tab], windows: vec![] };
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

    #[test]
    fn closed_tab_can_be_restored() {
        let (_d, s) = store();
        let mut t = s.create_note().unwrap();
        t.title = "Receita".into();
        s.write_note(t.id, "bolo").unwrap();
        s.close_tab(&t).unwrap();
        assert!(s.read_note(t.id).is_err());
        let list = s.list_closed(10);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].tab.title, "Receita");
        let (tab, text) = s.restore_note(t.id).unwrap();
        assert_eq!((tab.title.as_str(), text.as_str()), ("Receita", "bolo"));
        assert!(s.list_closed(10).is_empty());
        assert_eq!(s.read_note(t.id).unwrap(), "bolo");
    }

    // ---- abas de leitura (PDF) ------------------------------------------------

    fn pdf_in(dir: &Path) -> PathBuf {
        let p = dir.join("livro.pdf");
        std::fs::write(&p, b"%PDF-1.7 conteudo do usuario").unwrap();
        p
    }

    #[test]
    fn open_reader_does_not_read_or_touch_the_file() {
        let (d, s) = store();
        let pdf = pdf_in(d.path());
        let before = std::fs::read(&pdf).unwrap();
        let tab = s.open_reader(&pdf).unwrap();
        assert_eq!((tab.kind, tab.title.as_str()), (TabKind::Pdf, "livro.pdf"));
        assert_eq!(tab.path.as_deref(), Some(pdf.as_path()));
        assert_eq!(s.read_note(tab.id).unwrap(), "", "a nota é só um marcador vazio");
        assert_eq!(std::fs::read(&pdf).unwrap(), before);
    }

    #[test]
    fn open_reader_rejects_other_extensions_and_missing_files() {
        let (d, s) = store();
        let txt = d.path().join("a.txt");
        std::fs::write(&txt, "oi").unwrap();
        assert!(s.open_reader(&txt).is_err());
        assert!(s.open_reader(&d.path().join("sumiu.pdf")).is_err());
        assert!(s.open_reader(d.path()).is_err());
    }

    #[test]
    fn reader_tab_survives_session_close_and_reopen() {
        let (d, s) = store();
        let mut tab = s.open_reader(&pdf_in(d.path())).unwrap();
        tab.reader = Some(serde_json::json!({ "page": 7, "zoom": 1.25 }));
        let mut session = Session::empty();
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        assert_eq!(s.load_session().unwrap().tabs[0], tab);

        // fechar e reabrir pelo histórico mantém o tipo e a posição
        s.close_tab(&tab).unwrap();
        let closed = s.list_closed(10);
        assert_eq!((closed.len(), closed[0].tab.kind), (1, TabKind::Pdf));
        let (back, text) = s.restore_note(tab.id).unwrap();
        assert_eq!((back, text.as_str()), (tab, ""));
    }

    #[test]
    fn text_tabs_do_not_write_the_new_fields() {
        let json = serde_json::to_string(&TabState::new(Uuid::new_v4())).unwrap();
        assert!(!json.contains("kind") && !json.contains("reader"), "{json}");
    }

    #[test]
    fn session_without_kind_is_a_text_tab() {
        let (d, s) = store();
        let tab = s.create_note().unwrap();
        let mut value = serde_json::to_value(Session { tabs: vec![tab], ..Session::empty() }).unwrap();
        value["tabs"][0].as_object_mut().unwrap().remove("kind");
        std::fs::write(d.path().join("session.json"), value.to_string()).unwrap();
        assert_eq!(s.load_session().unwrap().tabs[0].kind, TabKind::Text);
    }

    #[test]
    fn unknown_kind_from_a_newer_version_is_not_text_and_does_not_break_the_session() {
        let (d, s) = store();
        let tab = s.create_note().unwrap();
        let mut value = serde_json::to_value(Session { tabs: vec![tab.clone()], ..Session::empty() }).unwrap();
        value["tabs"][0]["kind"] = "mobi".into();
        std::fs::write(d.path().join("session.json"), value.to_string()).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs.len(), 1, "a sessão não foi para session.json.corrupt");
        assert_eq!(loaded.tabs[0].kind, TabKind::Unknown);
        assert!(loaded.tabs[0].kind.is_reader(), "nunca vira texto editável por engano");
        assert!(s.reader_file(tab.id).is_err(), "e não é lida como PDF/EPUB");
    }

    #[test]
    fn reader_file_only_serves_reader_tabs() {
        let (d, s) = store();
        let pdf = s.open_reader(&pdf_in(d.path())).unwrap();
        let text = s.create_note().unwrap();
        let mut file_tab = s.create_note().unwrap();
        file_tab.path = Some(d.path().join("nota.md"));
        let mut session = Session::empty();
        session.tabs = vec![pdf.clone(), text.clone(), file_tab.clone()];
        s.save_session(&session).unwrap();

        assert_eq!(s.reader_file(pdf.id).unwrap(), (TabKind::Pdf, pdf.path.clone().unwrap()));
        assert!(s.reader_file(text.id).is_err());
        assert!(s.reader_file(file_tab.id).is_err(), "um arquivo de texto aberto não é lido como binário");
        assert!(s.reader_file(Uuid::new_v4()).is_err());
    }

    #[test]
    fn save_file_refuses_reader_tabs_and_leaves_the_pdf_intact() {
        let (d, s) = store();
        let pdf_path = pdf_in(d.path());
        let before = std::fs::read(&pdf_path).unwrap();
        let tab = s.open_reader(&pdf_path).unwrap();
        let mut session = Session::empty();
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        assert!(s.save_file(tab.id, &pdf_path, "", Encoding::Utf8, Eol::Lf).is_err());
        assert_eq!(std::fs::read(&pdf_path).unwrap(), before);

        // uma nota de texto comum continua gravando normalmente
        let note = s.create_note().unwrap();
        let out = d.path().join("saida.txt");
        s.save_file(note.id, &out, "oi", Encoding::Utf8, Eol::Lf).unwrap();
        assert_eq!(std::fs::read_to_string(out).unwrap(), "oi");
    }

    #[test]
    fn reader_position_is_remembered_per_file_identity() {
        let (d, s) = store();
        let pdf = pdf_in(d.path());
        let key = reader::fingerprint(&pdf).unwrap();
        assert_eq!(s.reader_position(&key), None);
        s.remember_reader_position(&key, serde_json::json!({ "page": 9, "frac": 0.5 })).unwrap();
        assert_eq!(s.reader_position(&key), Some(serde_json::json!({ "page": 9, "frac": 0.5 })));
        // o arquivo mudou de lugar: a identidade é a mesma
        let moved = d.path().join("movido.pdf");
        std::fs::rename(&pdf, &moved).unwrap();
        assert_eq!(s.reader_position(&reader::fingerprint(&moved).unwrap()).unwrap()["page"], 9);
        // gravar de novo substitui
        s.remember_reader_position(&key, serde_json::json!({ "page": 12 })).unwrap();
        assert_eq!(s.reader_position(&key).unwrap()["page"], 12);
    }

    #[test]
    fn remembering_rejects_arbitrary_keys_and_survives_a_corrupt_file() {
        let (d, s) = store();
        for bad in ["../x", "", "nao e hex", "a/b-c"] {
            assert!(s.remember_reader_position(bad, serde_json::json!({})).is_err(), "{bad}");
            assert_eq!(s.reader_position(bad), None);
        }
        std::fs::write(d.path().join("reader-positions.json"), b"{ lixo").unwrap();
        assert_eq!(s.reader_position("1-2"), None);
        assert!(d.path().join("reader-positions.json.corrupt").exists());
        s.remember_reader_position("1-2", serde_json::json!({ "page": 3 })).unwrap(); // recomeça
        assert_eq!(s.reader_position("1-2").unwrap()["page"], 3);
    }

    #[test]
    fn only_the_most_recent_positions_are_kept() {
        let (_d, s) = store();
        let mut all = Positions::default();
        for i in 0..MAX_REMEMBERED + 5 {
            all.entries.insert(format!("{i:x}-1"), RememberedPosition { pos: serde_json::json!({ "page": i }), at: i as u64 });
        }
        write_atomic(&s.positions_path(), &serde_json::to_vec(&all).unwrap()).unwrap();
        s.remember_reader_position("ffffff-1", serde_json::json!({ "page": 1 })).unwrap();
        let kept = s.load_positions().entries;
        assert_eq!(kept.len(), MAX_REMEMBERED);
        assert!(kept.contains_key("ffffff-1"), "a nova fica");
        assert!(!kept.contains_key("0-1"), "as mais antigas saem");
    }

    #[test]
    fn for_path_maps_extensions() {
        assert_eq!(TabKind::for_path(Path::new("a/B.PDF")), Some(TabKind::Pdf));
        assert_eq!(TabKind::for_path(Path::new("livros/Romance.EPUB")), Some(TabKind::Epub));
        assert_eq!(TabKind::for_path(Path::new("a/nota.md")), None);
        assert_eq!(TabKind::for_path(Path::new("pdf")), None);
    }
}
