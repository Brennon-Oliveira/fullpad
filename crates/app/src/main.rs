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

#[derive(Clone, Serialize)]
struct DragOver {
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
fn strip_band(label: &str) -> f64 {
    if label == MAIN_WINDOW { 110.0 } else { 80.0 }
}

/// Janela de abas (que não seja `skip`) cuja barra de abas está sob o ponto (pixels físicos da tela).
fn strip_window_at(app: &AppHandle, x: i32, y: i32, skip: &str) -> Option<WebviewWindow> {
    app.webview_windows().into_iter().find_map(|(label, w)| {
        if label == skip || !is_tab_window(&label) || !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
            return None;
        }
        let (p, s) = (w.outer_position().ok()?, w.outer_size().ok()?);
        let band = (strip_band(&label) * w.scale_factor().unwrap_or(1.0)) as i32;
        (x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + band).then_some(w)
    })
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

/// Começou a arrastar uma aba para fora da barra: mostra a sombra (a abinha com o nome) no ponteiro.
#[tauri::command]
fn drag_start(app: AppHandle, title: String, x: i32, y: i32) {
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
    if let Some(g) = app.get_webview_window(GHOST) {
        let _ = g.set_position(PhysicalPosition::new(x + 14, y + 14));
    }
    let target = strip_window_at(&app, x, y, window.label());
    let new_over = target.as_ref().map(|w| w.label().to_string());
    let mut over = state.drag_over.lock().unwrap();
    if *over != new_over {
        if let Some(old) = over.as_ref() {
            let _ = app.emit_to(old.as_str(), "drag-leave", ());
        }
        *over = new_over;
    }
    if let Some(t) = target {
        let scale = t.scale_factor().unwrap_or(1.0);
        if let Ok(i) = t.inner_position() {
            let _ = app.emit_to(t.label(), "drag-over", DragOver { cx: (x - i.x) as f64 / scale, cy: (y - i.y) as f64 / scale, title });
        }
    }
}

fn end_drag(app: &AppHandle, state: &AppState) {
    if let Some(g) = app.get_webview_window(GHOST) {
        let _ = g.hide();
    }
    if let Some(old) = state.drag_over.lock().unwrap().take() {
        let _ = app.emit_to(old.as_str(), "drag-leave", ());
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
    end_drag(&app, &state);
    let from = window.label().to_string();
    if let Some(t) = strip_window_at(&app, x, y, &from) {
        return place_tab(&app, &state, &from, tab, t.label(), None).await;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    let (ox, oy) = match (window.outer_position(), window.inner_position()) {
        (Ok(o), Ok(i)) => (i.x - o.x + (gx * scale) as i32, i.y - o.y + (gy * scale) as i32),
        _ => ((gx * scale) as i32, (40.0 * scale + gy * scale) as i32),
    };
    place_tab(&app, &state, &from, tab, "new", Some((x - ox, y - oy))).await
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
        .manage(AppState { store, spare: Mutex::new(None), drag_over: Mutex::new(None), previews: Mutex::new(Default::default()), session_lock: Mutex::new(()), closed: Mutex::new(HashSet::new()) })
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
            exit_app
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o Fullpad");
}
