//! Calculadora de expressões com precedência — exemplo de Rust para o Fullpad.

use std::collections::HashMap;
use std::fmt;
use std::iter::Peekable;
use std::str::Chars;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Numero(f64),
    Ident(String),
    Op(char),
    AbreParen,
    FechaParen,
}

#[derive(Debug)]
pub enum Erro {
    CaractereInesperado(char, usize),
    FimInesperado,
    VariavelDesconhecida(String),
    DivisaoPorZero,
}

impl fmt::Display for Erro {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Erro::CaractereInesperado(c, pos) => write!(f, "caractere {c:?} inesperado na posição {pos}"),
            Erro::FimInesperado => write!(f, "a expressão terminou antes da hora"),
            Erro::VariavelDesconhecida(nome) => write!(f, "variável desconhecida: {nome}"),
            Erro::DivisaoPorZero => write!(f, "divisão por zero"),
        }
    }
}

impl std::error::Error for Erro {}

pub struct Lexer<'a> {
    chars: Peekable<Chars<'a>>,
    pos: usize,
}

impl<'a> Lexer<'a> {
    pub fn novo(entrada: &'a str) -> Self {
        Self { chars: entrada.chars().peekable(), pos: 0 }
    }

    fn avancar(&mut self) -> Option<char> {
        self.pos += 1;
        self.chars.next()
    }
}

impl Iterator for Lexer<'_> {
    type Item = Result<Token, Erro>;

    fn next(&mut self) -> Option<Self::Item> {
        while self.chars.peek().is_some_and(|c| c.is_whitespace()) {
            self.avancar();
        }
        let c = *self.chars.peek()?;
        Some(match c {
            '0'..='9' | '.' => {
                let mut s = String::new();
                while let Some(&d) = self.chars.peek() {
                    if d.is_ascii_digit() || d == '.' { s.push(d); self.avancar(); } else { break; }
                }
                Ok(Token::Numero(s.parse().unwrap_or(0.0)))
            }
            'a'..='z' | 'A'..='Z' | '_' => {
                let mut s = String::new();
                while let Some(&d) = self.chars.peek() {
                    if d.is_alphanumeric() || d == '_' { s.push(d); self.avancar(); } else { break; }
                }
                Ok(Token::Ident(s))
            }
            '+' | '-' | '*' | '/' | '^' => { self.avancar(); Ok(Token::Op(c)) }
            '(' => { self.avancar(); Ok(Token::AbreParen) }
            ')' => { self.avancar(); Ok(Token::FechaParen) }
            outro => Err(Erro::CaractereInesperado(outro, self.pos)),
        })
    }
}

#[derive(Debug)]
pub enum Expr {
    Num(f64),
    Var(String),
    Bin(Box<Expr>, char, Box<Expr>),
    Neg(Box<Expr>),
}

fn precedencia(op: char) -> (u8, bool) {
    match op {
        '+' | '-' => (1, false),
        '*' | '/' => (2, false),
        '^' => (3, true), // associa à direita
        _ => (0, false),
    }
}

pub struct Parser {
    tokens: Vec<Token>,
    i: usize,
}

impl Parser {
    pub fn novo(tokens: Vec<Token>) -> Self {
        Self { tokens, i: 0 }
    }

    fn espiar(&self) -> Option<&Token> {
        self.tokens.get(self.i)
    }

    pub fn expressao(&mut self, minimo: u8) -> Result<Expr, Erro> {
        let mut esq = self.primario()?;
        while let Some(&Token::Op(op)) = self.espiar() {
            let (prec, direita) = precedencia(op);
            if prec < minimo { break; }
            self.i += 1;
            let dir = self.expressao(if direita { prec } else { prec + 1 })?;
            esq = Expr::Bin(Box::new(esq), op, Box::new(dir));
        }
        Ok(esq)
    }

    fn primario(&mut self) -> Result<Expr, Erro> {
        let token = self.tokens.get(self.i).cloned().ok_or(Erro::FimInesperado)?;
        self.i += 1;
        match token {
            Token::Numero(n) => Ok(Expr::Num(n)),
            Token::Ident(nome) => Ok(Expr::Var(nome)),
            Token::Op('-') => Ok(Expr::Neg(Box::new(self.primario()?))),
            Token::AbreParen => {
                let e = self.expressao(1)?;
                match self.tokens.get(self.i) {
                    Some(Token::FechaParen) => { self.i += 1; Ok(e) }
                    _ => Err(Erro::FimInesperado),
                }
            }
            _ => Err(Erro::FimInesperado),
        }
    }
}

pub fn avaliar(e: &Expr, vars: &HashMap<&str, f64>) -> Result<f64, Erro> {
    Ok(match e {
        Expr::Num(n) => *n,
        Expr::Var(v) => *vars.get(v.as_str()).ok_or_else(|| Erro::VariavelDesconhecida(v.clone()))?,
        Expr::Neg(inner) => -avaliar(inner, vars)?,
        Expr::Bin(a, op, b) => {
            let (x, y) = (avaliar(a, vars)?, avaliar(b, vars)?);
            match op {
                '+' => x + y,
                '-' => x - y,
                '*' => x * y,
                '/' if y == 0.0 => return Err(Erro::DivisaoPorZero),
                '/' => x / y,
                '^' => x.powf(y),
                _ => unreachable!("operador {op}"),
            }
        }
    })
}

pub fn calcular(entrada: &str, vars: &HashMap<&str, f64>) -> Result<f64, Box<dyn std::error::Error>> {
    let tokens = Lexer::novo(entrada).collect::<Result<Vec<_>, _>>()?;
    let expr = Parser::novo(tokens).expressao(1)?;
    Ok(avaliar(&expr, vars)?)
}

fn main() {
    let vars = HashMap::from([("pi", std::f64::consts::PI), ("raio", 2.5)]);
    for entrada in ["1 + 2 * 3", "2 ^ 3 ^ 2", "-(4 - 6) * 5", "pi * raio ^ 2", "10 / (5 - 5)", "2 $ 3", "x + 1"] {
        match calcular(entrada, &vars) {
            Ok(v) => println!("{entrada:<16} = {v:.4}"),
            Err(e) => println!("{entrada:<16} ! {e}"),
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn precedencia_basica() {
        assert_eq!(calcular("1 + 2 * 3", &HashMap::new()).unwrap(), 7.0);
        assert_eq!(calcular("2 ^ 3 ^ 2", &HashMap::new()).unwrap(), 512.0);
    }
}
