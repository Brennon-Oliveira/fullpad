//! Imagens coladas (ou soltas) no markdown: onde guardar, como nomear e como escrever o caminho no texto.
//!
//! O nome do arquivo é o **hash do conteúdo** (`9f3a1c07e2b4d856.png`): colar a mesma imagem duas vezes (ou
//! de novo depois de um Ctrl+Z, que deixa o arquivo órfão) reaproveita o que já está na pasta, em vez de
//! gravar outro. O hash só acha o candidato; antes de reaproveitar confere-se o tamanho e três amostras
//! (começo, meio e fim), para não confiar num arquivo que alguém tenha mexido depois. Uma diferença grava
//! com sufixo (`-2`, `-3`…), nunca por cima. A gravação é atômica.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::atomic::write_atomic;
use crate::error::IoContext;
use crate::json::MAX_IMAGE_BYTES;
use crate::{Error, Result};

/// Quanto se lê de cada amostra (começo, meio e fim) ao conferir um arquivo que já existe.
const SAMPLE: usize = 4096;
/// Quantos sufixos (`-2`, `-3`…) se tentam antes de desistir (só há sufixo se o hash colidir de verdade).
const MAX_SUFFIX: u32 = 100;

/// Onde a imagem foi parar e se já estava lá.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Saved {
    pub path: PathBuf,
    /// Já existia um arquivo igual: nada foi gravado (ou, em [`plan`], nada será).
    pub reused: bool,
}

/// A extensão do formato, reconhecido pelos primeiros bytes (nunca pelo que a UI diz): PNG, JPEG, GIF,
/// WebP, BMP e AVIF. SVG e ícones ficam de fora (não vêm da área de transferência).
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.len() >= 14 && bytes.starts_with(b"BM") {
        Some("bmp")
    } else if bytes.len() >= 12 && &bytes[4..12] == b"ftypavif" {
        Some("avif")
    } else {
        None
    }
}

/// `true` se a extensão é de um formato que [`sniff`] aceita (para decidir, sem ler o arquivo, se um arquivo
/// solto pode virar imagem do markdown).
pub fn is_image_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif"))
}

/// FNV-1a de 64 bits: identidade do conteúdo para achar um arquivo igual, não segurança.
pub fn hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// A pasta das imagens de uma nota ligada a um arquivo: `imagens/<nome-do-arquivo>/`, ao lado dele.
pub fn dir_for_file(file: &Path) -> Option<PathBuf> {
    let parent = file.parent()?;
    let stem = file.file_stem()?;
    Some(parent.join("imagens").join(stem))
}

fn check(bytes: &[u8]) -> Result<&'static str> {
    if bytes.is_empty() {
        return Err(Error::Invalid("a imagem está vazia".into()));
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(Error::Invalid(format!("imagem grande demais ({} MB; o limite é {} MB)", bytes.len() / (1024 * 1024), MAX_IMAGE_BYTES / (1024 * 1024))));
    }
    sniff(bytes).ok_or_else(|| Error::Invalid("formato de imagem não reconhecido (aceitos: PNG, JPEG, GIF, WebP, BMP e AVIF)".into()))
}

/// O arquivo `path` é, com toda a confiança que se precisa, o mesmo que `bytes`: mesmo tamanho e as mesmas
/// amostras do começo, do meio e do fim (um arquivo pequeno é comparado inteiro). Lê no máximo ~12 KB.
fn same_content(path: &Path, bytes: &[u8]) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if !meta.is_file() || meta.len() != bytes.len() as u64 {
        return false;
    }
    let Ok(mut f) = std::fs::File::open(path) else { return false };
    let len = bytes.len();
    let mut windows: Vec<(usize, usize)> = Vec::new();
    if len <= SAMPLE * 3 {
        windows.push((0, len));
    } else {
        windows.push((0, SAMPLE));
        windows.push(((len - SAMPLE) / 2, SAMPLE));
        windows.push((len - SAMPLE, SAMPLE));
    }
    let mut buf = vec![0u8; SAMPLE.min(len)];
    for (at, n) in windows {
        if f.seek(SeekFrom::Start(at as u64)).is_err() || f.read_exact(&mut buf[..n]).is_err() || buf[..n] != bytes[at..at + n] {
            return false;
        }
    }
    true
}

/// Onde `bytes` ficaria em `dir` e se já há um igual, sem gravar nada.
pub fn plan(dir: &Path, bytes: &[u8]) -> Result<Saved> {
    let ext = check(bytes)?;
    let h = hash(bytes);
    for n in 1..=MAX_SUFFIX {
        let name = if n == 1 { format!("{h:016x}.{ext}") } else { format!("{h:016x}-{n}.{ext}") };
        let path = dir.join(name);
        if !path.exists() {
            return Ok(Saved { path, reused: false });
        }
        if same_content(&path, bytes) {
            return Ok(Saved { path, reused: true });
        }
    }
    Err(Error::Invalid("não foi possível achar um nome livre para a imagem".into()))
}

/// Guarda `bytes` em `dir` (que é criada se preciso): reaproveita o arquivo igual que já estiver lá; senão
/// grava com a escrita atômica, sem nunca sobrescrever um arquivo existente.
pub fn save(dir: &Path, bytes: &[u8]) -> Result<Saved> {
    let planned = plan(dir, bytes)?;
    if !planned.reused {
        write_atomic(&planned.path, bytes)?;
    }
    Ok(planned)
}

/// Lê uma imagem solta no disco (arrastada para o editor) com as mesmas regras de tamanho e formato.
pub fn read_source(path: &Path) -> Result<Vec<u8>> {
    let meta = std::fs::metadata(path).at(path)?;
    if !meta.is_file() {
        return Err(Error::Invalid("não é um arquivo".into()));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(Error::Invalid(format!("imagem grande demais ({} MB; o limite é {} MB)", meta.len() / (1024 * 1024), MAX_IMAGE_BYTES / (1024 * 1024))));
    }
    let bytes = std::fs::read(path).at(path)?;
    check(&bytes)?;
    Ok(bytes)
}

/// Codifica o que quebraria um destino de link do markdown (espaço, parênteses, `#`, `%`…). Letras, números e
/// `-._~/` ficam; o resto vira `%XX`. `keep_non_ascii`: acentos e emoji ficam como estão (legíveis no texto).
fn encode(s: &str, keep_non_ascii: bool, keep_colon: bool) -> String {
    let mut out = String::with_capacity(s.len());
    let mut buf = [0u8; 4];
    for c in s.chars() {
        let plain = c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~' | '/') || (keep_colon && c == ':') || (keep_non_ascii && !c.is_ascii());
        if plain {
            out.push(c);
        } else {
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    out
}

/// O destino que vai entre os parênteses de `![](…)`: relativo à pasta da nota quando a imagem está dentro dela
/// (nota ligada a arquivo), senão um `file:///…` absoluto (nota solta), que continua valendo onde a nota estiver.
pub fn markdown_target(note_file: Option<&Path>, image: &Path) -> String {
    if let Some(parent) = note_file.and_then(|f| f.parent())
        && let Ok(rel) = image.strip_prefix(parent)
    {
        let rel = rel.to_string_lossy().replace('\\', "/");
        return encode(&rel, true, false);
    }
    let abs = image.to_string_lossy().replace('\\', "/");
    let abs = abs.strip_prefix("//?/").unwrap_or(&abs).to_string(); // prefixo de caminho longo do Windows
    let abs = if abs.starts_with('/') { abs } else { format!("/{abs}") }; // `C:/x` → `/C:/x`
    format!("file://{}", encode(&abs, false, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nresto-da-imagem";

    fn png_of(len: usize, fill: u8) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n".to_vec();
        v.resize(len, fill);
        v
    }

    #[test]
    fn reconhece_formatos_pelos_primeiros_bytes() {
        assert_eq!(sniff(PNG), Some("png"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("jpg"));
        assert_eq!(sniff(b"GIF89a....."), Some("gif"));
        assert_eq!(sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), Some("webp"));
        assert_eq!(sniff(b"BM\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"), Some("bmp"));
        assert_eq!(sniff(b"\x00\x00\x00\x1cftypavif...."), Some("avif"));
        assert_eq!(sniff(b"<svg></svg>"), None);
        assert_eq!(sniff(b"texto qualquer"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn extensao_de_imagem_aceita() {
        assert!(is_image_ext(Path::new("a/B.PNG")));
        assert!(is_image_ext(Path::new("foto.jpeg")));
        assert!(!is_image_ext(Path::new("a.svg")));
        assert!(!is_image_ext(Path::new("a.md")));
        assert!(!is_image_ext(Path::new("png")));
    }

    #[test]
    fn pasta_fica_ao_lado_do_arquivo_com_o_nome_dele() {
        assert_eq!(dir_for_file(Path::new("/x/notas.md")), Some(PathBuf::from("/x/imagens/notas")));
        assert_eq!(dir_for_file(Path::new("/x/a.b.md")), Some(PathBuf::from("/x/imagens/a.b")));
    }

    #[test]
    fn grava_com_o_hash_no_nome() {
        let d = tempfile::tempdir().unwrap();
        let s = save(d.path(), PNG).unwrap();
        assert!(!s.reused);
        assert_eq!(s.path, d.path().join(format!("{:016x}.png", hash(PNG))));
        assert_eq!(std::fs::read(&s.path).unwrap(), PNG);
    }

    #[test]
    fn mesma_imagem_duas_vezes_e_um_arquivo_so() {
        let d = tempfile::tempdir().unwrap();
        let a = save(d.path(), PNG).unwrap();
        let b = save(d.path(), PNG).unwrap();
        assert!(!a.reused);
        assert!(b.reused);
        assert_eq!(a.path, b.path);
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn plan_nao_grava() {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("imagens").join("n");
        let p = plan(&dir, PNG).unwrap();
        assert!(!p.reused);
        assert!(!dir.exists());
        save(&dir, PNG).unwrap();
        assert!(plan(&dir, PNG).unwrap().reused);
    }

    #[test]
    fn recusa_vazio_grande_demais_e_formato_desconhecido() {
        let d = tempfile::tempdir().unwrap();
        assert!(save(d.path(), b"").is_err());
        assert!(save(d.path(), b"nao e imagem").is_err());
        let big = png_of(MAX_IMAGE_BYTES as usize + 1, 1);
        assert!(save(d.path(), &big).is_err());
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0);
    }

    /// O arquivo com o nome certo mas de outro conteúdo não é reaproveitado: a nova imagem vai para `-2`.
    fn colide(mutate: impl FnOnce(&mut Vec<u8>)) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().to_path_buf();
        let img = png_of(40_000, 7);
        let first = save(&dir, &img).unwrap();
        let mut changed = img.clone();
        mutate(&mut changed);
        std::fs::write(&first.path, &changed).unwrap(); // mexeram no arquivo depois
        let again = save(&dir, &img).unwrap();
        (d, first.path, again.path)
    }

    #[test]
    fn arquivo_com_tamanho_diferente_nao_e_reaproveitado() {
        let (_d, a, b) = colide(|v| v.push(0));
        assert!(!b.eq(&a));
        assert!(b.to_string_lossy().ends_with("-2.png"));
    }

    #[test]
    fn arquivo_com_o_comeco_alterado_nao_e_reaproveitado() {
        let (_d, a, b) = colide(|v| v[100] ^= 0xFF);
        assert_ne!(a, b);
    }

    #[test]
    fn arquivo_com_o_meio_alterado_nao_e_reaproveitado() {
        let (_d, a, b) = colide(|v| {
            let m = v.len() / 2;
            v[m] ^= 0xFF;
        });
        assert_ne!(a, b);
    }

    #[test]
    fn arquivo_com_o_fim_alterado_nao_e_reaproveitado() {
        let (_d, a, b) = colide(|v| {
            let n = v.len();
            v[n - 1] ^= 0xFF;
        });
        assert_ne!(a, b);
    }

    #[test]
    fn sufixo_se_repete_e_o_arquivo_do_usuario_nunca_e_sobrescrito() {
        let d = tempfile::tempdir().unwrap();
        let img = png_of(100, 3);
        let first = save(d.path(), &img).unwrap();
        std::fs::write(&first.path, b"outra coisa").unwrap();
        let second = save(d.path(), &img).unwrap();
        assert!(second.path.to_string_lossy().ends_with("-2.png"));
        assert_eq!(std::fs::read(&first.path).unwrap(), b"outra coisa");
        assert!(save(d.path(), &img).unwrap().reused); // o `-2` é igual: reaproveita
    }

    #[test]
    fn imagem_pequena_e_comparada_inteira() {
        let d = tempfile::tempdir().unwrap();
        let img = png_of(200, 3);
        let first = save(d.path(), &img).unwrap();
        let mut other = img.clone();
        other[150] ^= 1; // no meio de um arquivo pequeno: só a comparação inteira pega
        std::fs::write(&first.path, &other).unwrap();
        assert!(!save(d.path(), &img).unwrap().reused);
    }

    #[test]
    fn le_imagem_solta_com_as_mesmas_regras() {
        let d = tempfile::tempdir().unwrap();
        let ok = d.path().join("a.png");
        std::fs::write(&ok, PNG).unwrap();
        assert_eq!(read_source(&ok).unwrap(), PNG);
        let bad = d.path().join("b.png");
        std::fs::write(&bad, b"texto").unwrap();
        assert!(read_source(&bad).is_err());
        assert!(read_source(&d.path().join("nao-existe.png")).is_err());
        assert!(read_source(d.path()).is_err());
    }

    #[test]
    fn destino_relativo_quando_a_imagem_esta_ao_lado_da_nota() {
        let note = Path::new("/x/notas.md");
        let img = Path::new("/x/imagens/notas/9f3a.png");
        assert_eq!(markdown_target(Some(note), img), "imagens/notas/9f3a.png");
    }

    #[test]
    fn destino_codifica_o_que_quebra_o_link() {
        let note = Path::new("/x/minhas notas (1).md");
        let img = Path::new("/x/imagens/minhas notas (1)/9f3a.png");
        assert_eq!(markdown_target(Some(note), img), "imagens/minhas%20notas%20%281%29/9f3a.png");
        let acc = Path::new("/x/imagens/relatório/a.png");
        assert_eq!(markdown_target(Some(Path::new("/x/relatório.md")), acc), "imagens/relatório/a.png");
    }

    #[test]
    fn destino_de_nota_solta_e_file_url_absoluta() {
        let img = Path::new("/home/u/.local/share/fullpad/images/abc/9f3a.png");
        assert_eq!(markdown_target(None, img), "file:///home/u/.local/share/fullpad/images/abc/9f3a.png");
        let win = Path::new("C:\\Users\\Zé Silva\\AppData\\Roaming\\fullpad\\images\\abc\\9f3a.png");
        assert_eq!(markdown_target(None, win), "file:///C:/Users/Z%C3%A9%20Silva/AppData/Roaming/fullpad/images/abc/9f3a.png");
    }

    #[test]
    fn destino_gerado_e_entendido_pela_leitura_de_imagem_do_json() {
        let img = Path::new("/home/u/dados/images/abc/9f3a.png");
        let target = markdown_target(None, img);
        assert_eq!(crate::json::resolve_image_path(&target, None).unwrap(), img);
        let win = Path::new("C:\\Users\\Zé Silva\\x.png");
        let t = markdown_target(None, win);
        assert_eq!(crate::json::resolve_image_path(&t, None).unwrap(), PathBuf::from("C:/Users/Zé Silva/x.png"));
    }
}
