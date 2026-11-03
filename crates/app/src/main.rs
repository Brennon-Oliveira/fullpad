#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fullpad_core::json::{self, Doc, Indent, JsonError};
use fullpad_core::reader::{FileStatus, PdfScan};
use fullpad_core::{ClosedTab, Encoding, Eol, Geometry, Session, Store, TabKind, TabState, MAIN_WINDOW};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use uuid::Uuid;

/// De quem é uma janela de preview (`preview-<aba>`): quem a abriu, a aba e se é markdown ou DBML.
#[derive(Clone, Serialize)]
struct PreviewInfo {
    owner: String,
    tab: String,
    lang: String,
}

#[derive(Clone, Serialize)]
struct DragOver {
    /// Janela a que o aviso se destina (a UI confere: ela é quem decide se mostra o espaço).
    target: String,
    cx: f64,
    cy: f64,
    title: String,
}

struct AppState {
    store: Store,
    /// Janela escondida já carregada, à espera de uma aba (tirar uma aba fica instantâneo).
    spare: Mutex<Option<String>>,
    /// Janela de abas cuja barra está sob o ponteiro durante um arrasto (para avisá-la ao sair).
    drag_over: Mutex<Option<String>>,
    /// A janela sob o ponteiro aceita a aba onde ele está (uma barra de abas ou a borda de um painel).
    /// No meio de um painel ela não aceita: a aba vira uma janela própria, como sempre.
    drag_accept: Mutex<bool>,
    /// Arrasto da única aba de uma janela: é a própria janela que anda. Guarda a distância do canto
    /// dela ao ponteiro (px físicos).
    self_drag: Mutex<Option<(i32, i32)>>,
    previews: Mutex<std::collections::HashMap<String, PreviewInfo>>,
    /// Serializa ler-alterar-gravar do `session.json`: várias janelas gravam ao mesmo tempo.
    session_lock: Mutex<()>,
    /// Serializa ler-alterar-gravar de `reader-positions.json` (várias janelas lembram posições).
    positions_lock: Mutex<()>,
    /// EPUBs abertos (só metadados e sumário), por aba: `epub_chapter` lê os capítulos sob demanda.
    epubs: Mutex<std::collections::HashMap<Uuid, fullpad_core::epub::Epub>>,
    /// CSVs indexados, por aba: a tabela pede faixas de linhas sem reenviar o texto a cada rolagem.
    csvs: Mutex<std::collections::HashMap<Uuid, CsvEntry>>,
    /// Abas fechadas nesta execução: uma gravação atrasada de uma janela não pode ressuscitá-las.
    closed: Mutex<HashSet<Uuid>>,
    /// Arquivos pedidos na linha de comando (duplo clique, "Abrir com") que a janela principal
    /// ainda não abriu. Ela os retira com `take_open_paths`.
    open_paths: Mutex<Vec<PathBuf>>,
    /// Versão nova achada por `check_update` e, depois de `download_update`, o instalador baixado.
    update: Mutex<Option<tauri_plugin_updater::Update>>,
    update_bytes: Mutex<Option<Vec<u8>>>,
    /// O app acabou de ser atualizado: a janela principal abre a nota de versão uma vez.
    just_updated: Mutex<bool>,
}

/// Notas da versão em execução, embutidas no app (a skill `gerar-versao` escreve este arquivo).
const RELEASE_NOTES: &str = include_str!("../release-notes.md");

/// Caminhos de arquivo dos argumentos (sem o executável e sem opções), absolutos: uma segunda
/// instância pode ter sido chamada de outra pasta.
fn paths_from_args(args: &[String], cwd: &std::path::Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.is_empty())
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() { p } else { cwd.join(p) }
        })
        .collect()
}

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
}

/// Procura uma versão nova nos Releases públicos (`plugins.updater` no `tauri.conf.json`).
#[tauri::command]
async fn check_update(app: AppHandle, state: State<'_, AppState>) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(err)?.check().await.map_err(err)?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *state.update.lock().unwrap() = update;
    *state.update_bytes.lock().unwrap() = None;
    Ok(info)
}

/// Baixa e confere a assinatura do instalador. Não mexe em nada: a UI ainda vai gravar tudo.
#[tauri::command]
async fn download_update(state: State<'_, AppState>) -> Result<(), String> {
    let update = state.update.lock().unwrap().clone().ok_or("nenhuma atualização pendente")?;
    let bytes = update.download(|_, _| {}, || {}).await.map_err(err)?;
    *state.update_bytes.lock().unwrap() = Some(bytes);
    Ok(())
}

/// Roda o instalador baixado. No Windows o app encerra aqui e o instalador o reabre.
/// Só chamar depois de gravar todas as janelas.
#[tauri::command]
fn install_update(state: State<AppState>) -> Result<(), String> {
    let update = state.update.lock().unwrap().clone().ok_or("nenhuma atualização pendente")?;
    let bytes = state.update_bytes.lock().unwrap().take().ok_or("a atualização não foi baixada")?;
    update.install(bytes).map_err(err)
}

/// Abre a nota de versão (Ajuda > "Ver nota de versão"): uma nota nova com as notas embutidas.
#[tauri::command]
fn release_notes(app: AppHandle, state: State<AppState>) -> Result<OpenedFile, String> {
    let version = app.package_info().version.to_string();
    let (tab, text) = state.store.create_release_notes(&version, RELEASE_NOTES).map_err(err)?;
    Ok(OpenedFile { tab, text })
}

/// Na primeira abertura depois de uma atualização, a nota de versão (uma vez só).
#[tauri::command]
fn startup_release_notes(app: AppHandle, state: State<AppState>) -> Result<Option<OpenedFile>, String> {
    if !std::mem::take(&mut *state.just_updated.lock().unwrap()) {
        return Ok(None);
    }
    release_notes(app, state).map(Some)
}

/// Entrega (e esvazia) os arquivos pedidos na linha de comando.
#[tauri::command]
fn take_open_paths(state: State<AppState>) -> Vec<PathBuf> {
    std::mem::take(&mut *state.open_paths.lock().unwrap())
}

#[derive(Serialize)]
struct Startup {
    /// Só as abas da janela que perguntou, com a ativa dela.
    session: Session,
    /// Texto da aba ativa (as demais carregam sob demanda).
    active_text: String,
    /// Grade de painéis desta janela (a UI a interpreta).
    layout: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct WindowInfo {
    label: String,
    name: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn parse_id(id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(id).map_err(err)
}

/// Janela de aplicação (as de preview, `preview-*`, não recebem abas).
fn is_tab_window(label: &str) -> bool {
    !label.starts_with("preview-") && label != GHOST
}

/// Janela minúscula e transparente que acompanha o ponteiro enquanto uma aba é arrastada.
const GHOST: &str = "ghost";

fn geometry_of(w: &WebviewWindow) -> Option<Geometry> {
    let p = w.outer_position().ok()?;
    let s = w.outer_size().ok()?;
    Some(Geometry { x: p.x, y: p.y, w: s.width, h: s.height })
}

/// Cria uma janela de abas escondida (a UI se mostra quando termina de carregar, sem flash branco).
fn build_window(app: &AppHandle, label: &str, geometry: Option<Geometry>, at: Option<(i32, i32)>) -> Result<(), String> {
    let win = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Fullpad")
        .inner_size(900.0, 620.0)
        .visible(false)
        .build()
        .map_err(err)?;
    if let Some(g) = geometry {
        let _ = win.set_size(PhysicalSize::new(g.w, g.h));
        let _ = win.set_position(PhysicalPosition::new(g.x, g.y));
    } else if let Some((x, y)) = at {
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
    Ok(())
}

/// Grava um arquivo exportado (SVG/PNG do diagrama) no caminho escolhido pelo usuário no diálogo
/// "Salvar". Escrita atômica, como todo arquivo do usuário.
#[tauri::command]
fn export_file(path: PathBuf, bytes: Vec<u8>) -> Result<(), String> {
    fullpad_core::atomic::write_atomic(&path, &bytes).map_err(err)
}

/// Carrega a parte da sessão que é da janela `window`. A principal sempre tem ao menos uma aba.
#[tauri::command]
fn load_startup(state: State<AppState>, window: WebviewWindow) -> Result<Startup, String> {
    let _g = state.session_lock.lock().unwrap();
    let store = &state.store;
    let label = window.label().to_string();
    let mut session = store.load_session().map_err(err)?;
    if label == MAIN_WINDOW && session.window_tabs(MAIN_WINDOW).is_empty() {
        let tab = store.create_note().map_err(err)?;
        session.set_active(MAIN_WINDOW, Some(tab.id));
        session.tabs.push(tab);
        store.save_session(&session).map_err(err)?;
    }
    let view = session.view_for(&label);
    let active_text = match view.active {
        Some(id) => store.read_note(id).map_err(err)?,
        None => String::new(),
    };
    let layout = session.layout_of(&label);
    Ok(Startup { session: view, active_text, layout })
}

#[tauri::command]
fn read_note(state: State<AppState>, id: String) -> Result<String, String> {
    state.store.read_note(parse_id(&id)?).map_err(err)
}

#[tauri::command]
fn save_note(state: State<AppState>, id: String, text: String) -> Result<(), String> {
    state.store.write_note(parse_id(&id)?, &text).map_err(err)
}

/// A janela envia suas abas (na ordem dela) e a ativa. Só atualiza: fechar e mover aba são comandos próprios.
#[tauri::command]
fn save_window(
    state: State<AppState>,
    window: WebviewWindow,
    tabs: Vec<TabState>,
    active: Option<String>,
    layout: Option<serde_json::Value>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let active = active.as_deref().map(parse_id).transpose()?;
    let closed = state.closed.lock().unwrap().clone();
    let _g = state.session_lock.lock().unwrap();
    let mut session = state.store.load_session().map_err(err)?;
    session.apply_window(&label, tabs, active, &closed);
    session.set_layout(&label, layout);
    if !window.is_maximized().unwrap_or(false) {
        if let Some(g) = geometry_of(&window) {
            session.set_geometry(&label, g);
        }
    }
    state.store.save_session(&session).map_err(err)
}

#[tauri::command]
fn new_note(state: State<AppState>) -> Result<TabState, String> {
    state.store.create_note().map_err(err)
}

#[tauri::command]
fn close_note(state: State<AppState>, id: String) -> Result<(), String> {
    let id = parse_id(&id)?;
    state.closed.lock().unwrap().insert(id);
    state.epubs.lock().unwrap().remove(&id);
    state.csvs.lock().unwrap().remove(&id);
    let _g = state.session_lock.lock().unwrap();
    let mut session = state.store.load_session().map_err(err)?;
    match session.tabs.iter().find(|t| t.id == id) {
        Some(tab) => state.store.close_tab(tab).map_err(err)?,
        None => state.store.close_note(id).map_err(err)?,
    }
    session.remove_tab(id);
    session.prune_windows();
    state.store.save_session(&session).map_err(err)
}

/// Abas fechadas recentemente (as mais novas primeiro), para "Reabrir aba fechada".
#[tauri::command]
fn list_closed(state: State<AppState>, limit: Option<usize>) -> Vec<ClosedTab> {
    state.store.list_closed(limit.unwrap_or(15).min(500))
}

/// Reabre uma aba da lixeira na janela que pediu e a torna a ativa.
#[tauri::command]
fn restore_tab(state: State<AppState>, window: WebviewWindow, id: String) -> Result<OpenedFile, String> {
    let id = parse_id(&id)?;
    let _g = state.session_lock.lock().unwrap();
    let (mut tab, text) = state.store.restore_note(id).map_err(err)?;
    state.closed.lock().unwrap().remove(&id);
    let label = window.label().to_string();
    tab.window = label.clone();
    tab.detached = false;
    let mut session = state.store.load_session().map_err(err)?;
    session.tabs.retain(|t| t.id != id);
    session.tabs.push(tab.clone());
    session.set_active(&label, Some(id));
    state.store.save_session(&session).map_err(err)?;
    Ok(OpenedFile { tab, text })
}

// ---- janelas ----------------------------------------------------------------

fn window_name(session: &Session, label: &str) -> String {
    let base = if label == MAIN_WINDOW {
        "Janela principal".to_string()
    } else {
        let n = session.floating_labels().iter().position(|l| l == label).map_or(2, |i| i + 2);
        format!("Janela {n}")
    };
    match session.active_of(label).and_then(|id| session.tabs.iter().find(|t| t.id == id)) {
        Some(t) if !t.title.is_empty() => format!("{base} — {}", t.title),
        _ => base,
    }
}

/// Janelas de abas abertas (para o menu "mover para…").
#[tauri::command]
fn list_windows(app: AppHandle, state: State<AppState>) -> Result<Vec<WindowInfo>, String> {
    let session = {
        let _g = state.session_lock.lock().unwrap();
        state.store.load_session().map_err(err)?
    };
    let spare = state.spare.lock().unwrap().clone();
    let mut labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|l| is_tab_window(l) && spare.as_deref() != Some(l.as_str()))
        .collect();
    labels.sort_by_key(|l| (l != MAIN_WINDOW, l.clone()));
    Ok(labels.into_iter().map(|label| WindowInfo { name: window_name(&session, &label), label }).collect())
}

/// Leva a aba (com o estado mais recente que a janela de origem conhece) para outra janela.
/// `to`: o rótulo de uma janela aberta, ou `"new"` para uma janela nova, na posição `at` (pixels
/// físicos da tela) se houver. Devolve o rótulo de destino.
async fn place_tab(app: &AppHandle, state: &AppState, from: &str, tab: TabState, to: &str, at: Option<(i32, i32)>) -> Result<String, String> {
    // "nova janela": usa a reserva já carregada, se houver (aparece na hora)
    let spare = if to == "new" { state.spare.lock().unwrap().take() } else { None };
    let (label, fresh) = {
        let _g = state.session_lock.lock().unwrap();
        let mut session = state.store.load_session().map_err(err)?;
        let fresh = spare.is_none() && (to == "new" || app.get_webview_window(to).is_none());
        let label = match &spare {
            Some(s) => s.clone(),
            None if fresh => session.fresh_label(),
            None => to.to_string(),
        };
        if label == from {
            return Ok(label);
        }
        session.move_tab(tab.clone(), &label);
        session.prune_windows();
        state.store.save_session(&session).map_err(err)?;
        (label, fresh)
    };
    if fresh {
        // se a janela de origem tem posição, a nova nasce deslocada dela (ou onde o usuário soltou a aba)
        let origin = app.get_webview_window(from).and_then(|w| geometry_of(&w));
        let pos = at.or_else(|| origin.map(|g| (g.x + 48, g.y + 48)));
        build_window(app, &label, None, pos)?;
    } else {
        let mut moved = tab;
        moved.window = label.clone();
        app.emit_to(label.as_str(), "tab-incoming", moved).map_err(err)?;
        if let Some(w) = app.get_webview_window(&label) {
            if spare.is_some() {
                // a reserva ainda está escondida: posiciona; a própria janela se mostra ao receber a aba
                let origin = app.get_webview_window(from).and_then(|w| geometry_of(&w));
                if let Some(g) = origin {
                    let _ = w.set_size(PhysicalSize::new(g.w, g.h));
                }
                if let Some((x, y)) = at.or_else(|| origin.map(|g| (g.x + 48, g.y + 48))) {
                    let _ = w.set_position(PhysicalPosition::new(x, y));
                }
            } else {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
    }
    Ok(label)
}

#[tauri::command]
async fn move_tab(app: AppHandle, state: State<'_, AppState>, window: WebviewWindow, tab: TabState, to: String) -> Result<String, String> {
    place_tab(&app, &state, window.label(), tab, &to, None).await
}

/// Nota nova numa janela nova.
#[tauri::command]
async fn new_window(app: AppHandle, state: State<'_, AppState>, window: WebviewWindow) -> Result<String, String> {
    let tab = state.store.create_note().map_err(err)?;
    place_tab(&app, &state, window.label(), tab, "new", None).await
}

// ---- arrastar uma aba para fora da barra (a janela dela segue o mouse) -------------

/// Faixa do topo de uma janela onde fica a barra de abas (em px lógicos, a partir da borda externa).
/// Janela de abas (que não seja `skip`) sob o ponto (pixels físicos da tela). Havendo janelas
/// sobrepostas, vale a que tem o foco e, depois, as flutuantes (costumam estar sobre a principal).
fn window_at(app: &AppHandle, x: i32, y: i32, skip: &str) -> Option<WebviewWindow> {
    let mut hits: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, w)| {
            if label == skip || !is_tab_window(&label) || !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
                return None;
            }
            let (p, s) = (w.outer_position().ok()?, w.outer_size().ok()?);
            (x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32).then_some(w)
        })
        .collect();
    hits.sort_by_key(|w| (!w.is_focused().unwrap_or(false), w.label() == MAIN_WINDOW));
    hits.into_iter().next()
}

/// Cria, em segundo plano, a janela reserva (se ainda não houver) e a "sombra" do arrasto: quando uma
/// aba é solta fora da barra, a janela já está carregada e aparece na hora.
#[tauri::command]
async fn prewarm(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if app.get_webview_window(GHOST).is_none() {
        let ghost = WebviewWindowBuilder::new(&app, GHOST, WebviewUrl::App("index.html".into()))
            .title("Fullpad")
            .inner_size(220.0, 40.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(err)?;
        let _ = ghost.set_ignore_cursor_events(true); // o mouse atravessa a sombra
    }
    let label = {
        let mut spare = state.spare.lock().unwrap();
        if spare.is_some() {
            return Ok(());
        }
        let label = format!("spare-{}", &Uuid::new_v4().simple().to_string()[..8]);
        *spare = Some(label.clone());
        label
    };
    build_window(&app, &label, None, None)
}

/// Distância do canto externo da janela ao ponto da aba onde o usuário a segurou (px físicos).
fn grab_offset(window: &WebviewWindow, gx: f64, gy: f64) -> (i32, i32) {
    let scale = window.scale_factor().unwrap_or(1.0);
    match (window.outer_position(), window.inner_position()) {
        (Ok(o), Ok(i)) => (i.x - o.x + (gx * scale) as i32, i.y - o.y + (gy * scale) as i32),
        _ => ((gx * scale) as i32, (40.0 * scale + gy * scale) as i32),
    }
}

/// Começou a arrastar uma aba para fora da barra. Normalmente mostra a sombra (a abinha com o nome)
/// no ponteiro; se a aba é a única da janela (`self_drag`), a própria janela é que anda com o mouse.
#[tauri::command]
fn drag_start(app: AppHandle, state: State<AppState>, window: WebviewWindow, title: String, x: i32, y: i32, gx: f64, gy: f64, self_drag: bool) {
    if self_drag {
        *state.self_drag.lock().unwrap() = Some(grab_offset(&window, gx, gy));
        return;
    }
    if let Some(g) = app.get_webview_window(GHOST) {
        let _ = app.emit_to(GHOST, "ghost-title", title);
        let _ = g.set_position(PhysicalPosition::new(x + 14, y + 14));
        let _ = g.show();
    }
}

/// O ponteiro andou: a sombra o acompanha e, se ele está sobre a barra de abas de outra janela, essa
/// barra mostra onde a aba entraria.
#[tauri::command]
fn drag_move(app: AppHandle, state: State<AppState>, window: WebviewWindow, title: String, x: i32, y: i32) {
    let target = window_at(&app, x, y, window.label());
    match *state.self_drag.lock().unwrap() {
        // a janela anda com o mouse; sobre a barra de outra janela ela fica logo abaixo do ponteiro,
        // para não cobrir o espaço que a barra mostra
        Some((ox, oy)) => {
            let below = (24.0 * window.scale_factor().unwrap_or(1.0)) as i32;
            let _ = window.set_position(PhysicalPosition::new(x - ox, if target.is_some() { y + below } else { y - oy }));
        }
        None => {
            if let Some(g) = app.get_webview_window(GHOST) {
                let _ = g.set_position(PhysicalPosition::new(x + 14, y + 14));
            }
        }
    }
    let new_over = target.as_ref().map(|w| w.label().to_string());
    let mut over = state.drag_over.lock().unwrap();
    if *over != new_over {
        *state.drag_accept.lock().unwrap() = false;
        if let Some(old) = over.as_ref() {
            let _ = app.emit_to(old.as_str(), "drag-leave", old.clone());
        }
        *over = new_over;
    }
    if target.is_none() {
        *state.drag_accept.lock().unwrap() = false;
    }
    if let Some(t) = target {
        let scale = t.scale_factor().unwrap_or(1.0);
        if let Ok(i) = t.inner_position() {
            let _ = app.emit_to(t.label(), "drag-over", DragOver { target: t.label().to_string(), cx: (x - i.x) as f64 / scale, cy: (y - i.y) as f64 / scale, title });
        }
    }
}

fn end_drag(app: &AppHandle, state: &AppState) {
    *state.drag_accept.lock().unwrap() = false;
    *state.self_drag.lock().unwrap() = None;
    if let Some(g) = app.get_webview_window(GHOST) {
        let _ = g.hide();
    }
    if let Some(old) = state.drag_over.lock().unwrap().take() {
        let _ = app.emit_to(old.as_str(), "drag-leave", old.clone());
    }
}

/// Cancelou (ou soltou de volta na própria janela): só some com a sombra.
#[tauri::command]
fn drag_cancel(app: AppHandle, state: State<AppState>) {
    end_drag(&app, &state);
}

/// Soltou a aba em (x, y) da tela. Sobre a barra de outra janela, ela entra lá (no lugar que a barra
/// mostrou); em qualquer outro lugar, vira uma janela nova que aparece ali mesmo. `gx`/`gy` é onde,
/// dentro da aba, ela foi segurada (px lógicos): a janela nova nasce com a aba sob o ponteiro.
#[tauri::command]
async fn drop_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    window: WebviewWindow,
    tab: TabState,
    x: i32,
    y: i32,
    gx: f64,
    gy: f64,
) -> Result<String, String> {
    let was_self_drag = state.self_drag.lock().unwrap().is_some();
    let accepted = *state.drag_accept.lock().unwrap();
    end_drag(&app, &state);
    let from = window.label().to_string();
    if accepted {
        if let Some(t) = window_at(&app, x, y, &from) {
            return place_tab(&app, &state, &from, tab, t.label(), None).await;
        }
    }
    if was_self_drag {
        // soltou a janela solta por aí: ela já está onde o usuário a deixou
        let _ = window.set_position(PhysicalPosition::new(x - grab_offset(&window, gx, gy).0, y - grab_offset(&window, gx, gy).1));
        return Ok(from);
    }
    let (ox, oy) = grab_offset(&window, gx, gy);
    place_tab(&app, &state, &from, tab, "new", Some((x - ox, y - oy))).await
}

/// A janela sob o ponteiro avisa se aceita a aba no ponto onde ele está.
#[tauri::command]
fn drag_accept(state: State<AppState>, accept: bool) {
    *state.drag_accept.lock().unwrap() = accept;
}

/// A janela terminou de carregar: mostra.
#[tauri::command]
fn window_ready(window: WebviewWindow) {
    let _ = window.show();
}

// ---- visão renderizada em janela própria --------------------------------------

/// Abre (ou traz à frente) a janela com a visão renderizada da aba. Quem a abriu é o "dono": o texto
/// vem dele, por eventos.
#[tauri::command]
async fn open_preview(app: AppHandle, state: State<'_, AppState>, window: WebviewWindow, tab: String, lang: String) -> Result<(), String> {
    parse_id(&tab)?;
    let label = format!("preview-{tab}");
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return Ok(());
    }
    state.previews.lock().unwrap().insert(label.clone(), PreviewInfo { owner: window.label().to_string(), tab, lang });
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Preview")
        .inner_size(760.0, 600.0)
        .visible(false)
        .build()
        .map_err(err)?;
    if let Some(g) = geometry_of(&window) {
        let _ = win.set_position(PhysicalPosition::new(g.x + 60, g.y + 60));
    }
    Ok(())
}

#[tauri::command]
fn preview_info(state: State<AppState>, window: WebviewWindow) -> Result<PreviewInfo, String> {
    state.previews.lock().unwrap().get(window.label()).cloned().ok_or_else(|| "janela de preview desconhecida".to_string())
}

/// Fecha a janela de preview da aba, se houver (sem avisar o dono: foi ele quem pediu).
#[tauri::command]
fn close_preview(app: AppHandle, state: State<AppState>, tab: String) {
    let label = format!("preview-{tab}");
    state.previews.lock().unwrap().remove(&label);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argumentos_viram_caminhos_absolutos() {
        let args: Vec<String> = ["fullpad.exe", "--flag", "nota.md", "C:\\x\\y.txt"].iter().map(|s| s.to_string()).collect();
        let got = paths_from_args(&args, std::path::Path::new("/pasta"));
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], std::path::Path::new("/pasta").join("nota.md"));
    }
}

#[derive(Serialize)]
struct OpenedFile {
    tab: TabState,
    text: String,
}

/// Abre um arquivo real e devolve a nova aba + texto normalizado.
#[tauri::command]
fn open_file(state: State<AppState>, path: PathBuf) -> Result<OpenedFile, String> {
    let (tab, text) = state.store.open_file(&path).map_err(err)?;
    Ok(OpenedFile { tab, text })
}

// ---- leitor de PDF/EPUB (abas só de leitura) -----------------------------------------

/// Abre um PDF/EPUB como aba de leitura. Não lê o arquivo: a UI mostra o botão "Carregar" e só
/// então pede os bytes. A aba já entra na sessão para o Rust conhecer o caminho dela (é por ela,
/// e não por um caminho vindo da UI, que `reader_read` acha o arquivo).
#[tauri::command]
fn open_reader(state: State<AppState>, window: WebviewWindow, path: PathBuf) -> Result<TabState, String> {
    let mut tab = state.store.open_reader(&path).map_err(err)?;
    tab.window = window.label().to_string();
    let _g = state.session_lock.lock().unwrap();
    let mut session = state.store.load_session().map_err(err)?;
    session.tabs.push(tab.clone());
    state.store.save_session(&session).map_err(err)?;
    Ok(tab)
}

/// Situação do arquivo da aba (existe? tamanho e data), só com metadados.
#[tauri::command]
async fn reader_info(state: State<'_, AppState>, id: String) -> Result<FileStatus, String> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_, path) = store.reader_file(id).map_err(err)?;
        fullpad_core::reader::status(&path).map_err(err)
    })
    .await
    .map_err(err)?
}

/// Verifica o PDF antes de entregá-lo ao pdf.js: bomba de compressão (um trecho minúsculo que
/// expande para gigabytes). Roda no Rust, fora da UI, e só lê o arquivo, sem guardá-lo. O EPUB não
/// precisa: o leitor dele (`Epub`) já limita cada leitura e recusa o que passa do teto.
#[tauri::command]
async fn reader_check(state: State<'_, AppState>, id: String) -> Result<PdfScan, String> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (kind, path) = store.reader_file(id).map_err(err)?;
        match kind {
            TabKind::Pdf => fullpad_core::reader::scan_pdf(&path).map_err(err),
            _ => Ok(PdfScan::Ok),
        }
    })
    .await
    .map_err(err)?
}

/// Abre o EPUB da aba: metadados, ordem de leitura e sumário (não lê os capítulos). O livro
/// aberto fica em memória (só isso, nunca o conteúdo) para os capítulos pedidos em seguida.
#[tauri::command]
async fn epub_open(state: State<'_, AppState>, id: String) -> Result<fullpad_core::epub::EpubInfo, String> {
    let uuid = parse_id(&id)?;
    let store = state.store.clone();
    let book = tauri::async_runtime::spawn_blocking(move || {
        let (kind, path) = store.reader_file(uuid).map_err(err)?;
        if kind != TabKind::Epub {
            return Err("a aba não é um EPUB".to_string());
        }
        fullpad_core::epub::Epub::open(&path).map_err(err)
    })
    .await
    .map_err(err)??;
    let info = book.info().clone();
    state.epubs.lock().unwrap().insert(uuid, book);
    Ok(info)
}

/// O texto puro de um capítulo do EPUB aberto (para a busca no livro).
#[tauri::command]
async fn epub_text(state: State<'_, AppState>, id: String, index: usize) -> Result<String, String> {
    let uuid = parse_id(&id)?;
    let book = state.epubs.lock().unwrap().get(&uuid).cloned().ok_or("o EPUB não está aberto")?;
    tauri::async_runtime::spawn_blocking(move || book.chapter_text(index).map_err(err)).await.map_err(err)?
}

/// Um capítulo do EPUB já aberto, com o HTML limpo (sem scripts, só imagens do próprio livro) e o CSS filtrado.
#[tauri::command]
async fn epub_chapter(state: State<'_, AppState>, id: String, index: usize) -> Result<fullpad_core::epub::Chapter, String> {
    let uuid = parse_id(&id)?;
    let book = state.epubs.lock().unwrap().get(&uuid).cloned().ok_or("o EPUB não está aberto")?;
    tauri::async_runtime::spawn_blocking(move || book.chapter(index).map_err(err)).await.map_err(err)?
}

#[derive(Serialize)]
struct ReaderMemo {
    /// Identidade do conteúdo do arquivo (não do caminho): a chave da posição lembrada.
    key: String,
    /// Posição de leitura lembrada para esse arquivo, se houver.
    pos: Option<serde_json::Value>,
}

/// Identidade do arquivo da aba e a última posição de leitura lembrada para ele. Lê só o começo e
/// o fim do arquivo (128 KB), e só quando o usuário manda carregar.
#[tauri::command]
async fn reader_memo(state: State<'_, AppState>, id: String) -> Result<ReaderMemo, String> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_, path) = store.reader_file(id).map_err(err)?;
        let key = fullpad_core::reader::fingerprint(&path).map_err(err)?;
        let pos = store.reader_position(&key);
        Ok(ReaderMemo { key, pos })
    })
    .await
    .map_err(err)?
}

/// Lembra a posição de leitura do arquivo (pela identidade devolvida por `reader_memo`).
#[tauri::command]
fn reader_remember(state: State<AppState>, key: String, pos: serde_json::Value) -> Result<(), String> {
    let _g = state.positions_lock.lock().unwrap();
    state.store.remember_reader_position(&key, pos).map_err(err)
}

/// Uma faixa de bytes do arquivo da aba, em binário cru (sem JSON). O Rust limita o tamanho.
#[tauri::command]
async fn reader_read(state: State<'_, AppState>, id: String, offset: u64, len: u64) -> Result<tauri::ipc::Response, String> {
    let id = parse_id(&id)?;
    let store = state.store.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let (_, path) = store.reader_file(id).map_err(err)?;
        fullpad_core::reader::read_range(&path, offset, len).map_err(err)
    })
    .await
    .map_err(err)??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// O arquivo sumiu ou foi movido: o usuário escolheu outro caminho para a mesma aba. Tem de ser
/// do mesmo tipo (um PDF continua PDF); a posição de leitura é mantida.
#[tauri::command]
fn reader_relocate(state: State<AppState>, id: String, path: PathBuf) -> Result<TabState, String> {
    let id = parse_id(&id)?;
    let _g = state.session_lock.lock().unwrap();
    let mut session = state.store.load_session().map_err(err)?;
    let tab = session.tabs.iter_mut().find(|t| t.id == id).ok_or("aba não encontrada")?;
    if !matches!(tab.kind, TabKind::Pdf | TabKind::Epub) || TabKind::for_path(&path) != Some(tab.kind) {
        return Err("escolha um arquivo do mesmo tipo".into());
    }
    if fullpad_core::reader::status(&path).map_err(err)? == FileStatus::Missing {
        return Err(format!("arquivo não encontrado: {}", path.display()));
    }
    tab.title = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    tab.path = Some(path);
    let updated = tab.clone();
    state.store.save_session(&session).map_err(err)?;
    Ok(updated)
}

#[tauri::command]
fn save_file(
    state: State<AppState>,
    id: String,
    path: PathBuf,
    text: String,
    encoding: Encoding,
    eol: Eol,
) -> Result<(), String> {
    state
        .store
        .save_file(parse_id(&id)?, &path, &text, encoding, eol)
        .map_err(err)
}

/// Resultado de `json_analyze`: ou a árvore ou o erro (a UI mantém a última árvore boa no erro).
#[derive(Serialize)]
struct JsonAnalysis {
    doc: Option<Doc>,
    error: Option<JsonError>,
}

/// Analisa o JSON (posições, valores, dicas) fora da thread da janela.
#[tauri::command]
async fn json_analyze(text: String, lenient: bool) -> Result<JsonAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || match json::analyze(&text, lenient) {
        Ok(doc) => JsonAnalysis { doc: Some(doc), error: None },
        Err(error) => JsonAnalysis { doc: None, error: Some(error) },
    })
    .await
    .map_err(err)
}

/// Separador de um CSV pela estrutura do texto (`ext`: extensão do arquivo, `tsv` manda no tab).
/// Devolve o caractere como texto.
#[tauri::command]
async fn csv_detect(text: String, ext: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || fullpad_core::csv::detect(&text, ext.as_deref()).to_string())
        .await
        .map_err(err)
}

/// Um CSV indexado e a ordem em que a tabela o mostra (índices de linha do arquivo). Os dois são
/// compartilhados: um comando longo trabalha numa cópia barata sem segurar o cadeado.
#[derive(Clone)]
struct CsvEntry {
    csv: std::sync::Arc<fullpad_core::csv::Csv>,
    view: std::sync::Arc<Vec<u32>>,
}

#[derive(Serialize)]
struct CsvInfo {
    /// Linhas na visão (depois do filtro).
    rows: usize,
    /// Linhas de dados do arquivo (sem o cabeçalho), antes do filtro.
    total: usize,
    cols: usize,
    delimiter: String,
    unterminated: bool,
    types: Vec<fullpad_core::csv::ColType>,
    /// A primeira linha, quando é o cabeçalho.
    header: Option<fullpad_core::csv::RowOut>,
}

fn csv_char(s: &str) -> char {
    s.chars().next().unwrap_or(',')
}

fn csv_info(csv: &fullpad_core::csv::Csv, view: &[u32], header: bool, decimal: char) -> CsvInfo {
    CsvInfo {
        rows: view.len(),
        total: csv.row_count().saturating_sub(header as usize),
        cols: csv.cols(),
        delimiter: csv.delimiter().to_string(),
        unterminated: csv.unterminated(),
        types: csv.column_types(header, decimal),
        header: if header { csv.rows(0, 1).into_iter().next() } else { None },
    }
}

fn csv_entry(state: &AppState, tab: &str) -> Result<CsvEntry, String> {
    state.csvs.lock().unwrap().get(&parse_id(tab)?).cloned().ok_or_else(|| "o CSV não está carregado".to_string())
}

/// Indexa o texto do CSV da aba (fora da thread da janela) e monta a visão. Devolve o resumo.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn csv_load(
    state: State<'_, AppState>,
    tab: String,
    text: String,
    delimiter: String,
    header: bool,
    decimal: String,
    sort: Option<fullpad_core::csv::Sort>,
    filter: Option<fullpad_core::csv::Filter>,
) -> Result<CsvInfo, String> {
    let id = parse_id(&tab)?;
    let (entry, info) = tauri::async_runtime::spawn_blocking(move || {
        let csv = fullpad_core::csv::Csv::parse(text, csv_char(&delimiter));
        let dec = csv_char(&decimal);
        let view = csv.view(header, dec, sort, filter.as_ref());
        let info = csv_info(&csv, &view, header, dec);
        (CsvEntry { csv: std::sync::Arc::new(csv), view: std::sync::Arc::new(view) }, info)
    })
    .await
    .map_err(err)?;
    state.csvs.lock().unwrap().insert(id, entry);
    Ok(info)
}

/// Refaz a visão (ordem, filtro, cabeçalho, decimal) do CSV já carregado, sem reenviar o texto.
#[tauri::command]
async fn csv_view(
    state: State<'_, AppState>,
    tab: String,
    header: bool,
    decimal: String,
    sort: Option<fullpad_core::csv::Sort>,
    filter: Option<fullpad_core::csv::Filter>,
) -> Result<CsvInfo, String> {
    let id = parse_id(&tab)?;
    let entry = csv_entry(&state, &tab)?;
    let (view, info) = tauri::async_runtime::spawn_blocking(move || {
        let dec = csv_char(&decimal);
        let view = entry.csv.view(header, dec, sort, filter.as_ref());
        let info = csv_info(&entry.csv, &view, header, dec);
        (view, info)
    })
    .await
    .map_err(err)?;
    if let Some(e) = state.csvs.lock().unwrap().get_mut(&id) {
        e.view = std::sync::Arc::new(view);
    }
    Ok(info)
}

/// Linhas `[from, from + count)` da visão (no máximo 500 por chamada). `index` é a linha do arquivo.
#[tauri::command]
async fn csv_rows(state: State<'_, AppState>, tab: String, from: usize, count: usize) -> Result<Vec<fullpad_core::csv::RowOut>, String> {
    let e = csv_entry(&state, &tab)?;
    tauri::async_runtime::spawn_blocking(move || {
        let end = from.saturating_add(count.min(500)).min(e.view.len());
        e.csv.rows_at(&e.view[from.min(end)..end])
    })
    .await
    .map_err(err)
}

/// Estatísticas das linhas `[from, to)` da visão (posições na tela) nas colunas `[col_from, col_to)`.
#[tauri::command]
async fn csv_stats(
    state: State<'_, AppState>,
    tab: String,
    from: usize,
    to: usize,
    col_from: usize,
    col_to: usize,
    decimal: String,
) -> Result<fullpad_core::csv::Stats, String> {
    let e = csv_entry(&state, &tab)?;
    tauri::async_runtime::spawn_blocking(move || {
        let end = to.min(e.view.len());
        let rows = e.view[from.min(end)..end].iter().map(|&i| i as usize);
        e.csv.stats(rows, col_from..col_to, csv_char(&decimal))
    })
    .await
    .map_err(err)
}

#[derive(Serialize)]
struct CsvLocated {
    /// Linha e coluna no arquivo.
    row: usize,
    col: usize,
    /// Posição da linha na visão atual (`None` se ela está filtrada ou é o cabeçalho).
    view: Option<usize>,
}

/// A célula sob uma posição do código (UTF-16) e onde ela está na tabela.
#[tauri::command]
fn csv_locate(state: State<AppState>, tab: String, pos: usize) -> Result<Option<CsvLocated>, String> {
    let e = csv_entry(&state, &tab)?;
    Ok(e.csv.cell_at(pos).map(|p| CsvLocated { row: p.row, col: p.col, view: e.view.iter().position(|&r| r as usize == p.row) }))
}

#[derive(Deserialize)]
struct CsvCellValue {
    /// Linha do arquivo (`RowOut.index`), não a posição na tabela.
    row: usize,
    col: usize,
    value: String,
}

/// O que trocar no texto para gravar estes valores (até 20 mil células), em coordenadas UTF-16 do
/// texto que foi indexado. A UI aplica tudo numa só transação do editor, se o texto ainda for esse.
#[tauri::command]
async fn csv_edit(state: State<'_, AppState>, tab: String, edits: Vec<CsvCellValue>) -> Result<Vec<fullpad_core::csv::CellEdit>, String> {
    if edits.len() > 20_000 {
        return Err("células demais de uma vez".to_string());
    }
    let e = csv_entry(&state, &tab)?;
    tauri::async_runtime::spawn_blocking(move || {
        let list: Vec<(usize, usize, &str)> = edits.iter().map(|x| (x.row, x.col, x.value.as_str())).collect();
        e.csv.edit_cells(&list)
    })
    .await
    .map_err(err)
}

/// Mudança de estrutura da tabela (linhas e colunas inteiras). As posições de linha são **da visão**
/// (as da tela); as de coluna são do arquivo.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum CsvOp {
    /// Linhas vazias antes (`after: false`) ou depois da linha na posição `pos`; sem `pos`, no fim.
    InsertRows { pos: Option<usize>, after: bool, count: usize },
    /// Apaga as linhas das posições `from..=to`.
    DeleteRows { from: usize, to: usize },
    InsertCol { at: usize },
    DeleteCols { cols: Vec<usize> },
    MoveCol { from: usize, to: usize },
    /// Ordena de verdade o texto do arquivo (ação explícita).
    SortFile { col: usize, desc: bool, header: bool, decimal: String },
}

/// O que trocar no texto para a mudança de estrutura, em coordenadas UTF-16 do texto indexado. A UI
/// aplica tudo numa transação só, como em `csv_edit`.
#[tauri::command]
async fn csv_structure(state: State<'_, AppState>, tab: String, op: CsvOp) -> Result<Vec<fullpad_core::csv::CellEdit>, String> {
    let e = csv_entry(&state, &tab)?;
    tauri::async_runtime::spawn_blocking(move || {
        let csv = &e.csv;
        match op {
            CsvOp::InsertRows { pos, after, count } => {
                let before = match pos.and_then(|p| e.view.get(p)) {
                    Some(&ri) => ri as usize + after as usize,
                    None => csv.row_count(),
                };
                csv.insert_rows(before, count)
            }
            CsvOp::DeleteRows { from, to } => {
                let end = to.saturating_add(1).min(e.view.len());
                let rows: Vec<usize> = e.view[from.min(end)..end].iter().map(|&r| r as usize).collect();
                csv.delete_rows(&rows)
            }
            CsvOp::InsertCol { at } => csv.insert_col(at),
            CsvOp::DeleteCols { cols } => csv.delete_cols(&cols),
            CsvOp::MoveCol { from, to } => csv.move_col(from, to),
            CsvOp::SortFile { col, desc, header, decimal } => {
                csv.sort_file(header, decimal.chars().next().unwrap_or('.'), fullpad_core::csv::Sort { col, desc })
            }
        }
    })
    .await
    .map_err(err)
}

/// Uma célula do arquivo (valor inteiro e trecho no texto), para levar o cursor do código até ela.
#[tauri::command]
fn csv_cell(state: State<AppState>, tab: String, row: usize, col: usize) -> Result<Option<fullpad_core::csv::Cell>, String> {
    Ok(csv_entry(&state, &tab)?.csv.cell(row, col))
}

/// Resultado da busca global numa aba.
#[derive(serde::Serialize)]
struct TabHits {
    id: String,
    hits: fullpad_core::search::Hits,
}

/// Busca global: procura `query` no texto das abas pedidas (lidas de `notes/`; a UI grava as
/// pendências antes). `Err` leva a mensagem de expressão inválida. `replace` pede, junto, o texto
/// que entraria no lugar de cada resultado. Abas sem resultado não voltam.
#[tauri::command]
async fn search_tabs(
    state: State<'_, AppState>,
    ids: Vec<String>,
    query: String,
    options: fullpad_core::search::Options,
    replace: Option<String>,
) -> Result<Vec<TabHits>, String> {
    let ids = ids.iter().map(|i| parse_id(i)).collect::<Result<Vec<_>, _>>()?;
    // valida a consulta uma vez, antes de ler qualquer nota
    fullpad_core::search::compile(&query, &options)?;
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for id in ids {
            let Ok(text) = store.read_note(id) else { continue };
            let hits = fullpad_core::search::find(&text, &query, &options, replace.as_deref())?;
            if hits.total > 0 {
                out.push(TabHits { id: id.to_string(), hits });
            }
        }
        Ok::<_, String>(out)
    })
    .await
    .map_err(err)?
}

/// Só valida (para sublinhar o erro com qualquer visão aberta): não monta nada para a UI.
#[tauri::command]
async fn json_check(text: String) -> Result<Option<JsonError>, String> {
    tauri::async_runtime::spawn_blocking(move || json::validate(&text, true).err()).await.map_err(err)
}

/// Formata (`indent`: "2", "4", "tab" ou "min" para minificar). Erro: o `JsonError` da posição.
#[tauri::command]
async fn json_format(text: String, indent: String, sort_keys: bool) -> Result<Result<String, JsonError>, String> {
    tauri::async_runtime::spawn_blocking(move || json::format(&text, Indent::parse(&indent), sort_keys))
        .await
        .map_err(err)
}

/// Bytes de uma imagem local citada num JSON, para a miniatura. Só extensões de imagem e com limite
/// de tamanho; `base` é a pasta do arquivo da aba (para caminhos relativos).
#[tauri::command]
fn json_preview_image(value: String, base: Option<PathBuf>) -> Result<tauri::ipc::Response, String> {
    let path = json::resolve_image_path(&value, base.as_deref()).map_err(err)?;
    let (bytes, _mime) = json::read_image(&path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Abre um link no navegador do sistema. Só `http`, `https` e `mailto`: um JSON não pode mandar
/// o app abrir arquivo nem executar nada.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let lower = url.to_ascii_lowercase();
    let ok = ["http://", "https://", "mailto:"].iter().any(|p| lower.starts_with(p)) && !url.chars().any(|c| c.is_control() || c.is_whitespace());
    if !ok {
        return Err("só links http, https e mailto podem ser abertos".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}

fn main() {
    let store = Store::open_default().expect("diretório de dados indisponível");

    tauri::Builder::default()
        // Segunda execução reaproveita a janela já aberta.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = paths_from_args(&args, std::path::Path::new(&cwd));
            if !paths.is_empty() {
                app.state::<AppState>().open_paths.lock().unwrap().extend(paths);
                // só um aviso: a janela principal retira a lista com `take_open_paths`
                let _ = app.emit_to("main", "open-paths", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState { store, spare: Mutex::new(None), drag_over: Mutex::new(None), drag_accept: Mutex::new(false),
        self_drag: Mutex::new(None), previews: Mutex::new(Default::default()), session_lock: Mutex::new(()), positions_lock: Mutex::new(()), epubs: Mutex::new(Default::default()), csvs: Mutex::new(Default::default()), closed: Mutex::new(HashSet::new()),
        open_paths: Mutex::new(std::env::current_dir().map(|cwd| paths_from_args(&std::env::args().collect::<Vec<_>>(), &cwd)).unwrap_or_default()),
        update: Mutex::new(None), update_bytes: Mutex::new(None), just_updated: Mutex::new(false) })
        .setup(|app| {
            // reabre as janelas flutuantes da sessão anterior, no mesmo lugar
            let state = app.state::<AppState>();
            // antes de qualquer janela ler a sessão: numa instalação nova ela ainda não existe
            let version = app.package_info().version.to_string();
            match state.store.note_running_version(&version) {
                Ok(updated) => *state.just_updated.lock().unwrap() = updated,
                Err(e) => eprintln!("versão em execução não gravada: {e}"),
            }
            let session = state.store.load_session().map_err(|e| e.to_string())?;
            for label in session.floating_labels() {
                build_window(app.handle(), &label, session.geometry_of(&label), None)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_startup,
            read_note,
            save_note,
            save_window,
            new_note,
            close_note,
            list_closed,
            drag_accept,
            restore_tab,
            open_file,
            open_reader,
            reader_info,
            reader_check,
            epub_open,
            epub_chapter,
            epub_text,
            reader_memo,
            reader_remember,
            reader_read,
            reader_relocate,
            save_file,
            export_file,
            list_windows,
            move_tab,
            new_window,
            prewarm,
            drag_start,
            drag_move,
            drag_cancel,
            drop_tab,
            window_ready,
            open_preview,
            preview_info,
            close_preview,
            exit_app,
            take_open_paths,
            check_update,
            download_update,
            install_update,
            release_notes,
            startup_release_notes,
            json_analyze,
            json_check,
            search_tabs,
            csv_detect,
            csv_load,
            csv_view,
            csv_rows,
            csv_stats,
            csv_locate,
            csv_cell,
            csv_edit,
            csv_structure,
            json_format,
            json_preview_image,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o Fullpad");
}
