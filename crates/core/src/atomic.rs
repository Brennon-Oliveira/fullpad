use crate::error::{IoContext, Result};
use std::io::Write;
use std::path::Path;

/// Escreve `bytes` em `path` de forma atômica: arquivo temporário no mesmo
/// diretório, `fsync` e `rename`. Em queda de energia sobra o conteúdo antigo
/// ou o novo, nunca um arquivo pela metade.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir).at(dir)?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".tmp-")
        .tempfile_in(dir)
        .at(dir)?;
    tmp.write_all(bytes).at(path)?;
    tmp.as_file().sync_all().at(path)?;
    tmp.persist(path).map_err(|e| crate::Error::Io {
        path: path.to_path_buf(),
        source: e.error,
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overwrites_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        write_atomic(&file, b"um").unwrap();
        write_atomic(&file, b"dois").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"dois");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
