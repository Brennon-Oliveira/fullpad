//! Núcleo do Fullpad: notas, sessão e persistência. Sem dependência de UI.

pub mod atomic;
pub mod error;
pub mod fileio;
pub mod model;
pub mod store;
pub mod windows;

pub use error::{Error, Result};
pub use model::{Encoding, Eol, Geometry, Language, Session, TabState, ViewMode, WindowState, MAIN_WINDOW};
pub use store::Store;
