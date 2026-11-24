"""
Servidor da barbearia — API + banco de dados SQLite.
Usa só o que já vem com o Python (não precisa instalar nada).

Como rodar (na pasta do projeto):
    python servidor/servidor.py              -> abre em http://localhost:8000
    python servidor/servidor.py --rede       -> libera para celulares no mesmo Wi-Fi
    python servidor/servidor.py --resetar    -> apaga o banco e cria de novo com os dados de teste
"""

import hashlib
import hmac
import json
import os
import random
import re
import secrets
import socket
import sqlite3
import sys
import threading
import traceback
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PASTA = os.path.dirname(os.path.abspath(__file__))
PASTA_SITE = os.path.normpath(os.path.join(PASTA, "..", "cliente"))
BANCO = os.path.join(PASTA, "barbearia.db")
SCHEMA = os.path.join(PASTA, "schema.sql")
PORTA = int(os.environ.get("PORTA", "8000"))

DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]
FORMAS_APP = ["Pix", "Cartão de crédito", "Cartão de débito", "Pagar na barbearia"]
FORMAS_BALCAO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito"]
FORMAS_PAG_BARBEIRO = ["Pix", "Dinheiro", "Transferência"]
INTERVALOS = [15, 20, 30, 40, 45, 60]

TRAVA = threading.Lock()  # uma alteração por vez, para dois clientes não pegarem o mesmo horário


# =====================================================================
#  Utilitários
# =====================================================================
class Erro(Exception):
    def __init__(self, mensagem, status=400):
        super().__init__(mensagem)
        self.status = status


class Arquivo:
    """Resposta que é um arquivo para baixar (ex.: backup)."""
    def __init__(self, dados, tipo, nome):
        self.dados, self.tipo, self.nome = dados, tipo, nome


@contextmanager
def conectar():
    db = sqlite3.connect(BANCO, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def agora():
    return datetime.now()


def hoje():
    return date.today()


def para_min(h):
    a, b = h.split(":")
    return int(a) * 60 + int(b)


def dia_semana_js(d):
    """Python: segunda = 0. No site: domingo = 0."""
    return (d.weekday() + 1) % 7


def digitos(v):
    return re.sub(r"\D", "", str(v or ""))


def texto(obj, campo, obrigatorio=True, maximo=120, nome=None):
    v = obj.get(campo, "")
    if v is None:
        v = ""
    if not isinstance(v, str):
        raise Erro(f"Campo inválido: {nome or campo}.")
    v = v.strip()
    if obrigatorio and not v:
        raise Erro(f"Preencha o campo {nome or campo}.")
    if len(v) > maximo:
        raise Erro(f"O campo {nome or campo} pode ter no máximo {maximo} caracteres.")
    return v


def numero(v, nome, minimo=None, maximo=None, inteiro=False):
    if isinstance(v, bool):
        raise Erro(f"Valor inválido em {nome}.")
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise Erro(f"Valor inválido em {nome}.")
    if n != n or n in (float("inf"), float("-inf")):
        raise Erro(f"Valor inválido em {nome}.")
    if inteiro:
        if n != int(n):
            raise Erro(f"{nome} precisa ser um número inteiro.")
        n = int(n)
    if minimo is not None and n < minimo:
        raise Erro(f"{nome} precisa ser no mínimo {minimo}.")
    if maximo is not None and n > maximo:
        raise Erro(f"{nome} pode ser no máximo {maximo}.")
    return n


def data_valida(v, nome="data"):
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise Erro(f"Data inválida em {nome}.")
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise Erro(f"Data inválida em {nome}.")


def hora_valida(v, nome="horário"):
    if not isinstance(v, str) or not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
        raise Erro(f"Horário inválido em {nome}.")
    return v


def id_valido(v, nome="id"):
    if not isinstance(v, str) or not re.fullmatch(r"[\w-]{1,64}", v):
        raise Erro(f"Identificador inválido em {nome}.")
    return v


def lista(obj, campo):
    v = obj.get(campo, [])
    if not isinstance(v, list):
        raise Erro(f"Campo inválido: {campo}.")
    return v


def novo_id(prefixo):
    return prefixo + secrets.token_hex(6)


# =====================================================================
#  Senhas e sessões
# =====================================================================
def gerar_hash(senha):
    sal = secrets.token_bytes(16)
    iteracoes = 200_000
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal, iteracoes)
    return f"pbkdf2_sha256${iteracoes}${sal.hex()}${h.hex()}"


def conferir_senha(senha, guardado):
    try:
        _, iteracoes, sal, h = guardado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", senha.encode(), bytes.fromhex(sal), int(iteracoes))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(calc.hex(), h)


def nova_sessao(db, tipo, usuario_id):
    db.execute("DELETE FROM sessoes WHERE expira_em < ?", (agora().isoformat(),))
    token = secrets.token_urlsafe(32)
    validade = timedelta(days=30) if tipo == "cliente" else timedelta(hours=12)
    db.execute("INSERT INTO sessoes (token, tipo, usuario_id, expira_em) VALUES (?, ?, ?, ?)",
               (token, tipo, usuario_id, (agora() + validade).isoformat()))
    return token


def autenticar(db, token, tipo):
    s = db.execute("SELECT * FROM sessoes WHERE token = ? AND tipo = ?", (token, tipo)).fetchone() if token else None
    if not s or s["expira_em"] < agora().isoformat():
        raise Erro("Sua sessão expirou. Faça login novamente.", 401)
    tabela = "clientes" if tipo == "cliente" else "donos"
    if not db.execute(f"SELECT 1 FROM {tabela} WHERE id = ?", (s["usuario_id"],)).fetchone():
        raise Erro("Conta não encontrada. Faça login novamente.", 401)
    return s["usuario_id"]


# =====================================================================
#  Leitura dos dados
# =====================================================================
def cfg_valor(db, chave, padrao):
    r = db.execute("SELECT valor FROM configuracoes WHERE chave = ?", (chave,)).fetchone()
    return r["valor"] if r else padrao


def reservados(db):
    """Quantidade de cada produto já pedida em agendamentos ainda não atendidos."""
    return {r["produto_id"]: r["q"] for r in db.execute(
        """SELECT ap.produto_id, SUM(ap.qtd) AS q FROM agendamento_produtos ap
           JOIN agendamentos a ON a.id = ap.agendamento_id
           WHERE a.status = 'confirmado' GROUP BY ap.produto_id""")}


def ler_funcionamento(db):
    semana = [{"aberto": False, "abre": "09:00", "fecha": "18:00"} for _ in range(7)]
    for r in db.execute("SELECT * FROM funcionamento"):
        semana[r["dia_semana"]] = {"aberto": bool(r["aberto"]), "abre": r["abre"], "fecha": r["fecha"]}
    return {
        "intervalo": int(cfg_valor(db, "intervalo", "30")),
        "diasParaAgendar": int(cfg_valor(db, "dias_para_agendar", "14")),
        "semana": semana,
        "datasFechadas": [{"data": r["data"], "motivo": r["motivo"]}
                          for r in db.execute("SELECT * FROM datas_fechadas ORDER BY data")],
    }


def ler_config(db, completo):
    onde = "" if completo else " WHERE ativo = 1"
    servicos = [{"id": r["id"], "nome": r["nome"], "icone": r["icone"], "preco": r["preco"],
                 "duracao": r["duracao"], "ativo": bool(r["ativo"])}
                for r in db.execute(f"SELECT * FROM servicos{onde} ORDER BY rowid")]
    barbeiros = []
    for r in db.execute(f"SELECT * FROM barbeiros{onde} ORDER BY rowid"):
        b = {"id": r["id"], "nome": r["nome"], "especialidade": r["especialidade"],
             "folga": json.loads(r["folga"]), "ativo": bool(r["ativo"])}
        if completo:
            b.update(telefone=r["telefone"], comissao=r["comissao"], comissaoProdutos=r["comissao_produtos"],
                     entrouEm=r["entrou_em"], desligadoEm=r["desligado_em"])
        barbeiros.append(b)
    res = reservados(db)
    produtos = []
    for r in db.execute(f"SELECT * FROM produtos{onde} ORDER BY rowid"):
        p = {"id": r["id"], "nome": r["nome"], "categoria": r["categoria"], "icone": r["icone"],
             "preco": r["preco"], "ativo": bool(r["ativo"]),
             "disponivel": max(0, r["estoque"] - res.get(r["id"], 0))}
        if completo:
            p.update(custo=r["custo"], estoque=r["estoque"])
        produtos.append(p)
    return {"servicos": servicos, "barbeiros": barbeiros, "produtos": produtos,
            "funcionamento": ler_funcionamento(db)}


def ler_agendamentos(db, onde="", params=(), para_cliente=False):
    linhas = db.execute(f"SELECT a.* FROM agendamentos a {onde} ORDER BY a.dia, a.hora", params).fetchall()
    itens = {}
    for p in db.execute(f"""SELECT ap.* FROM agendamento_produtos ap
                            JOIN agendamentos a ON a.id = ap.agendamento_id {onde}
                            ORDER BY ap.id""", params):
        item = {"id": p["produto_id"], "nome": p["nome"], "qtd": p["qtd"], "preco": p["preco"]}
        if not para_cliente:
            item["custo"] = p["custo"]
        itens.setdefault(p["agendamento_id"], []).append(item)
    saida = []
    for r in linhas:
        a = {
            "id": r["id"], "clienteId": r["cliente_id"], "cliente": r["cliente_nome"], "telefone": r["telefone"],
            "servicoId": r["servico_id"], "servico": r["servico_nome"], "preco": r["preco"], "duracao": r["duracao"],
            "barbeiroId": r["barbeiro_id"], "barbeiro": r["barbeiro_nome"], "dia": r["dia"], "hora": r["hora"],
            "produtos": itens.get(r["id"], []), "total": r["total"], "pagamento": r["pagamento"],
            "pago": bool(r["pago"]), "obs": r["obs"], "status": r["status"], "origem": r["origem"],
            "criadoEm": r["criado_em"], "atendidoEm": r["atendido_em"],
        }
        if not para_cliente:
            a["comissaoValor"] = r["comissao_valor"]
        saida.append(a)
    return saida


def saldo_barbeiro(db, barbeiro_id):
    ganho = db.execute("SELECT COALESCE(SUM(comissao_valor), 0) FROM agendamentos WHERE barbeiro_id = ? AND status = 'atendido'",
                       (barbeiro_id,)).fetchone()[0]
    pago = db.execute("SELECT COALESCE(SUM(valor), 0) FROM pagamentos_barbeiros WHERE barbeiro_id = ?",
                      (barbeiro_id,)).fetchone()[0]
    return round(ganho - pago, 2)


# =====================================================================
#  Regras de agendamento
# =====================================================================
def validar_horario(db, barbeiro_id, dia, hora, duracao, ignorar_id=None, limitar_dias=True):
    b = db.execute("SELECT * FROM barbeiros WHERE id = ? AND ativo = 1", (barbeiro_id,)).fetchone()
    if not b:
        raise Erro("Barbeiro não encontrado.")
    d = data_valida(dia, "dia")
    hora_valida(hora)
    f = ler_funcionamento(db)
    if d < hoje():
        raise Erro("Não dá para agendar numa data que já passou.")
    if limitar_dias and d > hoje() + timedelta(days=f["diasParaAgendar"]):
        raise Erro(f"Só dá para agendar com até {f['diasParaAgendar']} dias de antecedência.")
    if any(x["data"] == dia for x in f["datasFechadas"]):
        raise Erro("A barbearia vai estar fechada neste dia.")
    dsem = dia_semana_js(d)
    cfg = f["semana"][dsem]
    if not cfg["aberto"]:
        raise Erro(f"A barbearia não abre {DIAS_SEMANA[dsem].lower()}.")
    if dsem in json.loads(b["folga"]):
        raise Erro(f"{b['nome']} está de folga neste dia.")
    ini, abre, fecha = para_min(hora), para_min(cfg["abre"]), para_min(cfg["fecha"])
    if ini < abre or ini + duracao > fecha:
        raise Erro("Horário fora do funcionamento da barbearia.")
    if (ini - abre) % f["intervalo"]:
        raise Erro("Horário inválido.")
    if d == hoje() and ini <= agora().hour * 60 + agora().minute:
        raise Erro("Esse horário já passou.")
    for r in db.execute("SELECT id, hora, duracao FROM agendamentos WHERE barbeiro_id = ? AND dia = ? AND status != 'cancelado'",
                        (barbeiro_id, dia)):
        if r["id"] == ignorar_id:
            continue
        ai = para_min(r["hora"])
        if ini < ai + r["duracao"] and ai < ini + duracao:
            raise Erro("Esse horário acabou de ser ocupado. Escolha outro.", 409)
    return b


def criar_agendamento(db, *, cliente_id, nome, telefone, servico_id, barbeiro_id, dia, hora,
                      itens, pagamento, obs, origem, limitar_dias):
    s = db.execute("SELECT * FROM servicos WHERE id = ? AND ativo = 1", (servico_id,)).fetchone()
    if not s:
        raise Erro("Serviço não encontrado.")
    b = validar_horario(db, barbeiro_id, dia, hora, s["duracao"], limitar_dias=limitar_dias)

    if not isinstance(itens, list) or len(itens) > 30:
        raise Erro("Lista de produtos inválida.")
    res = reservados(db)
    produtos, vistos, total = [], set(), s["preco"]
    for it in itens:
        if not isinstance(it, dict):
            raise Erro("Lista de produtos inválida.")
        pid = id_valido(it.get("id"), "produto")
        if pid in vistos:
            raise Erro("Produto repetido no pedido.")
        vistos.add(pid)
        qtd = numero(it.get("qtd"), "quantidade", 1, 99, inteiro=True)
        p = db.execute("SELECT * FROM produtos WHERE id = ? AND ativo = 1", (pid,)).fetchone()
        if not p:
            raise Erro("Um dos produtos não está mais disponível.")
        disp = p["estoque"] - res.get(pid, 0)
        if qtd > disp:
            raise Erro(f"Só temos {max(0, disp)} unidade(s) de {p['nome']}.", 409)
        produtos.append((p, qtd))
        total += p["preco"] * qtd

    cur = db.execute(
        """INSERT INTO agendamentos (cliente_id, cliente_nome, telefone, servico_id, servico_nome, preco, duracao,
             barbeiro_id, barbeiro_nome, dia, hora, total, pagamento, pago, obs, status, origem, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmado', ?, ?)""",
        (cliente_id, nome, telefone, s["id"], s["nome"], s["preco"], s["duracao"], b["id"], b["nome"],
         dia, hora, round(total, 2), pagamento, 0 if pagamento == "Pagar na barbearia" else 1, obs, origem,
         agora().isoformat(timespec="seconds")))
    aid = cur.lastrowid
    for p, qtd in produtos:
        db.execute("INSERT INTO agendamento_produtos (agendamento_id, produto_id, nome, qtd, preco, custo) VALUES (?, ?, ?, ?, ?, ?)",
                   (aid, p["id"], p["nome"], qtd, p["preco"], p["custo"]))
    return aid


def buscar_agendamento(db, aid):
    a = db.execute("SELECT * FROM agendamentos WHERE id = ?", (aid,)).fetchone()
    if not a:
        raise Erro("Agendamento não encontrado.", 404)
    return a


# =====================================================================
#  Rotas da API
# =====================================================================
ROTAS = []


def rota(metodo, caminho, auth=None):
    def registrar(funcao):
        ROTAS.append((metodo, re.compile("^" + caminho + "$"), auth, funcao))
        return funcao
    return registrar


class Ctx:
    pass


# ---------- Público ----------
@rota("GET", "/api/config")
def r_config(c):
    cfg = ler_config(c.db, completo=False)
    cfg["ocupados"] = [{"barbeiroId": r["barbeiro_id"], "dia": r["dia"], "hora": r["hora"],
                        "duracao": r["duracao"], "status": "confirmado"}
                       for r in c.db.execute("SELECT barbeiro_id, dia, hora, duracao FROM agendamentos WHERE status != 'cancelado' AND dia >= ?",
                                             (hoje().isoformat(),))]
    return cfg


@rota("POST", "/api/logout")
def r_logout(c):
    if c.token:
        c.db.execute("DELETE FROM sessoes WHERE token = ?", (c.token,))


# ---------- Cliente ----------
def cliente_json(r):
    return {"id": r["id"], "nome": r["nome"], "tel": r["telefone"]}


@rota("POST", "/api/clientes/cadastro")
def r_cadastro(c):
    nome = texto(c.corpo, "nome", maximo=80)
    tel = digitos(c.corpo.get("telefone"))
    senha = c.corpo.get("senha")
    if len(tel) not in (10, 11):
        raise Erro("Digite um WhatsApp válido com DDD.")
    if not isinstance(senha, str) or len(senha) < 4:
        raise Erro("A senha precisa ter pelo menos 4 caracteres.")
    if c.db.execute("SELECT 1 FROM clientes WHERE telefone = ?", (tel,)).fetchone():
        raise Erro("Já existe uma conta com esse WhatsApp.", 409)
    cid = c.db.execute("INSERT INTO clientes (nome, telefone, senha_hash) VALUES (?, ?, ?)",
                       (nome, tel, gerar_hash(senha))).lastrowid
    # agendamentos feitos no balcão com esse telefone passam a aparecer na conta
    c.db.execute("UPDATE agendamentos SET cliente_id = ? WHERE cliente_id IS NULL AND telefone = ?", (cid, tel))
    return {"token": nova_sessao(c.db, "cliente", cid), "cliente": {"id": cid, "nome": nome, "tel": tel}}


@rota("POST", "/api/clientes/login")
def r_login_cliente(c):
    tel = digitos(c.corpo.get("telefone"))
    senha = c.corpo.get("senha")
    r = c.db.execute("SELECT * FROM clientes WHERE telefone = ?", (tel,)).fetchone()
    if not r or not isinstance(senha, str) or not conferir_senha(senha, r["senha_hash"]):
        raise Erro("WhatsApp ou senha incorretos.", 401)
    return {"token": nova_sessao(c.db, "cliente", r["id"]), "cliente": cliente_json(r)}


@rota("GET", "/api/clientes/eu", "cliente")
def r_eu(c):
    r = c.db.execute("SELECT * FROM clientes WHERE id = ?", (c.usuario_id,)).fetchone()
    return {"cliente": cliente_json(r),
            "agendamentos": ler_agendamentos(c.db, "WHERE a.cliente_id = ?", (c.usuario_id,), para_cliente=True)}


@rota("POST", "/api/agendamentos", "cliente")
def r_agendar(c):
    cli = c.db.execute("SELECT * FROM clientes WHERE id = ?", (c.usuario_id,)).fetchone()
    pagamento = c.corpo.get("pagamento")
    if pagamento not in FORMAS_APP:
        raise Erro("Escolha uma forma de pagamento.")
    aid = criar_agendamento(
        c.db, cliente_id=cli["id"], nome=cli["nome"], telefone=cli["telefone"],
        servico_id=id_valido(c.corpo.get("servicoId"), "serviço"), barbeiro_id=id_valido(c.corpo.get("barbeiroId"), "barbeiro"),
        dia=c.corpo.get("dia"), hora=c.corpo.get("hora"), itens=c.corpo.get("produtos", []),
        pagamento=pagamento, obs=texto(c.corpo, "obs", False, 300, "observação"), origem="app", limitar_dias=True)
    return {"id": aid}


@rota("POST", r"/api/agendamentos/(\d+)/cancelar", "cliente")
def r_cancelar_cliente(c):
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["cliente_id"] != c.usuario_id:
        raise Erro("Agendamento não encontrado.", 404)
    if a["status"] != "confirmado":
        raise Erro("Esse agendamento não pode mais ser cancelado.", 409)
    if datetime.fromisoformat(f"{a['dia']}T{a['hora']}") <= agora():
        raise Erro("Esse horário já passou. Fale com a barbearia.", 409)
    c.db.execute("UPDATE agendamentos SET status = 'cancelado' WHERE id = ?", (a["id"],))


# ---------- Dono ----------
@rota("POST", "/api/dono/login")
def r_login_dono(c):
    usuario = texto(c.corpo, "usuario", maximo=60, nome="usuário").lower()
    senha = c.corpo.get("senha")
    r = c.db.execute("SELECT * FROM donos WHERE usuario = ?", (usuario,)).fetchone()
    if not r or not isinstance(senha, str) or not conferir_senha(senha, r["senha_hash"]):
        raise Erro("Usuário ou senha incorretos.", 401)
    return {"token": nova_sessao(c.db, "dono", r["id"]), "nome": r["nome"]}


@rota("GET", "/api/dono/dados", "dono")
def r_dados(c):
    dono = c.db.execute("SELECT nome, usuario FROM donos WHERE id = ?", (c.usuario_id,)).fetchone()
    return {
        "dono": {"nome": dono["nome"], "usuario": dono["usuario"]},
        "config": ler_config(c.db, completo=True),
        "agendamentos": ler_agendamentos(c.db),
        "usuarios": [cliente_json(r) for r in c.db.execute("SELECT * FROM clientes ORDER BY nome")],
        "pagamentos": [{"id": r["id"], "barbeiroId": r["barbeiro_id"], "barbeiro": r["nome"], "valor": r["valor"],
                        "data": r["data"], "forma": r["forma"], "obs": r["obs"]}
                       for r in c.db.execute("""SELECT p.*, b.nome FROM pagamentos_barbeiros p
                                                JOIN barbeiros b ON b.id = p.barbeiro_id ORDER BY p.data""")],
        "despesas": [dict(r) for r in c.db.execute("SELECT * FROM despesas ORDER BY data")],
    }


@rota("PUT", "/api/dono/config", "dono")
def r_salvar_config(c):
    db, cfg = c.db, c.corpo
    for s in lista(cfg, "servicos"):
        db.execute("""INSERT INTO servicos (id, nome, icone, preco, duracao, ativo) VALUES (?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, icone = excluded.icone, preco = excluded.preco,
                      duracao = excluded.duracao, ativo = excluded.ativo""",
                   (id_valido(s.get("id"), "serviço"), texto(s, "nome", maximo=60, nome="nome do serviço"),
                    texto(s, "icone", False, 8), numero(s.get("preco"), "preço", 0, 100000),
                    numero(s.get("duracao"), "duração", 5, 600, inteiro=True), 0 if s.get("ativo") is False else 1))

    for b in lista(cfg, "barbeiros"):
        bid = id_valido(b.get("id"), "barbeiro")
        nome = texto(b, "nome", maximo=60, nome="nome do barbeiro")
        folga = b.get("folga", [])
        if not isinstance(folga, list) or any(isinstance(x, bool) or x not in range(7) for x in folga):
            raise Erro("Dias de folga inválidos.")
        # "ativo" não muda aqui: remover/reativar tem rota própria (com as regras de pagamento)
        db.execute("""INSERT INTO barbeiros (id, nome, telefone, especialidade, folga, comissao, comissao_produtos, ativo, entrou_em)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
                      ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, telefone = excluded.telefone,
                      especialidade = excluded.especialidade, folga = excluded.folga, comissao = excluded.comissao,
                      comissao_produtos = excluded.comissao_produtos""",
                   (bid, nome, digitos(b.get("telefone"))[:15], texto(b, "especialidade", False, 80),
                    json.dumps(sorted(set(folga))), numero(b.get("comissao"), "comissão", 0, 100),
                    numero(b.get("comissaoProdutos", 0), "comissão dos produtos", 0, 100), hoje().isoformat()))
        db.execute("UPDATE agendamentos SET barbeiro_nome = ? WHERE barbeiro_id = ? AND status = 'confirmado'", (nome, bid))

    for p in lista(cfg, "produtos"):
        db.execute("""INSERT INTO produtos (id, nome, categoria, icone, preco, custo, estoque, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, categoria = excluded.categoria, icone = excluded.icone,
                      preco = excluded.preco, custo = excluded.custo, estoque = excluded.estoque, ativo = excluded.ativo""",
                   (id_valido(p.get("id"), "produto"), texto(p, "nome", maximo=80, nome="nome do produto"),
                    texto(p, "categoria", False, 40), texto(p, "icone", False, 8),
                    numero(p.get("preco"), "preço", 0, 100000), numero(p.get("custo", 0), "custo", 0, 100000),
                    numero(p.get("estoque"), "estoque", 0, 100000, inteiro=True), 0 if p.get("ativo") is False else 1))

    f = cfg.get("funcionamento")
    if f is not None:
        if not isinstance(f, dict):
            raise Erro("Funcionamento inválido.")
        semana = lista(f, "semana")
        if len(semana) != 7:
            raise Erro("A semana precisa ter 7 dias.")
        for i, d in enumerate(semana):
            if not isinstance(d, dict):
                raise Erro("Funcionamento inválido.")
            abre, fecha = hora_valida(d.get("abre"), DIAS_SEMANA[i]), hora_valida(d.get("fecha"), DIAS_SEMANA[i])
            aberto = bool(d.get("aberto"))
            if aberto and para_min(abre) >= para_min(fecha):
                raise Erro(f"{DIAS_SEMANA[i]}: o horário de abrir precisa ser antes do de fechar.")
            db.execute("INSERT OR REPLACE INTO funcionamento (dia_semana, aberto, abre, fecha) VALUES (?, ?, ?, ?)",
                       (i, int(aberto), abre, fecha))
        intervalo = numero(f.get("intervalo"), "intervalo", inteiro=True)
        if intervalo not in INTERVALOS:
            raise Erro("Intervalo inválido.")
        dias = numero(f.get("diasParaAgendar"), "dias para agendar", 1, 365, inteiro=True)
        db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('intervalo', ?)", (str(intervalo),))
        db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('dias_para_agendar', ?)", (str(dias),))
        db.execute("DELETE FROM datas_fechadas")
        for x in lista(f, "datasFechadas"):
            if not isinstance(x, dict):
                raise Erro("Data fechada inválida.")
            data_valida(x.get("data"))
            db.execute("INSERT OR REPLACE INTO datas_fechadas (data, motivo) VALUES (?, ?)",
                       (x["data"], texto(x, "motivo", False, 60)))


@rota("POST", "/api/dono/agendamentos", "dono")
def r_agendar_balcao(c):
    tel = digitos(c.corpo.get("telefone"))
    if tel and len(tel) not in (10, 11):
        raise Erro("Digite um WhatsApp válido com DDD (ou deixe em branco).")
    pagamento = c.corpo.get("pagamento")
    if pagamento not in FORMAS_APP:
        raise Erro("Forma de pagamento inválida.")
    cli = c.db.execute("SELECT id FROM clientes WHERE telefone = ?", (tel,)).fetchone() if tel else None
    aid = criar_agendamento(
        c.db, cliente_id=cli["id"] if cli else None, nome=texto(c.corpo, "nome", maximo=80, nome="nome do cliente"),
        telefone=tel, servico_id=id_valido(c.corpo.get("servicoId"), "serviço"),
        barbeiro_id=id_valido(c.corpo.get("barbeiroId"), "barbeiro"), dia=c.corpo.get("dia"), hora=c.corpo.get("hora"),
        itens=[], pagamento=pagamento, obs=texto(c.corpo, "obs", False, 300, "observação"),
        origem="balcao", limitar_dias=False)
    return {"id": aid}


@rota("POST", r"/api/dono/agendamentos/(\d+)/atender", "dono")
def r_atender(c):
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["status"] != "confirmado":
        raise Erro("Este agendamento não está mais em aberto.", 409)
    pagamento = a["pagamento"]
    if pagamento == "Pagar na barbearia":
        pagamento = c.corpo.get("forma")
        if pagamento not in FORMAS_BALCAO:
            raise Erro("Escolha como o cliente pagou.")
    b = c.db.execute("SELECT * FROM barbeiros WHERE id = ?", (a["barbeiro_id"],)).fetchone()
    itens = c.db.execute("SELECT * FROM agendamento_produtos WHERE agendamento_id = ?", (a["id"],)).fetchall()
    total_produtos = sum(i["preco"] * i["qtd"] for i in itens)
    comissao = round(a["preco"] * b["comissao"] / 100 + total_produtos * b["comissao_produtos"] / 100, 2)
    c.db.execute("""UPDATE agendamentos SET status = 'atendido', pago = 1, pagamento = ?, comissao_valor = ?, atendido_em = ?
                    WHERE id = ?""", (pagamento, comissao, agora().isoformat(timespec="seconds"), a["id"]))
    for i in itens:
        c.db.execute("UPDATE produtos SET estoque = MAX(0, estoque - ?) WHERE id = ?", (i["qtd"], i["produto_id"]))
    return {"comissao": comissao}


@rota("POST", r"/api/dono/agendamentos/(\d+)/status", "dono")
def r_status(c):
    a = buscar_agendamento(c.db, int(c.args[0]))
    novo = c.corpo.get("status")
    if novo not in ("faltou", "cancelado"):
        raise Erro("Situação inválida.")
    if a["status"] != "confirmado":
        raise Erro("Este agendamento não está mais em aberto.", 409)
    c.db.execute("UPDATE agendamentos SET status = ? WHERE id = ?", (novo, a["id"]))


@rota("POST", r"/api/dono/agendamentos/(\d+)/transferir", "dono")
def r_transferir(c):
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["status"] != "confirmado":
        raise Erro("Este agendamento não está mais em aberto.", 409)
    bid = id_valido(c.corpo.get("barbeiroId"), "barbeiro")
    b = validar_horario(c.db, bid, a["dia"], a["hora"], a["duracao"], ignorar_id=a["id"], limitar_dias=False)
    c.db.execute("UPDATE agendamentos SET barbeiro_id = ?, barbeiro_nome = ? WHERE id = ?", (b["id"], b["nome"], a["id"]))


@rota("POST", r"/api/dono/barbeiros/([\w-]+)/remover", "dono")
def r_remover_barbeiro(c):
    b = c.db.execute("SELECT * FROM barbeiros WHERE id = ?", (c.args[0],)).fetchone()
    if not b or not b["ativo"]:
        raise Erro("Barbeiro não encontrado.", 404)
    saldo = saldo_barbeiro(c.db, b["id"])
    if saldo > 0.009:
        raise Erro(f"{b['nome']} ainda tem R$ {saldo:.2f} a receber. Faça o pagamento antes de remover.", 409)
    abertos = c.db.execute("SELECT COUNT(*) FROM agendamentos WHERE barbeiro_id = ? AND status = 'confirmado'",
                           (b["id"],)).fetchone()[0]
    if abertos:
        raise Erro(f"{b['nome']} tem {abertos} agendamento(s) em aberto. Resolva antes de remover.", 409)
    c.db.execute("UPDATE barbeiros SET ativo = 0, desligado_em = ? WHERE id = ?", (hoje().isoformat(), b["id"]))


@rota("POST", r"/api/dono/barbeiros/([\w-]+)/reativar", "dono")
def r_reativar_barbeiro(c):
    if not c.db.execute("UPDATE barbeiros SET ativo = 1, desligado_em = NULL WHERE id = ?", (c.args[0],)).rowcount:
        raise Erro("Barbeiro não encontrado.", 404)


@rota("POST", "/api/dono/pagamentos", "dono")
def r_pagar(c):
    bid = id_valido(c.corpo.get("barbeiroId"), "barbeiro")
    if not c.db.execute("SELECT 1 FROM barbeiros WHERE id = ?", (bid,)).fetchone():
        raise Erro("Barbeiro não encontrado.", 404)
    forma = c.corpo.get("forma")
    if forma not in FORMAS_PAG_BARBEIRO:
        raise Erro("Forma de pagamento inválida.")
    data_valida(c.corpo.get("data"))
    pid = novo_id("pg")
    c.db.execute("INSERT INTO pagamentos_barbeiros (id, barbeiro_id, valor, data, forma, obs) VALUES (?, ?, ?, ?, ?, ?)",
                 (pid, bid, round(numero(c.corpo.get("valor"), "valor", 0.01, 1_000_000), 2), c.corpo["data"], forma,
                  texto(c.corpo, "obs", False, 120, "observação")))
    return {"id": pid}


@rota("DELETE", r"/api/dono/pagamentos/([\w-]+)", "dono")
def r_excluir_pagamento(c):
    if not c.db.execute("DELETE FROM pagamentos_barbeiros WHERE id = ?", (c.args[0],)).rowcount:
        raise Erro("Pagamento não encontrado.", 404)


@rota("POST", "/api/dono/despesas", "dono")
def r_despesa(c):
    data_valida(c.corpo.get("data"))
    did = novo_id("d")
    c.db.execute("INSERT INTO despesas (id, descricao, categoria, valor, data) VALUES (?, ?, ?, ?, ?)",
                 (did, texto(c.corpo, "descricao", maximo=120, nome="descrição"), texto(c.corpo, "categoria", maximo=60),
                  round(numero(c.corpo.get("valor"), "valor", 0.01, 10_000_000), 2), c.corpo["data"]))
    return {"id": did}


@rota("DELETE", r"/api/dono/despesas/([\w-]+)", "dono")
def r_excluir_despesa(c):
    if not c.db.execute("DELETE FROM despesas WHERE id = ?", (c.args[0],)).rowcount:
        raise Erro("Despesa não encontrada.", 404)


@rota("POST", "/api/dono/senha", "dono")
def r_trocar_senha(c):
    r = c.db.execute("SELECT * FROM donos WHERE id = ?", (c.usuario_id,)).fetchone()
    atual, nova = c.corpo.get("atual"), c.corpo.get("nova")
    if not isinstance(atual, str) or not conferir_senha(atual, r["senha_hash"]):
        raise Erro("A senha atual está errada.")
    if not isinstance(nova, str) or len(nova) < 6:
        raise Erro("A nova senha precisa ter pelo menos 6 caracteres.")
    c.db.execute("UPDATE donos SET senha_hash = ? WHERE id = ?", (gerar_hash(nova), r["id"]))
    c.db.execute("DELETE FROM sessoes WHERE tipo = 'dono' AND usuario_id = ? AND token != ?", (r["id"], c.token))


@rota("GET", "/api/dono/backup", "dono")
def r_backup(c):
    copia = sqlite3.connect(":memory:")
    c.db.backup(copia)
    dados = copia.serialize()
    copia.close()
    return Arquivo(dados, "application/vnd.sqlite3", f"backup-barbearia-{hoje().isoformat()}.db")


# =====================================================================
#  Servidor HTTP
# =====================================================================
class Handler(SimpleHTTPRequestHandler):
    server_version = "Barbearia/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PASTA_SITE, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, formato, *args):
        if self.path.startswith("/api/"):
            sys.stderr.write(f"[{agora():%H:%M:%S}] {formato % args}\n")

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        if urlparse(self.path).path.rstrip("/") == "/dono":
            self.path = "/dono.html"
        return super().do_GET()

    def do_POST(self):
        self.api("POST")

    def do_PUT(self):
        self.api("PUT")

    def do_DELETE(self):
        self.api("DELETE")

    def responder(self, status, dados):
        if isinstance(dados, Arquivo):
            corpo, tipo = dados.dados, dados.tipo
        else:
            corpo, tipo = json.dumps(dados, ensure_ascii=False).encode(), "application/json; charset=utf-8"
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        if isinstance(dados, Arquivo):
            self.send_header("Content-Disposition", f'attachment; filename="{dados.nome}"')
        self.end_headers()
        self.wfile.write(corpo)

    def ler_corpo(self):
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho > 1_000_000:
            raise Erro("Requisição grande demais.", 413)
        if not tamanho:
            return {}
        try:
            corpo = json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise Erro("Dados inválidos.")
        if not isinstance(corpo, dict):
            raise Erro("Dados inválidos.")
        return corpo

    def api(self, metodo):
        caminho = urlparse(self.path).path
        for m, padrao, auth, funcao in ROTAS:
            achou = padrao.match(caminho)
            if m != metodo or not achou:
                continue
            try:
                c = Ctx()
                c.args = achou.groups()
                c.corpo = self.ler_corpo() if metodo in ("POST", "PUT") else {}
                c.token = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
                with TRAVA, conectar() as db:
                    c.db = db
                    c.usuario_id = autenticar(db, c.token, auth) if auth else None
                    resultado = funcao(c)
                return self.responder(200, resultado if resultado is not None else {"ok": True})
            except Erro as e:
                return self.responder(e.status, {"erro": str(e)})
            except Exception:
                traceback.print_exc()
                return self.responder(500, {"erro": "Erro interno no servidor."})
        self.responder(404, {"erro": "Endereço não encontrado."})


# =====================================================================
#  Criação do banco e dados de teste
# =====================================================================
CONTA_DONO = {"usuario": "admin", "senha": "admin123", "nome": "Dono (conta de teste)"}
CONTA_CLIENTE = {"nome": "Davi", "telefone": "11999999999", "senha": "1234"}

SERVICOS_PADRAO = [
    ("corte", "Corte", "💈", 40, 30), ("barba", "Barba", "🧔", 30, 30), ("corte-barba", "Corte + Barba", "✂️", 65, 60),
    ("sobrancelha", "Sobrancelha", "👁️", 15, 30), ("pigmentacao", "Pigmentação", "🎨", 50, 60),
    ("luzes", "Luzes / Platinado", "✨", 120, 90),
]
BARBEIROS_PADRAO = [
    ("joao", "João", "11911112222", "Degradê e navalhado", [1]),
    ("pedro", "Pedro", "11922223333", "Barba e toalha quente", [2]),
    ("lucas", "Lucas", "11933334444", "Química e platinado", [3]),
]
PRODUTOS_PADRAO = [
    ("gel-forte", "Gel fixação forte 300g", "Cabelo", "🧴", 18.9, 8, 20),
    ("gel-molhado", "Gel efeito molhado 250g", "Cabelo", "🧴", 22.9, 10, 12),
    ("pomada", "Pomada modeladora matte", "Cabelo", "🫙", 34.9, 15, 15),
    ("minoxidil", "Minoxidil 5% 60ml", "Barba", "💧", 59.9, 30, 10),
    ("minox-kit", "Kit Minoxidil + Dermaroller", "Barba", "🎁", 89.9, 45, 6),
    ("oleo-barba", "Óleo para barba 30ml", "Barba", "🫗", 29.9, 12, 18),
    ("balm", "Balm para barba", "Barba", "🫙", 32.9, 14, 9),
    ("shampoo", "Shampoo anticaspa 250ml", "Cuidados", "🧼", 27.9, 11, 14),
    ("pos-barba", "Loção pós-barba", "Cuidados", "🧴", 24.9, 10, 11),
]
SEMANA_PADRAO = [(False, "09:00", "13:00"), (True, "09:00", "19:00"), (True, "09:00", "19:00"), (True, "09:00", "19:00"),
                 (True, "09:00", "19:00"), (True, "09:00", "20:00"), (True, "08:00", "17:00")]
CLIENTES_EXEMPLO = [("Carlos Souza", "11988887777"), ("Rafael Lima", "11977776666"),
                    ("Marcos Silva", "11966665555"), ("Bruno Alves", "11955554444")]


def popular(db):
    db.execute("INSERT INTO donos (usuario, nome, senha_hash) VALUES (?, ?, ?)",
               (CONTA_DONO["usuario"], CONTA_DONO["nome"], gerar_hash(CONTA_DONO["senha"])))
    davi = db.execute("INSERT INTO clientes (nome, telefone, senha_hash) VALUES (?, ?, ?)",
                      (CONTA_CLIENTE["nome"], CONTA_CLIENTE["telefone"], gerar_hash(CONTA_CLIENTE["senha"]))).lastrowid
    for s in SERVICOS_PADRAO:
        db.execute("INSERT INTO servicos (id, nome, icone, preco, duracao) VALUES (?, ?, ?, ?, ?)", s)
    entrou = (hoje() - timedelta(days=180)).isoformat()
    for bid, nome, tel, esp, folga in BARBEIROS_PADRAO:
        db.execute("INSERT INTO barbeiros (id, nome, telefone, especialidade, folga, comissao, comissao_produtos, entrou_em) VALUES (?, ?, ?, ?, ?, 50, 10, ?)",
                   (bid, nome, tel, esp, json.dumps(folga), entrou))
    for p in PRODUTOS_PADRAO:
        db.execute("INSERT INTO produtos (id, nome, categoria, icone, preco, custo, estoque) VALUES (?, ?, ?, ?, ?, ?, ?)", p)
    for i, (aberto, abre, fecha) in enumerate(SEMANA_PADRAO):
        db.execute("INSERT INTO funcionamento (dia_semana, aberto, abre, fecha) VALUES (?, ?, ?, ?)", (i, int(aberto), abre, fecha))
    db.execute("INSERT INTO configuracoes (chave, valor) VALUES ('intervalo', '30'), ('dias_para_agendar', '14')")
    criar_exemplos(db, davi)


def criar_exemplos(db, davi_id):
    """Histórico de exemplo dos últimos ~40 dias, para o painel já ter números."""
    rnd = random.Random(7)
    servicos = {s[0]: s for s in SERVICOS_PADRAO}
    produtos = {p[0]: p for p in PRODUTOS_PADRAO}
    clientes = [(None, n, t) for n, t in CLIENTES_EXEMPLO]
    davi = (davi_id, CONTA_CLIENTE["nome"], CONTA_CLIENTE["telefone"])

    def inserir(cliente, sid, b, dia, hora, status, itens, pagamento, comissao=None):
        s = servicos[sid]
        total = s[3] + sum(produtos[pid][4] * q for pid, q in itens)
        aid = db.execute(
            """INSERT INTO agendamentos (cliente_id, cliente_nome, telefone, servico_id, servico_nome, preco, duracao,
                 barbeiro_id, barbeiro_nome, dia, hora, total, pagamento, pago, status, origem, comissao_valor, criado_em, atendido_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?, ?, ?)""",
            (cliente[0], cliente[1], cliente[2], sid, s[1], s[3], s[4], b[0], b[1], dia.isoformat(), hora, round(total, 2),
             pagamento, int(status == "atendido" or pagamento != "Pagar na barbearia"), status, comissao,
             f"{dia.isoformat()}T08:00:00", f"{dia.isoformat()}T{hora}:00" if status == "atendido" else None)).lastrowid
        for pid, q in itens:
            p = produtos[pid]
            db.execute("INSERT INTO agendamento_produtos (agendamento_id, produto_id, nome, qtd, preco, custo) VALUES (?, ?, ?, ?, ?, ?)",
                       (aid, pid, p[1], q, p[4], p[5]))

    # passado: atendimentos já feitos
    for atras in range(40, 0, -1):
        dia = hoje() - timedelta(days=atras)
        aberto, abre, fecha = SEMANA_PADRAO[dia_semana_js(dia)]
        if not aberto:
            continue
        for b in BARBEIROS_PADRAO:
            if dia_semana_js(dia) in b[4]:
                continue
            horas = list(range(para_min(abre), para_min(fecha) - 60, 60))
            for ini in sorted(rnd.sample(horas, k=min(len(horas), rnd.randint(2, 4)))):
                sid = rnd.choice(["corte", "corte", "corte-barba", "barba", "sobrancelha", "pigmentacao"])
                itens = [(rnd.choice(list(produtos)), 1)] if rnd.random() < 0.25 else []
                status = "faltou" if rnd.random() < 0.07 else "atendido"
                s = servicos[sid]
                comissao = round(s[3] * 0.5 + sum(produtos[p][4] * q for p, q in itens) * 0.1, 2) if status == "atendido" else None
                inserir(rnd.choice(clientes), sid, b, dia, f"{ini // 60:02d}:{ini % 60:02d}", status, itens,
                        rnd.choice(FORMAS_BALCAO), comissao)

    joao = BARBEIROS_PADRAO[0]

    def proximo_dia_do_joao(d, passo):
        while not SEMANA_PADRAO[dia_semana_js(d)][0] or dia_semana_js(d) in joao[4]:
            d += timedelta(days=passo)
        return d

    # histórico do Davi: um corte a cada ~2 semanas com o João, no fim do dia (depois dos horários sorteados acima)
    for atras, sid, itens in [(36, "corte", []), (22, "corte-barba", [("pomada", 1)]), (8, "corte", [("minoxidil", 1)])]:
        dia = proximo_dia_do_joao(hoje() - timedelta(days=atras), -1)
        hora = {5: "19:00", 6: "16:00"}.get(dia_semana_js(dia), "18:00")
        comissao = round(servicos[sid][3] * 0.5 + sum(produtos[p][4] * q for p, q in itens) * 0.1, 2)
        inserir(davi, sid, joao, dia, hora, "atendido", itens, "Pix", comissao)

    # futuro: o próximo horário do Davi (com produtos para entregar) e de outros clientes
    dia = proximo_dia_do_joao(hoje() + timedelta(days=1), 1)
    inserir(davi, "corte-barba", joao, dia, "10:00", "confirmado", [("gel-forte", 1), ("minoxidil", 1)], "Pix")
    inserir(clientes[0], "corte", joao, dia, "11:00", "confirmado", [], "Pagar na barbearia")
    pedro = BARBEIROS_PADRAO[1]
    if dia_semana_js(dia) not in pedro[4]:
        inserir(clientes[1], "barba", pedro, dia, "14:00", "confirmado", [("oleo-barba", 1)], "Pagar na barbearia")

    # pagamentos aos barbeiros: pago até 7 dias atrás (o resto fica "a pagar")
    corte = (hoje() - timedelta(days=7)).isoformat()
    for b in BARBEIROS_PADRAO:
        valor = db.execute("SELECT COALESCE(SUM(comissao_valor), 0) FROM agendamentos WHERE barbeiro_id = ? AND status = 'atendido' AND dia <= ?",
                           (b[0], corte)).fetchone()[0]
        if valor:
            db.execute("INSERT INTO pagamentos_barbeiros (id, barbeiro_id, valor, data, forma, obs) VALUES (?, ?, ?, ?, 'Pix', 'Comissões (exemplo)')",
                       (novo_id("pg"), b[0], round(valor, 2), corte))

    # despesas do mês atual e do anterior
    inicio = hoje().replace(day=1)
    anterior = (inicio - timedelta(days=1)).replace(day=1)
    for mes in (anterior, inicio):
        for desc, cat, valor, dia_mes in [("Aluguel", "Aluguel", 1500, 5), ("Conta de luz", "Energia", 280, 10),
                                          ("Internet", "Internet", 120, 10), ("Água", "Água", 90, 12)]:
            d = mes.replace(day=dia_mes)
            if d <= hoje():
                db.execute("INSERT INTO despesas (id, descricao, categoria, valor, data) VALUES (?, ?, ?, ?, ?)",
                           (novo_id("d"), desc, cat, valor, d.isoformat()))


def iniciar_banco(resetar=False):
    if resetar and os.path.exists(BANCO):
        os.remove(BANCO)
        print("Banco apagado.")
    with open(SCHEMA, encoding="utf-8") as arq:
        schema = arq.read()
    with conectar() as db:
        db.executescript(schema)
        if db.execute("SELECT COUNT(*) FROM donos").fetchone()[0] == 0:
            popular(db)
            print("Banco criado com os dados de teste.")


def ip_da_rede():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def main():
    iniciar_banco(resetar="--resetar" in sys.argv)
    na_rede = "--rede" in sys.argv
    servidor = ThreadingHTTPServer(("0.0.0.0" if na_rede else "127.0.0.1", PORTA), Handler)
    print()
    print("  ✂  Servidor da barbearia ligado!")
    print(f"     App do cliente:  http://localhost:{PORTA}")
    print(f"     Painel do dono:  http://localhost:{PORTA}/dono")
    if na_rede and ip_da_rede():
        print(f"     No celular (mesmo Wi-Fi): http://{ip_da_rede()}:{PORTA}")
    print()
    print(f"  Conta de teste do dono:    usuário {CONTA_DONO['usuario']}  /  senha {CONTA_DONO['senha']}")
    print(f"  Conta de teste do cliente: WhatsApp {CONTA_CLIENTE['telefone']}  /  senha {CONTA_CLIENTE['senha']}")
    print("\n  Para desligar: Ctrl + C\n")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor desligado.")


if __name__ == "__main__":
    main()
