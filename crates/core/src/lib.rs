//! Núcleo do Fullpad: notas, sessão e persistência. Sem dependência de UI.

pub mod atomic;
pub mod error;
pub mod fileio;
pub mod json;
pub mod model;
pub mod reader;
pub mod store;
pub mod windows;

pub use error::{Error, Result};
pub use model::{ClosedTab, Encoding, Eol, Geometry, Language, Session, TabKind, TabState, ViewMode, WindowState, MAIN_WINDOW};
pub use store::Store;
