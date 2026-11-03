//! CSV/TSV: leitura por faixas com posições em UTF-16, detecção do separador, tipo e estatísticas
//! por coluna, e a escrita de uma célula que não toca em mais nenhum byte do arquivo. Sem UI.
//!
//! O texto é a única fonte. O parser nunca falha nem normaliza: aspas desbalanceadas, linhas com
//! colunas a mais ou a menos, quebras de linha misturadas, tudo vira uma tabela (às vezes torta)
//! e continua editável. Só o *índice de linhas* é guardado (início, fim e quantidade de células de
//! cada registro); as células de uma faixa são lidas de novo do texto quando a UI as pede, então a
//! memória cresce com as linhas, não com as células.
//!
//! Todas as posições devolvidas à UI são em unidades UTF-16 (as do CodeMirror); os byte offsets
//! (`bfrom`/`bto`) ficam no Rust.
//!
//! Dialeto: registros terminam em `\n`, `\r\n` ou `\r` fora de aspas; um campo só é "entre aspas"
//! se abre com `"` logo depois do separador ou do começo do registro; `""` dentro de aspas é uma
//! aspa; depois da aspa que fecha, o que sobrar até o separador entra no valor como está; aspas no
//! meio de um campo sem aspas são texto. O separador é um caractere ASCII.

use serde::{Deserialize, Serialize};

/// Acima disso (em caracteres) a UI não liga a visão de tabela (o editor continua normal).
pub const MAX_CHARS: usize = 50_000_000;
/// Valor de uma célula devolvido em `rows` (maiores são cortados; o texto inteiro fica no editor).
const MAX_TEXT: usize = 2_000;
/// Linhas olhadas para decidir o tipo de cada coluna.
const TYPE_SAMPLE: usize = 1_000;
/// Registros (não vazios) olhados para detectar o separador.
const DETECT_SAMPLE: usize = 20;

pub const DEFAULT_DELIMITER: char = ',';
/// Candidatos da detecção, do mais raro em texto comum ao mais comum: em empate, vence o primeiro.
const CANDIDATES: [char; 4] = ['\t', ';', '|', ','];

/// O separador precisa ser um caractere ASCII que não seja aspa nem quebra de linha.
pub fn valid_delimiter(c: char) -> bool {
    c.is_ascii() && c != '"' && c != '\n' && c != '\r' && (c == '\t' || !c.is_ascii_control())
}

fn utf16_len(s: &str) -> usize {
    if s.is_ascii() { s.len() } else { s.chars().map(char::len_utf16).sum() }
}

/// Um registro encontrado pela varredura.
struct Rec {
    /// Fim do registro, sem o terminador.
    end: usize,
    /// Onde começa o próximo (depois do terminador).
    next: usize,
    cells: u32,
    /// Terminou o texto com uma aspa ainda aberta.
    open: bool,
}

fn scan_record(b: &[u8], start: usize, delim: u8) -> Rec {
    let n = b.len();
    let mut i = start;
    let mut cells = 1u32;
    let mut at_start = true;
    let mut in_q = false;
    while i < n {
        let c = b[i];
        if in_q {
            if c == b'"' {
                if i + 1 < n && b[i + 1] == b'"' {
                    i += 2;
                } else {
                    in_q = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }
        if c == delim {
            cells += 1;
            at_start = true;
            i += 1;
        } else if c == b'"' && at_start {
            in_q = true;
            at_start = false;
            i += 1;
        } else if c == b'\n' {
            return Rec { end: i, next: i + 1, cells, open: false };
        } else if c == b'\r' {
            let next = if i + 1 < n && b[i + 1] == b'\n' { i + 2 } else { i + 1 };
            return Rec { end: i, next, cells, open: false };
        } else {
            at_start = false;
            i += 1;
        }
    }
    Rec { end: n, next: n, cells, open: in_q }
}

fn bom_len(text: &str) -> usize {
    if text.starts_with('\u{FEFF}') { '\u{FEFF}'.len_utf8() } else { 0 }
}

/// Escolhe o separador pela estrutura: para cada candidato conta quantos aparecem (fora das aspas)
/// em cada um dos primeiros registros; vale o que tem a mesma contagem, maior que zero, no
/// cabeçalho e em pelo menos 80% dos registros olhados. Empata pela contagem maior e depois pela
/// ordem de [`CANDIDATES`]. Sem candidato consistente, vírgula. `ext` (`"tsv"`) manda no tab.
pub fn detect(text: &str, ext: Option<&str>) -> char {
    if ext.is_some_and(|e| e.eq_ignore_ascii_case("tsv") || e.eq_ignore_ascii_case("tab")) {
        return '\t';
    }
    let b = text.as_bytes();
    let mut best: Option<(usize, u32, usize)> = None; // (% de registros iguais, contagem, -prioridade)
    let mut pick = DEFAULT_DELIMITER;
    for (prio, cand) in CANDIDATES.iter().enumerate() {
        let mut counts: Vec<u32> = Vec::new();
        let mut pos = bom_len(text);
        while pos < b.len() && counts.len() < DETECT_SAMPLE {
            let rec = scan_record(b, pos, *cand as u8);
            if rec.end > pos {
                counts.push(rec.cells - 1);
            }
            pos = rec.next;
        }
        let Some(&first) = counts.first() else { continue };
        if first == 0 {
            continue;
        }
        let same = counts.iter().filter(|c| **c == first).count();
        let pct = same * 100 / counts.len();
        if pct < 80 {
            continue;
        }
        let key = (pct, first, usize::MAX - prio);
        if best.is_none_or(|b| key > b) {
            best = Some(key);
            pick = *cand;
        }
    }
    pick
}

#[derive(Debug, Clone, Copy)]
struct Row {
    start: usize,
    start16: usize,
    end: usize,
    cells: u32,
}

/// Uma célula. `from`/`to` cobrem o texto como está no arquivo (aspas incluídas).
#[derive(Debug, Clone, Serialize)]
pub struct Cell {
    pub from: usize,
    pub to: usize,
    #[serde(skip)]
    pub bfrom: usize,
    #[serde(skip)]
    pub bto: usize,
    /// Valor decodificado (sem as aspas de fora, `""` virou `"`).
    pub value: String,
    /// `value` foi cortado (só em `rows`; `cell` devolve inteiro).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cut: bool,
    /// O campo estava entre aspas no arquivo.
    pub quoted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RowOut {
    pub index: usize,
    /// Início e fim do registro no texto (UTF-16), sem o terminador.
    pub from: usize,
    pub to: usize,
    pub cells: Vec<Cell>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct CellPos {
    pub row: usize,
    pub col: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ColType {
    /// Nenhuma célula preenchida na amostra.
    Empty,
    Number,
    Date,
    Text,
}

/// O que trocar no texto para gravar uma célula. Tudo fora de `[from, to)` fica como está.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CellEdit {
    pub from: usize,
    pub to: usize,
    #[serde(skip)]
    pub bfrom: usize,
    #[serde(skip)]
    pub bto: usize,
    pub insert: String,
}

impl CellEdit {
    /// Aplica a troca a um texto (o mesmo de onde ela saiu).
    pub fn apply_to(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len() + self.insert.len());
        out.push_str(&text[..self.bfrom]);
        out.push_str(&self.insert);
        out.push_str(&text[self.bto..]);
        out
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Stats {
    /// Células preenchidas (não vazias).
    pub count: usize,
    /// Das preenchidas, as que são número no formato escolhido.
    pub numeric: usize,
    /// Preenchidas que não são número: ficam fora da conta.
    pub skipped: usize,
    pub sum: f64,
    pub avg: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

/// Ordem da visão: por uma coluna, crescente ou decrescente. Célula vazia vai sempre para o fim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct Sort {
    pub col: usize,
    #[serde(default)]
    pub desc: bool,
}

/// Filtro da visão: linhas em que a célula contém `text` (sem diferenciar maiúscula nem acento).
/// `col` vazio olha todas as colunas.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Filter {
    #[serde(default)]
    pub col: Option<usize>,
    pub text: String,
}

/// Minúscula e sem acento (latinos comuns), para comparar texto como o usuário espera.
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à'..='å' => 'a',
            'ç' => 'c',
            'è'..='ë' => 'e',
            'ì'..='ï' => 'i',
            'ñ' => 'n',
            'ò'..='ö' | 'ø' => 'o',
            'ù'..='ü' => 'u',
            'ý' | 'ÿ' => 'y',
            c => c,
        })
        .collect()
}

#[derive(Debug, Clone)]
pub struct Csv {
    text: String,
    delim: u8,
    rows: Vec<Row>,
    max_cols: usize,
    unterminated: bool,
}

impl Csv {
    /// Indexa as linhas de `text`. `delim` inválido (não ASCII, aspa, quebra de linha) vira vírgula.
    pub fn parse(text: String, delim: char) -> Csv {
        let delim = if valid_delimiter(delim) { delim as u8 } else { DEFAULT_DELIMITER as u8 };
        let b = text.as_bytes();
        let mut rows = Vec::new();
        let mut max_cols = 0usize;
        let mut unterminated = false;
        let mut pos = bom_len(&text);
        let mut pos16 = if pos > 0 { 1 } else { 0 };
        while pos < b.len() {
            let rec = scan_record(b, pos, delim);
            rows.push(Row { start: pos, start16: pos16, end: rec.end, cells: rec.cells });
            max_cols = max_cols.max(rec.cells as usize);
            unterminated |= rec.open;
            pos16 += utf16_len(&text[pos..rec.next]);
            pos = rec.next;
        }
        Csv { text, delim, rows, max_cols, unterminated }
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn delimiter(&self) -> char {
        self.delim as char
    }

    pub fn row_count(&self) -> usize {
        self.rows.len()
    }

    /// Maior quantidade de células em uma linha.
    pub fn cols(&self) -> usize {
        self.max_cols
    }

    /// O texto acaba com uma aspa aberta (o último campo vai até o fim).
    pub fn unterminated(&self) -> bool {
        self.unterminated
    }

    /// Células de uma linha, com valores inteiros.
    fn parse_cells(&self, ri: usize) -> Vec<Cell> {
        let row = self.rows[ri];
        let b = self.text.as_bytes();
        let e = row.end;
        let mut out = Vec::with_capacity(row.cells as usize);
        let mut p16 = row.start16;
        let mut i = row.start;
        loop {
            let fs = i;
            let (raw_end, value, quoted);
            if i < e && b[i] == b'"' {
                quoted = true;
                let mut val: Vec<u8> = Vec::new();
                let mut j = i + 1;
                let mut closed = false;
                while j < e {
                    if b[j] == b'"' {
                        if j + 1 < e && b[j + 1] == b'"' {
                            val.push(b'"');
                            j += 2;
                        } else {
                            j += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        val.push(b[j]);
                        j += 1;
                    }
                }
                if closed {
                    let mut k = j;
                    while k < e && b[k] != self.delim {
                        k += 1;
                    }
                    val.extend_from_slice(&b[j..k]);
                    raw_end = k;
                } else {
                    raw_end = e;
                }
                value = String::from_utf8_lossy(&val).into_owned();
            } else {
                quoted = false;
                let mut k = i;
                while k < e && b[k] != self.delim {
                    k += 1;
                }
                raw_end = k;
                value = self.text[i..k].to_string();
            }
            let from = p16;
            let to = from + utf16_len(&self.text[fs..raw_end]);
            out.push(Cell { from, to, bfrom: fs, bto: raw_end, value, cut: false, quoted });
            p16 = to;
            if raw_end < e {
                p16 += 1; // o separador (ASCII)
                i = raw_end + 1;
            } else {
                break;
            }
        }
        out
    }

    /// Linhas `[from, from + count)` com as células já cortadas em [`MAX_TEXT`] caracteres.
    pub fn rows(&self, from: usize, count: usize) -> Vec<RowOut> {
        let end = from.saturating_add(count).min(self.rows.len());
        (from.min(end)..end)
            .map(|ri| {
                let mut cells = self.parse_cells(ri);
                for c in &mut cells {
                    if c.value.len() > MAX_TEXT && c.value.chars().count() > MAX_TEXT {
                        c.value = c.value.chars().take(MAX_TEXT).collect();
                        c.cut = true;
                    }
                }
                let to = cells.last().map_or(self.rows[ri].start16, |c| c.to);
                RowOut { index: ri, from: self.rows[ri].start16, to, cells }
            })
            .collect()
    }

    /// As linhas de dados (a primeira fica de fora se for cabeçalho) na ordem da visão, como índices
    /// de linha do arquivo: filtradas e depois ordenadas. Sem filtro nem ordem, é a ordem do arquivo.
    /// O texto não muda: a visão é só uma lista de índices.
    pub fn view(&self, header: bool, decimal: char, sort: Option<Sort>, filter: Option<&Filter>) -> Vec<u32> {
        let first = header as usize;
        let needle = filter.map(|f| fold(&f.text)).filter(|n| !n.is_empty());
        let mut keep: Vec<u32> = Vec::with_capacity(self.rows.len().saturating_sub(first));
        for ri in first..self.rows.len() {
            if let (Some(f), Some(n)) = (filter, &needle) {
                let cells = self.parse_cells(ri);
                let hit = match f.col {
                    Some(c) => cells.get(c).is_some_and(|x| fold(&x.value).contains(n.as_str())),
                    None => cells.iter().any(|x| fold(&x.value).contains(n.as_str())),
                };
                if !hit {
                    continue;
                }
            }
            keep.push(ri as u32);
        }
        let Some(sort) = sort else { return keep };
        let vals: Vec<String> = keep
            .iter()
            .map(|&ri| self.parse_cells(ri as usize).into_iter().nth(sort.col).map(|c| c.value.trim().to_string()).unwrap_or_default())
            .collect();
        // coluna só de números (ou vazios) ordena como número; senão, como texto sem acento
        let nums: Option<Vec<Option<f64>>> = vals
            .iter()
            .map(|v| if v.is_empty() { Some(None) } else { parse_number(v, decimal).map(Some) })
            .collect();
        let mut order: Vec<usize> = (0..keep.len()).collect();
        match nums {
            Some(n) => order.sort_by(|&a, &b| match (n[a], n[b]) {
                (None, None) => std::cmp::Ordering::Equal,
                (None, _) => std::cmp::Ordering::Greater,
                (_, None) => std::cmp::Ordering::Less,
                (Some(x), Some(y)) => {
                    let o = x.total_cmp(&y);
                    if sort.desc { o.reverse() } else { o }
                }
            }),
            None => {
                let folded: Vec<String> = vals.iter().map(|v| fold(v)).collect();
                order.sort_by(|&a, &b| match (vals[a].is_empty(), vals[b].is_empty()) {
                    (true, true) => std::cmp::Ordering::Equal,
                    (true, false) => std::cmp::Ordering::Greater,
                    (false, true) => std::cmp::Ordering::Less,
                    (false, false) => {
                        let o = folded[a].cmp(&folded[b]);
                        if sort.desc { o.reverse() } else { o }
                    }
                });
            }
        }
        order.into_iter().map(|i| keep[i]).collect()
    }

    /// As linhas pedidas por índice (na ordem dada), com as células cortadas como em [`Csv::rows`].
    pub fn rows_at(&self, idx: &[u32]) -> Vec<RowOut> {
        idx.iter().filter(|&&i| (i as usize) < self.rows.len()).map(|&i| self.rows(i as usize, 1).remove(0)).collect()
    }

    /// Uma célula com o valor inteiro.
    pub fn cell(&self, row: usize, col: usize) -> Option<Cell> {
        if row >= self.rows.len() {
            return None;
        }
        self.parse_cells(row).into_iter().nth(col)
    }

    /// A célula sob uma posição do texto (UTF-16). Antes do primeiro registro é a primeira célula;
    /// no terminador de uma linha é a última dela.
    pub fn cell_at(&self, pos: usize) -> Option<CellPos> {
        if self.rows.is_empty() {
            return None;
        }
        let ri = self.rows.partition_point(|r| r.start16 <= pos).saturating_sub(1);
        let cells = self.parse_cells(ri);
        let col = cells.iter().rposition(|c| c.from <= pos).unwrap_or(0);
        Some(CellPos { row: ri, col })
    }

    /// Tipo de cada coluna, olhando as primeiras linhas (a primeira é pulada se for cabeçalho).
    /// Número e data só valem se **todas** as células preenchidas da amostra são.
    pub fn column_types(&self, header: bool, decimal: char) -> Vec<ColType> {
        let n = self.max_cols;
        let mut any = vec![false; n];
        let mut num = vec![true; n];
        let mut date = vec![true; n];
        let first = header as usize;
        for ri in first..self.rows.len().min(first + TYPE_SAMPLE) {
            for (ci, c) in self.parse_cells(ri).iter().enumerate() {
                let v = c.value.trim();
                if v.is_empty() {
                    continue;
                }
                any[ci] = true;
                if num[ci] && parse_number(v, decimal).is_none() {
                    num[ci] = false;
                }
                if date[ci] && !is_date(v) {
                    date[ci] = false;
                }
            }
        }
        (0..n)
            .map(|i| {
                if !any[i] {
                    ColType::Empty
                } else if num[i] {
                    ColType::Number
                } else if date[i] {
                    ColType::Date
                } else {
                    ColType::Text
                }
            })
            .collect()
    }

    /// Estatísticas das células das `rows` indicadas (índices de linha, na ordem que a UI quiser:
    /// serve para a coluna inteira, para uma seleção e para uma visão filtrada) nas colunas `cols`.
    pub fn stats(&self, rows: impl IntoIterator<Item = usize>, cols: std::ops::Range<usize>, decimal: char) -> Stats {
        let mut st = Stats::default();
        for ri in rows {
            if ri >= self.rows.len() {
                continue;
            }
            for (ci, c) in self.parse_cells(ri).iter().enumerate() {
                if !cols.contains(&ci) {
                    continue;
                }
                let v = c.value.trim();
                if v.is_empty() {
                    continue;
                }
                st.count += 1;
                match parse_number(v, decimal) {
                    Some(x) => {
                        st.numeric += 1;
                        st.sum += x;
                        st.min = Some(st.min.map_or(x, |m| m.min(x)));
                        st.max = Some(st.max.map_or(x, |m| m.max(x)));
                    }
                    None => st.skipped += 1,
                }
            }
        }
        if st.numeric > 0 {
            st.avg = Some(st.sum / st.numeric as f64);
        }
        st
    }

    /// A troca que grava `value` na célula (`row`, `col`). Só essa célula muda:
    /// - já entre aspas, continua entre aspas;
    /// - sem aspas, só ganha se o valor tem separador, aspa ou quebra de linha (`"` vira `""`);
    /// - coluna depois do fim da linha: acrescenta os separadores que faltam no fim dela.
    ///
    /// `None` se a linha não existe.
    pub fn edit_cell(&self, row: usize, col: usize, value: &str) -> Option<CellEdit> {
        if row >= self.rows.len() {
            return None;
        }
        let cells = self.parse_cells(row);
        let delim = self.delim as char;
        if let Some(c) = cells.get(col) {
            return Some(CellEdit {
                from: c.from,
                to: c.to,
                bfrom: c.bfrom,
                bto: c.bto,
                insert: encode(value, c.quoted, delim),
            });
        }
        let last = cells.last().expect("toda linha tem ao menos uma célula");
        let missing = col + 1 - cells.len();
        let mut insert = delim.to_string().repeat(missing);
        insert.push_str(&encode(value, false, delim));
        Some(CellEdit { from: last.to, to: last.to, bfrom: last.bto, bto: last.bto, insert })
    }
}

impl Csv {
    /// Várias células de uma vez, todas em coordenadas do texto **de antes** (servem juntas numa só
    /// transação do editor: um passo no desfazer). Mesma regra de aspas de [`Csv::edit_cell`], com duas
    /// diferenças: a mesma célula repetida vale pela última, e uma célula além do fim da linha com
    /// valor vazio não faz nada (apagar não cria separadores). As células de uma linha que passam do
    /// fim viram uma troca só, no fim dela. Linhas além da última viram linhas novas no fim do arquivo (colar passando do fim; até 20 mil). Sai em ordem de texto.
    pub fn edit_cells(&self, edits: &[(usize, usize, &str)]) -> Vec<CellEdit> {
        let mut by_row: std::collections::BTreeMap<usize, std::collections::BTreeMap<usize, &str>> = Default::default();
        let mut new_rows: std::collections::BTreeMap<usize, std::collections::BTreeMap<usize, &str>> = Default::default();
        for &(r, c, v) in edits {
            if r < self.rows.len() {
                by_row.entry(r).or_default().insert(c, v);
            } else if r < self.rows.len() + MAX_NEW_ROWS {
                new_rows.entry(r).or_default().insert(c, v);
            }
        }
        let delim = self.delim as char;
        let mut out = Vec::new();
        for (r, cols) in by_row {
            let cells = self.parse_cells(r);
            let mut beyond: std::collections::BTreeMap<usize, &str> = Default::default();
            for (c, v) in cols {
                match cells.get(c) {
                    Some(cell) => out.push(CellEdit {
                        from: cell.from,
                        to: cell.to,
                        bfrom: cell.bfrom,
                        bto: cell.bto,
                        insert: encode(v, cell.quoted, delim),
                    }),
                    None if !v.is_empty() => {
                        beyond.insert(c, v);
                    }
                    None => {}
                }
            }
            if let Some((&last_col, _)) = beyond.iter().next_back() {
                let end = cells.last().expect("toda linha tem ao menos uma célula");
                let mut insert = String::new();
                for c in cells.len()..=last_col {
                    insert.push(delim);
                    if let Some(v) = beyond.get(&c) {
                        insert.push_str(&encode(v, false, delim));
                    }
                }
                out.push(CellEdit { from: end.to, to: end.to, bfrom: end.bto, bto: end.bto, insert });
            }
        }
        // linhas além do fim (colar passando da última): viram linhas novas, uma troca só no fim do texto
        if let Some((&last_row, _)) = new_rows.iter().next_back() {
            let eol = self.eol();
            let mut lines: Vec<String> = Vec::new();
            for r in self.rows.len()..=last_row {
                let cols = new_rows.get(&r);
                let width = cols.and_then(|m| m.keys().next_back()).map_or(0, |&c| c + 1);
                let line: Vec<String> = (0..width).map(|c| cols.and_then(|m| m.get(&c)).map_or(String::new(), |v| encode(v, false, delim))).collect();
                lines.push(line.join(&delim.to_string()));
            }
            let insert = if self.rows.is_empty() {
                lines.join(eol)
            } else if self.text.len() > self.rows[self.rows.len() - 1].end {
                lines.iter().map(|l| format!("{l}{eol}")).collect()
            } else {
                lines.iter().map(|l| format!("{eol}{l}")).collect()
            };
            out.push(CellEdit { from: self.end16(), to: self.end16(), bfrom: self.text.len(), bto: self.text.len(), insert });
        }
        out
    }
}

/// Quantas linhas novas uma única colagem pode criar além do fim.
const MAX_NEW_ROWS: usize = 20_000;

/// Estrutura (11.E): linhas e colunas inteiras. Como `edit_cells`, tudo sai como trocas no texto **de
/// antes**, para a UI aplicar numa transação só (um passo no desfazer). O que não é tocado fica igual.
impl Csv {
    /// Fim do texto em UTF-16.
    fn end16(&self) -> usize {
        match self.rows.last() {
            Some(r) => r.start16 + utf16_len(&self.text[r.start..]),
            None => bom_len(&self.text).min(1),
        }
    }

    /// Fim (sem terminador) de uma linha, em UTF-16.
    fn row_end16(&self, ri: usize) -> usize {
        let r = self.rows[ri];
        r.start16 + utf16_len(&self.text[r.start..r.end])
    }

    /// Onde a linha seguinte começa (ou o fim do texto): o fim do terminador desta.
    fn next_start(&self, ri: usize) -> (usize, usize) {
        match self.rows.get(ri + 1) {
            Some(n) => (n.start, n.start16),
            None => (self.text.len(), self.end16()),
        }
    }

    /// Terminador de linha do arquivo: o da primeira linha, `\n` se ela não tem.
    fn eol(&self) -> &'static str {
        match self.rows.first() {
            Some(r) if self.text[r.end..].starts_with("\r\n") => "\r\n",
            _ => "\n",
        }
    }

    /// Insere `count` linhas vazias antes da linha `before` (`before == row_count` põe no fim). Cada uma
    /// tem tantas células quanto a maior linha do arquivo.
    pub fn insert_rows(&self, before: usize, count: usize) -> Vec<CellEdit> {
        let count = count.clamp(1, 100_000);
        let before = before.min(self.rows.len());
        let eol = self.eol();
        let line = (self.delim as char).to_string().repeat(self.max_cols.max(1) - 1);
        let (bpos, pos16, insert) = if before < self.rows.len() {
            let r = self.rows[before];
            (r.start, r.start16, format!("{line}{eol}").repeat(count))
        } else if self.rows.is_empty() {
            (self.text.len(), self.end16(), vec![line.as_str(); count].join(eol))
        } else if self.text.len() > self.rows[self.rows.len() - 1].end {
            // o arquivo acaba com terminador: cada linha nova também
            (self.text.len(), self.end16(), format!("{line}{eol}").repeat(count))
        } else {
            (self.text.len(), self.end16(), format!("{eol}{line}").repeat(count))
        };
        vec![CellEdit { from: pos16, to: pos16, bfrom: bpos, bto: bpos, insert }]
    }

    /// Apaga as linhas (com o terminador). Se leva a última e o arquivo acaba sem terminador, leva
    /// junto o da linha de antes, para não sobrar uma linha vazia.
    pub fn delete_rows(&self, rows: &[usize]) -> Vec<CellEdit> {
        let mut r: Vec<usize> = rows.iter().copied().filter(|&x| x < self.rows.len()).collect();
        r.sort_unstable();
        r.dedup();
        let mut out = Vec::new();
        let mut i = 0;
        while i < r.len() {
            let a = r[i];
            let mut b = a;
            while i + 1 < r.len() && r[i + 1] == b + 1 {
                i += 1;
                b = r[i];
            }
            i += 1;
            let (mut bfrom, mut from) = (self.rows[a].start, self.rows[a].start16);
            let (bto, to) = self.next_start(b);
            let last_open = b + 1 == self.rows.len() && self.text.len() == self.rows[b].end;
            if last_open && a > 0 {
                bfrom = self.rows[a - 1].end;
                from = self.row_end16(a - 1);
            }
            out.push(CellEdit { from, to, bfrom, bto, insert: String::new() });
        }
        out
    }

    /// Refaz as linhas: `f` recebe os campos crus (com aspas) e devolve os novos, ou `None` para deixar
    /// a linha como está. Só as linhas mudadas viram troca.
    fn rewrite(&self, f: impl Fn(Vec<&str>) -> Option<Vec<String>>) -> Vec<CellEdit> {
        let delim = (self.delim as char).to_string();
        let mut out = Vec::new();
        for ri in 0..self.rows.len() {
            let cells = self.parse_cells(ri);
            let raw: Vec<&str> = cells.iter().map(|c| &self.text[c.bfrom..c.bto]).collect();
            if raw.len() == 1 && raw[0].is_empty() {
                continue; // linha em branco
            }
            if let Some(n) = f(raw) {
                let r = self.rows[ri];
                out.push(CellEdit { from: r.start16, to: cells.last().map_or(r.start16, |c| c.to), bfrom: r.start, bto: r.end, insert: n.join(&delim) });
            }
        }
        out
    }

    /// Coluna vazia nova na posição `at` (`at == cols` põe no fim). Linhas curtas demais para ter a posição ficam como estão.
    pub fn insert_col(&self, at: usize) -> Vec<CellEdit> {
        let max = self.max_cols;
        self.rewrite(|raw| {
            if raw.len() < at || (raw.len() == at && at < max) {
                return None;
            }
            let mut v: Vec<String> = raw.into_iter().map(String::from).collect();
            v.insert(at, String::new());
            Some(v)
        })
    }

    /// Apaga colunas. Uma linha que ficaria sem nenhuma célula vira vazia.
    pub fn delete_cols(&self, cols: &[usize]) -> Vec<CellEdit> {
        let set: std::collections::HashSet<usize> = cols.iter().copied().collect();
        self.rewrite(|raw| {
            if !(0..raw.len()).any(|c| set.contains(&c)) {
                return None;
            }
            Some(raw.into_iter().enumerate().filter(|(c, _)| !set.contains(c)).map(|(_, s)| s.to_string()).collect())
        })
    }

    /// Leva a coluna `from` para a posição `to`. Linhas curtas demais para ter as duas ficam como estão
    /// se não têm a coluna de origem; senão ganham células vazias até a posição de destino.
    pub fn move_col(&self, from: usize, to: usize) -> Vec<CellEdit> {
        if from == to {
            return vec![];
        }
        self.rewrite(|raw| {
            if raw.len() <= from {
                return None;
            }
            let mut v: Vec<String> = raw.into_iter().map(String::from).collect();
            while v.len() <= to {
                v.push(String::new());
            }
            let x = v.remove(from);
            v.insert(to, x);
            Some(v)
        })
    }

    /// Reescreve o arquivo com as linhas de dados na ordem pedida (ação explícita: muda o texto).
    /// O cabeçalho fica no lugar e os terminadores passam a ser o da primeira linha.
    pub fn sort_file(&self, header: bool, decimal: char, sort: Sort) -> Vec<CellEdit> {
        let first = header as usize;
        if self.rows.len() < first + 2 {
            return vec![];
        }
        let order = self.view(header, decimal, Some(sort), None);
        if order.iter().enumerate().all(|(k, &ri)| ri as usize == first + k) {
            return vec![];
        }
        let body: Vec<&str> = order.iter().map(|&ri| &self.text[self.rows[ri as usize].start..self.rows[ri as usize].end]).collect();
        let last = self.rows.len() - 1;
        vec![CellEdit {
            from: self.rows[first].start16,
            to: self.row_end16(last),
            bfrom: self.rows[first].start,
            bto: self.rows[last].end,
            insert: body.join(self.eol()),
        }]
    }
}

/// O campo como vai para o arquivo.
fn encode(value: &str, force_quote: bool, delim: char) -> String {
    let needs = value.chars().any(|c| c == delim || c == '"' || c == '\n' || c == '\r');
    if force_quote || needs {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

/// Número no formato escolhido: `decimal` é `.` ou `,`; o outro vale como separador de milhar,
/// só em grupos certos (`1,234.56` com ponto decimal; `1.234,56` com vírgula). Aceita sinal e
/// expoente (`1e5`). Nada de moeda, porcentagem ou espaço no meio: isso fica de fora da conta.
pub fn parse_number(s: &str, decimal: char) -> Option<f64> {
    let s = s.trim();
    let decimal = if decimal == ',' { ',' } else { '.' };
    let group = if decimal == '.' { ',' } else { '.' };
    let s = s.strip_prefix(['+', '-']).map(|r| (s.starts_with('-'), r)).unwrap_or((false, s));
    let (neg, rest) = s;
    let (mant, exp) = match rest.find(['e', 'E']) {
        Some(i) => (&rest[..i], Some(&rest[i + 1..])),
        None => (rest, None),
    };
    let mut parts = mant.split(decimal);
    let int = parts.next()?;
    let frac = parts.next();
    if parts.next().is_some() {
        return None;
    }
    if let Some(f) = frac
        && (f.is_empty() || !f.bytes().all(|c| c.is_ascii_digit()))
    {
        return None;
    }
    let int_digits = if int.contains(group) {
        let groups: Vec<&str> = int.split(group).collect();
        let ok = (1..=3).contains(&groups[0].len())
            && groups[1..].iter().all(|g| g.len() == 3)
            && groups.iter().all(|g| g.bytes().all(|c| c.is_ascii_digit()));
        if !ok {
            return None;
        }
        groups.concat()
    } else {
        if !int.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        int.to_string()
    };
    if int_digits.is_empty() && frac.is_none() {
        return None;
    }
    let mut norm = String::new();
    if neg {
        norm.push('-');
    }
    norm.push_str(if int_digits.is_empty() { "0" } else { &int_digits });
    if let Some(f) = frac {
        norm.push('.');
        norm.push_str(f);
    }
    if let Some(e) = exp {
        let digits = e.strip_prefix(['+', '-']).unwrap_or(e);
        if digits.is_empty() || !digits.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        norm.push('e');
        norm.push_str(e);
    }
    norm.parse::<f64>().ok().filter(|x| x.is_finite())
}

/// `2026-01-05`, `2026-01-05T10:30[:00]` (ou com espaço), `2026/01/05` e `05/01/2026`.
fn is_date(s: &str) -> bool {
    fn num(s: &str, len: usize) -> Option<u32> {
        (s.len() == len && s.bytes().all(|c| c.is_ascii_digit())).then(|| s.parse().ok()).flatten()
    }
    fn ymd(y: Option<u32>, m: Option<u32>, d: Option<u32>) -> bool {
        matches!((y, m, d), (Some(_), Some(1..=12), Some(1..=31)))
    }
    let date_part = s.split(['T', ' ']).next().unwrap_or(s);
    let time_ok = match s.get(date_part.len()..) {
        Some("") => true,
        Some(t) => {
            let t = &t[1..];
            let mut it = t.split(':');
            let h = it.next().and_then(|x| num(x, 2));
            let m = it.next().and_then(|x| num(x, 2));
            let sec = it.next();
            matches!(h, Some(0..=23))
                && matches!(m, Some(0..=59))
                && sec.is_none_or(|x| x.trim_end_matches('Z').split('.').next().and_then(|v| num(v, 2)).is_some())
        }
        None => false,
    };
    if !time_ok {
        return false;
    }
    let p: Vec<&str> = date_part.split(['-', '/']).collect();
    if p.len() != 3 {
        return false;
    }
    if p[0].len() == 4 {
        ymd(num(p[0], 4), num(p[1], 2), num(p[2], 2))
    } else if date_part.contains('/') {
        ymd(num(p[2], 4), num(p[1], 2), num(p[0], 2))
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn csv(s: &str) -> Csv {
        Csv::parse(s.to_string(), ',')
    }

    fn values(c: &Csv, row: usize) -> Vec<String> {
        c.rows(row, 1)[0].cells.iter().map(|x| x.value.clone()).collect()
    }

    #[test]
    fn linhas_e_celulas_simples() {
        let c = csv("a,b,c\n1,2,3\n");
        assert_eq!(c.row_count(), 2);
        assert_eq!(c.cols(), 3);
        assert_eq!(values(&c, 0), ["a", "b", "c"]);
        assert_eq!(values(&c, 1), ["1", "2", "3"]);
    }

    #[test]
    fn sem_quebra_no_fim_e_com_quebra_no_fim_dao_o_mesmo() {
        assert_eq!(csv("a,b\n1,2").row_count(), 2);
        assert_eq!(csv("a,b\n1,2\n").row_count(), 2);
        assert_eq!(csv("a,b\n1,2\n\n").row_count(), 3, "linha em branco no fim é uma linha");
        assert_eq!(csv("").row_count(), 0);
    }

    #[test]
    fn aspas_com_separador_aspa_e_quebra_de_linha() {
        let c = csv("1,\"a, b\",\"diz \"\"oi\"\"\",\"x\ny\"\n2,z,w,v\n");
        assert_eq!(c.row_count(), 2);
        assert_eq!(values(&c, 0), ["1", "a, b", "diz \"oi\"", "x\ny"]);
        assert_eq!(values(&c, 1), ["2", "z", "w", "v"]);
        assert!(c.rows(0, 1)[0].cells[1].quoted);
        assert!(!c.rows(0, 1)[0].cells[0].quoted);
    }

    #[test]
    fn terminadores_crlf_lf_e_cr_misturados() {
        let c = csv("a,b\r\n1,2\n3,4\r5,6");
        assert_eq!(c.row_count(), 4);
        assert_eq!(values(&c, 1), ["1", "2"]);
        assert_eq!(values(&c, 2), ["3", "4"]);
        assert_eq!(values(&c, 3), ["5", "6"]);
    }

    #[test]
    fn crlf_dentro_de_aspas_nao_quebra_a_linha() {
        let c = csv("a,\"x\r\ny\"\r\nb,c\r\n");
        assert_eq!(c.row_count(), 2);
        assert_eq!(values(&c, 0), ["a", "x\r\ny"]);
    }

    #[test]
    fn campos_vazios_e_separador_no_fim() {
        let c = csv(",,\na,,\n,b\n");
        assert_eq!(values(&c, 0), ["", "", ""]);
        assert_eq!(values(&c, 1), ["a", "", ""]);
        assert_eq!(values(&c, 2), ["", "b"]);
        assert_eq!(c.cols(), 3);
    }

    #[test]
    fn linhas_com_colunas_a_mais_e_a_menos() {
        let c = csv("a,b,c\n1\n1,2,3,4,5\n");
        assert_eq!(values(&c, 1), ["1"]);
        assert_eq!(values(&c, 2).len(), 5);
        assert_eq!(c.cols(), 5);
    }

    #[test]
    fn aspa_no_meio_de_campo_sem_aspas_e_texto() {
        let c = csv("ab\"cd,e\"f\n");
        assert_eq!(values(&c, 0), ["ab\"cd", "e\"f"]);
    }

    #[test]
    fn lixo_depois_da_aspa_que_fecha_entra_no_valor() {
        let c = csv("\"abc\"def,x\n");
        assert_eq!(values(&c, 0), ["abcdef", "x"]);
        // o texto original da célula inclui tudo
        let cell = &c.rows(0, 1)[0].cells[0];
        assert_eq!((cell.from, cell.to), (0, 8));
    }

    #[test]
    fn aspa_aberta_vai_ate_o_fim() {
        let c = csv("a,\"b\nc,d\ne\n");
        assert!(c.unterminated());
        assert_eq!(c.row_count(), 1);
        assert_eq!(values(&c, 0), ["a", "b\nc,d\ne\n"]);
        assert!(!csv("a,\"b\"\n").unterminated());
    }

    #[test]
    fn campo_so_com_aspas_vazio() {
        let c = csv("\"\",\"\"\"\"\n");
        assert_eq!(values(&c, 0), ["", "\""]);
    }

    #[test]
    fn posicoes_em_utf16_com_acento_e_emoji() {
        // "é" = 1 unidade; "😀" = 2 unidades
        let c = csv("é,😀,x\nab,c\n");
        let r = &c.rows(0, 2);
        let cells = &r[0].cells;
        assert_eq!((cells[0].from, cells[0].to), (0, 1));
        assert_eq!((cells[1].from, cells[1].to), (2, 4));
        assert_eq!((cells[2].from, cells[2].to), (5, 6));
        assert_eq!((r[0].from, r[0].to), (0, 6));
        // a segunda linha começa depois do "\n" (posição 7)
        assert_eq!(r[1].from, 7);
        assert_eq!((r[1].cells[0].from, r[1].cells[0].to), (7, 9));
        // e os byte offsets recortam o mesmo texto
        let t = c.text();
        assert_eq!(&t[cells[1].bfrom..cells[1].bto], "😀");
    }

    #[test]
    fn bom_no_comeco_nao_entra_na_primeira_celula() {
        let c = csv("\u{FEFF}\"a\",b\n1,2\n");
        assert_eq!(values(&c, 0), ["a", "b"]);
        let cell = &c.rows(0, 1)[0].cells[0];
        assert_eq!((cell.from, cell.to), (1, 4), "o BOM ocupa a posição 0 do editor");
        assert_eq!(c.rows(1, 1)[0].from, 7);
    }

    #[test]
    fn rows_por_faixa_e_limites() {
        let c = csv("a\nb\nc\nd\n");
        assert_eq!(c.rows(1, 2).len(), 2);
        assert_eq!(c.rows(1, 2)[0].index, 1);
        assert_eq!(c.rows(3, 10).len(), 1);
        assert!(c.rows(9, 3).is_empty());
        assert!(c.rows(usize::MAX, 3).is_empty());
        assert!(c.rows(0, usize::MAX).len() == 4);
    }

    #[test]
    fn valor_enorme_e_cortado_em_rows_mas_nao_em_cell() {
        let big = "x".repeat(5_000);
        let c = csv(&format!("{big},b\n"));
        let r = c.rows(0, 1);
        assert!(r[0].cells[0].cut);
        assert_eq!(r[0].cells[0].value.chars().count(), MAX_TEXT);
        assert_eq!(c.cell(0, 0).unwrap().value.len(), 5_000);
        assert!(!c.cell(0, 0).unwrap().cut);
        assert!(c.cell(0, 9).is_none());
        assert!(c.cell(9, 0).is_none());
    }

    #[test]
    fn cell_at_acha_a_celula_do_cursor() {
        let c = csv("ab,cd\n\"x\ny\",z\n");
        assert_eq!(c.cell_at(0), Some(CellPos { row: 0, col: 0 }));
        assert_eq!(c.cell_at(2), Some(CellPos { row: 0, col: 0 }), "logo antes da vírgula ainda é a célula");
        assert_eq!(c.cell_at(3), Some(CellPos { row: 0, col: 1 }));
        assert_eq!(c.cell_at(5), Some(CellPos { row: 0, col: 1 }), "no fim da linha é a última célula");
        assert_eq!(c.cell_at(8), Some(CellPos { row: 1, col: 0 }), "dentro da célula de várias linhas");
        assert_eq!(c.cell_at(11), Some(CellPos { row: 1, col: 0 }), "logo antes da vírgula");
        assert_eq!(c.cell_at(12), Some(CellPos { row: 1, col: 1 }));
        assert_eq!(c.cell_at(10_000), Some(CellPos { row: 1, col: 1 }));
        assert_eq!(csv("").cell_at(0), None);
    }

    // ---- separador ----

    #[test]
    fn detecta_cada_separador_pelo_cabecalho() {
        assert_eq!(detect("a,b,c\n1,2,3\n4,5,6\n", None), ',');
        assert_eq!(detect("a;b;c\n1;2;3\n4;5;6\n", None), ';');
        assert_eq!(detect("a\tb\tc\n1\t2\t3\n", None), '\t');
        assert_eq!(detect("a|b|c\n1|2|3\n", None), '|');
    }

    #[test]
    fn detecta_ponto_e_virgula_com_virgula_decimal() {
        // as vírgulas dos números não enganam: o cabeçalho não tem nenhuma
        assert_eq!(detect("nome;preco;qtd\nlápis;1,5;10\ncaneta;2,25;5\n", None), ';');
    }

    #[test]
    fn detecta_ignorando_separadores_dentro_de_aspas() {
        assert_eq!(detect("a;b\n\"x;y;z\";2\n\"p;q\";3\n", None), ';');
        assert_eq!(detect("\"a;b\",c\n\"1;2\",3\n", None), ',');
    }

    #[test]
    fn deteccao_empata_pela_contagem_e_depois_pela_ordem() {
        // "nome, sobrenome" tem vírgula em todas as linhas, mas o tab é a estrutura de verdade
        assert_eq!(detect("nome, sobrenome\tidade\nana, maria\t30\nbia, souza\t41\n", None), '\t');
        // vírgula aparece mais vezes que ponto e vírgula
        assert_eq!(detect("a,b,c,d\n1,2,3;4\n5,6,7;8\n", None), ',');
    }

    #[test]
    fn deteccao_tolera_uma_linha_torta_mas_nao_varias() {
        let ok = "a,b,c\n1,2,3\n4,5\n6,7,8\n9,1,2\n3,4,5\n6,7,8\n9,8,7\n6,5,4\n3,2,1\n";
        assert_eq!(detect(ok, None), ',');
        // metade das linhas diverge: nenhum candidato é consistente, cai na vírgula
        assert_eq!(detect("a;b;c\n1;2\n3\n4;5;6;7\n", None), ',');
    }

    #[test]
    fn deteccao_sem_estrutura_ou_vazio_usa_virgula() {
        assert_eq!(detect("", None), ',');
        assert_eq!(detect("so um texto qualquer\noutra linha\n", None), ',');
        assert_eq!(detect("\n\n\n", None), ',');
    }

    #[test]
    fn deteccao_pula_linhas_em_branco_e_o_bom() {
        assert_eq!(detect("\u{FEFF}a;b\n\n1;2\n\n3;4\n", None), ';');
    }

    #[test]
    fn extensao_tsv_manda_no_tab() {
        assert_eq!(detect("a,b,c\n1,2,3\n", Some("tsv")), '\t');
        assert_eq!(detect("a,b,c\n1,2,3\n", Some("TSV")), '\t');
        assert_eq!(detect("a;b\n1;2\n", Some("csv")), ';');
    }

    #[test]
    fn separador_invalido_vira_virgula() {
        assert_eq!(Csv::parse("a;b".into(), '"').delimiter(), ',');
        assert_eq!(Csv::parse("a;b".into(), 'é').delimiter(), ',');
        assert_eq!(Csv::parse("a;b".into(), '\n').delimiter(), ',');
        assert_eq!(Csv::parse("a;b".into(), ';').delimiter(), ';');
        assert_eq!(Csv::parse("a\tb".into(), '\t').delimiter(), '\t');
        let c = Csv::parse("a;b\n1;2\n".into(), ';');
        assert_eq!(values(&c, 1), ["1", "2"]);
    }

    // ---- números, tipos, estatísticas ----

    #[test]
    fn numeros_com_ponto_decimal() {
        assert_eq!(parse_number("12.5", '.'), Some(12.5));
        assert_eq!(parse_number("-3", '.'), Some(-3.0));
        assert_eq!(parse_number("+3.25", '.'), Some(3.25));
        assert_eq!(parse_number(" 7 ", '.'), Some(7.0));
        assert_eq!(parse_number(".5", '.'), Some(0.5));
        assert_eq!(parse_number("1e3", '.'), Some(1000.0));
        assert_eq!(parse_number("2.5E-1", '.'), Some(0.25));
        assert_eq!(parse_number("1,234.56", '.'), Some(1234.56));
        assert_eq!(parse_number("1,234,567", '.'), Some(1_234_567.0));
    }

    #[test]
    fn numeros_com_virgula_decimal() {
        assert_eq!(parse_number("12,5", ','), Some(12.5));
        assert_eq!(parse_number("1.234,56", ','), Some(1234.56));
        assert_eq!(parse_number("-0,5", ','), Some(-0.5));
        assert_eq!(parse_number("1.234.567", ','), Some(1_234_567.0));
    }

    #[test]
    fn nao_e_numero_no_formato_escolhido() {
        assert_eq!(parse_number("12,5", '.'), None, "vírgula decimal com o ponto escolhido");
        assert_eq!(parse_number("12.5", ','), None);
        for s in ["", "abc", "R$ 10", "10%", "1 000", "1..2", "1.2.3", "5.", "-", "+", "e5", "1e", "1,23.4", "1234,567.8", "0x10", "NaN", "inf", "1e999"] {
            assert_eq!(parse_number(s, '.'), None, "{s:?}");
        }
    }

    #[test]
    fn tipo_por_coluna() {
        let c = csv("id,nome,preco,data,vazia,misto\n1,ana,2.5,2026-01-05,,1\n2,bia,3,2026-02-10,,x\n");
        use ColType::*;
        assert_eq!(c.column_types(true, '.'), [Number, Text, Number, Date, Empty, Text]);
        // sem cabeçalho, a primeira linha entra na conta e estraga os números
        assert_eq!(c.column_types(false, '.')[0], Text);
    }

    #[test]
    fn tipo_depende_do_decimal_escolhido() {
        let c = Csv::parse("p\n1,5\n2,25\n".into(), ';');
        assert_eq!(c.column_types(true, '.')[0], ColType::Text);
        assert_eq!(c.column_types(true, ',')[0], ColType::Number);
    }

    #[test]
    fn formatos_de_data() {
        for s in ["2026-01-05", "2026-01-05T10:30", "2026-01-05 10:30:15", "2026-01-05T10:30:15Z", "2026-01-05T10:30:15.123Z", "05/01/2026", "2026/01/05"] {
            assert!(is_date(s), "{s:?}");
        }
        for s in ["2026-13-01", "2026-01-32", "05-01-2026", "1/2/26", "2026-01-05T25:00", "ontem", "2026-01", "2026-01-05 x"] {
            assert!(!is_date(s), "{s:?}");
        }
    }

    #[test]
    fn estatisticas_da_coluna() {
        let c = csv("preco\n10\n2.5\n\nabc\n7.5\n");
        let st = c.stats(1..c.row_count(), 0..1, '.');
        assert_eq!(st.count, 4);
        assert_eq!(st.numeric, 3);
        assert_eq!(st.skipped, 1);
        assert_eq!(st.sum, 20.0);
        assert_eq!(st.avg, Some(20.0 / 3.0));
        assert_eq!(st.min, Some(2.5));
        assert_eq!(st.max, Some(10.0));
    }

    #[test]
    fn estatisticas_de_selecao_e_visao_filtrada() {
        let c = csv("a,b\n1,10\n2,20\n3,30\n4,40\n");
        // retângulo: linhas 2..4, colunas 0..2
        let st = c.stats(2..4, 0..2, '.');
        assert_eq!((st.numeric, st.sum), (4, 2.0 + 20.0 + 3.0 + 30.0));
        // linhas escolhidas e fora de ordem (visão ordenada/filtrada); linha inexistente é ignorada
        let st = c.stats([4, 1, 99], 1..2, '.');
        assert_eq!((st.numeric, st.sum, st.min, st.max), (2, 50.0, Some(10.0), Some(40.0)));
    }

    #[test]
    fn estatisticas_sem_numeros() {
        let c = csv("a\nx\ny\n");
        let st = c.stats(1..3, 0..1, '.');
        assert_eq!((st.count, st.numeric, st.skipped), (2, 0, 2));
        assert_eq!((st.avg, st.min, st.max), (None, None, None));
        assert_eq!(c.stats(0..0, 0..1, '.'), Stats::default());
    }

    #[test]
    fn estatisticas_com_virgula_decimal() {
        let c = Csv::parse("v\n1,5\n2,5\n".into(), ';');
        assert_eq!(c.stats(1..3, 0..1, ',').sum, 4.0);
        let st = c.stats(1..3, 0..1, '.');
        assert_eq!((st.numeric, st.skipped), (0, 2));
    }

    // ---- escrita de célula ----

    fn edit(text: &str, row: usize, col: usize, v: &str) -> String {
        let c = csv(text);
        c.edit_cell(row, col, v).unwrap().apply_to(text)
    }

    #[test]
    fn editar_celula_simples_so_muda_ela() {
        assert_eq!(edit("a,b,c\n1,2,3\n", 1, 1, "XX"), "a,b,c\n1,XX,3\n");
        assert_eq!(edit("a,b,c\n1,2,3\n", 0, 0, ""), ",b,c\n1,2,3\n");
        assert_eq!(edit("a,b,c\n1,2,3", 1, 2, "z"), "a,b,c\n1,2,z");
    }

    #[test]
    fn editar_preserva_crlf_linhas_em_branco_e_aspas_de_outras_celulas() {
        let t = "a,\"b,1\"\r\n\r\nx,\"y\"\r\n";
        assert_eq!(edit(t, 2, 0, "novo"), "a,\"b,1\"\r\n\r\nnovo,\"y\"\r\n");
        assert_eq!(edit(t, 0, 0, "A"), "A,\"b,1\"\r\n\r\nx,\"y\"\r\n");
    }

    #[test]
    fn editar_poe_aspas_so_quando_precisa() {
        assert_eq!(edit("a,b\n", 0, 0, "x y"), "x y,b\n", "espaço não precisa de aspas");
        assert_eq!(edit("a,b\n", 0, 0, "x,y"), "\"x,y\",b\n");
        assert_eq!(edit("a,b\n", 0, 0, "diz \"oi\""), "\"diz \"\"oi\"\"\",b\n");
        assert_eq!(edit("a,b\n", 0, 1, "l1\nl2"), "a,\"l1\nl2\"\n");
    }

    #[test]
    fn editar_mantem_as_aspas_que_ja_existiam() {
        assert_eq!(edit("\"a\",b\n", 0, 0, "novo"), "\"novo\",b\n");
        assert_eq!(edit("\"a\",b\n", 0, 0, ""), "\"\",b\n");
        assert_eq!(edit("\"a\",b\n", 0, 0, "x,y"), "\"x,y\",b\n");
        assert_eq!(edit("\"x\ny\",b\n", 0, 0, "s"), "\"s\",b\n", "célula de várias linhas encolhe");
    }

    #[test]
    fn editar_com_separador_ponto_e_virgula() {
        let t = "a;b\n1;2\n";
        let c = Csv::parse(t.to_string(), ';');
        assert_eq!(c.edit_cell(1, 0, "x;y").unwrap().apply_to(t), "a;b\n\"x;y\";2\n");
        assert_eq!(c.edit_cell(1, 0, "x,y").unwrap().apply_to(t), "a;b\nx,y;2\n");
    }

    #[test]
    fn editar_coluna_alem_do_fim_da_linha_acrescenta_separadores() {
        assert_eq!(edit("a,b,c\n1\n2,2,2\n", 1, 2, "z"), "a,b,c\n1,,z\n2,2,2\n");
        assert_eq!(edit("a,b,c\n1\n", 1, 1, "z"), "a,b,c\n1,z\n");
        assert_eq!(edit("a,b,c\n1\r\n", 1, 2, "x,y"), "a,b,c\n1,,\"x,y\"\r\n");
    }

    #[test]
    fn editar_linha_inexistente_e_none() {
        assert!(csv("a\n").edit_cell(5, 0, "x").is_none());
        assert!(csv("").edit_cell(0, 0, "x").is_none());
    }

    #[test]
    fn editar_com_acento_emoji_e_posicoes_utf16() {
        let t = "é,😀,x\n";
        let c = csv(t);
        let e = c.edit_cell(0, 2, "y").unwrap();
        assert_eq!((e.from, e.to), (5, 6));
        assert_eq!(e.apply_to(t), "é,😀,y\n");
        let e = c.edit_cell(0, 1, "ñ").unwrap();
        assert_eq!((e.from, e.to), (2, 4));
        assert_eq!(e.apply_to(t), "é,ñ,x\n");
    }

    #[test]
    fn editar_com_bom_mantem_o_bom() {
        let t = "\u{FEFF}a,b\n";
        assert_eq!(csv(t).edit_cell(0, 0, "z").unwrap().apply_to(t), "\u{FEFF}z,b\n");
    }

    #[test]
    fn editar_e_reler_da_o_mesmo_valor() {
        let t = "a,\"b\"\n\"x,y\",3\n";
        for v in ["", "plain", "com,virgula", "com \"aspas\"", "duas\nlinhas", "\"", ",", "é😀"] {
            for (r, c) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let out = edit(t, r, c, v);
                let after = csv(&out);
                assert_eq!(after.cell(r, c).unwrap().value, v, "linha {r} coluna {c} valor {v:?}");
                // as outras células continuam iguais
                let before = csv(t);
                for (r2, c2) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                    if (r2, c2) != (r, c) {
                        assert_eq!(after.cell(r2, c2).unwrap().value, before.cell(r2, c2).unwrap().value);
                    }
                }
            }
        }
    }

    // ---- tamanho ----

    #[test]
    fn arquivo_grande_indexa_rapido() {
        // ~10 MB, 200 mil linhas, com acento e uma célula entre aspas por linha
        let mut s = String::from("id,nome,obs,valor\n");
        for i in 0..200_000 {
            s.push_str(&format!("{i},João {i},\"a, b\",{}.5\n", i % 1000));
        }
        let t = std::time::Instant::now();
        let c = Csv::parse(s, ',');
        let parse = t.elapsed();
        assert_eq!(c.row_count(), 200_001);
        let t = std::time::Instant::now();
        let r = c.rows(150_000, 50);
        let faixa = t.elapsed();
        assert_eq!(r[0].cells[0].value, "149999");
        assert_eq!(r[0].cells[1].value, "João 149999");
        let st = c.stats(1..c.row_count(), 3..4, '.');
        assert_eq!(st.numeric, 200_000);
        eprintln!("índice de 200 mil linhas: {parse:?}; faixa de 50: {faixa:?}");
        assert!(parse.as_secs() < 5, "{parse:?}");
        assert!(faixa.as_millis() < 100, "{faixa:?}");
    }

    #[test]
    fn linha_gigante_sem_quebra_nao_estoura() {
        let s = "x,".repeat(500_000);
        let c = csv(&s);
        assert_eq!(c.row_count(), 1);
        assert_eq!(c.cols(), 500_001);
    }

    // ---- visão: ordenar e filtrar ----

    #[test]
    fn visao_sem_filtro_nem_ordem_e_a_ordem_do_arquivo_sem_o_cabecalho() {
        let c = csv("h
a
b
c
");
        assert_eq!(c.view(true, '.', None, None), [1, 2, 3]);
        assert_eq!(c.view(false, '.', None, None), [0, 1, 2, 3]);
    }

    #[test]
    fn ordena_numeros_como_numeros() {
        let c = csv("n
10
9
100

2.5
");
        assert_eq!(c.view(true, '.', Some(Sort { col: 0, desc: false }), None), [5, 2, 1, 3, 4], "2.5, 9, 10, 100 e a linha vazia no fim");
        assert_eq!(c.view(true, '.', Some(Sort { col: 0, desc: true }), None), [3, 1, 2, 5, 4], "decrescente; a vazia continua no fim");
    }

    #[test]
    fn ordena_texto_sem_diferenciar_maiuscula_nem_acento() {
        let c = csv("n
beta
Ágata
alfa
Zeca
");
        let v = c.view(true, '.', Some(Sort { col: 0, desc: false }), None);
        let nomes: Vec<String> = v.iter().map(|&i| c.cell(i as usize, 0).unwrap().value).collect();
        assert_eq!(nomes, ["Ágata", "alfa", "beta", "Zeca"]);
    }

    #[test]
    fn coluna_mista_ordena_como_texto() {
        let c = csv("n
10
abc
9
");
        let v = c.view(true, '.', Some(Sort { col: 0, desc: false }), None);
        let vals: Vec<String> = v.iter().map(|&i| c.cell(i as usize, 0).unwrap().value).collect();
        assert_eq!(vals, ["10", "9", "abc"], "como texto: 10 vem antes de 9");
    }

    #[test]
    fn ordem_e_estavel_e_respeita_o_decimal() {
        let c = csv("k,v
a,1,5
b,1,5
c,0,5
");
        // com vírgula como separador de colunas isto é só para ver a estabilidade pela coluna 0
        let v = c.view(true, '.', Some(Sort { col: 1, desc: false }), None);
        assert_eq!(v.len(), 3);
        let d = Csv::parse("p
1,5
10,5
2,25
".into(), ';');
        assert_eq!(d.view(true, ',', Some(Sort { col: 0, desc: false }), None), [1, 3, 2]);
        assert_eq!(d.view(true, '.', Some(Sort { col: 0, desc: false }), None), [1, 2, 3], "com ponto decimal escolhido, '1,5' não é número: ordena como texto");
    }

    #[test]
    fn filtra_por_coluna_ou_em_todas_sem_maiuscula_nem_acento() {
        let c = csv("nome,cidade
João,São Paulo
ana,Recife
MARIA,sao jose
");
        let f = |col: Option<usize>, t: &str| c.view(true, '.', None, Some(&Filter { col, text: t.into() }));
        assert_eq!(f(None, "sao"), [1, 3]);
        assert_eq!(f(Some(0), "sao"), Vec::<u32>::new());
        assert_eq!(f(Some(1), "SÃO"), [1, 3]);
        assert_eq!(f(None, "joao"), [1]);
        assert_eq!(f(None, ""), [1, 2, 3], "filtro vazio não filtra");
        assert_eq!(f(Some(9), "x"), Vec::<u32>::new(), "coluna que a linha não tem não casa");
    }

    #[test]
    fn filtra_e_depois_ordena() {
        let c = csv("n,t
3,a
1,b
2,a
");
        let v = c.view(true, '.', Some(Sort { col: 0, desc: false }), Some(&Filter { col: Some(1), text: "a".into() }));
        assert_eq!(v, [3, 1]);
    }

    #[test]
    fn rows_at_devolve_na_ordem_pedida() {
        let c = csv("h
a
b
c
");
        let r = c.rows_at(&[3, 1, 99]);
        assert_eq!(r.iter().map(|x| x.index).collect::<Vec<_>>(), [3, 1]);
        assert_eq!(r[0].cells[0].value, "c");
    }

    #[test]
    fn visao_de_arquivo_grande_e_rapida() {
        let mut s = String::from("id,nome,valor\n");
        for i in 0..100_000 {
            s.push_str(&format!("{i},Nome {},{}\n", (i * 7919) % 10007, i % 977));
        }
        let c = Csv::parse(s, ',');
        let t = std::time::Instant::now();
        let v = c.view(true, '.', Some(Sort { col: 2, desc: true }), Some(&Filter { col: None, text: "nome 1".into() }));
        let el = t.elapsed();
        eprintln!("visão (filtro + ordem) de 100 mil linhas: {el:?}, {} linhas", v.len());
        assert!(!v.is_empty());
        assert!(el.as_secs() < 5, "{el:?}");
    }

    // ---- várias células de uma vez ----

    /// Aplica as trocas (em coordenadas do texto original) de trás para a frente.
    fn apply_all(text: &str, edits: &[CellEdit]) -> String {
        let mut out = text.to_string();
        for e in edits.iter().rev() {
            out.replace_range(e.bfrom..e.bto, &e.insert);
        }
        out
    }

    #[test]
    fn varias_celulas_de_uma_vez() {
        let t = "a,b,c\n1,2,3\n4,5,6\n";
        let c = csv(t);
        let e = c.edit_cells(&[(1, 0, "X"), (2, 2, "Z"), (1, 2, "Y,1")]);
        assert_eq!(apply_all(t, &e), "a,b,c\nX,2,\"Y,1\"\n4,5,Z\n");
        assert!(e.windows(2).all(|w| w[0].bfrom <= w[1].bfrom), "em ordem de texto");
    }

    #[test]
    fn apagar_um_intervalo_so_esvazia_as_celulas() {
        let t = "a,\"b\",c\n1,2,3\n";
        let c = csv(t);
        let e = c.edit_cells(&[(0, 0, ""), (0, 1, ""), (1, 1, "")]);
        assert_eq!(apply_all(t, &e), ",\"\",c\n1,,3\n", "as aspas que já existiam ficam");
    }

    #[test]
    fn mesma_celula_repetida_vale_a_ultima() {
        let t = "a,b\n";
        let e = csv(t).edit_cells(&[(0, 0, "um"), (0, 0, "dois")]);
        assert_eq!(apply_all(t, &e), "dois,b\n");
    }

    #[test]
    fn alem_do_fim_da_linha_vira_uma_troca_so_e_vazio_nao_cria_separador() {
        let t = "a,b,c\n1\n2\n";
        let c = csv(t);
        let e = c.edit_cells(&[(1, 2, "z"), (1, 1, "y")]);
        assert_eq!(e.len(), 1);
        assert_eq!(apply_all(t, &e), "a,b,c\n1,y,z\n2\n");
        assert!(c.edit_cells(&[(1, 5, ""), (2, 3, "")]).is_empty(), "apagar o que não existe não muda nada");
        let e = c.edit_cells(&[(2, 3, "w")]);
        assert_eq!(apply_all(t, &e), "a,b,c\n1\n2,,,w\n");
    }

    #[test]
    fn varias_celulas_ignoram_linha_inexistente_e_respeitam_utf16() {
        let t = "é,😀\nb,c\n";
        let c = csv(t);
        assert!(c.edit_cells(&[(1_000_000, 0, "x")]).is_empty());
        let e = c.edit_cells(&[(0, 1, "ñ"), (1, 0, "z")]);
        assert_eq!((e[0].from, e[0].to), (2, 4));
        assert_eq!((e[1].from, e[1].to), (5, 6));
        assert_eq!(apply_all(t, &e), "é,ñ\nz,c\n");
    }

    #[test]
    fn varias_celulas_conferem_com_uma_so() {
        let t = "a,\"b\"\n1,2\n";
        let c = csv(t);
        for (r, col, v) in [(0, 0, "x,y"), (0, 1, ""), (1, 1, "q\"r"), (1, 0, "l1\nl2")] {
            let one = c.edit_cell(r, col, v).unwrap();
            let many = c.edit_cells(&[(r, col, v)]);
            assert_eq!(many, vec![one], "linha {r} coluna {col}");
        }
    }

    // ---- estrutura (11.E) ----

    fn apply(c: &Csv, edits: Vec<CellEdit>) -> String {
        // aplica de trás para a frente, como a UI faz numa transação (posições do texto de antes)
        let mut t = c.text().to_string();
        let mut v = edits;
        v.sort_by_key(|e| std::cmp::Reverse(e.bfrom));
        for e in v {
            t.replace_range(e.bfrom..e.bto, &e.insert);
        }
        t
    }

    #[test]
    fn edit_cells_beyond_last_row_appends_rows() {
        let c = csv("a,b\r\n1,2\r\n");
        let e = c.edit_cells(&[(2, 0, "x"), (2, 1, "y,z"), (3, 1, "w"), (1, 0, "9")]);
        assert_eq!(apply(&c, e), "a,b\r\n9,2\r\nx,\"y,z\"\r\n,w\r\n");
        let d = csv("a,b\n1,2");
        assert_eq!(apply(&d, d.edit_cells(&[(2, 0, "x")])), "a,b\n1,2\nx");
        let e = csv("");
        assert_eq!(apply(&e, e.edit_cells(&[(0, 1, "q"), (1, 0, "r")])), ",q\nr");
    }

    #[test]
    fn insert_rows_keeps_eol_and_width() {
        let c = csv("a,b,c\r\n1,2,3\r\n");
        assert_eq!(apply(&c, c.insert_rows(1, 2)), "a,b,c\r\n,,\r\n,,\r\n1,2,3\r\n");
        assert_eq!(apply(&c, c.insert_rows(2, 1)), "a,b,c\r\n1,2,3\r\n,,\r\n");
        let d = csv("a,b\n1,2");
        assert_eq!(apply(&d, d.insert_rows(2, 1)), "a,b\n1,2\n,");
        assert_eq!(apply(&d, d.insert_rows(0, 1)), ",\na,b\n1,2");
        let e = csv("");
        assert_eq!(apply(&e, e.insert_rows(0, 2)), "\n");
    }

    #[test]
    fn delete_rows_runs_and_last_without_terminator() {
        let c = csv("a\nb\nc\nd\n");
        assert_eq!(apply(&c, c.delete_rows(&[1, 2])), "a\nd\n");
        assert_eq!(apply(&c, c.delete_rows(&[0, 3])), "b\nc\n");
        let d = csv("a\r\nb\r\nc");
        assert_eq!(apply(&d, d.delete_rows(&[2])), "a\r\nb");
        assert_eq!(apply(&d, d.delete_rows(&[1, 2])), "a");
        assert_eq!(apply(&d, d.delete_rows(&[0, 1, 2])), "");
        assert!(d.delete_rows(&[9]).is_empty());
    }

    #[test]
    fn delete_rows_with_multiline_quoted_and_utf16() {
        let c = csv("a,b\n\"x\ny\",é\nz,😀\n");
        let e = c.delete_rows(&[1]);
        assert_eq!(apply(&c, e.clone()), "a,b\nz,😀\n");
        assert_eq!((e[0].from, e[0].to), (4, 12));
    }

    #[test]
    fn insert_and_delete_cols_keep_other_cells() {
        let c = csv("a,\"b,1\",c\r\n1,2,3\r\n\r\nx\r\n");
        assert_eq!(apply(&c, c.insert_col(1)), "a,,\"b,1\",c\r\n1,,2,3\r\n\r\nx\r\n");
        assert_eq!(apply(&c, c.insert_col(3)), "a,\"b,1\",c,\r\n1,2,3,\r\n\r\nx\r\n");
        assert_eq!(apply(&c, c.delete_cols(&[1])), "a,c\r\n1,3\r\n\r\nx\r\n");
        assert_eq!(apply(&c, c.delete_cols(&[1, 2])), "a\r\n1\r\n\r\nx\r\n");
        assert_eq!(apply(&c, c.delete_cols(&[0, 1, 2])), "\r\n\r\n\r\n\r\n");
    }

    #[test]
    fn move_col_reorders_and_keeps_quotes() {
        let c = csv("a,\"b,1\",c\n1,2,3\n");
        assert_eq!(apply(&c, c.move_col(0, 2)), "\"b,1\",c,a\n2,3,1\n");
        assert_eq!(apply(&c, c.move_col(2, 0)), "c,a,\"b,1\"\n3,1,2\n");
        assert!(c.move_col(1, 1).is_empty());
    }

    #[test]
    fn sort_file_rewrites_rows_in_order_and_keeps_header() {
        let c = csv("n,v\r\nb,10\r\na,9\r\nc,\"100\"\r\n");
        let e = c.sort_file(true, '.', Sort { col: 1, desc: false });
        assert_eq!(apply(&c, e), "n,v\r\na,9\r\nb,10\r\nc,\"100\"\r\n");
        let e = c.sort_file(true, '.', Sort { col: 0, desc: true });
        assert_eq!(apply(&c, e), "n,v\r\nc,\"100\"\r\nb,10\r\na,9\r\n");
        let sorted = csv("n\n1\n2");
        assert!(sorted.sort_file(true, '.', Sort { col: 0, desc: false }).is_empty());
        let nh = csv("b\na");
        assert_eq!(apply(&nh, nh.sort_file(false, '.', Sort { col: 0, desc: false })), "a\nb");
    }
}
