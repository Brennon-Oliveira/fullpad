//! Arquivos binários das abas só de leitura (PDF; EPUB depois).
//!
//! O app nunca grava nesses arquivos e não os lê ao abrir a aba: a UI pede os bytes por faixas,
//! só depois de o usuário clicar em "Carregar". Aqui fica o que o Rust decide: se o arquivo existe
//! e mudou, e quanto pode ser lido de uma vez.

use crate::error::{Error, IoContext, Result};
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Maior faixa devolvida por chamada. Uma UI que peça mais recebe isto: o IPC não deve carregar
/// um PDF inteiro de uma vez, e um pedido absurdo não pode alocar memória à vontade.
pub const MAX_READ: u64 = 16 * 1024 * 1024;

/// Situação do arquivo de uma aba de leitura.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum FileStatus {
    /// Existe. `mtime` em milissegundos desde 1970: a UI compara para avisar de mudança no disco.
    Ok { size: u64, mtime: u64 },
    /// Não existe mais (apagado, movido, pasta ou unidade ausente) ou deixou de ser um arquivo.
    Missing,
}

/// Só metadados: não abre nem lê o conteúdo.
pub fn status(path: &Path) -> Result<FileStatus> {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() => {
            let mtime = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis() as u64);
            Ok(FileStatus::Ok { size: m.len(), mtime })
        }
        Ok(_) => Ok(FileStatus::Missing),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => Ok(FileStatus::Missing),
        Err(source) => Err(Error::Io { path: path.to_path_buf(), source }),
    }
}

/// Lê até `len` bytes a partir de `offset` (no máximo `MAX_READ`). Depois do fim do arquivo,
/// devolve vazio; perto do fim, devolve só o que existe.
pub fn read_range(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>> {
    let mut f = std::fs::File::open(path).at(path)?;
    let size = f.metadata().at(path)?.len();
    if offset >= size {
        return Ok(Vec::new());
    }
    let want = len.min(MAX_READ).min(size - offset);
    f.seek(SeekFrom::Start(offset)).at(path)?;
    let mut buf = Vec::with_capacity(want as usize);
    f.take(want).read_to_end(&mut buf).at(path)?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(bytes: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.pdf");
        std::fs::write(&p, bytes).unwrap();
        (dir, p)
    }

    #[test]
    fn status_reports_size_and_missing() {
        let (d, p) = file(b"%PDF-1.7 abc");
        match status(&p).unwrap() {
            FileStatus::Ok { size, mtime } => {
                assert_eq!(size, 12);
                assert!(mtime > 0);
            }
            other => panic!("esperava Ok, veio {other:?}"),
        }
        assert_eq!(status(&d.path().join("nao-existe.pdf")).unwrap(), FileStatus::Missing);
        assert_eq!(status(d.path()).unwrap(), FileStatus::Missing, "pasta não é arquivo");
    }

    #[test]
    fn status_changes_when_file_changes() {
        let (_d, p) = file(b"um");
        let a = status(&p).unwrap();
        std::fs::write(&p, b"dois bytes a mais").unwrap();
        assert_ne!(a, status(&p).unwrap());
    }

    #[test]
    fn read_range_slices_and_clamps() {
        let (_d, p) = file(b"0123456789");
        assert_eq!(read_range(&p, 2, 3).unwrap(), b"234");
        assert_eq!(read_range(&p, 8, 100).unwrap(), b"89", "pedido além do fim devolve só o que existe");
        assert!(read_range(&p, 10, 5).unwrap().is_empty());
        assert!(read_range(&p, 999, 5).unwrap().is_empty());
        assert!(read_range(&p, 0, 0).unwrap().is_empty());
    }

    #[test]
    fn read_range_caps_one_call() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("grande.pdf");
        let f = std::fs::File::create(&p).unwrap();
        f.set_len(MAX_READ + 1000).unwrap(); // arquivo esparso: não gasta disco de verdade
        assert_eq!(read_range(&p, 0, u64::MAX).unwrap().len() as u64, MAX_READ);
        assert_eq!(read_range(&p, MAX_READ, u64::MAX).unwrap().len(), 1000);
    }

    #[test]
    fn read_range_of_missing_file_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(read_range(&d.path().join("x.pdf"), 0, 4).is_err());
    }
}
