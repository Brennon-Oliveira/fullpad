//! Arquivos binários das abas só de leitura (PDF; EPUB depois).
//!
//! O app nunca grava nesses arquivos e não os lê ao abrir a aba: a UI pede os bytes por faixas,
//! só depois de o usuário clicar em "Carregar". Aqui fica o que o Rust decide: se o arquivo existe
//! e mudou, e quanto pode ser lido de uma vez.

use crate::error::{Error, IoContext, Result};
use serde::Serialize;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::{Duration, Instant};

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

// ---- identidade do arquivo (para lembrar a posição de leitura) ---------------------------------

/// Quanto do começo e do fim do arquivo entra na identidade.
const FINGERPRINT_BYTES: u64 = 64 * 1024;

/// Identidade do conteúdo de um arquivo: o tamanho e um hash (FNV-1a, estável entre versões do
/// Rust, ao contrário do `DefaultHasher`) do começo e do fim. Não depende do caminho, então a
/// posição de leitura sobrevive a mover ou renomear o arquivo; editar o arquivo (outro tamanho ou
/// outro conteúdo nas pontas) gera outra identidade, e a posição antiga deixa de valer.
pub fn fingerprint(path: &Path) -> Result<String> {
    let mut f = std::fs::File::open(path).at(path)?;
    let size = f.metadata().at(path)?.len();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            hash ^= u64::from(*b);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    let head = FINGERPRINT_BYTES.min(size);
    let mut buf = vec![0u8; head as usize];
    f.read_exact(&mut buf).at(path)?;
    feed(&buf);
    if size > head {
        let tail = FINGERPRINT_BYTES.min(size - head);
        f.seek(SeekFrom::Start(size - tail)).at(path)?;
        let mut buf = vec![0u8; tail as usize];
        f.read_exact(&mut buf).at(path)?;
        feed(&buf);
    }
    Ok(format!("{size:x}-{hash:016x}"))
}

/// Uma identidade válida (a UI a devolve ao gravar a posição; nada além disso vira chave).
pub fn is_fingerprint(key: &str) -> bool {
    key.len() <= 40 && key.split_once('-').is_some_and(|(a, b)| !a.is_empty() && !b.is_empty() && key.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-'))
}

// ---- verificação de PDF antes de abrir (bomba de compressão) -----------------------------------

/// Resultado de `scan_pdf`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "verdict", rename_all = "lowercase")]
pub enum PdfScan {
    Ok,
    /// Um trecho comprimido (`packed` bytes) expande demais ao abrir. `unpacked` é o quanto se
    /// mediu antes de parar; `at_least` diz que parou no teto e o real é ainda maior.
    Suspicious { packed: u64, unpacked: u64, at_least: bool },
}

/// Pedaço lido por vez ao procurar streams.
const SCAN_CHUNK: usize = 4 * 1024 * 1024;
/// Um trecho só é suspeito depois de passar de 32 MB descomprimidos...
const BOMB_MIN_OUT: u64 = 32 * 1024 * 1024;
/// ...e de expandir mais de 200 vezes.
const BOMB_RATIO: u64 = 200;
/// Passou de 64 MB com razão abaixo de 20: dado comum (uma imagem grande), nada a temer.
const CLEAR_OUT: u64 = 64 * 1024 * 1024;
const CLEAR_RATIO: u64 = 20;
/// Teto de leitura por trecho: acima disso para de medir (e é suspeito mesmo com razão baixa).
const MAX_OUT: u64 = 256 * 1024 * 1024;
/// Tempo máximo da verificação inteira; esgotado, o arquivo passa (verificação inconclusiva).
const SCAN_DEADLINE: Duration = Duration::from_secs(15);

/// Conta os bytes que o descompressor consumiu do arquivo.
struct Counting<R> {
    inner: R,
    n: u64,
}
impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let k = self.inner.read(buf)?;
        self.n += k as u64;
        Ok(k)
    }
}

/// Procura bombas de compressão num PDF **sem** entregá-lo ao pdf.js: o pdf.js não tem limite para
/// o tamanho de um stream descomprimido, e um arquivo de 1 MB chegou a pedir 2 GB de memória.
/// Cada stream `/FlateDecode` é desinflado com teto, só contando bytes; erros de decodificação
/// (arquivo truncado, `stream` dentro de dado binário) são ignorados, o pdf.js os trata depois.
pub fn scan_pdf(path: &Path) -> Result<PdfScan> {
    let started = Instant::now();
    let mut f = std::fs::File::open(path).at(path)?;
    let size = f.metadata().at(path)?.len();
    const KEY: &[u8] = b"stream";

    let mut carry: Vec<u8> = Vec::new();
    let mut next = 0u64; // onde continua a leitura sequencial
    let mut chunk = vec![0u8; SCAN_CHUNK];
    while next < size {
        if started.elapsed() > SCAN_DEADLINE {
            return Ok(PdfScan::Ok);
        }
        f.seek(SeekFrom::Start(next)).at(path)?;
        let got = f.read(&mut chunk).at(path)?;
        if got == 0 {
            break;
        }
        let mut buf = std::mem::take(&mut carry);
        let carried = buf.len();
        let base = next - carried as u64; // posição absoluta do início de `buf`
        buf.extend_from_slice(&chunk[..got]);
        next += got as u64;

        let mut i = 0;
        while let Some(at) = find(&buf[i..], KEY).map(|k| k + i) {
            i = at + 1;
            // já vista no pedaço anterior (inteira dentro do que veio de lá)
            if at + KEY.len() <= carried {
                continue;
            }
            if at >= 3 && &buf[at - 3..at] == b"end" {
                continue; // `endstream`
            }
            if let Some(found) = inspect_stream(&mut f, path, base + at as u64, &started)? {
                return Ok(found);
            }
        }
        // guarda o fim, para achar `stream` e `end` partidos na emenda
        let keep = buf.len().min(KEY.len() + 3);
        carry = buf[buf.len() - keep..].to_vec();
    }
    Ok(PdfScan::Ok)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Olha o stream que começa em `at` (posição da palavra `stream`). `Some` se for suspeito.
fn inspect_stream(f: &mut std::fs::File, path: &Path, at: u64, started: &Instant) -> Result<Option<PdfScan>> {
    // o dicionário do objeto vem logo antes: só interessa se declara /FlateDecode
    let from = at.saturating_sub(1024);
    f.seek(SeekFrom::Start(from)).at(path)?;
    let mut head = vec![0u8; (at - from) as usize];
    f.read_exact(&mut head).at(path)?;
    let dict = match head.windows(3).rposition(|w| w == b"obj") {
        Some(k) => &head[k..],
        None => &head[..],
    };
    if find(dict, b"FlateDecode").is_none() {
        return Ok(None);
    }
    // o corpo começa depois de `stream` e da quebra de linha
    f.seek(SeekFrom::Start(at + 6)).at(path)?;
    let mut eol = [0u8; 2];
    let k = f.read(&mut eol).at(path)?;
    let skip = match &eol[..k] {
        [b'\r', b'\n', ..] => 2,
        [b'\n', ..] | [b'\r', ..] => 1,
        _ => 0,
    };
    f.seek(SeekFrom::Start(at + 6 + skip)).at(path)?;

    let reader = Counting { inner: BufReader::with_capacity(64 * 1024, &mut *f), n: 0 };
    let mut dec = flate2::bufread::ZlibDecoder::new(BufReader::with_capacity(64 * 1024, reader));
    let mut out = 0u64;
    let mut sink = vec![0u8; 64 * 1024];
    loop {
        if started.elapsed() > SCAN_DEADLINE {
            return Ok(None);
        }
        let n = match dec.read(&mut sink) {
            Ok(0) | Err(_) => return Ok(None), // acabou ou não é zlib válido: nada suspeito
            Ok(n) => n as u64,
        };
        out += n;
        let packed = dec.total_in().max(1);
        if out >= CLEAR_OUT && out <= packed * CLEAR_RATIO {
            return Ok(None);
        }
        if out >= BOMB_MIN_OUT && out > packed * BOMB_RATIO || out >= MAX_OUT {
            // continua medindo até o teto, para dizer quanto o trecho realmente expande
            let mut total = out;
            while total < MAX_OUT {
                match dec.read(&mut sink) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => total += n as u64,
                }
            }
            return Ok(Some(PdfScan::Suspicious { packed: dec.total_in(), unpacked: total, at_least: total >= MAX_OUT }));
        }
    }
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

    // ---- scan_pdf ----

    use std::io::Write;

    fn zlib(data: &[u8]) -> Vec<u8> {
        let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    /// `n` bytes de zeros no nível padrão (razão acima de 1000:1, como numa bomba de verdade; o
    /// nível rápido do zlib-rs deixa a razão perto do limite e não representa o ataque).
    fn zeros(n: usize) -> Vec<u8> {
        let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        let block = vec![0u8; 1 << 20];
        for _ in 0..n / block.len() {
            e.write_all(&block).unwrap();
        }
        e.finish().unwrap()
    }

    /// PDF de mentira só com streams: o scan não precisa de um documento válido.
    fn pdf_with(streams: &[(&str, Vec<u8>)], lead: usize) -> (tempfile::TempDir, std::path::PathBuf) {
        let mut out = b"%PDF-1.7\n".to_vec();
        out.extend(vec![b'%'; lead]);
        out.push(b'\n');
        for (i, (dict, data)) in streams.iter().enumerate() {
            out.extend(format!("{} 0 obj\n<< {dict} /Length {} >>\nstream\n", i + 1, data.len()).bytes());
            out.extend(data);
            out.extend(b"\nendstream\nendobj\n");
        }
        out.extend(b"%%EOF\n");
        file(&out)
    }

    const FLATE: &str = "/Filter /FlateDecode";

    #[test]
    fn scan_flags_a_compression_bomb() {
        let (_d, p) = pdf_with(&[(FLATE, zeros(48 << 20))], 0);
        match scan_pdf(&p).unwrap() {
            PdfScan::Suspicious { packed, unpacked, .. } => {
                assert!(packed < 1 << 20, "o trecho comprimido é pequeno: {packed}");
                assert!(unpacked >= 32 << 20);
            }
            other => panic!("esperava Suspicious, veio {other:?}"),
        }
    }

    #[test]
    fn scan_reports_at_least_when_it_hits_the_cap() {
        let (_d, p) = pdf_with(&[(FLATE, zeros(300 << 20))], 0);
        match scan_pdf(&p).unwrap() {
            PdfScan::Suspicious { unpacked, at_least, .. } => assert!(at_least && unpacked >= MAX_OUT),
            other => panic!("esperava Suspicious, veio {other:?}"),
        }
    }

    #[test]
    fn scan_lets_normal_pdfs_through() {
        let text: Vec<u8> = (0..400_000u32).flat_map(|i| format!("BT /F1 12 Tf {} {} Td (linha {i}) Tj ET\n", i % 500, i % 700).into_bytes()).collect();
        let (_d, p) = pdf_with(&[(FLATE, zlib(&text)), ("", b"nao comprimido".to_vec()), (FLATE, zlib(b"pequeno"))], 0);
        assert_eq!(scan_pdf(&p).unwrap(), PdfScan::Ok);
    }

    #[test]
    fn scan_ignores_big_streams_that_are_not_flate_and_broken_ones() {
        // sem /FlateDecode no dicionário: nem tenta desinflar, mesmo com bytes de zlib dentro
        let (_d, p) = pdf_with(&[("/Filter /DCTDecode", zeros(48 << 20))], 0);
        assert_eq!(scan_pdf(&p).unwrap(), PdfScan::Ok);
        // flate truncado e flate inválido: erro de decodificação não é bomba
        let mut cut = zeros(48 << 20);
        cut.truncate(40);
        let (_d2, p2) = pdf_with(&[(FLATE, cut), (FLATE, b"isto nao e zlib".to_vec())], 0);
        assert_eq!(scan_pdf(&p2).unwrap(), PdfScan::Ok);
        // arquivo que nem é PDF
        let (_d3, p3) = file(b"texto qualquer");
        assert_eq!(scan_pdf(&p3).unwrap(), PdfScan::Ok);
    }

    #[test]
    fn scan_finds_a_bomb_after_good_streams_and_across_chunk_edges() {
        let good = zlib(b"conteudo comum");
        // vários preenchimentos: a palavra `stream` do trecho ruim cai em lugares diferentes em
        // relação ao limite do pedaço lido (inclusive partida ao meio)
        for lead in [0usize, SCAN_CHUNK - 200, SCAN_CHUNK - 120, SCAN_CHUNK - 100, SCAN_CHUNK - 90] {
            let (_d, p) = pdf_with(&[(FLATE, good.clone()), (FLATE, zeros(40 << 20))], lead);
            assert!(matches!(scan_pdf(&p).unwrap(), PdfScan::Suspicious { .. }), "lead {lead}");
        }
    }

    #[test]
    fn scan_of_missing_file_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(scan_pdf(&d.path().join("x.pdf")).is_err());
    }

    #[test]
    fn fingerprint_follows_the_content_not_the_path() {
        let (d, p) = file(b"%PDF-1.7 conteudo do livro");
        let moved = d.path().join("outro-nome.pdf");
        std::fs::copy(&p, &moved).unwrap();
        let a = fingerprint(&p).unwrap();
        assert_eq!(a, fingerprint(&moved).unwrap(), "copiar ou renomear não muda a identidade");
        assert!(is_fingerprint(&a), "{a}");

        std::fs::write(&p, b"%PDF-1.7 conteudo do livro, editado").unwrap();
        assert_ne!(a, fingerprint(&p).unwrap(), "outro conteúdo, outra identidade");
    }

    #[test]
    fn fingerprint_of_a_big_file_reads_only_the_ends_and_sees_the_tail() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("grande.pdf");
        let f = std::fs::File::create(&p).unwrap();
        f.set_len(500 << 20).unwrap(); // esparso
        let a = fingerprint(&p).unwrap();
        let mut f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
        f.seek(SeekFrom::End(-10)).unwrap();
        f.write_all(b"mudou").unwrap();
        assert_ne!(a, fingerprint(&p).unwrap(), "uma mudança no fim aparece");
        let (_d, tiny) = file(b"");
        assert!(is_fingerprint(&fingerprint(&tiny).unwrap()));
    }

    #[test]
    fn is_fingerprint_accepts_only_our_keys() {
        assert!(is_fingerprint("1a2b-00ff00ff00ff00ff"));
        for bad in ["", "-", "abc", "../etc/passwd", "a-b-c/d", "zz-yy", "a-", "-b", &"f".repeat(41)] {
            assert!(!is_fingerprint(bad), "{bad}");
        }
    }

    #[test]
    fn read_range_of_missing_file_is_an_error() {
        let d = tempfile::tempdir().unwrap();
        assert!(read_range(&d.path().join("x.pdf"), 0, 4).is_err());
    }
}
