-- =====================================================================
--  Banco de dados da barbearia (SQLite)
--  O servidor cria estas tabelas sozinho na primeira vez que roda.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- Contas de acesso ao painel do dono
CREATE TABLE IF NOT EXISTS donos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario     TEXT NOT NULL UNIQUE,
  nome        TEXT NOT NULL,
  senha_hash  TEXT NOT NULL,                 -- senha criptografada (nunca a senha pura)
  criado_em   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Clientes com conta no app
CREATE TABLE IF NOT EXISTS clientes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT NOT NULL,
  telefone    TEXT NOT NULL UNIQUE,          -- só números, com DDD
  senha_hash  TEXT NOT NULL,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Logins ativos (cada aparelho conectado tem um token)
CREATE TABLE IF NOT EXISTS sessoes (
  token       TEXT PRIMARY KEY,
  tipo        TEXT NOT NULL CHECK (tipo IN ('cliente', 'dono')),
  usuario_id  INTEGER NOT NULL,
  expira_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS barbeiros (
  id                 TEXT PRIMARY KEY,
  nome               TEXT NOT NULL,
  telefone           TEXT NOT NULL DEFAULT '',
  especialidade      TEXT NOT NULL DEFAULT '',
  folga              TEXT NOT NULL DEFAULT '[]',   -- dias da semana em JSON (0 = domingo)
  comissao           REAL NOT NULL DEFAULT 50 CHECK (comissao BETWEEN 0 AND 100),
  comissao_produtos  REAL NOT NULL DEFAULT 10 CHECK (comissao_produtos BETWEEN 0 AND 100),
  ativo              INTEGER NOT NULL DEFAULT 1,
  entrou_em          TEXT,
  desligado_em       TEXT
);

CREATE TABLE IF NOT EXISTS servicos (
  id       TEXT PRIMARY KEY,
  nome     TEXT NOT NULL,
  icone    TEXT NOT NULL DEFAULT '',
  preco    REAL NOT NULL CHECK (preco >= 0),
  duracao  INTEGER NOT NULL CHECK (duracao > 0),     -- minutos
  ativo    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS produtos (
  id         TEXT PRIMARY KEY,
  nome       TEXT NOT NULL,
  categoria  TEXT NOT NULL DEFAULT '',
  icone      TEXT NOT NULL DEFAULT '',
  preco      REAL NOT NULL CHECK (preco >= 0),        -- preço de venda
  custo      REAL NOT NULL DEFAULT 0 CHECK (custo >= 0), -- quanto a barbearia pagou
  estoque    INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  ativo      INTEGER NOT NULL DEFAULT 1
);

-- Horário de cada dia da semana (0 = domingo ... 6 = sábado)
CREATE TABLE IF NOT EXISTS funcionamento (
  dia_semana  INTEGER PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),
  aberto      INTEGER NOT NULL,
  abre        TEXT NOT NULL,
  fecha       TEXT NOT NULL
);

-- Feriados e dias em que a barbearia não abre
CREATE TABLE IF NOT EXISTS datas_fechadas (
  data    TEXT PRIMARY KEY,
  motivo  TEXT NOT NULL DEFAULT ''
);

-- Outras configurações (intervalo entre horários, dias de antecedência...)
CREATE TABLE IF NOT EXISTS configuracoes (
  chave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id      INTEGER REFERENCES clientes(id),   -- vazio quando foi marcado no balcão sem conta
  cliente_nome    TEXT NOT NULL,
  telefone        TEXT NOT NULL DEFAULT '',
  servico_id      TEXT NOT NULL REFERENCES servicos(id),
  servico_nome    TEXT NOT NULL,                      -- guardado para o histórico não mudar
  preco           REAL NOT NULL,
  duracao         INTEGER NOT NULL,
  barbeiro_id     TEXT NOT NULL REFERENCES barbeiros(id),
  barbeiro_nome   TEXT NOT NULL,
  dia             TEXT NOT NULL,                      -- AAAA-MM-DD
  hora            TEXT NOT NULL,                      -- HH:MM
  total           REAL NOT NULL,                      -- serviço + produtos
  pagamento       TEXT NOT NULL,
  pago            INTEGER NOT NULL DEFAULT 0,
  obs             TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'confirmado'
                  CHECK (status IN ('confirmado', 'atendido', 'faltou', 'cancelado')),
  origem          TEXT NOT NULL DEFAULT 'app',        -- app ou balcao
  comissao_valor  REAL,                               -- quanto o barbeiro ganhou (definido ao atender)
  criado_em       TEXT NOT NULL,
  atendido_em     TEXT
);
CREATE INDEX IF NOT EXISTS idx_agendamentos_barbeiro_dia ON agendamentos (barbeiro_id, dia);
CREATE INDEX IF NOT EXISTS idx_agendamentos_cliente ON agendamentos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_agendamentos_dia ON agendamentos (dia);

-- Produtos pedidos junto com o agendamento (entregues no dia do atendimento)
CREATE TABLE IF NOT EXISTS agendamento_produtos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agendamento_id  INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
  produto_id      TEXT NOT NULL REFERENCES produtos(id),
  nome            TEXT NOT NULL,
  qtd             INTEGER NOT NULL CHECK (qtd > 0),
  preco           REAL NOT NULL,
  custo           REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agprod_agendamento ON agendamento_produtos (agendamento_id);

-- Pagamentos feitos aos barbeiros
CREATE TABLE IF NOT EXISTS pagamentos_barbeiros (
  id           TEXT PRIMARY KEY,
  barbeiro_id  TEXT NOT NULL REFERENCES barbeiros(id),
  valor        REAL NOT NULL CHECK (valor > 0),
  data         TEXT NOT NULL,
  forma        TEXT NOT NULL,
  obs          TEXT NOT NULL DEFAULT ''
);

-- Despesas da barbearia (aluguel, luz, água...)
CREATE TABLE IF NOT EXISTS despesas (
  id         TEXT PRIMARY KEY,
  descricao  TEXT NOT NULL,
  categoria  TEXT NOT NULL,
  valor      REAL NOT NULL CHECK (valor > 0),
  data       TEXT NOT NULL
);
