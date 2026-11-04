//! O arquivo real de uma aba de texto: perceber que ele mudou **fora** do Fullpad.
//!
//! Ao abrir ou salvar, a aba guarda um carimbo do arquivo (`DiskStamp`: data, tamanho e hash do
//! conteúdo). Depois, `check` compara o arquivo de agora com esse carimbo: data e tamanho iguais
//! valem como "não mudou" (barato, sem ler o arquivo); se diferem, o hash decide (um `touch` ou um
//! programa que regravou o mesmo conteúdo não é mudança). É o que impede o Fullpad de sobrescrever,
//! ao salvar, o que outro programa gravou no meio.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiskStamp {
    /// Data de modificação, em milissegundos desde 1970.
    pub mtime: u64,
    pub size: u64,
    /// FNV-1a 64 bits do conteúdo (identidade do conteúdo, não segurança).
    pub hash: u64,
}

/// Como o arquivo está em relação ao carimbo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiskState {
    Unchanged,
    /// O conteúdo é outro: alguém gravou no arquivo depois do carimbo.
    Changed,
    /// O arquivo não existe mais (apagado, renomeado ou movido).
    Missing,
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

fn missing(e: &std::io::Error) -> bool {
    matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory)
}

/// O carimbo dos `bytes` que acabaram de ser lidos de `path` (a data vem do disco agora).
pub fn stamp_of(path: &Path, bytes: &[u8]) -> DiskStamp {
    let mtime = std::fs::metadata(path).map(|m| mtime_ms(&m)).unwrap_or(0);
    DiskStamp { mtime, size: bytes.len() as u64, hash: fnv1a(bytes) }
}

/// O carimbo do arquivo de agora, ou `None` se ele não existe. Lê o arquivo inteiro.
pub fn stamp(path: &Path) -> Result<Option<DiskStamp>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(stamp_of(path, &bytes))),
        Err(e) if missing(&e) => Ok(None),
        Err(source) => Err(Error::Io { path: path.to_path_buf(), source }),
    }
}

/// Compara o arquivo com o carimbo `known`. Devolve também o carimbo novo quando só a data mudou
/// (mesmo conteúdo), para quem chamou guardá-lo e não reler o arquivo da próxima vez.
pub fn check(path: &Path, known: &DiskStamp) -> Result<(DiskState, Option<DiskStamp>)> {
    let meta = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        Ok(_) => return Ok((DiskState::Missing, None)),
        Err(e) if missing(&e) => return Ok((DiskState::Missing, None)),
        Err(source) => return Err(Error::Io { path: path.to_path_buf(), source }),
    };
    if mtime_ms(&meta) == known.mtime && meta.len() == known.size {
        return Ok((DiskState::Unchanged, None));
    }
    match stamp(path)? {
        None => Ok((DiskState::Missing, None)),
        Some(now) if now.hash == known.hash => Ok((DiskState::Unchanged, Some(now))),
        Some(now) => Ok((DiskState::Changed, Some(now))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(content: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("a.md");
        std::fs::write(&p, content).unwrap();
        (d, p)
    }

    #[test]
    fn unchanged_file_is_unchanged() {
        let (_d, p) = file(b"um");
        let s = stamp(&p).unwrap().unwrap();
        assert_eq!(check(&p, &s).unwrap(), (DiskState::Unchanged, None));
    }

    #[test]
    fn different_content_is_changed_even_with_the_same_size() {
        let (_d, p) = file(b"um");
        let s = stamp(&p).unwrap().unwrap();
        std::fs::write(&p, b"du").unwrap();
        // força a data a mudar também (o teste roda mais rápido que a resolução do relógio do disco)
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options().write(true).open(&p).unwrap().set_modified(later).unwrap();
        let (state, now) = check(&p, &s).unwrap();
        assert_eq!(state, DiskState::Changed);
        assert_eq!(now.unwrap().hash, stamp(&p).unwrap().unwrap().hash);
    }

    #[test]
    fn touching_without_changing_the_content_is_not_a_change() {
        let (_d, p) = file(b"igual");
        let s = stamp(&p).unwrap().unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options().write(true).open(&p).unwrap().set_modified(later).unwrap();
        let (state, now) = check(&p, &s).unwrap();
        assert_eq!(state, DiskState::Unchanged);
        assert_ne!(now.unwrap().mtime, s.mtime, "devolve o carimbo novo para não reler da próxima vez");
    }

    #[test]
    fn missing_file_and_folder_are_missing() {
        let (d, p) = file(b"x");
        let s = stamp(&p).unwrap().unwrap();
        std::fs::remove_file(&p).unwrap();
        assert_eq!(check(&p, &s).unwrap().0, DiskState::Missing);
        assert_eq!(stamp(&p).unwrap(), None);
        assert_eq!(check(d.path(), &s).unwrap().0, DiskState::Missing, "pasta não é arquivo");
    }
}
