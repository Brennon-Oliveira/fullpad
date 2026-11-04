-- Fullpad — exemplo de SQL (PostgreSQL): loja virtual com relatórios analíticos.

CREATE TABLE clientes (
    id          BIGSERIAL PRIMARY KEY,
    nome        VARCHAR(120) NOT NULL,
    email       VARCHAR(160) NOT NULL UNIQUE,
    cidade      VARCHAR(80),
    criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE produtos (
    id          BIGSERIAL PRIMARY KEY,
    sku         CHAR(6) NOT NULL UNIQUE,
    nome        VARCHAR(160) NOT NULL,
    categoria   VARCHAR(40) NOT NULL,
    preco       NUMERIC(10, 2) NOT NULL CHECK (preco >= 0)
);

CREATE TABLE pedidos (
    id          BIGSERIAL PRIMARY KEY,
    cliente_id  BIGINT NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
    feito_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status      VARCHAR(20) NOT NULL DEFAULT 'novo'
                CHECK (status IN ('novo', 'pago', 'enviado', 'entregue', 'cancelado'))
);

CREATE TABLE itens_pedido (
    pedido_id   BIGINT NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
    produto_id  BIGINT NOT NULL REFERENCES produtos (id),
    quantidade  INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unit  NUMERIC(10, 2) NOT NULL,
    PRIMARY KEY (pedido_id, produto_id)
);

CREATE INDEX idx_pedidos_cliente_data ON pedidos (cliente_id, feito_em DESC);
CREATE INDEX idx_produtos_categoria ON produtos (categoria) WHERE preco > 100;

INSERT INTO clientes (nome, email, cidade) VALUES
    ('Ana Souza',      'ana@example.com',    'São Paulo'),
    ('João Álvares',   'joao@example.com',   'Belo Horizonte'),
    ('Mariana Costa',  'mariana@example.com', NULL);

INSERT INTO produtos (sku, nome, categoria, preco) VALUES
    ('CAD001', 'Caderno pautado', 'papelaria', 24.90),
    ('MOC001', 'Mochila impermeável', 'acessorios', 219.90),
    ('TEC001', 'Teclado mecânico', 'eletronicos', 459.90);

-- 1. Total gasto por cliente (só pedidos não cancelados), com ranking
WITH gastos AS (
    SELECT c.id,
           c.nome,
           COALESCE(SUM(i.quantidade * i.preco_unit), 0) AS total
      FROM clientes c
      LEFT JOIN pedidos p       ON p.cliente_id = c.id AND p.status <> 'cancelado'
      LEFT JOIN itens_pedido i  ON i.pedido_id = p.id
     GROUP BY c.id, c.nome
)
SELECT nome,
       total,
       RANK() OVER (ORDER BY total DESC)                      AS posicao,
       ROUND(100 * total / NULLIF(SUM(total) OVER (), 0), 1)  AS pct_do_total
  FROM gastos
 ORDER BY posicao;

-- 2. Vendas por mês e variação em relação ao mês anterior
SELECT date_trunc('month', p.feito_em)::date AS mes,
       SUM(i.quantidade * i.preco_unit)      AS faturamento,
       SUM(i.quantidade * i.preco_unit)
         - LAG(SUM(i.quantidade * i.preco_unit)) OVER (ORDER BY date_trunc('month', p.feito_em)) AS variacao
  FROM pedidos p
  JOIN itens_pedido i ON i.pedido_id = p.id
 WHERE p.status IN ('pago', 'enviado', 'entregue')
 GROUP BY 1
 ORDER BY 1;

-- 3. Produtos que nunca foram vendidos
SELECT pr.sku, pr.nome
  FROM produtos pr
 WHERE NOT EXISTS (SELECT 1 FROM itens_pedido i WHERE i.produto_id = pr.id);

-- 4. Atualização em transação
BEGIN;
UPDATE pedidos SET status = 'cancelado'
 WHERE status = 'novo' AND feito_em < now() - INTERVAL '7 days'
RETURNING id, cliente_id;
COMMIT;
