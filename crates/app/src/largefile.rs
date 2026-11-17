//! Comandos do modo de arquivo grande (`fullpad_core::large`): abrir sem ler, ler por lote, ir para a
//! linha, editar, salvar em fluxo e buscar. O texto do arquivo grande **nunca** passa por
//! `read_note`/`save_note`: a UI só enxerga o lote que está na tela.
//!
//! Todos os comandos são `async` e rodam em `spawn_blocking`: ler 2 MB, indexar ou salvar não pode
//! travar o laço de eventos (num comando síncrono o Windows deixa todo `invoke` sem resposta).

use crate::{err, parse_id, AppState};
use fullpad_core::large::{self, BatchOut, EditOut, Hit, Info, Located, Probe, SaveMode, SavePlan, SearchEnd, LARGE_THRESHOLD, MAX_HITS};
use fullpad_core::search::Options as SearchOptions;
use fullpad_core::{DiskStamp, DiskState, TabState};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State, WebviewWindow};
use uuid::Uuid;

type Larges = std::collections::HashMap<Uuid, Arc<large::Large>>;

fn get(state: &AppState, id: Uuid) -> Result<Arc<large::Large>, String> {
    let map: std::sync::MutexGuard<Larges> = state.larges.lock().unwrap();
    map.get(&id).cloned().ok_or_else(|| "o arquivo grande desta aba não está aberto".to_string())
}

/// Para o trabalho em andamento e esquece o arquivo grande da aba (ao fechar a aba).
pub fn forget(state: &AppState, id: Uuid) {
    if let Some(l) = state.larges.lock().unwrap().remove(&id) {
        l.close();
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProbeOut {
    /// Caminho de sempre (`open_file`).
    Normal,
    /// Abre em modo grande (`large_open`).
    Large,
    /// UTF-16 acima do limite: a UI oferece carregar inteiro pelo caminho normal.
    Utf16 { size: u64 },
}

/// O arquivo abre em modo grande? Barato: só metadados para arquivo pequeno.
#[tauri::command]
pub async fn large_probe(path: PathBuf) -> Result<ProbeOut, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(match large::probe(&path, LARGE_THRESHOLD).map_err(err)? {
            Probe::Normal => ProbeOut::Normal,
            Probe::Large(_) => ProbeOut::Large,
            Probe::Utf16 { size } => ProbeOut::Utf16 { size },
        })
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
pub struct LargeOpened {
    tab: TabState,
    info: Info,
}

/// Abre o arquivo em modo grande: aba nova, sem ler o arquivo; o índice sai em segundo plano. Recusa
/// o que `large::probe` não aceita (a UI não consegue forçar um arquivo comum ou binário para cá).
#[tauri::command]
pub async fn large_open(state: State<'_, AppState>, window: WebviewWindow, path: PathBuf) -> Result<LargeOpened, String> {
    let store = state.store.clone();
    let (mut tab, l) = tauri::async_runtime::spawn_blocking(move || {
        if !matches!(large::probe(&path, LARGE_THRESHOLD).map_err(err)?, Probe::Large(_)) {
            return Err("esse arquivo não abre em modo de arquivo grande".to_string());
        }
        store.open_large(&path).map_err(err)
    })
    .await
    .map_err(err)??;
    tab.window = window.label().to_string();
    {
        let _g = state.session_lock.lock().unwrap();
        let mut session = state.store.load_session().map_err(err)?;
        session.tabs.push(tab.clone());
        state.store.save_session(&session).map_err(err)?;
    }
    l.start_index();
    let info = l.info().map_err(err)?;
    state.larges.lock().unwrap().insert(tab.id, l);
    Ok(LargeOpened { tab, info })
}

/// Liga o arquivo de uma aba grande que já existe na sessão (ao reiniciar o app ou reabrir da lixeira):
/// índice novo e o diário de alterações. Chamar de novo troca o anterior.
#[tauri::command]
pub async fn large_attach(state: State<'_, AppState>, id: String) -> Result<Info, String> {
    let id = parse_id(&id)?;
    let tab = {
        let session = state.store.load_session().map_err(err)?;
        session.tabs.into_iter().find(|t| t.id == id).ok_or("aba não encontrada")?
    };
    let store = state.store.clone();
    let l = tauri::async_runtime::spawn_blocking(move || store.attach_large(&tab).map_err(err)).await.map_err(err)??;
    l.start_index();
    let info = l.info().map_err(err)?;
    if let Some(old) = state.larges.lock().unwrap().insert(id, l) {
        old.close();
    }
    Ok(info)
}

macro_rules! blocking {
    ($state:expr, $id:expr, |$l:ident| $body:expr) => {{
        let id = parse_id(&$id)?;
        let $l = get(&$state, id)?;
        tauri::async_runtime::spawn_blocking(move || $body.map_err(err)).await.map_err(err)?
    }};
}

#[tauri::command]
pub async fn large_info(state: State<'_, AppState>, id: String) -> Result<Info, String> {
    blocking!(state, id, |l| l.info())
}

/// Lê o lote `index` (com as alterações pendentes aplicadas).
#[tauri::command]
pub async fn large_batch(state: State<'_, AppState>, id: String, index: usize) -> Result<BatchOut, String> {
    blocking!(state, id, |l| l.read_batch(index))
}

/// Em que lote está a linha `line` (a partir de 0): só soma as linhas dos lotes.
#[tauri::command]
pub async fn large_locate(state: State<'_, AppState>, id: String, line: u64) -> Result<Located, String> {
    blocking!(state, id, |l| l.locate(line))
}

/// Guarda o texto novo do lote (no diário em disco; o arquivo do usuário não muda).
#[tauri::command]
pub async fn large_edit(state: State<'_, AppState>, id: String, index: usize, text: String) -> Result<EditOut, String> {
    blocking!(state, id, |l| l.edit(index, &text))
}

/// Situação do arquivo no disco (só data e tamanho; nunca lê o arquivo).
#[tauri::command]
pub async fn large_check(state: State<'_, AppState>, id: String) -> Result<DiskState, String> {
    blocking!(state, id, |l| l.check_disk())
}

/// O que salvar custaria (lotes que mudaram de tamanho, bytes de cada modo): a UI decide se pergunta.
#[tauri::command]
pub async fn large_save_plan(state: State<'_, AppState>, id: String) -> Result<SavePlan, String> {
    blocking!(state, id, |l| l.save_plan())
}

#[derive(Serialize)]
pub struct SaveProgress {
    done: u64,
    total: u64,
}

/// Andamento do salvar (bytes gravados e total). Não pega o lock do arquivo, então responde mesmo
/// durante a escrita direta.
#[tauri::command]
pub fn large_save_progress(state: State<AppState>, id: String) -> Result<SaveProgress, String> {
    let (done, total) = get(&state, parse_id(&id)?)?.save_progress();
    Ok(SaveProgress { done, total })
}

/// Pede para o salvar em andamento parar: o temporário é apagado e o arquivo fica como estava.
#[tauri::command]
pub fn large_save_cancel(state: State<AppState>, id: String) -> Result<(), String> {
    let id = parse_id(&id)?;
    get(&state, id)?.cancel_save();
    Ok(())
}

#[derive(Serialize)]
pub struct LargeSaved {
    stamp: DiskStamp,
    info: Info,
    path: PathBuf,
    title: String,
}

/// Salva: copia o original em fluxo trocando só os lotes editados (escrita atômica). `path` diferente
/// é "Salvar como" (o original fica intacto). Recusa com `conflito:` se o arquivo mudou fora do Fullpad.
#[tauri::command]
pub async fn large_save(state: State<'_, AppState>, id: String, path: Option<PathBuf>, mode: Option<SaveMode>) -> Result<LargeSaved, String> {
    let uuid = parse_id(&id)?;
    let l = get(&state, uuid)?;
    let (l2, dest) = (l.clone(), path.clone());
    let stamp = tauri::async_runtime::spawn_blocking(move || l2.save(dest.as_deref(), mode.unwrap_or(SaveMode::Safe))).await.map_err(err)?.map_err(err)?;
    if !l.info().map_err(err)?.done {
        l.start_index(); // o salvar emendou linhas: o índice sai de novo
    }
    let info = l.info().map_err(err)?;
    let new_path = l.path().map_err(err)?;
    let title = new_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    {
        let _g = state.session_lock.lock().unwrap();
        let mut session = state.store.load_session().map_err(err)?;
        if let Some(tab) = session.tabs.iter_mut().find(|t| t.id == uuid) {
            tab.path = Some(new_path.clone());
            tab.title = title.clone();
            tab.disk = Some(stamp);
            tab.dirty = false;
            state.store.save_session(&session).map_err(err)?;
        }
    }
    Ok(LargeSaved { stamp, info, path: new_path, title })
}

/// Descarta as alterações e relê o arquivo do disco ("Recarregar do disco"): índice novo, carimbo novo.
#[tauri::command]
pub async fn large_reload(state: State<'_, AppState>, id: String) -> Result<Info, String> {
    let uuid = parse_id(&id)?;
    if let Ok(old) = get(&state, uuid) {
        let o = old.clone();
        tauri::async_runtime::spawn_blocking(move || o.discard_edits()).await.map_err(err)?.map_err(err)?;
        old.close();
    } else {
        let _ = std::fs::remove_dir_all(state.store.large_dir(uuid));
    }
    let tab = {
        let session = state.store.load_session().map_err(err)?;
        session.tabs.into_iter().find(|t| t.id == uuid).ok_or("aba não encontrada")?
    };
    let store = state.store.clone();
    let l = tauri::async_runtime::spawn_blocking(move || store.attach_large(&tab).map_err(err)).await.map_err(err)??;
    let stamp = l.stamp().map_err(err)?;
    l.start_index();
    {
        let _g = state.session_lock.lock().unwrap();
        let mut session = state.store.load_session().map_err(err)?;
        if let Some(tab) = session.tabs.iter_mut().find(|t| t.id == uuid) {
            tab.disk = Some(stamp);
            tab.dirty = false;
            state.store.save_session(&session).map_err(err)?;
        }
    }
    let info = l.info().map_err(err)?;
    state.larges.lock().unwrap().insert(uuid, l);
    Ok(info)
}

/// Descarta só as alterações guardadas de outra versão do arquivo (`orphaned`) sem reler nada.
#[tauri::command]
pub async fn large_discard(state: State<'_, AppState>, id: String) -> Result<Info, String> {
    blocking!(state, id, |l| l.discard_edits().and_then(|()| l.info()))
}

#[derive(Clone, Serialize)]
struct HitsEvent {
    search: String,
    hits: Vec<Hit>,
    scanned: usize,
}

/// Busca em fluxo: os resultados chegam aos poucos pelo evento `large-hits` (por lote) e o comando
/// devolve o fim (total, se foi cortado ou cancelado). Cancelável com `large_cancel`.
#[tauri::command]
pub async fn large_search(
    state: State<'_, AppState>,
    window: WebviewWindow,
    id: String,
    search: String,
    query: String,
    opts: SearchOptions,
) -> Result<SearchEnd, String> {
    let uuid = parse_id(&id)?;
    let l = get(&state, uuid)?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(old) = state.searches.lock().unwrap().insert(search.clone(), cancel.clone()) {
        old.store(true, Ordering::Relaxed);
    }
    let (label, win) = (window.label().to_string(), window.clone());
    let sid = search.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        l.search(&query, &opts, &cancel, MAX_HITS, &mut |hits, scanned| {
            if !hits.is_empty() {
                let _ = win.emit_to(label.as_str(), "large-hits", HitsEvent { search: sid.clone(), hits: hits.to_vec(), scanned });
            }
        })
    })
    .await
    .map_err(err)?;
    state.searches.lock().unwrap().remove(&search);
    result.map_err(err)
}

#[tauri::command]
pub fn large_cancel(state: State<AppState>, search: String) {
    if let Some(c) = state.searches.lock().unwrap().get(&search) {
        c.store(true, Ordering::Relaxed);
    }
}
