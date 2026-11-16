//! A tabela de um CSV de arquivo grande (`large.rs`): as linhas do CSV lidas **por faixas do disco**.
//!
//! O CSV comum (`csv.rs`) indexa o texto inteiro na memória. Aqui o arquivo nunca é lido inteiro de uma vez:
//! uma varredura em segundo plano acha o começo de cada **registro** (uma linha do CSV, que pode ocupar várias
//! linhas do arquivo se uma célula entre aspas tem quebra de linha) com o mesmo tokenizador do `csv.rs`, e
//! guarda só um ponto de partida a cada `step` registros. Pedir as linhas `[from, from + count)` é ir ao
//! ponto de partida mais próximo, ler um pedaço do arquivo dali e deixar o próprio `Csv::parse` ler as
//! células; então nenhuma regra do CSV (aspas, `""`, terminadores, células cortadas) é reescrita.
//!
//! A tabela mostra **o arquivo salvo**: as alterações pendentes do texto (`Large`) ainda não estão nele, e
//! o índice vale para o arquivo como foi lido. Qualquer mudança de data ou tamanho no disco faz as
//! leituras recusarem (a UI recarrega). Só leitura: ordenar, filtrar e editar pela tabela ficam de fora.

use crate::csv::{self, scan_record, Cell, ColType, Csv, RowOut, Stats};
use crate::disk::{DiskState, DiskStamp};
use crate::error::{Error, IoContext, Result};
use crate::large::{check_stamp, stamp_large, Large};
use crate::model::Encoding;
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

/// Um registro maior que isto não cabe na leitura: a varredura para com um erro (um CSV de uma linha só de
/// centenas de MB não é uma tabela).
const MAX_RECORD: usize = 256 * 1024 * 1024;
/// Teto de um pedaço lido para montar uma faixa de linhas.
const MAX_SLICE: usize = 64 * 1024 * 1024;
/// Linhas de dados por pedaço das estatísticas.
const STATS_BLOCK: usize = 2_000;
/// Teto de linhas de uma seleção para as estatísticas.
pub const MAX_STATS_ROWS: usize = 200_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CsvLimits {
    /// A cada quantos registros guardar um ponto de partida.
    pub step: usize,
    /// Quanto do arquivo a varredura lê por vez.
    pub scan_chunk: usize,
    /// Tamanho do primeiro pedaço lido para uma faixa (cresce se faltar).
    pub slice: usize,
}

impl Default for CsvLimits {
    fn default() -> Self {
        Self { step: 1024, scan_chunk: 8 * 1024 * 1024, slice: 256 * 1024 }
    }
}

struct Index {
    /// `checkpoints[k]`: byte em que começa o registro `k * step`.
    checkpoints: Vec<u64>,
    /// Registros achados até agora (com o cabeçalho, se há).
    records: u64,
    cols: usize,
    unterminated: bool,
    done: bool,
    /// Bytes que a varredura já percorreu.
    scanned: u64,
    error: Option<String>,
}

/// O que a UI precisa para montar a tabela (o mesmo formato de `CsvInfo` do CSV comum, mais o progresso).
#[derive(Debug, Clone, Serialize)]
pub struct Summary {
    /// Linhas de dados (sem o cabeçalho). Sem filtro, `rows == total`.
    pub rows: u64,
    pub total: u64,
    pub cols: usize,
    pub delimiter: String,
    pub unterminated: bool,
    pub types: Vec<ColType>,
    pub header: Option<RowOut>,
    /// A varredura terminou: `rows` é definitivo (senão é "pelo menos isto").
    pub done: bool,
    pub scanned: u64,
    pub size: u64,
    pub error: Option<String>,
}

pub struct LargeCsv {
    path: PathBuf,
    encoding: Encoding,
    bom: u64,
    size: u64,
    stamp: DiskStamp,
    delim: u8,
    header: bool,
    decimal: char,
    limits: CsvLimits,
    cancel: AtomicBool,
    types: Vec<ColType>,
    head: Option<RowOut>,
    index: RwLock<Index>,
}

fn decode(bytes: &[u8], enc: Encoding) -> String {
    match enc {
        Encoding::Windows1252 => encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes).0.into_owned(),
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn poisoned<T>(_: T) -> Error {
    Error::Invalid("estado interno da tabela indisponível".into())
}

impl LargeCsv {
    /// Abre a tabela do arquivo de `large` (caminho, codificação e BOM vêm dele). `delimiter` `None`: detecta
    /// pelo começo do arquivo (`ext`: `tsv` manda no tab). Lê só o começo; a varredura é `start_index`.
    pub fn open(large: &Large, delimiter: Option<char>, header: bool, decimal: char, ext: Option<&str>, limits: CsvLimits) -> Result<Arc<Self>> {
        let path = large.path()?;
        Self::open_path(&path, large.encoding, large.bom(), delimiter, header, decimal, ext, limits)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn open_path(path: &Path, encoding: Encoding, bom: u64, delimiter: Option<char>, header: bool, decimal: char, ext: Option<&str>, limits: CsvLimits) -> Result<Arc<Self>> {
        let stamp = stamp_large(path)?.ok_or_else(|| Error::Invalid("arquivo não encontrado".into()))?;
        let limits = CsvLimits { step: limits.step.max(1), scan_chunk: limits.scan_chunk.max(16), slice: limits.slice.max(16) };
        let mut me = LargeCsv {
            path: path.to_path_buf(),
            encoding,
            bom,
            size: stamp.size,
            stamp,
            delim: b',',
            header,
            decimal,
            limits,
            cancel: AtomicBool::new(false),
            types: Vec::new(),
            head: None,
            index: RwLock::new(Index { checkpoints: vec![bom], records: 0, cols: 0, unterminated: false, done: false, scanned: bom, error: None }),
        };
        // o separador e os tipos saem do começo do arquivo (não dependem de varrer o resto)
        let head_text = decode(&me.read_at(bom, 256 * 1024)?.0, encoding);
        let delim = delimiter.filter(|&c| csv::valid_delimiter(c)).unwrap_or_else(|| csv::detect(&head_text, ext));
        me.delim = if csv::valid_delimiter(delim) { delim as u8 } else { b',' };
        let sample = Csv::parse(head_text, me.delim as char);
        me.types = sample.column_types(header, decimal);
        me.head = if header { sample.rows(0, 1).into_iter().next().map(strip_positions) } else { None };
        if let Ok(mut ix) = me.index.write() {
            ix.cols = sample.cols();
        }
        Ok(Arc::new(me))
    }

    fn read_at(&self, from: u64, len: usize) -> Result<(Vec<u8>, bool)> {
        let mut f = File::open(&self.path).at(&self.path)?;
        f.seek(SeekFrom::Start(from)).at(&self.path)?;
        let want = len.min(self.size.saturating_sub(from) as usize);
        let mut buf = vec![0u8; want];
        f.read_exact(&mut buf).at(&self.path)?;
        Ok((buf, from + want as u64 >= self.size))
    }

    fn guard(&self) -> Result<()> {
        match check_stamp(&self.path, &self.stamp)? {
            DiskState::Unchanged => Ok(()),
            _ => Err(Error::Invalid("o arquivo mudou no disco: recarregue a tabela".into())),
        }
    }

    // ---- índice ----

    pub fn start_index(self: &Arc<Self>) {
        let me = Arc::clone(self);
        std::thread::spawn(move || me.index_blocking());
    }

    pub fn close(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }

    pub fn index_blocking(&self) {
        if let Err(e) = self.scan() {
            if let Ok(mut ix) = self.index.write() {
                ix.error = Some(e.to_string());
            }
        }
    }

    fn scan(&self) -> Result<()> {
        let mut f = File::open(&self.path).at(&self.path)?;
        f.seek(SeekFrom::Start(self.bom)).at(&self.path)?;
        let step = self.limits.step as u64;
        let mut buf: Vec<u8> = Vec::new();
        let mut base = self.bom; // posição, no arquivo, de buf[0]
        let mut chunk = vec![0u8; self.limits.scan_chunk];
        let (mut records, mut cols, mut unterminated) = (0u64, 0usize, false);
        let mut found: Vec<u64> = Vec::new();
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                return Ok(());
            }
            let n = f.read(&mut chunk).at(&self.path)?;
            let eof = n == 0;
            buf.extend_from_slice(&chunk[..n]);
            let mut pos = 0usize;
            while pos < buf.len() {
                let rec = scan_record(&buf, pos, self.delim);
                // o registro pode continuar no próximo pedaço (aspa aberta, ou sem terminador ainda)
                if !eof && rec.next >= buf.len() {
                    break;
                }
                cols = cols.max(rec.cells as usize);
                unterminated |= rec.open;
                records += 1;
                pos = rec.next;
                if records % step == 0 {
                    found.push(base + pos as u64);
                }
            }
            if !eof && pos == 0 && buf.len() > MAX_RECORD {
                return Err(Error::Invalid("um registro do CSV passa de 256 MB: não dá para montar a tabela".into()));
            }
            buf.drain(..pos);
            base += pos as u64;
            let mut ix = self.index.write().map_err(poisoned)?;
            ix.checkpoints.append(&mut found);
            ix.records = records;
            ix.cols = ix.cols.max(cols);
            ix.unterminated = unterminated;
            ix.scanned = base + buf.len() as u64;
            if eof {
                ix.done = true;
                return Ok(());
            }
        }
    }

    /// O que se sabe da tabela agora (enquanto a varredura corre, `rows` é "pelo menos isto").
    pub fn summary(&self) -> Result<Summary> {
        let ix = self.index.read().map_err(poisoned)?;
        let rows = ix.records.saturating_sub(self.header as u64);
        Ok(Summary {
            rows,
            total: rows,
            cols: ix.cols,
            delimiter: (self.delim as char).to_string(),
            unterminated: ix.unterminated,
            types: self.types.clone(),
            header: self.head.clone(),
            done: ix.done,
            scanned: ix.scanned,
            size: self.size,
            error: ix.error.clone(),
        })
    }

    // ---- leitura por faixas ----

    /// O pedaço do arquivo que contém os registros `[file_from, file_from + count)`, já lido pelo `Csv::parse`.
    /// Devolve o `Csv`, quantos registros do pedaço ficam antes de `file_from` e o índice (no arquivo) do primeiro.
    fn slice(&self, file_from: u64, count: usize) -> Result<Option<(Csv, usize, u64)>> {
        self.guard()?;
        let (start, skip, first) = {
            let ix = self.index.read().map_err(poisoned)?;
            if file_from >= ix.records {
                return Ok(None);
            }
            let k = (file_from / self.limits.step as u64) as usize;
            let skip = (file_from - k as u64 * self.limits.step as u64) as usize;
            (ix.checkpoints[k], skip, k as u64 * self.limits.step as u64)
        };
        let want = skip + count;
        let mut size = self.limits.slice;
        loop {
            let (bytes, eof) = self.read_at(start, size)?;
            let csv = Csv::parse(decode(&bytes, self.encoding), self.delim as char);
            // sem chegar ao fim do arquivo, o último registro do pedaço pode estar cortado
            let usable = if eof { csv.row_count() } else { csv.row_count().saturating_sub(1) };
            if usable >= want || eof || size >= MAX_SLICE {
                return Ok(Some((csv, skip, first)));
            }
            size = (size * 4).min(MAX_SLICE);
        }
    }

    /// Linhas de **dados** `[from, from + count)` (o cabeçalho, se há, não conta), com `index` = o registro no arquivo.
    pub fn rows(&self, from: usize, count: usize) -> Result<Vec<RowOut>> {
        let file_from = from as u64 + self.header as u64;
        let Some((csv, skip, first)) = self.slice(file_from, count)? else { return Ok(Vec::new()) };
        Ok(csv
            .rows(skip, count)
            .into_iter()
            .map(|mut r| {
                r.index = (first + skip as u64) as usize + (r.index - skip);
                strip_positions(r)
            })
            .collect())
    }

    /// A célula inteira (`rows` corta as muito grandes).
    pub fn cell(&self, row: usize, col: usize) -> Result<Option<Cell>> {
        let file_from = row as u64 + self.header as u64;
        let Some((csv, skip, _)) = self.slice(file_from, 1)? else { return Ok(None) };
        Ok(csv.cell(skip, col))
    }

    /// Estatísticas das células `[r0, r1) × [c0, c1)` (linhas de dados), em blocos, sem guardar o arquivo.
    pub fn stats(&self, r0: usize, r1: usize, c0: usize, c1: usize) -> Result<Stats> {
        if r1.saturating_sub(r0) > MAX_STATS_ROWS {
            return Err(Error::Invalid(format!("seleção grande demais para as estatísticas (até {MAX_STATS_ROWS} linhas)")));
        }
        let mut all = Stats::default();
        let mut at = r0;
        while at < r1 {
            if self.cancel.load(Ordering::Relaxed) {
                break;
            }
            let n = STATS_BLOCK.min(r1 - at);
            let Some((csv, skip, _)) = self.slice(at as u64 + self.header as u64, n)? else { break };
            let s = csv.stats(skip..skip + n, c0..c1, self.decimal);
            all.count += s.count;
            all.numeric += s.numeric;
            all.skipped += s.skipped;
            all.sum += s.sum;
            all.min = match (all.min, s.min) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
            all.max = match (all.max, s.max) {
                (Some(a), Some(b)) => Some(a.max(b)),
                (a, b) => a.or(b),
            };
            at += n;
        }
        if all.numeric > 0 {
            all.avg = Some(all.sum / all.numeric as f64);
        }
        Ok(all)
    }
}

/// As posições (UTF-16) de `RowOut` são do pedaço lido, não do arquivo: a tabela de arquivo grande não as usa.
fn strip_positions(mut r: RowOut) -> RowOut {
    r.from = 0;
    r.to = 0;
    for c in &mut r.cells {
        c.from = 0;
        c.to = 0;
    }
    r
}

#[cfg(test)]
mod tests;
