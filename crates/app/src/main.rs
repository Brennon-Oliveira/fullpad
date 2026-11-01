#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fullpad_core::{Encoding, Eol, Geometry, Session, Store, TabState, MAIN_WINDOW};
use serde::Serialize;
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

struct AppState {
    store: Store,
    previews: Mutex<std::collections::HashMap<String, PreviewInfo>>,
    /// Serializa ler-alterar-gravar do `session.json`: várias janelas gravam ao mesmo tempo.
    session_lock: Mutex<()>,
    /// Abas fechadas nesta execução: uma gravação atrasada de uma janela não pode ressuscitá-las.
    closed: Mutex<HashSet<Uuid>>,
}

#[derive(Serialize)]
struct Startup {
    /// Só as abas da janela que perguntou, com a ativa dela.
    session: Session,
    /// Texto da aba ativa (as demais carregam sob demanda).
    active_text: String,
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
    !label.starts_with("preview-")
}

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

/// Janela de abas (que não seja `skip`) sob o ponto da tela, em pixels físicos.
fn window_at(app: &AppHandle, x: i32, y: i32, skip: &str) -> Option<String> {
    app.webview_windows().into_iter().find_map(|(label, w)| {
        if label == skip || !is_tab_window(&label) || !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
            return None;
        }
        let (p, s) = (w.outer_position().ok()?, w.outer_size().ok()?);
        let inside = x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32;
        inside.then_some(label)
    })
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
    Ok(Startup { session: view, active_text })
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
fn save_window(state: State<AppState>, window: WebviewWindow, tabs: Vec<TabState>, active: Option<String>) -> Result<(), String> {
    let label = window.label().to_string();
    let active = active.as_deref().map(parse_id).transpose()?;
    let closed = state.closed.lock().unwrap().clone();
    let _g = state.session_lock.lock().unwrap();
    let mut session = state.store.load_session().map_err(err)?;
    session.apply_window(&label, tabs, active, &closed);
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
    let _g = state.session_lock.lock().unwrap();
    state.store.close_note(id).map_err(err)?;
    let mut session = state.store.load_session().map_err(err)?;
    session.remove_tab(id);
    session.prune_windows();
    state.store.save_session(&session).map_err(err)
}

// ---- janelas ----------------------------------------------------------------

fn window_name(session: &Session, label: &str) -> String {
    let base = if label == MAIN_WINDOW {
        "Janela principal".to_string()
    } else {
        format!("Janela {}", label.trim_start_matches("win-"))
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
    let mut labels: Vec<String> = app.webview_windows().into_keys().filter(|l| is_tab_window(l)).collect();
    labels.sort_by_key(|l| (l != MAIN_WINDOW, l.clone()));
    Ok(labels.into_iter().map(|label| WindowInfo { name: window_name(&session, &label), label }).collect())
}

/// Leva a aba (com o estado mais recente que a janela de origem conhece) para outra janela.
/// `to`: o rótulo de uma janela aberta, ou `"new"` para uma janela nova, na posição `at` (pixels
/// físicos da tela) se houver. Devolve o rótulo de destino.
async fn place_tab(app: &AppHandle, state: &AppState, from: &str, tab: TabState, to: &str, at: Option<(i32, i32)>) -> Result<String, String> {
    let (label, fresh) = {
        let _g = state.session_lock.lock().unwrap();
        let mut session = state.store.load_session().map_err(err)?;
        let fresh = to == "new" || app.get_webview_window(to).is_none();
        let label = if fresh { session.fresh_label() } else { to.to_string() };
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
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
    Ok(label)
}

#[tauri::command]
async fn move_tab(app: AppHandle, state: State<'_, AppState>, window: WebviewWindow, tab: TabState, to: String) -> Result<String, String> {
    place_tab(&app, &state, window.label(), tab, &to, None).await
}

/// A aba foi solta fora da barra de abas, no ponto (x, y) da tela: se há outra janela ali, ela recebe
/// a aba; senão nasce uma janela nova naquele ponto.
#[tauri::command]
async fn drop_tab(app: AppHandle, state: State<'_, AppState>, window: WebviewWindow, tab: TabState, x: i32, y: i32) -> Result<String, String> {
    let from = window.label().to_string();
    match window_at(&app, x, y, &from) {
        Some(target) => place_tab(&app, &state, &from, tab, &target, None).await,
        None => place_tab(&app, &state, &from, tab, "new", Some((x - 120, y - 20))).await,
    }
}

/// Nota nova numa janela nova.
#[tauri::command]
async fn new_window(app: AppHandle, state: State<'_, AppState>, window: WebviewWindow) -> Result<String, String> {
    let tab = state.store.create_note().map_err(err)?;
    place_tab(&app, &state, window.label(), tab, "new", None).await
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

fn main() {
    let store = Store::open_default().expect("diretório de dados indisponível");

    tauri::Builder::default()
        // Segunda execução reaproveita a janela já aberta.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { store, previews: Mutex::new(Default::default()), session_lock: Mutex::new(()), closed: Mutex::new(HashSet::new()) })
        .setup(|app| {
            // reabre as janelas flutuantes da sessão anterior, no mesmo lugar
            let state = app.state::<AppState>();
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
            open_file,
            save_file,
            export_file,
            list_windows,
            move_tab,
            drop_tab,
            new_window,
            open_preview,
            preview_info,
            close_preview,
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o Fullpad");
}
