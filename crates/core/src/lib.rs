//! Núcleo do Fullpad: notas, sessão e persistência. Sem dependência de UI.

pub mod atomic;
pub mod error;
pub mod fileio;
pub mod model;
pub mod store;

pub use error::{Error, Result};
pub use model::{Encoding, Eol, Language, Session, TabState, ViewMode};
pub use store::Store;
