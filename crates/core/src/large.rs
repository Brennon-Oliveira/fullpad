//! Arquivos de texto muito grandes (centenas de MB ou GB): abrir, rolar, buscar e editar sem
//! carregar o arquivo inteiro. Sem UI, testável.
//!
//! **Nada aqui vale para arquivo comum.** O caminho normal (`Store::open_file`, `save_file`,
//! `write_atomic`) não passa por este módulo: só um arquivo de texto acima do limite (`probe`)
//! entra no modo grande.
//!
//! # Como funciona
//!
//! - O arquivo fica no disco. Um **índice** (construído em segundo plano) o divide em **lotes**:
//!   até `batch_lines` linhas **ou** `batch_bytes` bytes, o que estourar primeiro. O índice guarda
//!   só a faixa de bytes e a contagem de linhas de cada lote (poucas centenas de números por GB).
//! - Uma **linha gigante** (mais de `segment_bytes`) é cortada em **segmentos virtuais**, sempre em
//!   limite de caractere. O corte é só de exibição (um `\n` virtual no texto mostrado): o arquivo
//!   nunca ganha uma quebra de linha por causa dele.
//! - **Linha** é "o que vem depois do n-ésimo `\n`" (como no CodeMirror); o total é `\n`s + 1. Um
//!   segmento virtual conta como uma linha.
//! - A edição de um lote guarda o **texto novo do lote** (num diário em disco, `large/<id>/`);
//!   o arquivo do usuário só muda em `save`, que copia o original em fluxo, byte a byte, trocando só
//!   os lotes editados, num temporário que depois é renomeado (escrita atômica).
//! - Posições (`breaks`, buscas) são em **UTF-16**, as do CodeMirror.

use crate::atomic::write_atomic;
use crate::disk::{DiskState, DiskStamp};
use crate::error::{Error, IoContext, Result};
use crate::model::{Encoding, Eol};
use crate::search;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

/// A partir de que tamanho (bytes) um arquivo de texto abre em modo grande.
pub const LARGE_THRESHOLD: u64 = 20 * 1024 * 1024;
/// Quanto do começo do arquivo se lê para detectar codificação e quebra de linha.
const SAMPLE: usize = 64 * 1024;
/// Quanto do começo se olha à procura de byte NUL (arquivo binário).
const NUL_SNIFF: usize = 8 * 1024;
/// Pedaço lido por vez ao construir o índice.
const INDEX_CHUNK: usize = 4 * 1024 * 1024;
/// Quanto do começo e do fim entra no hash do carimbo.
const STAMP_EDGE: u64 = 64 * 1024;
/// Teto de resultados detalhados da busca.
pub const MAX_HITS: usize = 5000;

/// Tamanhos que definem lotes e segmentos. Os de produção são `Limits::default()`; os testes usam
/// valores pequenos para exercitar divisas de lote e linhas gigantes sem arquivos enormes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct Limits {
    pub batch_lines: usize,
    pub batch_bytes: usize,
    pub segment_bytes: usize,
    /// Teto do texto de um lote editado (colar um arquivo inteiro num lote não vale).
    pub max_edit_bytes: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self { batch_lines: 5_000, batch_bytes: 2 * 1024 * 1024, segment_bytes: 1024 * 1024, max_edit_bytes: 32 * 1024 * 1024 }
    }
}

impl Limits {
    fn norm(mut self) -> Self {
        self.segment_bytes = self.segment_bytes.max(8);
        self.batch_lines = self.batch_lines.max(1);
        // um pedaço (segmento + o `\n`) sempre cabe num lote
        self.batch_bytes = self.batch_bytes.max(self.segment_bytes + 1);
        self
    }
}

// ---- elegibilidade -------------------------------------------------------------------

/// Extensões que contam como texto no modo grande. Sem extensão (`messages`, `Makefile`) e só dígitos
/// (`app.log.1`, de rotação de log) também valem; binário é barrado pela leitura do começo.
const TEXT_EXTS: &[&str] = &[
    "txt", "log", "out", "dump", "md", "markdown", "csv", "tsv", "json", "jsonc", "geojson", "ndjson", "jsonl", "webmanifest", "yaml",
    "yml", "toml", "ini", "cfg", "conf", "properties", "env", "xml", "html", "htm", "css", "scss", "js", "mjs", "cjs", "ts", "tsx",
    "jsx", "sql", "py", "rs", "go", "java", "kt", "c", "h", "cc", "cpp", "hpp", "cs", "rb", "php", "sh", "bash", "zsh", "ps1", "bat",
    "lua", "pl", "swift", "diff", "patch", "dockerfile", "dbml", "dbmlx", "mmd", "mermaid", "tex", "latex", "ltx", "srt", "vtt",
    "tmx", "po", "lst", "list", "tab",
];

/// O caminho tem extensão de texto (ou nenhuma, ou só dígitos)?
pub fn is_text_path(path: &Path) -> bool {
    match path.extension() {
        None => true,
        Some(ext) => {
            let ext = ext.to_string_lossy().to_ascii_lowercase();
            ext.chars().all(|c| c.is_ascii_digit()) || TEXT_EXTS.contains(&ext.as_str())
        }
    }
}

/// O que se detecta do arquivo (por amostra do começo, nunca pelo arquivo todo).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sniff {
    pub encoding: Encoding,
    pub eol: Eol,
    /// Bytes do BOM no começo (0 ou 3).
    pub bom: u64,
}

/// Resultado de olhar um arquivo que a pessoa quer abrir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// Caminho de sempre: arquivo pequeno, ou que não é texto reconhecido, ou binário.
    Normal,
    /// Abre em modo grande.
    Large(Sniff),
    /// UTF-16 grande: não há índice por byte; a UI oferece carregar inteiro (caminho normal).
    Utf16 { size: u64 },
}

fn sniff_bytes(sample: &[u8]) -> Sniff {
    let (encoding, bom, body) = if let Some(rest) = sample.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        (Encoding::Utf8Bom, 3, rest)
    } else {
        let valid = match std::str::from_utf8(sample) {
            Ok(_) => true,
            // erro por a amostra ter cortado um caractere no fim não conta
            Err(e) => e.error_len().is_none(),
        };
        (if valid { Encoding::Utf8 } else { Encoding::Windows1252 }, 0, sample)
    };
    let crlf = body.windows(2).filter(|w| w == b"\r\n").count();
    let lf = body.iter().filter(|&&b| b == b'\n').count();
    let lf_only = lf - crlf;
    let eol = if crlf > 0 && crlf >= lf_only {
        Eol::Crlf
    } else if lf_only > 0 {
        Eol::Lf
    } else {
        Eol::platform_default()
    };
    Sniff { encoding, eol, bom }
}

fn read_head(path: &Path, n: usize) -> Result<Vec<u8>> {
    let mut f = File::open(path).at(path)?;
    let mut buf = vec![0u8; n];
    let mut got = 0;
    while got < n {
        let r = f.read(&mut buf[got..]).at(path)?;
        if r == 0 {
            break;
        }
        got += r;
    }
    buf.truncate(got);
    Ok(buf)
}

/// Decide se `path` abre em modo grande. Barato: só metadados para arquivo pequeno (nenhum byte é
/// lido), e no máximo 64 KB do começo para um grande. Qualquer coisa que não seja claramente texto
/// acima do limite devolve `Normal` (o caminho de sempre).
pub fn probe(path: &Path, threshold: u64) -> Result<Probe> {
    let meta = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return Ok(Probe::Normal),
    };
    if meta.len() <= threshold || !is_text_path(path) {
        return Ok(Probe::Normal);
    }
    let sample = read_head(path, SAMPLE)?;
    if sample.starts_with(&[0xFF, 0xFE]) || sample.starts_with(&[0xFE, 0xFF]) {
        return Ok(Probe::Utf16 { size: meta.len() });
    }
    if sample.iter().take(NUL_SNIFF).any(|&b| b == 0) {
        return Ok(Probe::Normal); // binário
    }
    Ok(Probe::Large(sniff_bytes(&sample)))
}

// ---- carimbo do arquivo --------------------------------------------------------------

fn fnv(mut h: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Carimbo do arquivo grande: data, tamanho e hash só do começo e do fim (nunca lê o arquivo todo).
/// Quem confere mudança externa usa data e tamanho: qualquer diferença vale como mudança, porque
/// aplicar os lotes editados a um arquivo diferente o corromperia.
pub fn stamp_large(path: &Path) -> Result<Option<DiskStamp>> {
    let mut f = match File::open(path) {
        Ok(f) => f,
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => return Ok(None),
        Err(source) => return Err(Error::Io { path: path.to_path_buf(), source }),
    };
    let meta = f.metadata().at(path)?;
    let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
    let size = meta.len();
    let mut head = vec![0u8; STAMP_EDGE.min(size) as usize];
    f.read_exact(&mut head).at(path)?;
    let mut h = fnv(0xcbf2_9ce4_8422_2325, &head);
    if size > STAMP_EDGE {
        let tail_len = STAMP_EDGE.min(size - STAMP_EDGE);
        let mut tail = vec![0u8; tail_len as usize];
        f.seek(SeekFrom::Start(size - tail_len)).at(path)?;
        f.read_exact(&mut tail).at(path)?;
        h = fnv(h, &tail);
    }
    Ok(Some(DiskStamp { mtime, size, hash: h }))
}

/// O arquivo está como no carimbo? Qualquer mudança de data ou tamanho é `Changed`.
pub fn check_stamp(path: &Path, known: &DiskStamp) -> Result<DiskState> {
    Ok(match stamp_large(path)? {
        None => DiskState::Missing,
        Some(now) if now.mtime == known.mtime && now.size == known.size => DiskState::Unchanged,
        Some(_) => DiskState::Changed,
    })
}

// ---- pedaços (linhas e segmentos) ----------------------------------------------------

/// Fim (exclusivo) do pedaço que começa em `p`: a linha até o `\n` (inclusive) ou, se ela tem mais
/// de `seg` bytes, um segmento cortado em limite de caractere. `None`: falta ler mais (`!eof`).
fn next_piece(buf: &[u8], p: usize, eof: bool, seg: usize, utf8: bool) -> Option<usize> {
    if p >= buf.len() {
        return None;
    }
    let limit = (p + seg + 1).min(buf.len());
    if let Some(i) = memchr::memchr(b'\n', &buf[p..limit]) {
        return Some(p + i + 1);
    }
    if limit - p > seg {
        // mais de `seg` bytes sem quebra de linha: corta em `seg`, voltando se caiu no meio de um caractere
        let mut c = p + seg;
        if utf8 {
            while c > p && (buf[c] & 0xC0) == 0x80 {
                c -= 1;
            }
            if c == p {
                c = p + seg; // sequência inválida: não há onde voltar
            }
        }
        return Some(c);
    }
    if eof { Some(buf.len()) } else { None }
}

fn is_utf8(enc: Encoding) -> bool {
    matches!(enc, Encoding::Utf8 | Encoding::Utf8Bom)
}

fn decode_piece(bytes: &[u8], enc: Encoding, lossy: &mut bool) -> String {
    if is_utf8(enc) {
        match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => {
                *lossy = true;
                String::from_utf8_lossy(bytes).into_owned()
            }
        }
    } else {
        encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned()
    }
}

/// O texto de um lote como o editor o mostra.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Display {
    /// Texto com `\n` no lugar de `\r\n` e com um `\n` virtual em cada corte de segmento.
    pub text: String,
    /// Onde estão os `\n` virtuais (UTF-16, posição do próprio `\n`).
    pub breaks: Vec<usize>,
    /// Havia bytes inválidos na codificação (viraram `U+FFFD`): o lote só pode ser lido, não editado.
    pub lossy: bool,
}

/// Monta o texto de exibição dos bytes de um lote. `tail_virtual`: o último pedaço, se não termina
/// em `\n`, é um corte de segmento (lote que não é o último do arquivo); senão é uma linha sem
/// quebra no fim (fim do arquivo, ou texto editado).
fn display_from_bytes(raw: &[u8], tail_virtual: bool, enc: Encoding, limits: &Limits) -> Display {
    let mut out = Display::default();
    let (mut p, mut u16len) = (0usize, 0usize);
    let utf8 = is_utf8(enc);
    while p < raw.len() {
        let end = next_piece(raw, p, true, limits.segment_bytes, utf8).unwrap_or(raw.len());
        let piece = &raw[p..end];
        let real = piece.last() == Some(&b'\n');
        let virt = !real && (end < raw.len() || tail_virtual);
        let content = if real {
            let c = &piece[..piece.len() - 1];
            c.strip_suffix(b"\r").unwrap_or(c)
        } else {
            piece
        };
        let s = decode_piece(content, enc, &mut out.lossy);
        u16len += s.encode_utf16().count();
        out.text.push_str(&s);
        if real || virt {
            if virt {
                out.breaks.push(u16len);
            }
            out.text.push('\n');
            u16len += 1;
        }
        p = end;
    }
    out
}

/// O texto do lote como está no arquivo (sem cortes virtuais), com `\r\n` virando `\n`. É com ele que
/// se confere se um lote "editado" voltou a ser igual ao original.
fn file_text(raw: &[u8], enc: Encoding) -> (String, bool) {
    let mut lossy = false;
    let s = decode_piece(raw, enc, &mut lossy);
    (s.replace("\r\n", "\n"), lossy)
}

fn encode_chunk(text: &str, enc: Encoding, eol: Eol) -> Result<Vec<u8>> {
    let text = match eol {
        Eol::Lf => std::borrow::Cow::Borrowed(text),
        Eol::Crlf => std::borrow::Cow::Owned(text.replace('\n', "\r\n")),
    };
    match enc {
        Encoding::Utf8 | Encoding::Utf8Bom => Ok(text.into_owned().into_bytes()),
        Encoding::Windows1252 => {
            let (bytes, _, bad) = encoding_rs::WINDOWS_1252.encode(&text);
            if bad { Err(Error::Unencodable("Windows-1252")) } else { Ok(bytes.into_owned()) }
        }
        Encoding::Utf16Le | Encoding::Utf16Be => Err(Error::Invalid("UTF-16 não abre em modo de arquivo grande".into())),
    }
}

// ---- o arquivo grande ----------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Batch {
    start: u64,
    end: u64,
    /// `\n`s do lote (reais e virtuais): quantas linhas terminam nele.
    nl: u64,
}

#[derive(Debug, Clone)]
struct Edit {
    text: String,
    nl: u64,
}

struct Inner {
    path: PathBuf,
    size: u64,
    stamp: DiskStamp,
    batches: Vec<Batch>,
    indexed_bytes: u64,
    done: bool,
    index_error: Option<String>,
    edits: BTreeMap<u64, Edit>,
    /// Há alterações guardadas de uma versão do arquivo que já não é esta: não se aplicam.
    orphaned: bool,
}

impl Inner {
    fn nl(&self, b: &Batch) -> u64 {
        self.edits.get(&b.start).map_or(b.nl, |e| e.nl)
    }
    fn total_lines(&self) -> u64 {
        self.batches.iter().map(|b| self.nl(b)).sum::<u64>() + 1
    }
}

/// Um arquivo grande aberto: índice, alterações pendentes e leitura por lote. Seguro entre threads.
pub struct Large {
    pub limits: Limits,
    pub encoding: Encoding,
    pub eol: Eol,
    bom: u64,
    journal: Option<PathBuf>,
    cancel: AtomicBool,
    /// Um salvar está copiando o arquivo (não há lock durante a cópia: ler e fechar a aba seguem livres).
    saving: AtomicBool,
    save_cancel: AtomicBool,
    save_done: AtomicU64,
    save_total: AtomicU64,
    inner: RwLock<Inner>,
}

/// O que a UI precisa saber do arquivo.
#[derive(Debug, Clone, Serialize)]
pub struct Info {
    pub size: u64,
    pub encoding: Encoding,
    pub eol: Eol,
    /// Lotes já indexados.
    pub batches: usize,
    /// Linhas (contando as já indexadas; o total só é definitivo com `done`).
    pub lines: u64,
    pub done: bool,
    /// Bytes já percorridos pelo índice.
    pub indexed: u64,
    pub edited_batches: usize,
    pub orphaned: bool,
    pub error: Option<String>,
    pub path: PathBuf,
    /// Salvando: bytes já gravados e total a gravar (`0` quando não há salvar em andamento).
    pub save_done: u64,
    pub save_total: u64,
}

/// Um lote pronto para o editor.
#[derive(Debug, Clone, Serialize)]
pub struct BatchOut {
    pub index: usize,
    /// Número (a partir de 0) da primeira linha do lote.
    pub start_line: u64,
    /// `\n`s do texto.
    pub lines: u64,
    pub text: String,
    pub breaks: Vec<usize>,
    pub lossy: bool,
    pub edited: bool,
    /// Lotes conhecidos e se o índice terminou (para saber se há mais adiante).
    pub count: usize,
    pub done: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Located {
    pub batch: usize,
    pub start_line: u64,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct EditOut {
    /// O lote difere do original (se voltou a ser igual, a alteração some).
    pub edited: bool,
    /// `\n`s do lote agora.
    pub lines: u64,
    pub total_lines: u64,
    pub dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hit {
    /// Linha (a partir de 0) e coluna (UTF-16, a partir de 0) onde o resultado começa.
    pub line: u64,
    pub col: usize,
    /// Tamanho em UTF-16.
    pub len: usize,
    pub preview: String,
    pub preview_start: usize,
    pub preview_end: usize,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SearchEnd {
    pub total: usize,
    pub truncated: bool,
    pub cancelled: bool,
}

fn poisoned<T>(_: T) -> Error {
    Error::Invalid("estado interno do arquivo grande indisponível".into())
}

impl Large {
    /// Abre o arquivo (sem ler além da amostra do começo). O índice ainda não existe: chame
    /// `start_index` (em segundo plano) ou `index_blocking` (testes). `journal` é a pasta das
    /// alterações pendentes; se há uma de outra versão do arquivo, vira `orphaned`.
    pub fn open(path: &Path, limits: Limits, journal: Option<PathBuf>) -> Result<Arc<Self>> {
        let limits = limits.norm();
        let sample = read_head(path, SAMPLE)?;
        if sample.starts_with(&[0xFF, 0xFE]) || sample.starts_with(&[0xFE, 0xFF]) {
            return Err(Error::Invalid("UTF-16 não abre em modo de arquivo grande".into()));
        }
        if sample.iter().take(NUL_SNIFF).any(|&b| b == 0) {
            return Err(Error::Invalid("o arquivo parece binário".into()));
        }
        let sn = sniff_bytes(&sample);
        let stamp = stamp_large(path)?.ok_or_else(|| Error::Invalid("arquivo não encontrado".into()))?;
        let large = Large {
            limits,
            encoding: sn.encoding,
            eol: sn.eol,
            bom: sn.bom,
            journal,
            cancel: AtomicBool::new(false),
            saving: AtomicBool::new(false),
            save_cancel: AtomicBool::new(false),
            save_done: AtomicU64::new(0),
            save_total: AtomicU64::new(0),
            inner: RwLock::new(Inner {
                path: path.to_path_buf(),
                size: stamp.size,
                stamp,
                batches: Vec::new(),
                indexed_bytes: sn.bom,
                done: false,
                index_error: None,
                edits: BTreeMap::new(),
                orphaned: false,
            }),
        };
        large.load_journal(&stamp)?;
        Ok(Arc::new(large))
    }

    fn read(&self) -> Result<RwLockReadGuard<'_, Inner>> {
        self.inner.read().map_err(poisoned)
    }
    fn write(&self) -> Result<RwLockWriteGuard<'_, Inner>> {
        self.inner.write().map_err(poisoned)
    }

    // ---- diário de alterações ----

    fn load_journal(&self, stamp: &DiskStamp) -> Result<()> {
        let Some(dir) = &self.journal else { return Ok(()) };
        let meta_path = dir.join("meta.json");
        let Ok(bytes) = std::fs::read(&meta_path) else { return Ok(()) };
        #[derive(serde::Deserialize)]
        struct Meta {
            limits: Limits,
            stamp: DiskStamp,
        }
        let mut g = self.write()?;
        let ok = serde_json::from_slice::<Meta>(&bytes).is_ok_and(|m| m.limits == self.limits && m.stamp == *stamp);
        if !ok {
            g.orphaned = true; // as alterações são de outra versão do arquivo: ficam guardadas, sem aplicar
            return Ok(());
        }
        // qualquer falha ao ler uma alteração guardada a deixa como "de outra versão": fica no disco
        // intocada e nada é aplicado pela metade
        let loaded = (|| -> Result<BTreeMap<u64, Edit>> {
            let mut edits = BTreeMap::new();
            let Ok(rd) = std::fs::read_dir(dir) else { return Ok(edits) };
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().is_none_or(|x| x != "txt") {
                    continue;
                }
                let start = p.file_stem().and_then(|s| s.to_str()).and_then(|s| s.parse::<u64>().ok()).ok_or_else(|| Error::Invalid("diário inválido".into()))?;
                let text = std::fs::read_to_string(&p).at(&p)?;
                let bytes = encode_chunk(&text, self.encoding, self.eol)?;
                let nl = display_from_bytes(&bytes, false, self.encoding, &self.limits).text.matches('\n').count() as u64;
                edits.insert(start, Edit { text, nl });
            }
            Ok(edits)
        })();
        match loaded {
            Ok(edits) => g.edits = edits,
            Err(_) => g.orphaned = true,
        }
        Ok(())
    }

    fn journal_put(&self, stamp: &DiskStamp, start: u64, text: &str) -> Result<()> {
        let Some(dir) = &self.journal else { return Ok(()) };
        let meta = serde_json::json!({ "version": 1, "limits": self.limits, "stamp": stamp });
        write_atomic(&dir.join("meta.json"), &serde_json::to_vec(&meta)?)?;
        write_atomic(&dir.join(format!("{start}.txt")), text.as_bytes())
    }

    fn journal_remove(&self, start: u64) {
        if let Some(dir) = &self.journal {
            let _ = std::fs::remove_file(dir.join(format!("{start}.txt")));
        }
    }

    fn journal_clear(&self) {
        if let Some(dir) = &self.journal {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    // ---- índice ----

    /// Constrói o índice numa thread (o arquivo já pode ser lido do começo enquanto isso).
    pub fn start_index(self: &Arc<Self>) {
        let me = Arc::clone(self);
        std::thread::spawn(move || me.index_blocking());
    }

    /// Para o índice e qualquer trabalho em andamento (ao fechar a aba).
    pub fn close(&self) {
        self.cancel.store(true, Ordering::Relaxed);
        self.save_cancel.store(true, Ordering::Relaxed);
    }

    /// Constrói o índice inteiro, publicando os lotes à medida que saem.
    pub fn index_blocking(&self) {
        if let Err(e) = self.index_inner() {
            if let Ok(mut g) = self.inner.write() {
                g.index_error = Some(e.to_string());
            }
        }
    }

    fn index_inner(&self) -> Result<()> {
        let (path, size) = {
            let g = self.read()?;
            (g.path.clone(), g.size)
        };
        let lim = self.limits;
        let utf8 = is_utf8(self.encoding);
        let mut f = File::open(&path).at(&path)?;
        f.seek(SeekFrom::Start(self.bom)).at(&path)?;
        let mut buf: Vec<u8> = Vec::new();
        let mut cur = Batch { start: self.bom, end: self.bom, nl: 0 };
        let mut pieces = 0usize;
        let mut chunk = vec![0u8; INDEX_CHUNK];
        let mut read_total = self.bom;
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let n = f.read(&mut chunk).at(&path)?;
            let eof = n == 0;
            buf.extend_from_slice(&chunk[..n]);
            read_total += n as u64;
            let mut done_batches: Vec<Batch> = Vec::new();
            let mut p = 0usize;
            while let Some(end) = next_piece(&buf, p, eof, lim.segment_bytes, utf8) {
                let len = (end - p) as u64;
                let final_unterminated = eof && end == buf.len() && buf[end - 1] != b'\n';
                if pieces > 0 && (pieces >= lim.batch_lines || (cur.end - cur.start) + len > lim.batch_bytes as u64) {
                    done_batches.push(cur);
                    cur = Batch { start: cur.end, end: cur.end, nl: 0 };
                    pieces = 0;
                }
                cur.end += len;
                pieces += 1;
                if !final_unterminated {
                    cur.nl += 1;
                }
                p = end;
            }
            buf.drain(..p);
            let mut g = self.write()?;
            g.batches.extend(done_batches);
            g.indexed_bytes = read_total;
            if eof {
                if pieces > 0 || g.batches.is_empty() {
                    g.batches.push(cur); // arquivo vazio: um lote vazio, para ter onde digitar
                }
                if cur.end != size {
                    // o arquivo mudou enquanto era indexado
                    g.index_error = Some("o arquivo mudou durante a leitura".into());
                }
                g.done = true;
                // alterações cujo lote não existe mais (arquivo diferente) não se aplicam
                let starts: Vec<u64> = g.batches.iter().map(|b| b.start).collect();
                if g.edits.keys().any(|k| !starts.contains(k)) {
                    g.edits.clear();
                    g.orphaned = true;
                }
                return Ok(());
            }
        }
    }

    pub fn info(&self) -> Result<Info> {
        let g = self.read()?;
        Ok(Info {
            size: g.size,
            encoding: self.encoding,
            eol: self.eol,
            batches: g.batches.len(),
            lines: g.total_lines(),
            done: g.done,
            indexed: g.indexed_bytes,
            edited_batches: g.edits.len(),
            orphaned: g.orphaned,
            error: g.index_error.clone(),
            path: g.path.clone(),
            save_done: self.save_done.load(Ordering::Relaxed),
            save_total: self.save_total.load(Ordering::Relaxed),
        })
    }

    /// Pede para o salvar em andamento parar (o temporário é apagado e o arquivo fica como está).
    pub fn cancel_save(&self) {
        self.save_cancel.store(true, Ordering::Relaxed);
    }

    pub fn path(&self) -> Result<PathBuf> {
        Ok(self.read()?.path.clone())
    }


    pub fn stamp(&self) -> Result<DiskStamp> {
        Ok(self.read()?.stamp)
    }

    pub fn is_dirty(&self) -> bool {
        self.read().map(|g| !g.edits.is_empty()).unwrap_or(false)
    }

    /// Situação do arquivo no disco em relação à última leitura ou gravação.
    pub fn check_disk(&self) -> Result<DiskState> {
        let g = self.read()?;
        check_stamp(&g.path, &g.stamp)
    }

    // ---- leitura ----

    fn raw(&self, g: &Inner, b: &Batch) -> Result<Vec<u8>> {
        let mut f = File::open(&g.path).at(&g.path)?;
        let len = f.metadata().at(&g.path)?.len();
        if len != g.size {
            return Err(Error::Conflict);
        }
        f.seek(SeekFrom::Start(b.start)).at(&g.path)?;
        let mut buf = vec![0u8; (b.end - b.start) as usize];
        f.read_exact(&mut buf).at(&g.path)?;
        Ok(buf)
    }

    fn display_of(&self, g: &Inner, b: &Batch) -> Result<(Display, bool)> {
        if let Some(e) = g.edits.get(&b.start) {
            let bytes = encode_chunk(&e.text, self.encoding, self.eol)?;
            return Ok((display_from_bytes(&bytes, false, self.encoding, &self.limits), true));
        }
        let raw = self.raw(g, b)?;
        let last = b.end >= g.size;
        Ok((display_from_bytes(&raw, !last, self.encoding, &self.limits), false))
    }

    /// Lê o lote `index`: o texto para o editor, com as alterações pendentes aplicadas.
    pub fn read_batch(&self, index: usize) -> Result<BatchOut> {
        let g = self.read()?;
        let b = *g.batches.get(index).ok_or_else(|| Error::Invalid("esse trecho do arquivo ainda não foi indexado".into()))?;
        let start_line: u64 = g.batches[..index].iter().map(|x| g.nl(x)).sum();
        let (d, edited) = self.display_of(&g, &b)?;
        let lines = d.text.matches('\n').count() as u64;
        Ok(BatchOut {
            index,
            start_line,
            lines,
            text: d.text,
            breaks: d.breaks,
            lossy: d.lossy,
            edited,
            count: g.batches.len(),
            done: g.done,
        })
    }

    /// Em que lote está a linha `line` (a partir de 0): a conta é só somar as linhas dos lotes.
    /// Depois do fim, vale o último lote. Linha que o índice ainda não alcançou: erro (tente de novo).
    pub fn locate(&self, line: u64) -> Result<Located> {
        let g = self.read()?;
        let mut acc = 0u64;
        for (i, b) in g.batches.iter().enumerate() {
            let nl = g.nl(b);
            if line < acc + nl {
                return Ok(Located { batch: i, start_line: acc });
            }
            if i + 1 == g.batches.len() {
                if g.done {
                    return Ok(Located { batch: i, start_line: acc });
                }
                break;
            }
            acc += nl;
        }
        Err(Error::Invalid("o índice ainda não chegou a essa linha".into()))
    }

    // ---- edição ----

    /// Guarda o texto novo do lote `index` (texto de arquivo: só `\n`, sem os cortes virtuais).
    /// Nada é gravado no arquivo do usuário; o diário em disco guarda a alteração. Se o texto voltou
    /// a ser o original, a alteração some.
    pub fn edit(&self, index: usize, text: &str) -> Result<EditOut> {
        if self.saving.load(Ordering::Relaxed) {
            return Err(Error::Invalid("salvando: espere o fim para editar".into()));
        }
        let mut g = self.write()?;
        if g.orphaned {
            return Err(Error::Conflict);
        }
        let b = *g.batches.get(index).ok_or_else(|| Error::Invalid("esse trecho do arquivo ainda não foi indexado".into()))?;
        if text.len() > self.limits.max_edit_bytes {
            return Err(Error::Invalid("o trecho editado é grande demais; divida em partes menores".into()));
        }
        let bytes = encode_chunk(text, self.encoding, self.eol)?;
        let raw = self.raw(&g, &b)?;
        let (orig, lossy) = file_text(&raw, self.encoding);
        if lossy {
            return Err(Error::Invalid("o trecho tem bytes inválidos para a codificação do arquivo: só leitura".into()));
        }
        if text == orig {
            if g.edits.remove(&b.start).is_some() {
                self.journal_remove(b.start);
            }
        } else {
            let nl = display_from_bytes(&bytes, false, self.encoding, &self.limits).text.matches('\n').count() as u64;
            self.journal_put(&g.stamp, b.start, text)?;
            g.edits.insert(b.start, Edit { text: text.to_string(), nl });
        }
        let lines = g.nl(&b);
        Ok(EditOut { edited: g.edits.contains_key(&b.start), lines, total_lines: g.total_lines(), dirty: !g.edits.is_empty() })
    }

    /// Descarta todas as alterações pendentes (e o diário).
    pub fn discard_edits(&self) -> Result<()> {
        if self.saving.load(Ordering::Relaxed) {
            return Err(Error::Invalid("salvando: espere o fim".into()));
        }
        let mut g = self.write()?;
        g.edits.clear();
        g.orphaned = false;
        self.journal_clear();
        Ok(())
    }

    // ---- salvar ----

    /// Grava as alterações: copia o original em fluxo, byte a byte, trocando só os lotes editados, para
    /// um temporário no mesmo diretório que depois é renomeado (nunca um arquivo pela metade). `dest`
    /// `None` grava no próprio arquivo, e aí recusa (`Error::Conflict`) se ele mudou fora do Fullpad
    /// desde que foi lido; um destino diferente ("Salvar como") não confere nada, o original fica
    /// intacto. Precisa do índice pronto e de espaço livre do tamanho do arquivo. Em geral o índice
    /// novo sai das contas do próprio salvar; se não (`info().done == false` depois), quem chamou
    /// manda refazê-lo com `start_index`.
    pub fn save(&self, dest: Option<&Path>) -> Result<DiskStamp> {
        if self.saving.swap(true, Ordering::AcqRel) {
            return Err(Error::Invalid("já há um salvar em andamento".into()));
        }
        self.save_cancel.store(false, Ordering::Relaxed);
        let r = self.save_inner(dest);
        self.save_done.store(0, Ordering::Relaxed);
        self.save_total.store(0, Ordering::Relaxed);
        self.saving.store(false, Ordering::Release);
        r
    }

    fn save_inner(&self, dest: Option<&Path>) -> Result<DiskStamp> {
        // fotografia do que importa, com o lock só pelo tempo de copiá-la: a cópia do arquivo (minutos,
        // num de 15 GB) roda sem lock, e as edições ficam recusadas enquanto salva (`saving`)
        let (src, size, stamp, batches, edits) = {
            let g = self.read()?;
            if !g.done {
                return Err(Error::Invalid("aguarde o fim da leitura do arquivo para salvar".into()));
            }
            if g.orphaned {
                return Err(Error::Conflict);
            }
            (g.path.clone(), g.size, g.stamp, g.batches.clone(), g.edits.clone())
        };
        let target = dest.map_or_else(|| src.clone(), Path::to_path_buf);
        match check_stamp(&src, &stamp)? {
            DiskState::Unchanged => {}
            // mesmo num "Salvar como", os lotes guardados não valem sobre um original que mudou
            DiskState::Changed => return Err(Error::Conflict),
            DiskState::Missing => return Err(Error::Invalid("o arquivo original sumiu: não há de onde copiar o resto".into())),
        }
        let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(dir).at(dir)?;
        self.save_total.store(size, Ordering::Relaxed);
        let tmp = tempfile::Builder::new().prefix(".tmp-").tempfile_in(dir).at(dir)?;
        let mut input = File::open(&src).at(&src)?;
        let mut out = std::io::BufWriter::with_capacity(1024 * 1024, tmp);
        let mut new_batches = Vec::with_capacity(batches.len());
        let mut pos = 0u64;
        // um lote editado que termina sem `\n`, ou que continua a linha do anterior, mexe nos cortes
        // virtuais de uma linha longa: aí o índice precisa ser refeito
        let mut reindex = false;
        let stopped = || self.save_cancel.load(Ordering::Relaxed) || self.cancel.load(Ordering::Relaxed);
        let copy = |input: &mut File, out: &mut dyn Write, from: u64, len: u64| -> Result<()> {
            input.seek(SeekFrom::Start(from)).at(&src)?;
            let mut buf = vec![0u8; 4 * 1024 * 1024];
            let mut left = len;
            while left > 0 {
                if stopped() {
                    return Err(Error::Invalid("salvar cancelado".into()));
                }
                let want = left.min(buf.len() as u64) as usize;
                let n = input.read(&mut buf[..want]).at(&src)?;
                if n == 0 {
                    return Err(Error::Conflict); // o arquivo encolheu durante a gravação
                }
                out.write_all(&buf[..n]).at(&target)?;
                left -= n as u64;
                self.save_done.fetch_add(n as u64, Ordering::Relaxed);
            }
            Ok(())
        };
        if self.bom > 0 {
            copy(&mut input, &mut out, 0, self.bom)?;
            pos = self.bom;
        }
        for b in &batches {
            let len = match edits.get(&b.start) {
                Some(e) => {
                    let bytes = encode_chunk(&e.text, self.encoding, self.eol)?;
                    out.write_all(&bytes).at(&target)?;
                    self.save_done.fetch_add(b.end - b.start, Ordering::Relaxed);
                    if bytes.last() != Some(&b'\n') && b.end < size {
                        reindex = true;
                    }
                    // o lote continua uma linha do anterior: o corte virtual no fim do anterior olha
                    // alguns bytes adiante, então mudar o começo deste pode mudá-lo
                    if b.start > self.bom && !reindex {
                        let mut prev = [0u8; 1];
                        input.seek(SeekFrom::Start(b.start - 1)).at(&src)?;
                        input.read_exact(&mut prev).at(&src)?;
                        if prev[0] != b'\n' {
                            reindex = true;
                        }
                    }
                    bytes.len() as u64
                }
                None => {
                    copy(&mut input, &mut out, b.start, b.end - b.start)?;
                    b.end - b.start
                }
            };
            let nl = edits.get(&b.start).map_or(b.nl, |e| e.nl);
            new_batches.push(Batch { start: pos, end: pos + len, nl });
            pos += len;
        }
        drop(input);
        if stopped() {
            return Err(Error::Invalid("salvar cancelado".into()));
        }
        out.flush().at(&target)?;
        let tmp = out.into_inner().map_err(|e| Error::Io { path: target.clone(), source: e.into_error() })?;
        tmp.as_file().sync_all().at(&target)?;
        tmp.persist(&target).map_err(|e| Error::Io { path: target.clone(), source: e.error })?;
        let new_stamp = stamp_large(&target)?.ok_or_else(|| Error::Invalid("o arquivo sumiu logo depois de gravar".into()))?;
        let mut g = self.write()?;
        g.path = target;
        g.size = pos;
        g.stamp = new_stamp;
        if reindex {
            g.batches.clear();
            g.indexed_bytes = self.bom;
            g.done = false;
        } else {
            g.batches = new_batches;
            g.indexed_bytes = pos;
        }
        g.edits.clear();
        self.journal_clear();
        Ok(new_stamp)
    }

    // ---- busca ----

    /// Procura `query` em todos os lotes, na ordem, com as alterações pendentes aplicadas. Os
    /// resultados saem aos poucos por `emit` (os de cada lote e quantos lotes já foram vistos) e
    /// `cancel` interrompe. Um resultado não atravessa a divisa de dois lotes nem um corte virtual.
    pub fn search(&self, query: &str, opts: &search::Options, cancel: &AtomicBool, max_hits: usize, emit: &mut dyn FnMut(&[Hit], usize)) -> Result<SearchEnd> {
        search::compile(query, opts).map_err(Error::Invalid)?;
        if query.is_empty() {
            return Ok(SearchEnd { total: 0, truncated: false, cancelled: false });
        }
        let count = {
            let g = self.read()?;
            if !g.done {
                return Err(Error::Invalid("aguarde o fim da leitura do arquivo para buscar".into()));
            }
            g.batches.len()
        };
        let (mut total, mut start_line) = (0usize, 0u64);
        for i in 0..count {
            if cancel.load(Ordering::Relaxed) || self.cancel.load(Ordering::Relaxed) {
                return Ok(SearchEnd { total, truncated: false, cancelled: true });
            }
            let (d, nl) = {
                let g = self.read()?;
                let b = g.batches[i];
                (self.display_of(&g, &b)?.0, g.nl(&b))
            };
            let room = max_hits.saturating_sub(total);
            let found = search::find_limited(&d.text, query, opts, None, room).map_err(Error::Invalid)?;
            let hits: Vec<Hit> = found
                .matches
                .iter()
                .map(|m| Hit {
                    line: start_line + (m.line as u64 - 1),
                    col: m.col - 1,
                    len: m.end - m.start,
                    preview: m.preview.clone(),
                    preview_start: m.preview_start,
                    preview_end: m.preview_end,
                })
                .collect();
            total += hits.len();
            emit(&hits, i + 1);
            if found.total > hits.len() || total >= max_hits {
                return Ok(SearchEnd { total, truncated: true, cancelled: false });
            }
            start_line += nl;
        }
        Ok(SearchEnd { total, truncated: false, cancelled: false })
    }
}

#[cfg(test)]
mod tests;
