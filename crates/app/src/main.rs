#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use fullpad_core::{Encoding, Eol, Session, Store, TabState};
use std::path::PathBuf;
use serde::Serialize;
use tauri::{Manager, State};
use uuid::Uuid;

struct AppState {
    store: Store,
}

#[derive(Serialize)]
struct Startup {
    session: Session,
    /// Texto da aba ativa (as demais carregam sob demanda).
    active_text: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn parse_id(id: &str) -> Result<Uuid, String> {
    Uuid::parse_str(id).map_err(err)
}

/// Carrega a sessão; garante que exista ao menos uma aba.
#[tauri::command]
fn load_startup(state: State<AppState>) -> Result<Startup, String> {
    let store = &state.store;
    let mut session = store.load_session().map_err(err)?;
    if session.tabs.is_empty() {
        let tab = store.create_note().map_err(err)?;
        session.active = Some(tab.id);
        session.tabs.push(tab);
        store.save_session(&session).map_err(err)?;
    }
    let active_text = match session.active {
        Some(id) => store.read_note(id).map_err(err)?,
        None => String::new(),
    };
    Ok(Startup { session, active_text })
}

#[tauri::command]
fn read_note(state: State<AppState>, id: String) -> Result<String, String> {
    state.store.read_note(parse_id(&id)?).map_err(err)
}

#[tauri::command]
fn save_note(state: State<AppState>, id: String, text: String) -> Result<(), String> {
    state.store.write_note(parse_id(&id)?, &text).map_err(err)
}

#[tauri::command]
fn save_session(state: State<AppState>, session: Session) -> Result<(), String> {
    state.store.save_session(&session).map_err(err)
}

#[tauri::command]
fn new_note(state: State<AppState>) -> Result<TabState, String> {
    state.store.create_note().map_err(err)
}

#[tauri::command]
fn close_note(state: State<AppState>, id: String) -> Result<(), String> {
    state.store.close_note(parse_id(&id)?).map_err(err)
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
        .manage(AppState { store })
        .invoke_handler(tauri::generate_handler![
            load_startup,
            read_note,
            save_note,
            save_session,
            new_note,
            close_note,
            open_file,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o Fullpad");
}
