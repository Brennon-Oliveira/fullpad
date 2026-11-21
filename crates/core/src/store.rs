use crate::atomic::write_atomic;
use crate::disk::{self, DiskState, DiskStamp};
use crate::fileio;
use crate::large;
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

/// O layout do diagrama da aba (`text` é `None` se ainda não há layout nenhum).
#[derive(Debug, Clone, serde::Serialize)]
pub struct LayoutFile {
    pub text: Option<String>,
    /// Carimbo do arquivo de layout ao lado do `.dbmlx` de agora (`None` se não existe ou a aba é avulsa).
    pub base: Option<DiskStamp>,
    /// O texto vem da cópia de trabalho (alterações ainda não salvas).
    pub draft: bool,
}

/// `esquema.dbmlx` → `esquema.dbmlx.layout.json`; `None` se não é um `.dbmlx`.
pub fn sibling_layout(file: &Path) -> Option<PathBuf> {
    let ext = file.extension()?.to_string_lossy().to_ascii_lowercase();
    if ext != "dbmlx" {
        return None;
    }
    let mut name = file.file_name()?.to_os_string();
    name.push(".layout.json");
    Some(file.with_file_name(name))
}

/// Persistência em disco:
///
/// ```text
/// <root>/session.json      ordem das abas, aba ativa, cursor, modo…
/// <root>/notes/<id>.md     conteúdo de cada nota
/// <root>/trash/<id>.md     notas fechadas (recuperáveis)
/// <root>/layouts/<id>.json layout do diagrama de uma nota avulsa em DBML (de arquivo `.dbmlx`, fica ao lado dele)
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
        Self::open_default_named("fullpad")
    }

    /// Como `open_default`, com outro nome de pasta (o build de desenvolvimento usa `fullpad-dev`, para nunca
    /// dividir dados com o app instalado). `FULLPAD_DATA_DIR` ainda sobrescreve tudo.
    pub fn open_default_named(name: &str) -> Result<Self> {
        if let Some(dir) = std::env::var_os("FULLPAD_DATA_DIR") {
            return Ok(Self::new(dir));
        }
        let base = dirs::data_dir().ok_or(Error::NoDataDir)?;
        Ok(Self::new(base.join(name)))
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

    fn layout_internal_path(&self, id: Uuid) -> PathBuf {
        self.root.join("layouts").join(format!("{id}.json"))
    }

    fn trash_layout_path(&self, id: Uuid) -> PathBuf {
        self.root.join("trash").join(format!("{id}.layout.json"))
    }

    /// Imagens coladas numa nota **solta** (sem arquivo, logo sem pasta "ao lado"): uma pasta por nota.
    pub fn images_dir(&self, id: Uuid) -> PathBuf {
        self.root.join("images").join(id.to_string())
    }

    /// Onde as imagens da aba `id` são guardadas e o arquivo dela (se há): `imagens/<nome>/` ao lado do arquivo,
    /// ou a pasta de dados do app para a nota solta. Sempre pelo id de uma aba que existe, nunca por caminho da UI.
    pub fn image_target(&self, id: Uuid) -> Result<(PathBuf, Option<PathBuf>)> {
        let session = self.load_session()?;
        let tab = session.tabs.iter().find(|t| t.id == id).ok_or_else(|| Error::Invalid("aba não encontrada".into()))?;
        if tab.kind != TabKind::Text || tab.large || tab.release_notes {
            return Err(Error::Invalid("só uma aba de texto editável recebe imagens".into()));
        }
        match tab.path.as_deref().and_then(|p| crate::images::dir_for_file(p).map(|d| (d, p.to_path_buf()))) {
            Some((dir, file)) => Ok((dir, Some(file))),
            None => Ok((self.images_dir(id), None)),
        }
    }

    /// Alterações pendentes de um arquivo grande (`large.rs`): uma pasta por aba.
    pub fn large_dir(&self, id: Uuid) -> PathBuf {
        self.root.join("large").join(id.to_string())
    }

    fn trash_large_dir(&self, id: Uuid) -> PathBuf {
        self.root.join("trash").join(format!("{id}.large"))
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
        self.create_app_note(&format!("Nota de versão V{version}"), notes)
    }

    /// Nota só de leitura cujo texto é do app (nota de versão, histórico de versões): markdown,
    /// aberta renderizada, marcada `release_notes` (fechar apaga de vez, sem histórico).
    pub fn create_app_note(&self, title: &str, body: &str) -> Result<(TabState, String)> {
        let text = format!("# {title}\n\n{}\n", body.trim());
        let mut tab = self.create_note()?;
        self.write_note(tab.id, &text)?;
        tab.title = title.to_string();
        tab.language = Language::Markdown;
        tab.mode = ViewMode::Rendered;
        tab.release_notes = true;
        Ok((tab, text))
    }

    /// A versão gravada na última execução (antes de `note_running_version` trocá-la).
    pub fn previous_version(&self) -> Option<String> {
        let v = std::fs::read_to_string(self.root.join("version")).ok()?;
        let v = v.trim();
        (!v.is_empty()).then(|| v.to_string())
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
        let (decoded, stamp) = fileio::read_file_stamped(path)?;
        let mut tab = self.create_note()?;
        self.write_note(tab.id, &decoded.text)?;
        tab.path = Some(path.to_path_buf());
        tab.title = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        tab.encoding = decoded.encoding;
        tab.eol = decoded.eol;
        tab.disk = Some(stamp);
        Ok((tab, decoded.text))
    }

    /// Abre um arquivo de texto grande em modo de lotes (`large.rs`). **Não lê o arquivo** (só a
    /// amostra do começo): a nota em `notes/` fica vazia, só como marcador (a aba segue o caminho das
    /// outras: sessão, lixeira, mover entre janelas), e o índice é construído em segundo plano por
    /// quem chama (`start_index`). Quem decide se o arquivo vale é `large::probe`.
    pub fn open_large(&self, path: &Path) -> Result<(TabState, std::sync::Arc<large::Large>)> {
        let mut tab = self.create_note()?;
        let l = large::Large::open(path, large::Limits::default(), Some(self.large_dir(tab.id)))?;
        tab.path = Some(path.to_path_buf());
        tab.title = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        tab.encoding = l.encoding;
        tab.eol = l.eol;
        tab.large = true;
        tab.disk = Some(l.stamp()?);
        tab.dirty = l.is_dirty();
        Ok((tab, l))
    }

    /// Reabre o arquivo grande de uma aba que já existe (ao reiniciar o app, ao reabrir da lixeira,
    /// ao recarregar do disco): índice novo e o diário de alterações dela, se houver.
    pub fn attach_large(&self, tab: &TabState) -> Result<std::sync::Arc<large::Large>> {
        if !tab.large {
            return Err(Error::Invalid("a aba não é de um arquivo grande".into()));
        }
        let path = tab.path.as_ref().ok_or_else(|| Error::Invalid("a aba não está ligada a um arquivo".into()))?;
        large::Large::open(path, large::Limits::default(), Some(self.large_dir(tab.id)))
    }

    /// Como o arquivo da aba está em relação ao que o Fullpad leu ou gravou por último. Devolve também
    /// o carimbo a guardar (data nova de um arquivo de mesmo conteúdo, ou o primeiro carimbo de uma
    /// aba antiga que ainda não tinha um). Uma mudança (`Changed`) **não** vira carimbo: continua
    /// sendo apontada até a pessoa recarregar ou escolher manter o texto dela.
    pub fn disk_state(&self, tab: &TabState) -> Result<(DiskState, Option<DiskStamp>)> {
        let Some(path) = tab.path.as_ref().filter(|_| tab.kind == TabKind::Text && !tab.release_notes) else {
            return Ok((DiskState::Unchanged, None));
        };
        if tab.large {
            // arquivo grande: nunca se lê o arquivo inteiro para conferir (`large::check_stamp`)
            return Ok((tab.disk.map_or(Ok(DiskState::Unchanged), |k| large::check_stamp(path, &k))?, None));
        }
        match tab.disk {
            // só uma data nova de conteúdo igual vira carimbo; uma mudança de verdade continua apontada
            Some(known) => disk::check(path, &known).map(|(s, n)| (s, n.filter(|_| s == DiskState::Unchanged))),
            None => {
                // aba de uma versão anterior, sem carimbo: o texto salvo na nota diz se o arquivo é o mesmo
                let Some(now) = disk::stamp(path)? else { return Ok((DiskState::Missing, None)) };
                let on_disk = fileio::read_file(path)?.text;
                let same = self.read_note(tab.id).map(|t| t == on_disk).unwrap_or(false);
                // sem carimbo e com edições locais, não há como saber quem mudou: vale o disco de agora
                Ok(if same || tab.dirty { (DiskState::Unchanged, Some(now)) } else { (DiskState::Changed, None) })
            }
        }
    }

    /// Relê o arquivo da aba (para "recarregar do disco"): o texto novo, a codificação e as quebras de
    /// linha dele, e o carimbo. Atualiza o buffer da nota; quem chama atualiza a aba na sessão.
    pub fn reload_file(&self, id: Uuid, path: &Path) -> Result<(fileio::Decoded, DiskStamp)> {
        let (decoded, stamp) = fileio::read_file_stamped(path)?;
        self.write_note(id, &decoded.text)?;
        Ok((decoded, stamp))
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

    /// Grava o texto no arquivo real e sincroniza o buffer da nota. Devolve o carimbo do arquivo
    /// gravado. Sem `force`, **recusa** (`Error::Conflict`) se o arquivo mudou no disco depois do
    /// último carimbo da aba: gravar por cima apagaria a mudança de outro programa. Arquivo que sumiu
    /// pode ser gravado de novo; "Salvar como" para outro caminho não tem o que conferir.
    pub fn save_file(
        &self,
        id: Uuid,
        path: &Path,
        text: &str,
        encoding: Encoding,
        eol: Eol,
        force: bool,
    ) -> Result<DiskStamp> {
        let session = self.load_session()?;
        let tab = session.tabs.iter().find(|t| t.id == id);
        // última trava: o texto de uma aba de PDF/EPUB (vazio) jamais pode ir parar no arquivo dele
        if tab.is_some_and(|t| t.kind.is_reader()) {
            return Err(Error::Invalid("abas de PDF e EPUB são só de leitura".into()));
        }
        if let (false, Some(tab)) = (force, tab) {
            if tab.path.as_deref() == Some(path) {
                if let Some(known) = tab.disk {
                    if disk::check(path, &known)?.0 == DiskState::Changed {
                        return Err(Error::Conflict);
                    }
                }
            }
        }
        fileio::write_file(path, text, encoding, eol)?;
        self.write_note(id, text)?;
        disk::stamp(path)?.ok_or_else(|| Error::Invalid("o arquivo sumiu logo depois de gravar".into()))
    }

    // ---- layout do diagrama (.dbmlx) ----------------------------------------
    //
    // O layout tem uma **cópia de trabalho** em `layouts/<id>.json` (como o texto da aba vive em
    // `notes/<id>.md` até ser salvo) e, numa aba de arquivo `.dbmlx`, o arquivo de verdade ao lado
    // dele (`esquema.dbmlx.layout.json`). Editar (arrastar, "Ver layout") grava só a cópia de
    // trabalho; **Salvar** consolida: copia para o arquivo ao lado (`commit_layout`) e apaga a cópia.
    // Sem cópia de trabalho, vale o arquivo ao lado. Numa nota avulsa só existe a cópia de trabalho.

    fn check_layout_tab(&self, id: Uuid) -> Result<Option<PathBuf>> {
        let session = self.load_session()?;
        let tab = session.tabs.iter().find(|t| t.id == id).ok_or_else(|| Error::Invalid("aba não encontrada".into()))?;
        if tab.kind != TabKind::Text || tab.release_notes {
            return Err(Error::Invalid("a aba não tem layout".into()));
        }
        match &tab.path {
            None => Ok(None),
            Some(p) => sibling_layout(p).map(Some).ok_or_else(|| Error::Invalid("só arquivos .dbmlx guardam layout".into())),
        }
    }

    /// Lê o layout da aba: a cópia de trabalho se há (`draft`), senão o arquivo ao lado. `base` é o
    /// carimbo do arquivo ao lado de agora (para o Salvar conferir mudança externa).
    pub fn read_layout(&self, id: Uuid) -> Result<LayoutFile> {
        let sibling = self.check_layout_tab(id)?;
        let work = self.layout_internal_path(id);
        let base = match &sibling {
            Some(p) => disk::stamp(p)?,
            None => None,
        };
        let read = |path: &Path| -> Result<Option<String>> {
            match std::fs::read(path) {
                Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(source) => Err(Error::Io { path: path.to_path_buf(), source }),
            }
        };
        if let Some(text) = read(&work)? {
            return Ok(LayoutFile { text: Some(text), base, draft: true });
        }
        let text = match &sibling {
            Some(p) => read(p)?,
            None => None,
        };
        Ok(LayoutFile { text, base, draft: false })
    }

    /// Grava o texto na cópia de trabalho do layout (escrita atômica). Não toca no arquivo ao lado.
    pub fn write_layout(&self, id: Uuid, text: &str) -> Result<()> {
        self.check_layout_tab(id)?;
        write_atomic(&self.layout_internal_path(id), text.as_bytes())
    }

    /// Descarta as alterações do layout: apaga a cópia de trabalho (volta o arquivo ao lado, se há).
    pub fn discard_layout(&self, id: Uuid) -> Result<()> {
        let path = self.layout_internal_path(id);
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(Error::Io { path, source: e }),
            _ => Ok(()),
        }
    }

    /// Salvar: a cópia de trabalho passa para o arquivo ao lado de `file` (o `.dbmlx` que acabou de ser
    /// gravado) e é apagada. Devolve o carimbo do arquivo de layout, ou `None` se não havia o que
    /// consolidar (sem cópia de trabalho, ou `file` não é `.dbmlx`: a cópia fica onde está).
    ///
    /// Gravando no **mesmo** arquivo da aba, recusa (`Error::Conflict`) se o layout ao lado mudou fora
    /// do Fullpad desde `base` (o carimbo de quando foi lido); "Salvar como" para outro caminho não confere
    /// (a pessoa já escolheu o destino). `force` só vem de "Sobrescrever".
    pub fn commit_layout(&self, id: Uuid, file: &Path, base: Option<DiskStamp>, force: bool) -> Result<Option<DiskStamp>> {
        let work = self.layout_internal_path(id);
        let Ok(bytes) = std::fs::read(&work) else { return Ok(None) };
        let Some(target) = sibling_layout(file) else { return Ok(None) };
        let same_file = self.load_session()?.tabs.iter().find(|t| t.id == id).and_then(|t| t.path.as_deref()) == Some(file);
        if !force && same_file {
            let moved = match base {
                Some(k) => disk::check(&target, &k)?.0 != DiskState::Unchanged,
                None => target.exists(),
            };
            if moved {
                return Err(Error::Conflict);
            }
        }
        write_atomic(&target, &bytes)?;
        let _ = std::fs::remove_file(&work);
        disk::stamp(&target)
    }

    /// Fecha uma nota movendo-a para `trash/` (nunca apaga de verdade).
    pub fn close_note(&self, id: Uuid) -> Result<()> {
        let from = self.note_path(id);
        let to = self.trash_path(id);
        if let Some(dir) = to.parent() {
            std::fs::create_dir_all(dir).at(dir)?;
        }
        let _ = std::fs::rename(self.layout_internal_path(id), self.trash_layout_path(id));
        // alterações pendentes de um arquivo grande vão junto (nada se perde ao fechar)
        let large = self.large_dir(id);
        if large.is_dir() {
            let _ = std::fs::remove_dir_all(self.trash_large_dir(id));
            let _ = std::fs::rename(&large, self.trash_large_dir(id));
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
        let layout = self.layout_internal_path(id);
        if let Some(dir) = layout.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::rename(self.trash_layout_path(id), layout);
        if self.trash_large_dir(id).is_dir() {
            let dir = self.large_dir(id);
            if let Some(parent) = dir.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::rename(self.trash_large_dir(id), dir);
        }
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
    fn previous_version_is_read_before_it_is_replaced() {
        let (_d, s) = store();
        assert_eq!(s.previous_version(), None);
        s.note_running_version("1.1.0").unwrap();
        assert_eq!(s.previous_version().as_deref(), Some("1.1.0"));
        s.note_running_version("2.0.0").unwrap();
        assert_eq!(s.previous_version().as_deref(), Some("2.0.0"));
    }

    #[test]
    fn app_note_is_read_only_and_leaves_no_history() {
        let (_d, s) = store();
        let (tab, text) = s.create_app_note("Histórico de versões", "## 1.0.0\n\n- x").unwrap();
        assert!(tab.release_notes && text.starts_with("# Histórico de versões\n\n## 1.0.0"));
        s.close_tab(&tab).unwrap();
        assert!(s.list_closed(10).is_empty());
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

        s.save_file(tab.id, &file, "# T\nnova\n", tab.encoding, tab.eol, false).unwrap();
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
    fn mermaid_language_survives_session_roundtrip() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.language = crate::Language::Mermaid;
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].language, crate::Language::Mermaid);
    }

    /// Abre um arquivo e põe a aba na sessão (como a UI faz ao gravar a janela).
    fn open_in_session(s: &Store, path: &Path) -> TabState {
        let (tab, _) = s.open_file(path).unwrap();
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        tab
    }

    fn touch_later(path: &Path) {
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options().write(true).open(path).unwrap().set_modified(later).unwrap();
    }

    #[test]
    fn open_file_records_the_disk_stamp() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "um\n").unwrap();
        let tab = open_in_session(&s, &file);
        assert_eq!(tab.disk, disk::stamp(&file).unwrap());
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Unchanged);
    }

    #[test]
    fn save_refuses_to_overwrite_a_change_made_outside_unless_forced() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "original\n").unwrap();
        let tab = open_in_session(&s, &file);
        // outro programa grava no arquivo
        std::fs::write(&file, "do outro programa\n").unwrap();
        touch_later(&file);
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Changed);
        let e = s.save_file(tab.id, &file, "meu texto\n", tab.encoding, tab.eol, false).unwrap_err();
        assert!(matches!(e, Error::Conflict), "veio {e:?}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "do outro programa\n", "nada foi sobrescrito");
        // com `force` (a pessoa escolheu sobrescrever) grava e devolve o carimbo novo
        let stamp = s.save_file(tab.id, &file, "meu texto\n", tab.encoding, tab.eol, true).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "meu texto\n");
        assert_eq!(Some(stamp), disk::stamp(&file).unwrap());
    }

    #[test]
    fn save_goes_through_when_the_file_did_not_change_and_after_updating_the_stamp() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "um\n").unwrap();
        let mut tab = open_in_session(&s, &file);
        let stamp = s.save_file(tab.id, &file, "dois\n", tab.encoding, tab.eol, false).unwrap();
        // a UI guarda o carimbo devolvido; um segundo salvar não pode achar que o arquivo mudou
        tab.disk = Some(stamp);
        let mut session = s.load_session().unwrap();
        session.tabs[0].disk = tab.disk;
        s.save_session(&session).unwrap();
        s.save_file(tab.id, &file, "tres\n", tab.encoding, tab.eol, false).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "tres\n");
    }

    #[test]
    fn save_as_another_path_and_recreating_a_deleted_file_are_not_conflicts() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "um\n").unwrap();
        let tab = open_in_session(&s, &file);
        let other = d.path().join("b.md");
        std::fs::write(&other, "ocupado\n").unwrap(); // o diálogo do sistema já confirmou a troca
        s.save_file(tab.id, &other, "novo\n", tab.encoding, tab.eol, false).unwrap();
        std::fs::remove_file(&file).unwrap();
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Missing);
        s.save_file(tab.id, &file, "de volta\n", tab.encoding, tab.eol, false).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "de volta\n");
    }

    #[test]
    fn a_tab_from_an_older_version_without_a_stamp_is_judged_by_its_saved_text() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "texto\n").unwrap();
        let (mut tab, _) = s.open_file(&file).unwrap();
        tab.disk = None; // sessão gravada antes de existir o carimbo
        // o texto da nota é o do arquivo: sem mudança, e o carimbo é criado
        let (state, stamp) = s.disk_state(&tab).unwrap();
        assert_eq!((state, stamp.is_some()), (DiskState::Unchanged, true));
        // o arquivo mudou e a aba não tem edições: é mudança externa, e não vira carimbo
        std::fs::write(&file, "outro\n").unwrap();
        assert_eq!(s.disk_state(&tab).unwrap(), (DiskState::Changed, None));
        // com edições locais não há como saber quem mudou: vale o disco de agora
        tab.dirty = true;
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Unchanged);
    }

    #[test]
    fn reload_file_replaces_the_note_and_returns_the_stamp() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "um\r\ndois\r\n").unwrap();
        let tab = open_in_session(&s, &file);
        std::fs::write(&file, "tres\n").unwrap();
        let (decoded, stamp) = s.reload_file(tab.id, &file).unwrap();
        assert_eq!((decoded.text.as_str(), decoded.eol), ("tres\n", Eol::Lf));
        assert_eq!(s.read_note(tab.id).unwrap(), "tres\n");
        assert_eq!(Some(stamp), disk::stamp(&file).unwrap());
    }

    #[test]
    fn the_stamp_is_kept_by_the_session_and_not_changed_by_a_stale_window_save() {
        let (d, s) = store();
        let file = d.path().join("a.md");
        std::fs::write(&file, "um\n").unwrap();
        let tab = open_in_session(&s, &file);
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].disk, tab.disk, "o carimbo sobrevive a reiniciar");
        let mut stale = tab.clone();
        stale.disk = Some(DiskStamp { mtime: 1, size: 1, hash: 1 });
        let mut session = loaded;
        session.apply_window("main", vec![stale], None, &Default::default());
        assert_eq!(session.tabs[0].disk, tab.disk, "a UI atrasada não troca o carimbo do Rust");
    }

    #[test]
    fn latex_language_survives_session_roundtrip() {
        let (_d, s) = store();
        let mut tab = s.create_note().unwrap();
        tab.language = crate::Language::Latex;
        let mut session = Session::empty();
        session.active = Some(tab.id);
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert_eq!(loaded.tabs[0].language, crate::Language::Latex);
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
            r#"{{"version":1,"active":"{id}","tabs":[{{"id":"{id}","title":"x","cursor":2,"scroll":0.0,"mode":"holografico","language":"holografico"}}]}}"#,
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
        assert!(s.save_file(tab.id, &pdf_path, "", Encoding::Utf8, Eol::Lf, true).is_err());
        assert_eq!(std::fs::read(&pdf_path).unwrap(), before);

        // uma nota de texto comum continua gravando normalmente
        let note = s.create_note().unwrap();
        let out = d.path().join("saida.txt");
        s.save_file(note.id, &out, "oi", Encoding::Utf8, Eol::Lf, false).unwrap();
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

    fn dbml_tab(s: &Store, path: Option<&Path>) -> TabState {
        let mut tab = s.create_note().unwrap();
        tab.path = path.map(|p| p.to_path_buf());
        let mut session = s.load_session().unwrap();
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        tab
    }

    fn work(s: &Store, id: Uuid) -> PathBuf {
        s.root().join("layouts").join(format!("{id}.json"))
    }

    #[test]
    fn layout_of_a_loose_note_lives_in_layouts_and_follows_the_tab() {
        let (_d, s) = store();
        let tab = dbml_tab(&s, None);
        assert_eq!(s.read_layout(tab.id).unwrap().text, None);
        s.write_layout(tab.id, "{}").unwrap();
        assert!(work(&s, tab.id).exists());
        assert!(s.read_layout(tab.id).unwrap().draft);
        s.close_tab(&tab).unwrap();
        assert!(!work(&s, tab.id).exists());
        let (restored, _) = s.restore_note(tab.id).unwrap();
        let mut session = s.load_session().unwrap();
        session.tabs.push(restored);
        s.save_session(&session).unwrap();
        assert_eq!(s.read_layout(tab.id).unwrap().text.as_deref(), Some("{}"));
    }

    #[test]
    fn editing_a_dbmlx_layout_does_not_touch_the_file_until_committed() {
        let (d, s) = store();
        let file = d.path().join("esquema.dbmlx");
        std::fs::write(&file, "Table a { id int }").unwrap();
        let side = d.path().join("esquema.dbmlx.layout.json");
        std::fs::write(&side, "{\"version\":1,\"tables\":{}}").unwrap();
        let tab = dbml_tab(&s, Some(&file));
        let l = s.read_layout(tab.id).unwrap();
        assert!(!l.draft && l.base.is_some());
        s.write_layout(tab.id, "rascunho").unwrap();
        assert_eq!(std::fs::read_to_string(&side).unwrap(), "{\"version\":1,\"tables\":{}}", "o arquivo ao lado não muda ao editar");
        let l2 = s.read_layout(tab.id).unwrap();
        assert!(l2.draft);
        assert_eq!(l2.text.as_deref(), Some("rascunho"));
        // Salvar consolida e apaga a cópia de trabalho
        let stamp = s.commit_layout(tab.id, &file, l.base, false).unwrap();
        assert!(stamp.is_some());
        assert_eq!(std::fs::read_to_string(&side).unwrap(), "rascunho");
        assert!(!work(&s, tab.id).exists());
        assert!(!s.read_layout(tab.id).unwrap().draft);
    }

    #[test]
    fn discarding_brings_back_the_file_layout() {
        let (d, s) = store();
        let file = d.path().join("x.dbmlx");
        std::fs::write(d.path().join("x.dbmlx.layout.json"), "do disco").unwrap();
        let tab = dbml_tab(&s, Some(&file));
        s.write_layout(tab.id, "meu").unwrap();
        s.discard_layout(tab.id).unwrap();
        assert_eq!(s.read_layout(tab.id).unwrap().text.as_deref(), Some("do disco"));
        s.discard_layout(tab.id).unwrap(); // de novo não é erro
    }

    #[test]
    fn only_dbmlx_files_keep_a_layout() {
        let (d, s) = store();
        let tab = dbml_tab(&s, Some(&d.path().join("esquema.dbml")));
        assert!(s.read_layout(tab.id).is_err());
        assert!(s.write_layout(tab.id, "x").is_err());
    }

    #[test]
    fn commit_refuses_to_overwrite_an_external_change_to_the_layout() {
        let (d, s) = store();
        let file = d.path().join("x.dbmlx");
        let side = d.path().join("x.dbmlx.layout.json");
        std::fs::write(&side, "original").unwrap();
        let tab = dbml_tab(&s, Some(&file));
        let base = s.read_layout(tab.id).unwrap().base;
        s.write_layout(tab.id, "meu").unwrap();
        std::fs::write(&side, "de fora, mais longo").unwrap(); // outro programa grava
        assert!(matches!(s.commit_layout(tab.id, &file, base, false), Err(Error::Conflict)));
        assert!(work(&s, tab.id).exists(), "a cópia de trabalho continua");
        assert_eq!(std::fs::read_to_string(&side).unwrap(), "de fora, mais longo");
        s.commit_layout(tab.id, &file, base, true).unwrap();
        assert_eq!(std::fs::read_to_string(&side).unwrap(), "meu");
        // o layout apareceu depois de lido como inexistente: também é mudança externa
        std::fs::remove_file(&side).unwrap();
        let tab2 = dbml_tab(&s, Some(&d.path().join("y.dbmlx")));
        let base2 = s.read_layout(tab2.id).unwrap().base;
        assert!(base2.is_none());
        s.write_layout(tab2.id, "meu").unwrap();
        std::fs::write(d.path().join("y.dbmlx.layout.json"), "surgiu").unwrap();
        assert!(matches!(s.commit_layout(tab2.id, &d.path().join("y.dbmlx"), base2, false), Err(Error::Conflict)));
    }

    #[test]
    fn commit_stamp_that_went_through_json_is_not_an_external_change() {
        let (d, s) = store();
        let file = d.path().join("x.dbmlx");
        std::fs::write(d.path().join("x.dbmlx.layout.json"), "um").unwrap();
        let tab = dbml_tab(&s, Some(&file));
        let stamp = s.read_layout(tab.id).unwrap().base.unwrap();
        // a UI recebe o carimbo como JSON e o devolve: o hash de 64 bits vira um número de 53 bits
        let mut v = serde_json::to_value(stamp).unwrap();
        v["hash"] = serde_json::json!((stamp.hash as f64) as u64);
        assert_ne!(v["hash"].as_u64(), Some(stamp.hash), "o teste só vale se a precisão se perde");
        let back: DiskStamp = serde_json::from_value(v).unwrap();
        s.write_layout(tab.id, "dois").unwrap();
        s.commit_layout(tab.id, &file, Some(back), false).unwrap();
    }

    #[test]
    fn saving_a_loose_note_as_dbmlx_moves_the_working_layout_next_to_the_file() {
        let (d, s) = store();
        let tab = dbml_tab(&s, None);
        s.write_layout(tab.id, "{\"version\":1}").unwrap();
        let file = d.path().join("novo.dbmlx");
        s.save_file(tab.id, &file, "Table a { id int }", Encoding::Utf8, Eol::Lf, true).unwrap();
        assert!(s.commit_layout(tab.id, &file, None, false).unwrap().is_some());
        assert_eq!(std::fs::read_to_string(d.path().join("novo.dbmlx.layout.json")).unwrap(), "{\"version\":1}");
        assert!(!work(&s, tab.id).exists());
        // salvar como em outro tipo de arquivo: a cópia fica onde está
        let tab = dbml_tab(&s, None);
        s.write_layout(tab.id, "x").unwrap();
        assert_eq!(s.commit_layout(tab.id, &d.path().join("a.dbml"), None, false).unwrap(), None);
        assert!(work(&s, tab.id).exists());
    }

    // ---- arquivos grandes -----------------------------------------------------------------

    fn big_file(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, "linha de log\n".repeat(3000)).unwrap();
        p
    }

    #[test]
    fn open_large_does_not_read_the_file_nor_copy_it_to_notes() {
        let (d, s) = store();
        let p = big_file(d.path(), "a.log");
        let (tab, l) = s.open_large(&p).unwrap();
        assert!(tab.large && tab.path.as_deref() == Some(p.as_path()));
        assert_eq!(s.read_note(tab.id).unwrap(), "", "a nota é só um marcador vazio");
        assert_eq!(std::fs::metadata(s.note_path(tab.id)).unwrap().len(), 0);
        assert!(tab.disk.is_some());
        l.close();
    }

    #[test]
    fn a_normal_file_still_opens_whole_and_is_not_a_large_tab() {
        let (d, s) = store();
        let p = big_file(d.path(), "normal.log"); // 39 KB, muito abaixo do limite de 20 MB
        assert_eq!(large::probe(&p, large::LARGE_THRESHOLD).unwrap(), large::Probe::Normal);
        let (tab, text) = s.open_file(&p).unwrap();
        assert!(!tab.large);
        assert_eq!(text.lines().count(), 3000);
        assert_eq!(s.read_note(tab.id).unwrap(), text, "o caminho normal grava a cópia em notes/, como sempre");
    }

    #[test]
    fn the_large_flag_is_only_written_to_the_session_when_true() {
        let (_d, s) = store();
        let normal = s.create_note().unwrap();
        assert!(!serde_json::to_string(&normal).unwrap().contains("large"));
        let mut big = s.create_note().unwrap();
        big.large = true;
        let mut session = Session::empty();
        session.tabs.push(big.clone());
        session.tabs.push(normal);
        s.save_session(&session).unwrap();
        let loaded = s.load_session().unwrap();
        assert!(loaded.tabs[0].large && !loaded.tabs[1].large);
    }

    #[test]
    fn large_tab_survives_session_close_and_reopen_with_its_pending_edits() {
        let (d, s) = store();
        let p = big_file(d.path(), "a.log");
        let (tab, l) = s.open_large(&p).unwrap();
        l.index_blocking();
        let text = l.read_batch(0).unwrap().text;
        l.edit(0, &text.replacen("linha", "LINHA", 1)).unwrap();
        l.close();
        let mut session = Session::empty();
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        // "reinicia": a sessão vem do disco, o arquivo grande é reaberto e o diário volta
        let loaded = s.load_session().unwrap();
        let again = s.attach_large(&loaded.tabs[0]).unwrap();
        again.index_blocking();
        assert_eq!(again.info().unwrap().edited_batches, 1);
        assert!(again.read_batch(0).unwrap().text.starts_with("LINHA de log"));
        assert_eq!(std::fs::read_to_string(&p).unwrap().chars().take(5).collect::<String>(), "linha", "o arquivo não mudou");
    }

    #[test]
    fn closing_a_large_tab_keeps_its_edits_in_the_trash_and_reopening_brings_them_back() {
        let (d, s) = store();
        let p = big_file(d.path(), "a.log");
        let (tab, l) = s.open_large(&p).unwrap();
        l.index_blocking();
        l.edit(0, "novo texto\n").unwrap();
        l.close();
        let mut session = Session::empty();
        session.tabs.push(tab.clone());
        s.save_session(&session).unwrap();
        s.close_tab(&tab).unwrap();
        assert!(!s.large_dir(tab.id).exists());
        assert!(s.trash_large_dir(tab.id).is_dir(), "as alterações vão para a lixeira junto com a aba");
        assert_eq!(s.list_closed(10).len(), 1);
        let (back, _) = s.restore_note(tab.id).unwrap();
        assert!(back.large);
        assert!(s.large_dir(tab.id).is_dir());
        let l2 = s.attach_large(&back).unwrap();
        l2.index_blocking();
        assert_eq!(l2.read_batch(0).unwrap().text, "novo texto\n");
    }

    #[test]
    fn disk_state_of_a_large_tab_follows_date_and_size_without_reading_the_file() {
        let (d, s) = store();
        let p = big_file(d.path(), "a.log");
        let (tab, l) = s.open_large(&p).unwrap();
        l.close();
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Unchanged);
        std::fs::write(&p, "outra coisa\n").unwrap();
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Changed);
        std::fs::remove_file(&p).unwrap();
        assert_eq!(s.disk_state(&tab).unwrap().0, DiskState::Missing);
    }

    #[test]
    fn attach_large_refuses_a_normal_tab() {
        let (d, s) = store();
        let p = big_file(d.path(), "a.log");
        let (tab, _) = s.open_file(&p).unwrap();
        assert!(s.attach_large(&tab).is_err());
    }
}
