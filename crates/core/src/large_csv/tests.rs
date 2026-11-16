use super::*;
use crate::csv::Csv;
use crate::large::Limits;

fn tiny() -> CsvLimits {
    CsvLimits { step: 3, scan_chunk: 40, slice: 48 }
}

fn file(bytes: &[u8]) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.csv");
    std::fs::write(&p, bytes).unwrap();
    (dir, p)
}

fn open(p: &Path, delim: Option<char>, header: bool, limits: CsvLimits) -> Arc<LargeCsv> {
    let t = LargeCsv::open_path(p, Encoding::Utf8, 0, delim, header, '.', None, limits).unwrap();
    t.index_blocking();
    assert!(t.summary().unwrap().done, "{:?}", t.summary().unwrap().error);
    t
}

/// Os valores de uma linha, para comparar sem as posições.
fn values(r: &RowOut) -> Vec<String> {
    r.cells.iter().map(|c| c.value.clone()).collect()
}

/// A tabela lida por faixas é igual à do `Csv::parse` do texto inteiro, em toda faixa.
fn assert_same_as_whole(t: &LargeCsv, text: &str, delim: char, header: bool) {
    let whole = Csv::parse(text.to_string(), delim);
    let sum = t.summary().unwrap();
    let skip = header as usize;
    assert_eq!(sum.total as usize, whole.row_count().saturating_sub(skip), "total de linhas");
    assert_eq!(sum.cols, whole.cols(), "colunas");
    assert_eq!(sum.unterminated, whole.unterminated(), "aspa aberta");
    assert_eq!(sum.types, whole.column_types(header, '.'), "tipos");
    let n = sum.total as usize;
    for (from, count) in [(0, n), (0, 1), (1, 2), (2, 5), (n.saturating_sub(1), 3), (n / 2, 4), (n, 2)] {
        let got = t.rows(from, count).unwrap();
        let want: Vec<RowOut> = whole.rows(from + skip, count).into_iter().filter(|_| from < n).collect();
        let want = &want[..want.len().min(n.saturating_sub(from))];
        assert_eq!(got.len(), want.len().min(count), "faixa ({from}, {count}) de {n}");
        for (g, w) in got.iter().zip(want) {
            assert_eq!(values(g), values(w), "faixa ({from}, {count}), linha {}", w.index);
            assert_eq!(g.index, w.index, "índice no arquivo");
            for (a, b) in g.cells.iter().zip(&w.cells) {
                assert_eq!((a.cut, a.quoted), (b.cut, b.quoted));
            }
        }
    }
}

// ---- casos simples -------------------------------------------------------------------

#[test]
fn simple_file_is_read_by_ranges() {
    let text = "id,nome\n1,Ana\n2,Bia\n3,Caio\n4,Duda\n5,Eva\n6,Fábio\n";
    let (_d, p) = file(text.as_bytes());
    let t = open(&p, Some(','), true, tiny());
    let s = t.summary().unwrap();
    assert_eq!((s.rows, s.total, s.cols), (6, 6, 2));
    assert_eq!(values(s.header.as_ref().unwrap()), ["id", "nome"]);
    let r = t.rows(2, 3).unwrap();
    assert_eq!(r.iter().map(values).collect::<Vec<_>>(), [["3", "Caio"], ["4", "Duda"], ["5", "Eva"]]);
    assert_eq!(r[0].index, 3, "o índice é o do registro no arquivo (o cabeçalho é o 0)");
    assert_same_as_whole(&t, text, ',', true);
}

#[test]
fn without_header_the_first_record_is_data() {
    let text = "1,Ana\n2,Bia\n3,Caio\n";
    let (_d, p) = file(text.as_bytes());
    let t = open(&p, Some(','), false, tiny());
    assert_eq!(t.summary().unwrap().rows, 3);
    assert!(t.summary().unwrap().header.is_none());
    assert_eq!(values(&t.rows(0, 1).unwrap()[0]), ["1", "Ana"]);
    assert_same_as_whole(&t, text, ',', false);
}

#[test]
fn edge_files_empty_header_only_no_trailing_newline_and_unterminated_quote() {
    for text in ["", "id,nome\n", "id,nome", "a,b\n1,2", "a,b\n1,\"aberta\n2,3\n", "\n\n\n", "a\r\nb\r\nc"] {
        let (_d, p) = file(text.as_bytes());
        for header in [true, false] {
            let t = open(&p, Some(','), header, tiny());
            assert_same_as_whole(&t, text, ',', header);
        }
    }
    let (_d, p) = file(b"a,b\n1,\"aberta\n2,3\n");
    assert!(open(&p, Some(','), true, tiny()).summary().unwrap().unterminated);
}

#[test]
fn quoted_newlines_commas_and_escaped_quotes_stay_in_one_record() {
    let text = "id,obs\n1,\"linha um\nlinha dois, com vírgula\"\n2,\"disse \"\"oi\"\"\"\n3,\n4,\"\"\n";
    let (_d, p) = file(text.as_bytes());
    let t = open(&p, Some(','), true, tiny());
    assert_eq!(t.summary().unwrap().rows, 4, "a quebra dentro das aspas não cria registro");
    let r = t.rows(0, 4).unwrap();
    assert_eq!(r[0].cells[1].value, "linha um\nlinha dois, com vírgula");
    assert_eq!(r[1].cells[1].value, "disse \"oi\"");
    assert_same_as_whole(&t, text, ',', true);
}

#[test]
fn a_record_bigger_than_every_read_chunk_is_still_read_whole() {
    let giant = "célula enorme 😀 ".repeat(500); // ~ 9 KB, o pedaço de leitura é de 48 bytes
    let text = format!("id,obs\n1,x\n2,\"{giant}\"\n3,y\n");
    let (_d, p) = file(text.as_bytes());
    let t = open(&p, Some(','), true, tiny());
    assert_eq!(t.summary().unwrap().rows, 3);
    let r = t.rows(1, 1).unwrap();
    assert!(r[0].cells[1].cut && giant.starts_with(&r[0].cells[1].value), "a faixa devolve a célula cortada");
    assert!(t.cell(1, 1).unwrap().unwrap().value == giant, "e a célula inteira vem de `cell`, mesmo maior que todo pedaço lido");
    assert_eq!(values(&t.rows(2, 1).unwrap()[0]), ["3", "y"]);
    assert_same_as_whole(&t, &text, ',', true);
}

#[test]
fn rows_past_the_end_are_empty_and_ranges_are_clipped() {
    let (_d, p) = file(b"a,b\n1,2\n3,4\n");
    let t = open(&p, Some(','), true, tiny());
    assert!(t.rows(2, 5).unwrap().is_empty());
    assert!(t.rows(99, 5).unwrap().is_empty());
    assert_eq!(t.rows(1, 99).unwrap().len(), 1);
    assert!(t.rows(0, 0).unwrap().is_empty());
}

#[test]
fn utf8_bom_is_skipped_and_cp1252_is_decoded() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("id,nome\n1,Conceição\n".as_bytes());
    let (_d, p) = file(&bytes);
    let t = LargeCsv::open_path(&p, Encoding::Utf8Bom, 3, Some(','), true, '.', None, tiny()).unwrap();
    t.index_blocking();
    assert_eq!(values(t.summary().unwrap().header.as_ref().unwrap()), ["id", "nome"], "o BOM não vira parte do cabeçalho");
    assert_eq!(values(&t.rows(0, 1).unwrap()[0]), ["1", "Conceição"]);

    let (_d, p) = file(b"id,nome\n1,Concei\xE7\xE3o\n");
    let t = LargeCsv::open_path(&p, Encoding::Windows1252, 0, Some(','), true, '.', None, tiny()).unwrap();
    t.index_blocking();
    assert_eq!(values(&t.rows(0, 1).unwrap()[0]), ["1", "Conceição"]);
}

#[test]
fn the_delimiter_is_detected_from_the_start_of_the_file() {
    for (text, d) in [("a;b;c\n1;2;3\n4;5;6\n", ";"), ("a\tb\n1\t2\n3\t4\n", "\t"), ("a|b|c\n1|2|3\n", "|"), ("a,b\n1,2\n", ",")] {
        let (_d, p) = file(text.as_bytes());
        let t = LargeCsv::open_path(&p, Encoding::Utf8, 0, None, true, '.', None, tiny()).unwrap();
        t.index_blocking();
        assert_eq!(t.summary().unwrap().delimiter, d, "{text:?}");
        assert_eq!(t.summary().unwrap().cols, text.lines().next().unwrap().split(d).count());
    }
    let (_d, p) = file(b"a b\n1 2\n");
    let t = LargeCsv::open_path(&p, Encoding::Utf8, 0, None, true, '.', Some("tsv"), tiny()).unwrap();
    assert_eq!(t.summary().unwrap().delimiter, "\t", ".tsv manda no tab");
}

// ---- arquivo mudou, progresso, células e estatísticas --------------------------------

#[test]
fn a_file_that_changed_on_disk_is_refused_instead_of_read_wrong() {
    let (_d, p) = file(b"a,b\n1,2\n3,4\n");
    let t = open(&p, Some(','), true, tiny());
    std::fs::write(&p, b"a,b\n9,9\n9,9\n9,9\n9,9\n").unwrap();
    assert!(t.rows(0, 2).is_err());
    assert!(t.cell(0, 0).is_err());
    assert!(t.stats(0, 2, 0, 2).is_err());
    assert_eq!(t.summary().unwrap().rows, 2, "o resumo é o do índice que se tem");
}

#[test]
fn rows_can_be_read_while_the_scan_is_still_running() {
    let text: String = std::iter::once("id\n".to_string()).chain((0..20_000).map(|i| format!("{i}\n"))).collect();
    let (_d, p) = file(text.as_bytes());
    let t = LargeCsv::open_path(&p, Encoding::Utf8, 0, Some(','), true, '.', None, CsvLimits { step: 16, scan_chunk: 512, slice: 256 }).unwrap();
    t.start_index();
    let mut last = 0u64;
    for _ in 0..2000 {
        let s = t.summary().unwrap();
        assert!(s.rows >= last, "a contagem só cresce");
        last = s.rows;
        if s.rows > 100 {
            assert_eq!(values(&t.rows(50, 1).unwrap()[0]), ["50"], "linhas já achadas leem sem esperar o fim");
        }
        if s.done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    let s = t.summary().unwrap();
    assert!(s.done);
    assert_eq!((s.rows, s.scanned), (20_000, s.size));
    assert_eq!(values(&t.rows(19_999, 1).unwrap()[0]), ["19999"]);
}

#[test]
fn cut_cells_have_a_full_value_through_cell() {
    let big = "x".repeat(5_000);
    let text = format!("a,b\n1,\"{big}\"\n");
    let (_d, p) = file(text.as_bytes());
    let t = open(&p, Some(','), true, tiny());
    let r = t.rows(0, 1).unwrap();
    assert!(r[0].cells[1].cut && r[0].cells[1].value.len() < big.len(), "a tabela recebe a célula cortada");
    assert_eq!(t.cell(0, 1).unwrap().unwrap().value, big, "e pede a inteira quando precisa");
    assert!(t.cell(5, 0).unwrap().is_none());
    assert!(t.cell(0, 9).unwrap().is_none());
}

#[test]
fn stats_match_the_whole_file_blocks_and_all() {
    let text: String = std::iter::once("id,valor,nome\n".to_string())
        .chain((0..5_000).map(|i| format!("{i},{}.{:02},n{}\n", i % 97, i % 100, i % 3)))
        .collect();
    let (_d, p) = file(text.as_bytes());
    let t = open(&p, Some(','), true, CsvLimits { step: 64, scan_chunk: 4096, slice: 1024 });
    let whole = Csv::parse(text.clone(), ',');
    for (r0, r1, c0, c1) in [(0, 5_000, 1, 2), (10, 4_990, 0, 3), (2_500, 2_501, 1, 2), (4_000, 5_000, 2, 3)] {
        let got = t.stats(r0, r1, c0, c1).unwrap();
        let want = whole.stats((r0 + 1)..(r1 + 1), c0..c1, '.');
        assert_eq!((got.count, got.numeric, got.skipped), (want.count, want.numeric, want.skipped), "{r0}..{r1}");
        assert!((got.sum - want.sum).abs() < 1e-6);
        assert_eq!(got.min, want.min);
        assert_eq!(got.max, want.max);
        assert_eq!(got.avg.map(|a| (a * 1e6).round()), want.avg.map(|a| (a * 1e6).round()));
    }
    assert!(t.stats(0, MAX_STATS_ROWS + 1, 0, 1).is_err(), "seleção enorme é recusada");
}

#[test]
fn opens_from_a_large_file_taking_path_encoding_and_bom_from_it() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.csv");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("id;nome\n1;Ana\n2;Conceição\n".as_bytes());
    std::fs::write(&p, &bytes).unwrap();
    let l = Large::open(&p, Limits::default(), None).unwrap();
    let t = LargeCsv::open(&l, None, true, '.', Some("csv"), tiny()).unwrap();
    t.index_blocking();
    let s = t.summary().unwrap();
    assert_eq!((s.delimiter.as_str(), s.rows), (";", 2));
    assert_eq!(values(&t.rows(1, 1).unwrap()[0]), ["2", "Conceição"]);
}

// ---- propriedade: conteúdo variado, pedaços e checkpoints minúsculos ------------------

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn cases(default: usize) -> usize {
    std::env::var("FULLPAD_PROP_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn random_csv(rng: &mut Rng, delim: char) -> String {
    const PLAIN: &[&str] = &["a", "bb", "ção", "x y", "12", "3.5", "😀", "€"];
    const QUOTED: &[&str] = &["\"com, vírgula\"", "\"linha\nquebrada\"", "\"disse \"\"oi\"\"\"", "\"\"", "\"a\r\nb\"", "\"x;y\ty\"", "\"😀\n😀\""];
    const ENDS: &[&str] = &["\n", "\n", "\n", "\r\n", "\r"];
    let mut s = String::new();
    for _ in 0..rng.below(40) {
        for c in 0..rng.below(5) {
            if c > 0 {
                s.push(delim);
            }
            match rng.below(8) {
                0 => {}
                1 | 2 => s.push_str(QUOTED[rng.below(QUOTED.len())]),
                3 => s.push_str(&PLAIN[rng.below(PLAIN.len())].repeat(1 + rng.below(30))), // campo comprido
                4 => s.push('"'), // aspa solta no meio de um campo
                _ => s.push_str(PLAIN[rng.below(PLAIN.len())]),
            }
        }
        s.push_str(ENDS[rng.below(ENDS.len())]);
    }
    if rng.below(4) == 0 {
        s.pop(); // sem terminador no fim
    }
    s
}

#[test]
fn property_ranges_equal_the_whole_file_parse_for_random_csv_and_tiny_chunks() {
    let mut rng = Rng(0x2545_F491_4F6C_DD1D);
    for case in 0..cases(500) {
        let delim = [',', ';', '\t'][case % 3];
        let text = random_csv(&mut rng, delim);
        let limits = CsvLimits { step: 1 + rng.below(5), scan_chunk: 16 + rng.below(80), slice: 16 + rng.below(80) };
        let (_d, p) = file(text.as_bytes());
        let header = rng.below(2) == 0;
        let t = open(&p, Some(delim), header, limits);
        assert_same_as_whole(&t, &text, delim, header);
    }
}

#[test]
fn property_the_same_with_bom_and_cp1252() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for case in 0..cases(200) {
        let text = random_csv(&mut rng, ',');
        let limits = CsvLimits { step: 1 + rng.below(4), scan_chunk: 16 + rng.below(60), slice: 16 + rng.below(60) };
        if case % 2 == 0 {
            let mut bytes = vec![0xEF, 0xBB, 0xBF];
            bytes.extend_from_slice(text.as_bytes());
            let (_d, p) = file(&bytes);
            let t = LargeCsv::open_path(&p, Encoding::Utf8Bom, 3, Some(','), true, '.', None, limits).unwrap();
            t.index_blocking();
            assert_same_as_whole(&t, &text, ',', true);
        } else {
            let latin: String = text.chars().filter(|c| (*c as u32) < 0x100).collect();
            let (bytes, _, _) = encoding_rs::WINDOWS_1252.encode(&latin);
            let (_d, p) = file(&bytes);
            let t = LargeCsv::open_path(&p, Encoding::Windows1252, 0, Some(','), true, '.', None, limits).unwrap();
            t.index_blocking();
            assert_same_as_whole(&t, &latin, ',', true);
        }
    }
}

/// Volume real: `FULLPAD_VOLUME_CSV=/caminho/grande.csv cargo test -p fullpad-core --release -- --ignored volume_csv --nocapture`
/// (gere o arquivo com `examples/large/gerar_csv.py 2000`).
#[test]
#[ignore]
fn volume_csv_indexes_and_reads_ranges() {
    use std::time::Instant;
    let Some(path) = std::env::var_os("FULLPAD_VOLUME_CSV") else { return eprintln!("defina FULLPAD_VOLUME_CSV") };
    let path = PathBuf::from(path);
    let t0 = Instant::now();
    let t = LargeCsv::open_path(&path, Encoding::Utf8, 0, None, true, '.', Some("csv"), CsvLimits::default()).unwrap();
    eprintln!("abrir: {:?}", t0.elapsed());
    let t0 = Instant::now();
    t.index_blocking();
    let s = t.summary().unwrap();
    eprintln!("índice: {:?}: {} linhas, {} colunas, {} MB", t0.elapsed(), s.rows, s.cols, s.size / 1_000_000);
    assert!(s.done && s.error.is_none());
    for from in [0, s.rows as usize / 2, s.rows as usize - 3] {
        let t0 = Instant::now();
        let r = t.rows(from, 100).unwrap();
        eprintln!("100 linhas a partir de {from}: {:?} ({} lidas, primeira: {:?})", t0.elapsed(), r.len(), r.first().map(values));
        assert!(!r.is_empty());
    }
    let t0 = Instant::now();
    let st = t.stats(1_000_000, 1_050_000, 3, 4).unwrap();
    eprintln!("estatísticas de 50 mil linhas: {:?} (soma {:.2}, {} números)", t0.elapsed(), st.sum, st.numeric);
}
