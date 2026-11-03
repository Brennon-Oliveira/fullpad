//! Núcleo do Fullpad: notas, sessão e persistência. Sem dependência de UI.

pub mod atomic;
pub mod css;
pub mod csv;
pub mod epub;
pub mod error;
pub mod fileio;
pub mod json;
pub mod model;
pub mod reader;
pub mod search;
pub mod structured;
pub mod toml;
pub mod yaml;
pub mod store;
pub mod windows;

pub use error::{Error, Result};
pub use model::{ClosedTab, Encoding, Eol, Geometry, Language, Session, TabKind, TabState, ViewMode, WindowState, MAIN_WINDOW};
pub use store::Store;
