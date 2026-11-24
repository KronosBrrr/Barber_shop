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
from html import escape as html_escape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import mensagens as msg
import pagamentos as pag

PASTA = os.path.dirname(os.path.abspath(__file__))
PASTA_SITE = os.path.normpath(os.path.join(PASTA, "..", "src"))   # módulos do site (HTML, CSS, JS)
BANCO = os.environ.get("BARBEARIA_BANCO") or os.path.join(PASTA, "barbearia.db")  # outro arquivo só para testes
SCHEMA = os.path.join(PASTA, "schema.sql")
PORTA = int(os.environ.get("PORTA", "8000"))

DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]
FORMAS_APP = ["Pix", "Cartão de crédito", "Cartão de débito", "Pagar na barbearia"]
FORMAS_BALCAO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito"]
FORMAS_PAG_BARBEIRO = ["Pix pelo site", "Pix", "Dinheiro", "Transferência"]
SENHA_MINIMA = {"cliente": 4, "barbeiro": 4, "dono": 6}
CODIGO_VALIDADE_MIN = 15      # o código de recuperação vale 15 minutos
CODIGO_TENTATIVAS = 5         # depois disso, é preciso pedir outro código
CODIGOS_POR_HORA = 3          # no máximo 3 códigos por conta a cada hora
FOTO_MAX_BYTES = 1_500_000
INTERVALOS = [15, 20, 30, 40, 45, 60]
DIAS_ANTECEDENCIA = [7, 14, 21, 30, 60]
MAX_PARCELAS_LIMITE = 12          # o dono escolhe até quantas vezes (padrão 3), no máximo isto
CHAVE_PIX_EXEMPLO = "123e4567-e89b-12d3-a456-426614174000"
CATEGORIAS_DESPESA_PADRAO = ["Aluguel", "Energia", "Água", "Internet", "Manutenção",
                             "Material de uso (lâminas, toalhas...)", "Marketing", "Impostos", "Outros"]

# Páginas do site: endereço -> arquivo dentro de src/
PAGINAS = {"/": "inicio/inicio.html", "/cliente": "cliente/cliente.html",
           "/dono": "dono/dono.html", "/barbeiro": "barbeiro/barbeiro.html"}

# Textos da página inicial (ficam na tabela "configuracoes" com o prefixo site_).
# (chave, rótulo no painel do dono, texto padrão, tamanho máximo). "{nome}" vira o nome da barbearia.
SITE_TEXTOS = [
    ("nome", "Nome da barbearia", "Barbearia Real", 40),
    ("hero_titulo", "Título principal", "Seu estilo merece um", 80),
    ("hero_destaque", "Final do título (em dourado)", "atendimento de rei.", 60),
    ("hero_texto", "Texto de apresentação", "Cortes clássicos e modernos, barba na toalha quente e produtos selecionados. "
     "Agora você agenda pelo celular: escolhe o barbeiro, vê os horários livres e paga como preferir.", 400),
    ("hero_frase", "Frase em destaque no fim do texto", "Sem fila, sem ligação, sem espera.", 80),
    ("tempo_agendar", "Tempo para agendar (aparece nos números)", "1 min", 12),
    ("diferenciais_selo", "Diferenciais: etiqueta", "Por que a {nome}", 60),
    ("diferenciais_titulo", "Diferenciais: título", "Mais que um corte: uma experiência.", 80),
    ("como_selo", "Como funciona: etiqueta", "O site trabalha por você", 60),
    ("como_titulo", "Como funciona: título", "Ser atendido nunca foi tão fácil.", 80),
    ("servicos_selo", "Serviços: etiqueta", "Serviços", 60),
    ("servicos_titulo", "Serviços: título", "Preços claros, sem surpresa.", 80),
    ("equipe_selo", "Equipe: etiqueta", "Nossa equipe", 60),
    ("equipe_titulo", "Equipe: título", "Conheça quem vai cuidar do seu visual.", 80),
    ("horarios_selo", "Horários: etiqueta", "Horários", 60),
    ("horarios_titulo", "Horários: título", "Estamos esperando por você.", 80),
    ("chamada_titulo", "Chamada final: título", "Pronto para sair na régua?", 80),
    ("chamada_texto", "Chamada final: texto", "Seu próximo horário está a um clique.", 120),
    ("rodape_texto", "Rodapé: texto depois do nome", "Agendamento online", 80),
]
# Listas da página inicial (tabela site_itens). campos = quais colunas a seção usa.
SITE_SECOES = {
    "destaque":    {"rotulo": "Cartões ao lado do título", "campos": ["icone", "texto"], "maximo": 3},
    "diferencial": {"rotulo": "Diferenciais", "campos": ["icone", "titulo", "texto"], "maximo": 8},
    "passo":       {"rotulo": "Como funciona (passos)", "campos": ["titulo", "texto"], "maximo": 6},
    "vantagem":    {"rotulo": "Vantagens do site", "campos": ["texto"], "maximo": 10},
}
SITE_ITENS_PADRAO = [
    ("destaque", "⭐", "", "Atendimento de excelência"),
    ("destaque", "⚡", "", "Pague por Pix ou cartão"),
    ("destaque", "🎁", "", "Produtos entregues no seu horário"),
    ("diferencial", "👑", "Atendimento de rei", "Cada cliente é recebido com atenção total. Do café na chegada ao acabamento final, cuidamos de cada detalhe."),
    ("diferencial", "✂️", "Mãos experientes", "Barbeiros especialistas em degradê, navalhado, barba e química, sempre atualizados com as tendências."),
    ("diferencial", "🧴", "Produtos selecionados", "Pomadas, géis, óleos e minoxidil de qualidade. Peça junto com o agendamento e receba no seu horário."),
    ("diferencial", "🛋️", "Ambiente confortável", "Um espaço pensado para você relaxar, conversar e sair renovado, com pontualidade de verdade."),
    ("passo", "", "Escolha o serviço", "Corte, barba, sobrancelha, pigmentação... com preço e duração na tela."),
    ("passo", "", "Escolha seu barbeiro", "Veja a foto e a especialidade de cada um e marque com quem você confia."),
    ("passo", "", "Marque o horário", "Só aparecem os horários livres. Nada de ligar, esperar resposta ou ficar na fila."),
    ("passo", "", "Pague como quiser", "Pix com QR code, cartão de crédito parcelado, débito ou na barbearia."),
    ("vantagem", "", "", "Seus pedidos e horários ficam salvos na sua conta"),
    ("vantagem", "", "", "Cancele pelo app; se já pagou, o reembolso é automático"),
    ("vantagem", "", "", "Produtos separados e entregues no dia do seu atendimento"),
    ("vantagem", "", "", "Funciona no celular e no computador, no modo claro ou escuro"),
]

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
    if tipo == "barbeiro":
        if not db.execute("SELECT 1 FROM barbeiros WHERE id = ? AND ativo = 1 AND senha_hash IS NOT NULL", (s["usuario_id"],)).fetchone():
            raise Erro("Acesso do barbeiro desativado. Fale com o dono.", 401)
        return s["usuario_id"]
    tabela = "clientes" if tipo == "cliente" else "donos"
    usuario_id = int(s["usuario_id"])
    if not db.execute(f"SELECT 1 FROM {tabela} WHERE id = ?", (usuario_id,)).fetchone():
        raise Erro("Conta não encontrada. Faça login novamente.", 401)
    return usuario_id


# =====================================================================
#  Provedores de pagamento
# =====================================================================
def mercado_pago(db):
    """Devolve o Mercado Pago se o dono cadastrou as credenciais; senão None."""
    token = cfg_valor(db, "mp_access_token", "")
    return pag.MercadoPago(token) if token else None


def provedor_cartao(db):
    return mercado_pago(db) or pag.PROVEDOR_CARTAO


# =====================================================================
#  Leitura dos dados
# =====================================================================
def cfg_valor(db, chave, padrao):
    r = db.execute("SELECT valor FROM configuracoes WHERE chave = ?", (chave,)).fetchone()
    return r["valor"] if r else padrao


def max_parcelas(db):
    return int(cfg_valor(db, "max_parcelas", "3"))


def categorias_despesa(db):
    salvas = json.loads(cfg_valor(db, "categorias_despesa", json.dumps(CATEGORIAS_DESPESA_PADRAO)))
    usadas = [r[0] for r in db.execute("SELECT DISTINCT categoria FROM despesas ORDER BY categoria")]
    return salvas + [c for c in usadas if c not in salvas]


def textos_site(db, bruto=False):
    """Textos da página inicial. bruto=True devolve como o dono digitou (com {nome})."""
    salvos = {r["chave"][5:]: r["valor"] for r in db.execute("SELECT * FROM configuracoes WHERE chave LIKE 'site^_%' ESCAPE '^'")}
    textos = {k: salvos.get(k, padrao) for k, _, padrao, _ in SITE_TEXTOS}
    if not bruto:
        textos = {k: v.replace("{nome}", textos["nome"]) for k, v in textos.items()}
    return textos


def itens_site(db):
    itens = {s: [] for s in SITE_SECOES}
    for r in db.execute("SELECT * FROM site_itens ORDER BY secao, ordem, id"):
        if r["secao"] in itens:
            itens[r["secao"]].append({"icone": r["icone"], "titulo": r["titulo"], "texto": r["texto"]})
    return itens


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
             "folga": json.loads(r["folga"]), "ativo": bool(r["ativo"]), "foto": url_foto(r)}
        if completo:
            b.update(telefone=r["telefone"], comissao=r["comissao"], comissaoProdutos=r["comissao_produtos"],
                     entrouEm=r["entrou_em"], desligadoEm=r["desligado_em"], chavePix=r["chave_pix"],
                     temAcesso=bool(r["senha_hash"]))
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
    chave = cfg_valor(db, "pix_chave", "")
    mp = bool(cfg_valor(db, "mp_access_token", ""))
    pagamentos = {"pixAtivo": bool(chave) or mp, "pixAutomatico": mp,
                  "modoCartao": "mercadopago" if mp else pag.PROVEDOR_CARTAO.nome,
                  "mpPublicKey": cfg_valor(db, "mp_public_key", "") if mp else "",
                  "maxParcelas": max_parcelas(db), "recebedor": cfg_valor(db, "pix_recebedor", "")}
    site = {"textos": textos_site(db), "itens": itens_site(db)}
    if completo:
        token = cfg_valor(db, "mp_access_token", "")
        pagamentos.update(chavePix=chave, cidade=cfg_valor(db, "pix_cidade", ""),
                          chaveExemplo=chave == CHAVE_PIX_EXEMPLO,
                          mpPublicKey=cfg_valor(db, "mp_public_key", ""),
                          mpTokenFinal=token[-6:] if token else "",          # nunca devolve o token inteiro
                          mpTeste=token.startswith("TEST-"))
        # para o painel do dono montar o formulário da página inicial
        site.update(textosBrutos=textos_site(db, bruto=True),
                    campos=[{"chave": k, "rotulo": rot, "maximo": m} for k, rot, _, m in SITE_TEXTOS],
                    secoes=SITE_SECOES)
    return {"servicos": servicos, "barbeiros": barbeiros, "produtos": produtos,
            "funcionamento": ler_funcionamento(db), "pagamentos": pagamentos, "site": site}


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
    pags = {}
    for p in db.execute(f"""SELECT pc.* FROM pagamentos_clientes pc
                            JOIN agendamentos a ON a.id = pc.agendamento_id {onde}
                            ORDER BY pc.criado_em""", params):
        pags.setdefault(p["agendamento_id"], []).append(p)
    saida = []
    for r in linhas:
        lista_pag = pags.get(r["id"], [])
        aprovado = next((p for p in reversed(lista_pag) if p["status"] == "aprovado"), None)
        if r["pago"]:
            situacao = "pago"
        elif any(p["metodo"] == "pix" and p["status"] == "aguardando" for p in lista_pag):
            situacao = "pix_aguardando"
        elif r["pagamento"] == "Pagar na barbearia":
            situacao = "na_barbearia"
        else:
            situacao = "pendente"
        detalhe = ""
        if aprovado and aprovado["metodo"] != "pix":
            detalhe = f"{aprovado['bandeira']} final {aprovado['final_cartao']}" + (f" em {aprovado['parcelas']}x" if aprovado["parcelas"] > 1 else "")
        elif aprovado and aprovado["provedor"] == "mercadopago":
            detalhe = "Pix via Mercado Pago"
        elif any(p["status"] == "estornado" for p in lista_pag):
            detalhe = "valor reembolsado"
        a = {
            "id": r["id"], "clienteId": r["cliente_id"], "cliente": r["cliente_nome"], "telefone": r["telefone"],
            "servicoId": r["servico_id"], "servico": r["servico_nome"], "preco": r["preco"], "duracao": r["duracao"],
            "barbeiroId": r["barbeiro_id"], "barbeiro": r["barbeiro_nome"], "dia": r["dia"], "hora": r["hora"],
            "produtos": itens.get(r["id"], []), "total": r["total"], "pagamento": r["pagamento"],
            "pago": bool(r["pago"]), "pagamentoStatus": situacao, "pagamentoDetalhe": detalhe, "obs": r["obs"], "status": r["status"], "origem": r["origem"],
            "criadoEm": r["criado_em"], "atendidoEm": r["atendido_em"],
        }
        if not para_cliente:
            a["comissaoValor"] = r["comissao_valor"]
            a["repasseId"] = r["pagamento_barbeiro_id"]       # pagamento em que o barbeiro recebeu
            a["reembolsoPendente"] = r["status"] in ("cancelado", "faltou") and bool(r["pago"])
        saida.append(a)
    return saida


def saldo_barbeiro(db, barbeiro_id):
    """Quanto o barbeiro tem a receber: comissões de atendimentos ainda não pagos a ele."""
    return round(db.execute("""SELECT COALESCE(SUM(comissao_valor), 0) FROM agendamentos
                               WHERE barbeiro_id = ? AND status = 'atendido' AND pagamento_barbeiro_id IS NULL""",
                            (barbeiro_id,)).fetchone()[0], 2)


def url_foto(r):
    return f"/api/barbeiros/{r['id']}/foto?v={r['foto_versao']}" if r["foto_versao"] else None


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
         dia, hora, round(total, 2), pagamento, 0, obs, origem,  # fica "pago" só quando o pagamento é aprovado
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


def estornar(db, a, manual_ok=False):
    """
    Devolve o dinheiro de um agendamento cancelado.
    - Mercado Pago (cartão ou Pix): reembolso automático pela API do Mercado Pago.
    - Cartão em modo de teste: reembolso simulado.
    - Pix direto na chave (sem Mercado Pago): o dono devolve pelo banco e marca aqui (manual_ok=True).
    Se o reembolso falhar, o agendamento fica com "reembolso pendente" para tentar de novo.
    """
    momento = agora().isoformat(timespec="seconds")
    if not a["pago"]:
        mp = mercado_pago(db)
        for p in db.execute("SELECT * FROM pagamentos_clientes WHERE agendamento_id = ? AND status = 'aguardando'", (a["id"],)).fetchall():
            if p["provedor"] == "mercadopago" and mp and p["provedor_id"]:
                mp.cancelar(p["provedor_id"])  # Pix ainda não pago: só cancela o código
        db.execute("UPDATE pagamentos_clientes SET status = 'recusado', mensagem = 'Agendamento cancelado' WHERE agendamento_id = ? AND status = 'aguardando'",
                   (a["id"],))
        return ""
    p = db.execute("SELECT * FROM pagamentos_clientes WHERE agendamento_id = ? AND status = 'aprovado' ORDER BY criado_em DESC LIMIT 1",
                   (a["id"],)).fetchone()
    valor = f"R$ {a['total']:.2f}".replace(".", ",")
    if p and p["provedor"] == "mercadopago":
        mp = mercado_pago(db)
        if not mp:
            return "Reembolso pendente: as credenciais do Mercado Pago foram removidas."
        try:
            mp.reembolsar(p["provedor_id"])
        except pag.ErroMercadoPago as e:
            return f"O reembolso ainda não foi feito ({e}). A barbearia vai tentar de novo."
        onde = f"no cartão final {p['final_cartao']}" if p["metodo"] != "pix" else "na conta do Pix"
        msg = f"Reembolso de {valor} feito pelo Mercado Pago {onde}."
    elif p and p["metodo"] != "pix":
        pag.PROVEDOR_CARTAO.reembolsar(p["txid"], a["total"])
        msg = f"O valor de {valor} foi estornado no cartão final {p['final_cartao']}."
    elif manual_ok:
        msg = f"Pix de {valor} marcado como devolvido ao cliente."
    else:
        return "Como você pagou por Pix, a barbearia vai devolver o valor."
    if p:
        db.execute("UPDATE pagamentos_clientes SET status = 'estornado', reembolsado_em = ? WHERE id = ?", (momento, p["id"]))
    db.execute("UPDATE agendamentos SET pago = 0 WHERE id = ?", (a["id"],))
    return msg


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
    return {"id": r["id"], "nome": r["nome"], "tel": r["telefone"], "email": r["email"], "cpf": r["cpf"]}


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
    return {"token": nova_sessao(c.db, "cliente", cid), "cliente": {"id": cid, "nome": nome, "tel": tel, "email": "", "cpf": ""}}


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
    return {"mensagem": estornar(c.db, a)}


# ---------- Pagamento pelo cliente ----------
def agendamento_para_pagar(c):
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["cliente_id"] != c.usuario_id:
        raise Erro("Agendamento não encontrado.", 404)
    if a["status"] != "confirmado":
        raise Erro("Este agendamento não está mais em aberto.", 409)
    if a["pago"]:
        raise Erro("Este agendamento já está pago.", 409)
    return a


def dados_pagador(c, precisa_cpf=False):
    """E-mail (e CPF, no cartão) que o Mercado Pago exige. Ficam salvos na conta do cliente."""
    cli = c.db.execute("SELECT * FROM clientes WHERE id = ?", (c.usuario_id,)).fetchone()
    email = texto(c.corpo, "email", False, 120, "e-mail") or cli["email"]
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email or ""):
        raise Erro("Digite um e-mail válido para receber o comprovante.")
    cpf = digitos(c.corpo.get("cpf")) or cli["cpf"]
    if precisa_cpf and len(cpf) != 11:
        raise Erro("Digite o CPF do dono do cartão (11 números).")
    c.db.execute("UPDATE clientes SET email = ?, cpf = ? WHERE id = ?", (email, cpf if len(cpf) == 11 else cli["cpf"], cli["id"]))
    return email, cpf


def descricao_pedido(a):
    return f"{a['servico_nome']} - {a['dia'][8:10]}/{a['dia'][5:7]} {a['hora']} - Agendamento {a['id']}"


@rota("POST", r"/api/agendamentos/(\d+)/pix", "cliente")
def r_pix(c):
    a = agendamento_para_pagar(c)
    mp = mercado_pago(c.db)
    if mp:
        # Pix pelo Mercado Pago: o sistema descobre sozinho quando o cliente pagar
        p = c.db.execute("""SELECT * FROM pagamentos_clientes WHERE agendamento_id = ? AND metodo = 'pix' AND status = 'aguardando'
                            AND provedor = 'mercadopago' AND valor = ? AND criado_em > ? ORDER BY criado_em DESC LIMIT 1""",
                         (a["id"], a["total"], (agora() - timedelta(minutes=50)).isoformat(timespec="seconds"))).fetchone()
        if p:
            return {"codigo": p["pix_codigo"], "valor": a["total"], "recebedor": cfg_valor(c.db, "pix_recebedor", ""),
                    "txid": p["provedor_id"], "automatico": True}
        email, _ = dados_pagador(c)
        try:
            r = mp.criar_pix(a["total"], descricao_pedido(a), email, f"agendamento-{a['id']}")
        except pag.ErroMercadoPago as e:
            raise Erro(str(e), 502)
        c.db.execute("""INSERT INTO pagamentos_clientes (id, agendamento_id, metodo, status, valor, txid, pix_codigo, provedor, provedor_id, criado_em)
                        VALUES (?, ?, 'pix', 'aguardando', ?, ?, ?, 'mercadopago', ?, ?)""",
                     (novo_id("pc"), a["id"], a["total"], r["id"], r["codigo"], r["id"], agora().isoformat(timespec="seconds")))
        c.db.execute("UPDATE agendamentos SET pagamento = 'Pix' WHERE id = ?", (a["id"],))
        return {"codigo": r["codigo"], "qrBase64": r["qr_base64"], "valor": a["total"],
                "recebedor": cfg_valor(c.db, "pix_recebedor", ""), "txid": r["id"], "automatico": True}

    chave = cfg_valor(c.db, "pix_chave", "")
    if not chave:
        raise Erro("A barbearia ainda não cadastrou a chave Pix. Escolha outra forma de pagamento.")
    recebedor = cfg_valor(c.db, "pix_recebedor", "Barbearia")
    cidade = cfg_valor(c.db, "pix_cidade", "Sao Paulo")
    # reaproveita o mesmo Pix se o cliente abrir de novo (ele pode já ter pago esse código)
    p = c.db.execute("""SELECT * FROM pagamentos_clientes WHERE agendamento_id = ? AND metodo = 'pix' AND status = 'aguardando'
                        AND valor = ? ORDER BY criado_em DESC LIMIT 1""", (a["id"], a["total"])).fetchone()
    if p and chave in p["pix_codigo"]:
        codigo, txid = p["pix_codigo"], p["txid"]
    else:
        txid = pag.novo_txid()
        codigo = pag.codigo_pix(chave, recebedor, cidade, a["total"], txid)
        c.db.execute("""INSERT INTO pagamentos_clientes (id, agendamento_id, metodo, status, valor, txid, pix_codigo, provedor, criado_em)
                        VALUES (?, ?, 'pix', 'aguardando', ?, ?, ?, 'pix_manual', ?)""",
                     (novo_id("pc"), a["id"], a["total"], txid, codigo, agora().isoformat(timespec="seconds")))
    c.db.execute("UPDATE agendamentos SET pagamento = 'Pix' WHERE id = ?", (a["id"],))
    return {"codigo": codigo, "valor": a["total"], "recebedor": recebedor, "txid": txid, "automatico": False}


def atualizar_pix_mp(db, a):
    """Pergunta ao Mercado Pago se o Pix deste agendamento já foi pago."""
    mp = mercado_pago(db)
    if not mp or a["pago"]:
        return
    for p in db.execute("""SELECT * FROM pagamentos_clientes WHERE agendamento_id = ? AND status = 'aguardando'
                           AND provedor = 'mercadopago'""", (a["id"],)).fetchall():
        try:
            r = mp.consultar(p["provedor_id"])
        except pag.ErroMercadoPago:
            continue
        if r["status"] == "approved":
            momento = agora().isoformat(timespec="seconds")
            db.execute("UPDATE pagamentos_clientes SET status = 'aprovado', pago_em = ? WHERE id = ?", (momento, p["id"]))
            db.execute("UPDATE agendamentos SET pago = 1, pagamento = 'Pix' WHERE id = ?", (a["id"],))
            if a["status"] in ("cancelado", "faltou"):  # pagou depois de cancelado: devolve
                estornar(db, buscar_agendamento(db, a["id"]))
            return
        if r["status"] in ("cancelled", "rejected", "refunded"):
            db.execute("UPDATE pagamentos_clientes SET status = 'recusado', mensagem = ? WHERE id = ?", (r["status"], p["id"]))


@rota("GET", r"/api/agendamentos/(\d+)/pagamento", "cliente")
def r_situacao_pagamento(c):
    """O app pergunta de tempos em tempos se o Pix já caiu."""
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["cliente_id"] != c.usuario_id:
        raise Erro("Agendamento não encontrado.", 404)
    atualizar_pix_mp(c.db, a)
    a = ler_agendamentos(c.db, "WHERE a.id = ?", (a["id"],), para_cliente=True)[0]
    return {"pagamentoStatus": a["pagamentoStatus"], "pago": a["pago"]}


def registrar_cartao(c, a, *, tipo, parcelas, bandeira, final, status, transacao, mensagem, provedor):
    momento = agora().isoformat(timespec="seconds")
    c.db.execute("""INSERT INTO pagamentos_clientes (id, agendamento_id, metodo, status, valor, txid, bandeira, final_cartao, parcelas,
                      mensagem, provedor, provedor_id, criado_em, pago_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                 (novo_id("pc"), a["id"], tipo, status, a["total"], transacao, bandeira, final, parcelas, mensagem, provedor,
                  transacao if provedor == "mercadopago" else None, momento, momento if status == "aprovado" else None))
    if status == "aprovado":
        # outros Pix em aberto deste pedido deixam de valer
        mp = mercado_pago(c.db)
        for p in c.db.execute("SELECT * FROM pagamentos_clientes WHERE agendamento_id = ? AND status = 'aguardando'", (a["id"],)).fetchall():
            if p["provedor"] == "mercadopago" and mp:
                mp.cancelar(p["provedor_id"])
        c.db.execute("UPDATE pagamentos_clientes SET status = 'recusado', mensagem = 'Pago com cartão' WHERE agendamento_id = ? AND status = 'aguardando'",
                     (a["id"],))
        c.db.execute("UPDATE agendamentos SET pago = 1, pagamento = ? WHERE id = ?",
                     ("Cartão de crédito" if tipo == "credito" else "Cartão de débito", a["id"]))


@rota("POST", r"/api/agendamentos/(\d+)/cartao", "cliente")
def r_cartao(c):
    a = agendamento_para_pagar(c)
    tipo = c.corpo.get("tipo")
    if tipo not in ("credito", "debito"):
        raise Erro("Escolha crédito ou débito.")
    parcelas = 1 if tipo == "debito" else numero(c.corpo.get("parcelas", 1), "parcelas", 1, max_parcelas(c.db), inteiro=True)

    mp = mercado_pago(c.db)
    if mp:
        # Com Mercado Pago o número do cartão nem passa pelo nosso servidor:
        # o navegador manda os dados direto para o Mercado Pago, que devolve um "token".
        email, cpf = dados_pagador(c, precisa_cpf=True)
        token = texto(c.corpo, "token", maximo=200, nome="token do cartão")
        metodo_id = id_valido(c.corpo.get("metodoId"), "bandeira")
        emissor = c.corpo.get("emissorId")
        emissor = str(emissor) if emissor not in (None, "") and re.fullmatch(r"\d{1,12}", str(emissor)) else None
        bandeira = texto(c.corpo, "bandeira", False, 30) or metodo_id.capitalize()
        final = digitos(c.corpo.get("final"))[-4:]
        try:
            r = mp.cobrar_cartao(valor=a["total"], descricao=descricao_pedido(a), token=token, metodo_id=metodo_id,
                                 emissor_id=emissor, parcelas=parcelas, email=email, cpf=cpf, referencia=f"agendamento-{a['id']}")
        except pag.ErroMercadoPago as e:
            raise Erro(str(e), 502)
        if r["status"] == "approved":
            registrar_cartao(c, a, tipo=tipo, parcelas=parcelas, bandeira=bandeira, final=final, status="aprovado",
                             transacao=r["id"], mensagem="", provedor="mercadopago")
            return {"aprovado": True, "bandeira": bandeira, "final": final, "parcelas": parcelas, "transacao": r["id"], "modoTeste": False}
        if r["status"] in ("in_process", "pending"):
            registrar_cartao(c, a, tipo=tipo, parcelas=parcelas, bandeira=bandeira, final=final, status="aguardando",
                             transacao=r["id"], mensagem="Em análise", provedor="mercadopago")
            return {"aprovado": False, "mensagem": "O pagamento está em análise pelo Mercado Pago. Você recebe a resposta por e-mail."}
        motivo = pag.motivo_recusa(r["detalhe"])
        registrar_cartao(c, a, tipo=tipo, parcelas=parcelas, bandeira=bandeira, final=final, status="recusado",
                         transacao=r["id"], mensagem=motivo, provedor="mercadopago")
        return {"aprovado": False, "mensagem": motivo}

    try:
        numero_cartao, bandeira = pag.validar_cartao(c.corpo)
    except ValueError as e:
        raise Erro(str(e))
    final = numero_cartao[-4:]
    momento = agora().isoformat(timespec="seconds")
    pid = novo_id("pc")
    try:
        transacao = pag.PROVEDOR_CARTAO.cobrar(numero_cartao, a["total"], tipo, parcelas)
    except pag.CartaoRecusado as e:
        # guarda a tentativa recusada (sem os dados do cartão) e avisa o cliente
        c.db.execute("""INSERT INTO pagamentos_clientes (id, agendamento_id, metodo, status, valor, bandeira, final_cartao, parcelas, mensagem, criado_em)
                        VALUES (?, ?, ?, 'recusado', ?, ?, ?, ?, ?, ?)""",
                     (pid, a["id"], tipo, a["total"], bandeira, final, parcelas, str(e), momento))
        return {"aprovado": False, "mensagem": str(e)}
    c.db.execute("""INSERT INTO pagamentos_clientes (id, agendamento_id, metodo, status, valor, txid, bandeira, final_cartao, parcelas, criado_em, pago_em)
                    VALUES (?, ?, ?, 'aprovado', ?, ?, ?, ?, ?, ?, ?)""",
                 (pid, a["id"], tipo, a["total"], transacao, bandeira, final, parcelas, momento, momento))
    c.db.execute("UPDATE pagamentos_clientes SET status = 'recusado', mensagem = 'Pago com cartão' WHERE agendamento_id = ? AND status = 'aguardando'",
                 (a["id"],))
    c.db.execute("UPDATE agendamentos SET pago = 1, pagamento = ? WHERE id = ?",
                 ("Cartão de crédito" if tipo == "credito" else "Cartão de débito", a["id"]))
    return {"aprovado": True, "bandeira": bandeira, "final": final, "parcelas": parcelas, "transacao": transacao,
            "modoTeste": pag.PROVEDOR_CARTAO.nome == "teste"}


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
    # confere no Mercado Pago os Pix que ainda estão esperando (no máximo 10 de uma vez)
    if mercado_pago(c.db):
        for a in c.db.execute("""SELECT DISTINCT a.* FROM agendamentos a JOIN pagamentos_clientes p ON p.agendamento_id = a.id
                                 WHERE p.status = 'aguardando' AND p.provedor = 'mercadopago' AND p.criado_em > ? LIMIT 10""",
                              ((agora() - timedelta(days=2)).isoformat(),)).fetchall():
            atualizar_pix_mp(c.db, a)
    dono = c.db.execute("SELECT nome, usuario, email, telefone FROM donos WHERE id = ?", (c.usuario_id,)).fetchone()
    return {
        "dono": {"nome": dono["nome"], "usuario": dono["usuario"], "email": dono["email"], "telefone": dono["telefone"]},
        "mensagens": config_mensagens_publica(c.db),
        "config": ler_config(c.db, completo=True),
        "agendamentos": ler_agendamentos(c.db),
        "usuarios": [cliente_json(r) for r in c.db.execute("SELECT * FROM clientes ORDER BY nome")],
        "pagamentos": [{"id": r["id"], "barbeiroId": r["barbeiro_id"], "barbeiro": r["nome"], "valor": r["valor"],
                        "data": r["data"], "forma": r["forma"], "obs": r["obs"]}
                       for r in c.db.execute("""SELECT p.*, b.nome FROM pagamentos_barbeiros p
                                                JOIN barbeiros b ON b.id = p.barbeiro_id ORDER BY p.data""")],
        "despesas": [dict(r) for r in c.db.execute("SELECT * FROM despesas ORDER BY data")],
        # listas de opções dos formulários (uma fonte só: o servidor)
        "opcoes": {"formasApp": FORMAS_APP, "formasBalcao": FORMAS_BALCAO, "formasPagBarbeiro": FORMAS_PAG_BARBEIRO,
                   "intervalos": INTERVALOS, "diasAntecedencia": DIAS_ANTECEDENCIA, "maxParcelasLimite": MAX_PARCELAS_LIMITE,
                   "categoriasDespesa": categorias_despesa(c.db)},
    }


@rota("PUT", "/api/dono/site", "dono")
def r_salvar_site(c):
    """Textos e listas da página inicial."""
    db, corpo = c.db, c.corpo
    textos = corpo.get("textos")
    if not isinstance(textos, dict):
        raise Erro("Textos inválidos.")
    for chave, rotulo, _, maximo in SITE_TEXTOS:
        valor = texto(textos, chave, chave == "nome", maximo, rotulo)
        db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)", ("site_" + chave, valor))
    itens = corpo.get("itens")
    if not isinstance(itens, dict):
        raise Erro("Listas inválidas.")
    db.execute("DELETE FROM site_itens")
    for secao, regra in SITE_SECOES.items():
        lista_secao = lista(itens, secao) if secao in itens else []
        if len(lista_secao) > regra["maximo"]:
            raise Erro(f"{regra['rotulo']}: no máximo {regra['maximo']} itens.")
        for ordem, item in enumerate(lista_secao):
            if not isinstance(item, dict):
                raise Erro(f"{regra['rotulo']}: item inválido.")
            valores = {campo: texto(item, campo, campo in ("texto", "titulo"), 8 if campo == "icone" else 200, f"{regra['rotulo']} ({campo})")
                       if campo in regra["campos"] else "" for campo in ("icone", "titulo", "texto")}
            db.execute("INSERT INTO site_itens (secao, ordem, icone, titulo, texto) VALUES (?, ?, ?, ?, ?)",
                       (secao, ordem, valores["icone"], valores["titulo"], valores["texto"]))


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
        # o WhatsApp do barbeiro é o login dele no painel do barbeiro
        tel = digitos(b.get("telefone"))
        if tel and len(tel) not in (10, 11):
            raise Erro(f"{nome}: digite o WhatsApp com DDD.")
        if tel and db.execute("SELECT 1 FROM barbeiros WHERE telefone = ? AND id != ?", (tel, bid)).fetchone():
            raise Erro(f"{nome}: já existe outro barbeiro com esse WhatsApp.")
        chave_digitada = texto(b, "chavePix", False, 77, "chave Pix do barbeiro")
        chave = pag.validar_chave_pix(chave_digitada) if chave_digitada else ""
        if chave is None:
            raise Erro(f"{nome}: chave Pix inválida. Use CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória.")
        existe = db.execute("SELECT senha_hash FROM barbeiros WHERE id = ?", (bid,)).fetchone()
        nova_senha = b.get("novaSenha") or ""
        if not isinstance(nova_senha, str) or (nova_senha and len(nova_senha) < 4):
            raise Erro(f"{nome}: a senha do barbeiro precisa ter pelo menos 4 caracteres.")
        if not existe and not nova_senha:
            raise Erro(f"{nome}: crie uma senha para o barbeiro acessar o painel dele.")
        if nova_senha and not tel:
            raise Erro(f"{nome}: digite o WhatsApp com DDD. Ele é o login do barbeiro.")
        # "ativo" não muda aqui: remover/reativar tem rota própria (com as regras de pagamento)
        db.execute("""INSERT INTO barbeiros (id, nome, telefone, chave_pix, especialidade, folga, comissao, comissao_produtos, ativo, entrou_em)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                      ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, telefone = excluded.telefone, chave_pix = excluded.chave_pix,
                      especialidade = excluded.especialidade, folga = excluded.folga, comissao = excluded.comissao,
                      comissao_produtos = excluded.comissao_produtos""",
                   (bid, nome, tel, chave, texto(b, "especialidade", False, 80),
                    json.dumps(sorted(set(folga))), numero(b.get("comissao"), "comissão", 0, 100),
                    numero(b.get("comissaoProdutos", 0), "comissão dos produtos", 0, 100), hoje().isoformat()))
        if nova_senha:
            db.execute("UPDATE barbeiros SET senha_hash = ? WHERE id = ?", (gerar_hash(nova_senha), bid))
            db.execute("DELETE FROM sessoes WHERE tipo = 'barbeiro' AND usuario_id = ?", (bid,))
        db.execute("UPDATE agendamentos SET barbeiro_nome = ? WHERE barbeiro_id = ? AND status = 'confirmado'", (nome, bid))

    for p in lista(cfg, "produtos"):
        db.execute("""INSERT INTO produtos (id, nome, categoria, icone, preco, custo, estoque, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, categoria = excluded.categoria, icone = excluded.icone,
                      preco = excluded.preco, custo = excluded.custo, estoque = excluded.estoque, ativo = excluded.ativo""",
                   (id_valido(p.get("id"), "produto"), texto(p, "nome", maximo=80, nome="nome do produto"),
                    texto(p, "categoria", False, 40), texto(p, "icone", False, 8),
                    numero(p.get("preco"), "preço", 0, 100000), numero(p.get("custo", 0), "custo", 0, 100000),
                    numero(p.get("estoque"), "estoque", 0, 100000, inteiro=True), 0 if p.get("ativo") is False else 1))

    p = cfg.get("pagamentos")
    if p is not None:
        if not isinstance(p, dict):
            raise Erro("Configuração de pagamento inválida.")
        chave_digitada = texto(p, "chavePix", False, 77, "chave Pix")
        chave = pag.validar_chave_pix(chave_digitada) if chave_digitada else ""
        if chave is None:
            raise Erro("Chave Pix inválida. Use CPF, CNPJ, e-mail, telefone (+55...) ou chave aleatória.")
        for chave_cfg, valor in [("pix_chave", chave), ("pix_recebedor", texto(p, "recebedor", bool(chave), 25, "nome do recebedor")),
                                 ("pix_cidade", texto(p, "cidade", bool(chave), 15, "cidade"))]:
            db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)", (chave_cfg, valor))
        if "maxParcelas" in p:
            vezes = numero(p.get("maxParcelas"), "número de parcelas", 1, MAX_PARCELAS_LIMITE, inteiro=True)
            db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('max_parcelas', ?)", (str(vezes),))

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
    if not a["pago"]:
        pagamento = c.corpo.get("forma")
        if pagamento not in FORMAS_BALCAO:
            raise Erro("Escolha como o cliente pagou.")
        c.db.execute("UPDATE pagamentos_clientes SET status = ?, pago_em = ? WHERE agendamento_id = ? AND status = 'aguardando'",
                     ("aprovado" if pagamento == "Pix" else "recusado", agora().isoformat(timespec="seconds"), a["id"]))
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
    if novo == "cancelado":
        return {"mensagem": estornar(c.db, a)}


@rota("POST", r"/api/dono/agendamentos/(\d+)/confirmar-pix", "dono")
def r_confirmar_pix(c):
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["pago"]:
        raise Erro("Este agendamento já está pago.", 409)
    if a["status"] in ("cancelado", "faltou"):
        raise Erro("Este agendamento não está mais em aberto.", 409)
    momento = agora().isoformat(timespec="seconds")
    if not c.db.execute("UPDATE pagamentos_clientes SET status = 'aprovado', pago_em = ? WHERE agendamento_id = ? AND metodo = 'pix' AND status = 'aguardando'",
                        (momento, a["id"])).rowcount:
        raise Erro("Não há Pix aguardando para este agendamento.", 409)
    c.db.execute("UPDATE agendamentos SET pago = 1, pagamento = 'Pix' WHERE id = ?", (a["id"],))


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
    """
    Paga o barbeiro pelos atendimentos escolhidos. Cada atendimento fica marcado com o pagamento
    em que foi quitado, então dá para ver exatamente o que já foi pago e o que falta.
    """
    bid = id_valido(c.corpo.get("barbeiroId"), "barbeiro")
    if not c.db.execute("SELECT 1 FROM barbeiros WHERE id = ?", (bid,)).fetchone():
        raise Erro("Barbeiro não encontrado.", 404)
    forma = c.corpo.get("forma")
    if forma not in FORMAS_PAG_BARBEIRO:
        raise Erro("Forma de pagamento inválida.")
    data_valida(c.corpo.get("data"))
    ids = c.corpo.get("agendamentoIds")
    if not isinstance(ids, list) or not ids or len(ids) > 2000 or not all(isinstance(x, int) and not isinstance(x, bool) for x in ids):
        raise Erro("Escolha pelo menos um atendimento para pagar.")
    ids = sorted(set(ids))
    marcas = ",".join("?" * len(ids))
    linhas = c.db.execute(f"""SELECT id, comissao_valor FROM agendamentos WHERE id IN ({marcas}) AND barbeiro_id = ?
                              AND status = 'atendido' AND pagamento_barbeiro_id IS NULL""", (*ids, bid)).fetchall()
    if len(linhas) != len(ids):
        raise Erro("Algum desses atendimentos já foi pago ou não é deste barbeiro. Atualize a página.", 409)
    valor = round(sum(r["comissao_valor"] or 0 for r in linhas), 2)
    if valor <= 0:
        raise Erro("Esses atendimentos não têm comissão a pagar.")
    pid = novo_id("pg")
    c.db.execute("INSERT INTO pagamentos_barbeiros (id, barbeiro_id, valor, data, forma, obs) VALUES (?, ?, ?, ?, ?, ?)",
                 (pid, bid, valor, c.corpo["data"], forma, texto(c.corpo, "obs", False, 120, "observação")))
    c.db.execute(f"UPDATE agendamentos SET pagamento_barbeiro_id = ? WHERE id IN ({marcas})", (pid, *ids))
    return {"id": pid, "valor": valor, "atendimentos": len(ids)}


@rota("DELETE", r"/api/dono/pagamentos/([\w-]+)", "dono")
def r_excluir_pagamento(c):
    """Desfaz um pagamento registrado errado: os atendimentos voltam a ficar 'a receber'."""
    c.db.execute("UPDATE agendamentos SET pagamento_barbeiro_id = NULL WHERE pagamento_barbeiro_id = ?", (c.args[0],))
    if not c.db.execute("DELETE FROM pagamentos_barbeiros WHERE id = ?", (c.args[0],)).rowcount:
        raise Erro("Pagamento não encontrado.", 404)


@rota("POST", r"/api/dono/barbeiros/([\w-]+)/pix", "dono")
def r_pix_barbeiro(c):
    """Gera o QR code Pix para o dono pagar o barbeiro pelo app do banco."""
    b = c.db.execute("SELECT * FROM barbeiros WHERE id = ?", (c.args[0],)).fetchone()
    if not b:
        raise Erro("Barbeiro não encontrado.", 404)
    if not b["chave_pix"]:
        raise Erro(f"Cadastre a chave Pix de {b['nome']} (Barbeiros → Editar) para pagar pelo site.")
    valor = round(numero(c.corpo.get("valor"), "valor", 0.01, 1_000_000), 2)
    cidade = cfg_valor(c.db, "pix_cidade", "") or "Brasil"
    return {"codigo": pag.codigo_pix(b["chave_pix"], b["nome"], cidade, valor, pag.novo_txid()),
            "chave": b["chave_pix"], "nome": b["nome"], "valor": valor}


@rota("PUT", r"/api/dono/barbeiros/([\w-]+)/foto", "dono")
def r_foto_salvar(c):
    import base64
    b = c.db.execute("SELECT id FROM barbeiros WHERE id = ?", (c.args[0],)).fetchone()
    if not b:
        raise Erro("Barbeiro não encontrado.", 404)
    imagem = c.corpo.get("imagem")
    if imagem is None:  # remover foto
        c.db.execute("UPDATE barbeiros SET foto = NULL, foto_tipo = NULL, foto_versao = NULL WHERE id = ?", (b["id"],))
        return
    m = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)", imagem if isinstance(imagem, str) else "")
    if not m:
        raise Erro("Foto inválida. Use uma imagem JPG, PNG ou WEBP.")
    dados = base64.b64decode(m.group(2))
    assinaturas = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG", "image/webp": b"RIFF"}
    if len(dados) > FOTO_MAX_BYTES or not dados.startswith(assinaturas[m.group(1)]):
        raise Erro("Foto inválida ou grande demais (máximo 1,5 MB).")
    c.db.execute("UPDATE barbeiros SET foto = ?, foto_tipo = ?, foto_versao = ? WHERE id = ?",
                 (dados, m.group(1), secrets.token_hex(4), b["id"]))


@rota("GET", r"/api/barbeiros/([\w-]+)/foto")
def r_foto(c):
    b = c.db.execute("SELECT foto, foto_tipo FROM barbeiros WHERE id = ?", (c.args[0],)).fetchone()
    if not b or not b["foto"]:
        raise Erro("Sem foto.", 404)
    return Arquivo(bytes(b["foto"]), b["foto_tipo"], None)


@rota("POST", r"/api/dono/agendamentos/(\d+)/reembolsar", "dono")
def r_reembolsar(c):
    """Reembolsa um pedido cancelado que ainda está pago (ex.: o reembolso automático falhou, ou foi Pix direto)."""
    a = buscar_agendamento(c.db, int(c.args[0]))
    if a["status"] not in ("cancelado", "faltou"):
        raise Erro("Cancele o agendamento antes de reembolsar.", 409)
    if not a["pago"]:
        raise Erro("Esse pedido não tem valor pago para devolver.", 409)
    msg = estornar(c.db, a, manual_ok=True)
    if buscar_agendamento(c.db, a["id"])["pago"]:
        raise Erro(msg, 502)
    return {"mensagem": msg}


@rota("PUT", "/api/dono/mercadopago", "dono")
def r_salvar_mp(c):
    if c.corpo.get("remover"):
        c.db.execute("DELETE FROM configuracoes WHERE chave IN ('mp_public_key', 'mp_access_token')")
        return {"mensagem": "Mercado Pago desligado. O cartão volta para o modo de teste."}
    publica = texto(c.corpo, "publicKey", True, 120, "Public Key")
    token = texto(c.corpo, "accessToken", False, 200, "Access Token") or cfg_valor(c.db, "mp_access_token", "")
    if not re.fullmatch(r"(APP_USR|TEST)-[\w-]+", publica):
        raise Erro("Public Key inválida. Ela começa com APP_USR- ou TEST-.")
    if not re.fullmatch(r"(APP_USR|TEST)-[\w-]+", token or ""):
        raise Erro("Access Token inválido. Ele começa com APP_USR- ou TEST-.")
    try:
        pag.MercadoPago(token).testar()
    except pag.ErroMercadoPago as e:
        raise Erro(str(e))
    for chave, valor in (("mp_public_key", publica), ("mp_access_token", token)):
        c.db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)", (chave, valor))
    modo = "de TESTE" if token.startswith("TEST-") else "de PRODUÇÃO (cobra de verdade)"
    return {"mensagem": f"Mercado Pago conectado no modo {modo}."}


# ---------- Barbeiro ----------
@rota("POST", "/api/barbeiro/login")
def r_login_barbeiro(c):
    tel = digitos(c.corpo.get("telefone"))
    senha = c.corpo.get("senha")
    b = c.db.execute("SELECT * FROM barbeiros WHERE telefone = ? AND ativo = 1", (tel,)).fetchone()
    if not b or not b["senha_hash"] or not isinstance(senha, str) or not conferir_senha(senha, b["senha_hash"]):
        raise Erro("WhatsApp ou senha incorretos.", 401)
    return {"token": nova_sessao(c.db, "barbeiro", b["id"]), "nome": b["nome"]}


@rota("GET", "/api/barbeiro/dados", "barbeiro")
def r_dados_barbeiro(c):
    b = c.db.execute("SELECT * FROM barbeiros WHERE id = ?", (c.usuario_id,)).fetchone()
    ags = ler_agendamentos(c.db, "WHERE a.barbeiro_id = ? AND a.status != 'cancelado'", (b["id"],))
    for a in ags:  # o barbeiro não vê custo de produto nem dados de pagamento do cartão
        for p in a["produtos"]:
            p.pop("custo", None)
        a.pop("pagamentoDetalhe", None)
        a.pop("reembolsoPendente", None)
        if a["status"] == "confirmado":  # quanto ele deve ganhar com esse atendimento
            prod = sum(p["preco"] * p["qtd"] for p in a["produtos"])
            a["comissaoPrevista"] = round(a["preco"] * b["comissao"] / 100 + prod * b["comissao_produtos"] / 100, 2)
    pagos = [{"id": r["id"], "valor": r["valor"], "data": r["data"], "forma": r["forma"], "obs": r["obs"]}
             for r in c.db.execute("SELECT * FROM pagamentos_barbeiros WHERE barbeiro_id = ? ORDER BY data DESC", (b["id"],))]
    return {
        "barbeiro": {"id": b["id"], "nome": b["nome"], "telefone": b["telefone"], "especialidade": b["especialidade"],
                     "folga": json.loads(b["folga"]), "comissao": b["comissao"], "comissaoProdutos": b["comissao_produtos"],
                     "chavePix": b["chave_pix"], "foto": url_foto(b), "entrouEm": b["entrou_em"], "email": b["email"]},
        "agendamentos": ags,
        "pagamentos": pagos,
        "saldo": saldo_barbeiro(c.db, b["id"]),
        "funcionamento": ler_funcionamento(c.db),
    }


@rota("POST", "/api/barbeiro/senha", "barbeiro")
def r_senha_barbeiro(c):
    trocar_senha(c, "barbeiro", "barbeiros", c.usuario_id)


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
    trocar_senha(c, "dono", "donos", c.usuario_id)

# =====================================================================
#  Minha conta (configurações de cada interface)
# =====================================================================
def email_valido(c, campo="email"):
    v = texto(c.corpo, campo, False, 120, "e-mail").lower()
    if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
        raise Erro("Digite um e-mail válido (ex.: nome@gmail.com).")
    return v


def trocar_senha(c, tipo, tabela, usuario_id):
    r = c.db.execute(f"SELECT senha_hash FROM {tabela} WHERE id = ?", (usuario_id,)).fetchone()
    atual, nova = c.corpo.get("atual"), c.corpo.get("nova")
    if not isinstance(atual, str) or not r["senha_hash"] or not conferir_senha(atual, r["senha_hash"]):
        raise Erro("A senha atual está errada.")
    if not isinstance(nova, str) or len(nova) < SENHA_MINIMA[tipo]:
        raise Erro(f"A nova senha precisa ter pelo menos {SENHA_MINIMA[tipo]} caracteres.")
    c.db.execute(f"UPDATE {tabela} SET senha_hash = ? WHERE id = ?", (gerar_hash(nova), usuario_id))
    # os outros aparelhos conectados saem da conta
    c.db.execute("DELETE FROM sessoes WHERE tipo = ? AND usuario_id = ? AND token != ?", (tipo, str(usuario_id), c.token))


@rota("PUT", "/api/clientes/eu", "cliente")
def r_cliente_conta(c):
    nome = texto(c.corpo, "nome", maximo=80)
    c.db.execute("UPDATE clientes SET nome = ?, email = ? WHERE id = ?", (nome, email_valido(c), c.usuario_id))
    # o nome novo aparece nos horários que ainda vão acontecer
    c.db.execute("UPDATE agendamentos SET cliente_nome = ? WHERE cliente_id = ? AND status = 'confirmado'", (nome, c.usuario_id))
    return {"cliente": cliente_json(c.db.execute("SELECT * FROM clientes WHERE id = ?", (c.usuario_id,)).fetchone())}


@rota("POST", "/api/clientes/senha", "cliente")
def r_cliente_senha(c):
    trocar_senha(c, "cliente", "clientes", c.usuario_id)


@rota("PUT", "/api/barbeiro/eu", "barbeiro")
def r_barbeiro_conta(c):
    c.db.execute("UPDATE barbeiros SET email = ? WHERE id = ?", (email_valido(c), c.usuario_id))


@rota("PUT", "/api/dono/eu", "dono")
def r_dono_conta(c):
    tel = digitos(c.corpo.get("telefone"))
    if tel and len(tel) not in (10, 11):
        raise Erro("Digite o WhatsApp com DDD.")
    c.db.execute("UPDATE donos SET nome = ?, email = ?, telefone = ? WHERE id = ?",
                 (texto(c.corpo, "nome", maximo=60), email_valido(c), tel, c.usuario_id))


# =====================================================================
#  Esqueci minha senha (código por e-mail ou WhatsApp)
# =====================================================================
MSG_CHAVES = ["smtp_host", "smtp_porta", "smtp_usuario", "smtp_senha", "smtp_remetente", "wa_token", "wa_numero_id", "wa_modelo"]


def config_mensagens(db):
    cfg = {k: cfg_valor(db, "msg_" + k, "") for k in MSG_CHAVES + ["ultimo_erro"]}
    email = None
    if cfg["smtp_host"] and cfg["smtp_usuario"] and cfg["smtp_senha"]:
        email = {"host": cfg["smtp_host"], "porta": cfg["smtp_porta"] or "465", "usuario": cfg["smtp_usuario"],
                 "senha": cfg["smtp_senha"], "remetente": cfg["smtp_remetente"]}
    whatsapp = {"token": cfg["wa_token"], "numero_id": cfg["wa_numero_id"], "modelo": cfg["wa_modelo"]} \
        if cfg["wa_token"] and cfg["wa_numero_id"] else None
    return email, whatsapp, cfg


def config_mensagens_publica(db):
    """O que o painel do dono pode ver (as senhas e o token nunca voltam para a tela)."""
    email, whatsapp, cfg = config_mensagens(db)
    return {"emailAtivo": bool(email), "whatsappAtivo": bool(whatsapp),
            "smtpHost": cfg["smtp_host"], "smtpPorta": cfg["smtp_porta"] or "465", "smtpUsuario": cfg["smtp_usuario"],
            "smtpRemetente": cfg["smtp_remetente"], "smtpSenhaGuardada": bool(cfg["smtp_senha"]),
            "waNumeroId": cfg["wa_numero_id"], "waModelo": cfg["wa_modelo"], "waTokenFinal": cfg["wa_token"][-6:],
            "ultimoErro": cfg["ultimo_erro"]}


CONTAS = {  # tipo -> (tabela, coluna usada no login)
    "cliente": ("clientes", "telefone"),
    "barbeiro": ("barbeiros", "telefone"),
    "dono": ("donos", "usuario"),
}


def achar_conta(db, tipo, login):
    tabela, coluna = CONTAS[tipo]
    valor = login.strip().lower() if coluna == "usuario" else digitos(login)
    if not valor:
        return None
    extra = " AND ativo = 1" if tipo == "barbeiro" else ""
    return db.execute(f"SELECT * FROM {tabela} WHERE {coluna} = ?{extra}", (valor,)).fetchone()


def registrar_erro_envio(texto_erro):
    try:
        with conectar() as db:
            db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('msg_ultimo_erro', ?)",
                       (f"{agora():%d/%m %H:%M} · {texto_erro}" if texto_erro else "",))
    except Exception:
        traceback.print_exc()


def enviar_em_segundo_plano(funcao, *args):
    """Manda a mensagem sem travar o site; se falhar, o erro aparece no painel do dono."""
    def tarefa():
        try:
            funcao(*args)
            registrar_erro_envio("")
        except msg.FalhaEnvio as e:
            print(f"[envio] {e}")
            registrar_erro_envio(str(e))
        except Exception as e:
            traceback.print_exc()
            registrar_erro_envio(f"Erro inesperado: {e}")
    threading.Thread(target=tarefa, daemon=True).start()


@rota("POST", "/api/recuperar/pedir")
def r_recuperar_pedir(c):
    tipo = c.corpo.get("tipo")
    canal = c.corpo.get("canal")
    if tipo not in CONTAS or canal not in ("email", "whatsapp"):
        raise Erro("Pedido inválido.")
    login = texto(c.corpo, "login", maximo=80, nome="WhatsApp" if tipo != "dono" else "usuário")
    email_cfg, wa_cfg, _ = config_mensagens(c.db)
    modo_teste = not (email_cfg if canal == "email" else wa_cfg)
    resposta = {"mensagem": ("Se houver uma conta com esses dados, o código chega em alguns minutos "
                             f"{'no seu e-mail' if canal == 'email' else 'no seu WhatsApp'}. Ele vale por {CODIGO_VALIDADE_MIN} minutos."),
                "modoTeste": modo_teste}
    conta = achar_conta(c.db, tipo, login)
    destino = None
    if conta:
        destino = conta["email"] if canal == "email" else conta["telefone"]
    if not conta or not destino:
        return resposta     # mesma resposta: não revela quem tem conta
    uid = str(conta["id"])
    uma_hora = (agora() - timedelta(hours=1)).isoformat()
    if c.db.execute("SELECT COUNT(*) FROM codigos_recuperacao WHERE tipo = ? AND usuario_id = ? AND criado_em > ?",
                    (tipo, uid, uma_hora)).fetchone()[0] >= CODIGOS_POR_HORA:
        raise Erro("Você já pediu vários códigos. Espere uma hora e tente de novo.", 429)

    codigo = f"{secrets.randbelow(1_000_000):06d}"
    c.db.execute("UPDATE codigos_recuperacao SET usado = 1 WHERE tipo = ? AND usuario_id = ?", (tipo, uid))
    c.db.execute("""INSERT INTO codigos_recuperacao (tipo, usuario_id, codigo_hash, canal, criado_em, expira_em)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                 (tipo, uid, gerar_hash(codigo), canal, agora().isoformat(),
                  (agora() + timedelta(minutes=CODIGO_VALIDADE_MIN)).isoformat()))
    nome_loja = textos_site(c.db)["nome"]
    texto_msg = (f"{nome_loja}: seu código para criar uma nova senha é {codigo}. "
                 f"Ele vale por {CODIGO_VALIDADE_MIN} minutos. Se não foi você que pediu, ignore esta mensagem.")
    if modo_teste:
        print(f"\n  [MODO TESTE] {'E-mail' if canal == 'email' else 'WhatsApp'} não configurado. "
              f"Código de recuperação de {conta['nome']} ({tipo}): {codigo}\n")
    elif canal == "email":
        enviar_em_segundo_plano(msg.enviar_email, email_cfg, destino, f"{nome_loja} — código para nova senha",
                                f"Olá, {conta['nome'].split(' ')[0]}!\n\n{texto_msg}\n")
    else:
        enviar_em_segundo_plano(msg.enviar_whatsapp, wa_cfg, destino, codigo, texto_msg)
    return resposta


@rota("POST", "/api/recuperar/confirmar")
def r_recuperar_confirmar(c):
    tipo = c.corpo.get("tipo")
    if tipo not in CONTAS:
        raise Erro("Pedido inválido.")
    login = texto(c.corpo, "login", maximo=80, nome="login")
    codigo = digitos(c.corpo.get("codigo"))
    nova = c.corpo.get("nova")
    if not isinstance(nova, str) or len(nova) < SENHA_MINIMA[tipo]:
        raise Erro(f"A nova senha precisa ter pelo menos {SENHA_MINIMA[tipo]} caracteres.")
    conta = achar_conta(c.db, tipo, login)
    pedido = conta and c.db.execute(
        """SELECT * FROM codigos_recuperacao WHERE tipo = ? AND usuario_id = ? AND usado = 0 AND expira_em > ?
           ORDER BY id DESC LIMIT 1""", (tipo, str(conta["id"]), agora().isoformat())).fetchone()
    if not pedido:
        raise Erro("Código inválido ou vencido. Peça um novo código.")
    if pedido["tentativas"] >= CODIGO_TENTATIVAS:
        raise Erro("Muitas tentativas erradas. Peça um novo código.", 429)
    if len(codigo) != 6 or not conferir_senha(codigo, pedido["codigo_hash"]):
        # grava a tentativa numa conexão à parte: o erro abaixo desfaz tudo o que foi feito nesta
        with conectar() as db2:
            db2.execute("UPDATE codigos_recuperacao SET tentativas = tentativas + 1 WHERE id = ?", (pedido["id"],))
        restam = CODIGO_TENTATIVAS - pedido["tentativas"] - 1
        raise Erro(f"Código errado. {'Você ainda tem ' + str(restam) + ' tentativa(s).' if restam else 'Peça um novo código.'}")
    tabela = CONTAS[tipo][0]
    c.db.execute(f"UPDATE {tabela} SET senha_hash = ? WHERE id = ?", (gerar_hash(nova), conta["id"]))
    c.db.execute("UPDATE codigos_recuperacao SET usado = 1 WHERE tipo = ? AND usuario_id = ?", (tipo, str(conta["id"])))
    c.db.execute("DELETE FROM sessoes WHERE tipo = ? AND usuario_id = ?", (tipo, str(conta["id"])))
    return {"mensagem": "Senha nova criada! Entre com ela."}


@rota("PUT", "/api/dono/mensagens", "dono")
def r_salvar_mensagens(c):
    """Configura o envio dos códigos. Campos de senha/token vazios = manter o que já estava."""
    b = c.corpo
    if b.get("remover") in ("email", "whatsapp"):
        prefixo = "msg_smtp_%" if b["remover"] == "email" else "msg_wa_%"
        c.db.execute("DELETE FROM configuracoes WHERE chave LIKE ?", (prefixo,))
        return {"mensagem": "Envio desligado."}
    # só muda o que veio no pedido
    leitores = {
        "smtpHost": ("smtp_host", lambda: texto(b, "smtpHost", False, 120, "servidor de e-mail")),
        "smtpPorta": ("smtp_porta", lambda: str(numero(b.get("smtpPorta") or 465, "porta", 1, 65535, inteiro=True))),
        "smtpUsuario": ("smtp_usuario", lambda: texto(b, "smtpUsuario", False, 120, "usuário do e-mail")),
        "smtpRemetente": ("smtp_remetente", lambda: texto(b, "smtpRemetente", False, 120, "remetente")),
        "waNumeroId": ("wa_numero_id", lambda: digitos(b.get("waNumeroId"))),
        "waModelo": ("wa_modelo", lambda: texto(b, "waModelo", False, 60, "modelo do WhatsApp")),
    }
    valores = {chave: ler() for campo, (chave, ler) in leitores.items() if campo in b}
    if b.get("smtpSenha"):
        valores["smtp_senha"] = texto(b, "smtpSenha", True, 200, "senha do e-mail")
    if b.get("waToken"):
        valores["wa_token"] = texto(b, "waToken", True, 1000, "token do WhatsApp")
    for k, v in valores.items():
        c.db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)", ("msg_" + k, v))


@rota("POST", "/api/dono/mensagens/teste", "dono")
def r_testar_mensagens(c):
    """Manda uma mensagem de teste agora e diz se deu certo."""
    canal = c.corpo.get("canal")
    email_cfg, wa_cfg, _ = config_mensagens(c.db)
    nome_loja = textos_site(c.db)["nome"]
    texto_msg = f"{nome_loja}: teste de envio. Se você recebeu, a recuperação de senha está funcionando. Código de exemplo: 123456"
    try:
        if canal == "email":
            if not email_cfg:
                raise Erro("Preencha e salve os dados do e-mail primeiro.")
            para = email_valido(c, "destino")
            if not para:
                raise Erro("Digite o e-mail que vai receber o teste.")
            msg.enviar_email(email_cfg, para, f"{nome_loja} — teste de envio", texto_msg)
        elif canal == "whatsapp":
            if not wa_cfg:
                raise Erro("Preencha e salve os dados do WhatsApp primeiro.")
            tel = digitos(c.corpo.get("destino"))
            if len(tel) not in (10, 11):
                raise Erro("Digite o WhatsApp que vai receber o teste, com DDD.")
            msg.enviar_whatsapp(wa_cfg, tel, "123456", texto_msg)
        else:
            raise Erro("Canal inválido.")
    except msg.FalhaEnvio as e:
        raise Erro(str(e), 502)
    return {"mensagem": "Mensagem de teste enviada! Confira se chegou."}



@rota("GET", "/api/dono/backup", "dono")
def r_backup(c):
    copia = sqlite3.connect(":memory:")
    c.db.backup(copia)
    dados = copia.serialize()
    copia.close()
    return Arquivo(dados, "application/vnd.sqlite3", f"backup-barbearia-{hoje().isoformat()}.db")


# =====================================================================
#  Montagem das páginas (header, footer e seções em arquivos separados)
# =====================================================================
# Numa página, a linha
#     <incluir src="componentes/header/header.html" subtitulo="Painel do dono">...links...</incluir>
# é trocada pelo conteúdo do arquivo. Dentro do arquivo incluído:
#     {{conteudo}}   = o que estava entre <incluir> e </incluir>
#     {{subtitulo}}  = qualquer atributo da linha <incluir> (vazio se não tiver)
# Em qualquer página:  {{site.nome}}, {{site.hero_titulo}}... = textos do banco  ·  {{ano}} = ano atual
INCLUIR = re.compile(r"<!--.*?-->|<incluir\s+([^>]*?)\s*(?:/>|>(.*?)</incluir>)", re.S)   # comentários ficam como estão
COMENTARIO = re.compile(r"<!--.*?-->", re.S)
ATRIBUTO = re.compile(r'([\w-]+)\s*=\s*"([^"]*)"')
MARCADOR = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")


def ler_arquivo_site(relativo):
    caminho = os.path.normpath(os.path.join(PASTA_SITE, relativo.lstrip("/")))
    if not caminho.startswith(PASTA_SITE + os.sep):       # não deixa sair da pasta src
        raise FileNotFoundError(relativo)
    with open(caminho, encoding="utf-8") as arq:
        return arq.read()


def juntar_inclusoes(html, profundidade=0):
    if profundidade > 5:
        raise Erro("Um <incluir> está incluindo a si mesmo.")

    def trocar(m):
        if m.group(0).startswith("<!--"):
            return m.group(0)
        attrs = dict(ATRIBUTO.findall(m.group(1)))
        if "src" not in attrs:
            raise Erro("<incluir> sem o atributo src.")
        try:
            parte = ler_arquivo_site(attrs["src"])
        except FileNotFoundError:
            raise Erro(f"Arquivo do <incluir> não encontrado: src/{attrs['src']}")
        parte = COMENTARIO.sub("", parte).strip()       # os comentários de ajuda do arquivo incluído não vão para a página
        valores = {**attrs, "conteudo": (m.group(2) or "").strip()}
        parte = MARCADOR.sub(lambda x: x.group(0) if x.group(1).startswith("site.") or x.group(1) == "ano"
                             else valores.get(x.group(1), ""), parte)
        return juntar_inclusoes(parte, profundidade + 1)

    return INCLUIR.sub(trocar, html)


def montar_html(arquivo, textos):
    html = juntar_inclusoes(ler_arquivo_site(arquivo))

    def trocar(m):
        nome = m.group(1)
        if nome == "ano":
            return str(hoje().year)
        if nome.startswith("site.") and nome[5:] in textos:
            return html_escape(textos[nome[5:]])
        return ""
    return MARCADOR.sub(trocar, html)


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
        caminho = urlparse(self.path).path.rstrip("/") or "/"
        arquivo = PAGINAS.get(caminho) or (caminho.lstrip("/") if caminho.endswith(".html") else None)
        if arquivo:
            return self.pagina(arquivo)
        return super().do_GET()

    def list_directory(self, path):          # não mostra a lista de arquivos das pastas
        self.send_error(404, "Página não encontrada")

    def pagina(self, arquivo):
        """Monta uma página HTML: junta os <incluir> (header, footer, seções) e coloca os textos do banco."""
        try:
            with conectar() as db:
                textos = textos_site(db)
            html = montar_html(arquivo, textos)
        except FileNotFoundError:
            return self.send_error(404, "Página não encontrada")
        except Erro as e:
            return self.send_error(500, str(e))
        corpo = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

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
        if isinstance(dados, Arquivo) and dados.nome:
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
SENHA_BARBEIROS_TESTE = "1234"   # login dos barbeiros de teste: WhatsApp de cada um + esta senha

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
        db.execute("""INSERT INTO barbeiros (id, nome, telefone, senha_hash, chave_pix, especialidade, folga, comissao, comissao_produtos, entrou_em)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 50, 10, ?)""",
                   (bid, nome, tel, gerar_hash(SENHA_BARBEIROS_TESTE), "+55" + tel, esp, json.dumps(folga), entrou))
    for p in PRODUTOS_PADRAO:
        db.execute("INSERT INTO produtos (id, nome, categoria, icone, preco, custo, estoque) VALUES (?, ?, ?, ?, ?, ?, ?)", p)
    for i, (aberto, abre, fecha) in enumerate(SEMANA_PADRAO):
        db.execute("INSERT INTO funcionamento (dia_semana, aberto, abre, fecha) VALUES (?, ?, ?, ?)", (i, int(aberto), abre, fecha))
    db.execute("INSERT INTO configuracoes (chave, valor) VALUES ('intervalo', '30'), ('dias_para_agendar', '14')")
    # chave Pix de EXEMPLO — o dono troca pela chave real no painel (Funcionamento → Pagamentos)
    db.execute("""INSERT INTO configuracoes (chave, valor) VALUES ('pix_chave', ?),
                  ('pix_recebedor', 'Barbearia Real'), ('pix_cidade', 'Sao Paulo')""", (CHAVE_PIX_EXEMPLO,))
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
            pid = novo_id("pg")
            db.execute("INSERT INTO pagamentos_barbeiros (id, barbeiro_id, valor, data, forma, obs) VALUES (?, ?, ?, ?, 'Pix', 'Comissões (exemplo)')",
                       (pid, b[0], round(valor, 2), corte))
            db.execute("UPDATE agendamentos SET pagamento_barbeiro_id = ? WHERE barbeiro_id = ? AND status = 'atendido' AND dia <= ?",
                       (pid, b[0], corte))

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
        migrar(db)
        if db.execute("SELECT COUNT(*) FROM donos").fetchone()[0] == 0:
            popular(db)
            print("Banco criado com os dados de teste.")
        garantir_padroes(db)


def garantir_padroes(db):
    """Coloca no banco os textos e listas que ainda não estão lá (não muda o que o dono já salvou)."""
    for chave, _, padrao, _ in SITE_TEXTOS:
        db.execute("INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)", ("site_" + chave, padrao))
    db.execute("INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('max_parcelas', '3')")
    db.execute("INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES ('categorias_despesa', ?)",
               (json.dumps(CATEGORIAS_DESPESA_PADRAO, ensure_ascii=False),))
    # as listas só são criadas uma vez: se o dono apagar todas, continuam apagadas
    if cfg_valor(db, "site_itens_criados", "") != "1":
        if not db.execute("SELECT 1 FROM site_itens LIMIT 1").fetchone():
            for ordem, (secao, icone, titulo, txt) in enumerate(SITE_ITENS_PADRAO):
                db.execute("INSERT INTO site_itens (secao, ordem, icone, titulo, texto) VALUES (?, ?, ?, ?, ?)",
                           (secao, ordem, icone, titulo, txt))
        db.execute("INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES ('site_itens_criados', '1')")


def migrar(db):
    """Atualiza um banco criado por uma versão antiga do sistema, sem perder nenhum dado."""
    def colunas(tabela):
        return {r[1] for r in db.execute(f"PRAGMA table_info({tabela})")}

    def adicionar(tabela, coluna, definicao):
        if coluna not in colunas(tabela):
            db.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {definicao}")
            return True
        return False

    adicionar("clientes", "email", "TEXT NOT NULL DEFAULT ''")
    adicionar("clientes", "cpf", "TEXT NOT NULL DEFAULT ''")
    adicionar("barbeiros", "senha_hash", "TEXT")
    adicionar("barbeiros", "chave_pix", "TEXT NOT NULL DEFAULT ''")
    adicionar("barbeiros", "foto", "BLOB")
    adicionar("barbeiros", "foto_tipo", "TEXT")
    adicionar("barbeiros", "foto_versao", "TEXT")
    adicionar("barbeiros", "email", "TEXT NOT NULL DEFAULT ''")
    adicionar("donos", "email", "TEXT NOT NULL DEFAULT ''")
    adicionar("donos", "telefone", "TEXT NOT NULL DEFAULT ''")
    if adicionar("pagamentos_clientes", "provedor", "TEXT NOT NULL DEFAULT 'teste'"):
        db.execute("UPDATE pagamentos_clientes SET provedor = 'pix_manual' WHERE metodo = 'pix'")
    adicionar("pagamentos_clientes", "provedor_id", "TEXT")
    adicionar("pagamentos_clientes", "reembolsado_em", "TEXT")
    repasses_novos = adicionar("agendamentos", "pagamento_barbeiro_id", "TEXT REFERENCES pagamentos_barbeiros(id)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_agendamentos_repasse ON agendamentos (pagamento_barbeiro_id)")

    # a tabela de logins antiga não aceitava o tipo "barbeiro": recria (todos precisam entrar de novo uma vez)
    sql = db.execute("SELECT sql FROM sqlite_master WHERE name = 'sessoes'").fetchone()[0]
    if "'barbeiro'" not in sql:
        db.execute("DROP TABLE sessoes")
        db.execute("""CREATE TABLE sessoes (token TEXT PRIMARY KEY,
                      tipo TEXT NOT NULL CHECK (tipo IN ('cliente', 'dono', 'barbeiro')),
                      usuario_id TEXT NOT NULL, expira_em TEXT NOT NULL)""")

    # pagamentos antigos aos barbeiros eram só um valor solto: liga cada um aos atendimentos que ele cobriu
    if repasses_novos:
        for b in db.execute("SELECT DISTINCT barbeiro_id FROM pagamentos_barbeiros").fetchall():
            atendimentos = db.execute("""SELECT id, comissao_valor FROM agendamentos WHERE barbeiro_id = ? AND status = 'atendido'
                                         ORDER BY dia, hora""", (b[0],)).fetchall()
            i = 0
            for p in db.execute("SELECT id, valor FROM pagamentos_barbeiros WHERE barbeiro_id = ? ORDER BY data, rowid", (b[0],)).fetchall():
                usado = 0.0
                while i < len(atendimentos) and usado + (atendimentos[i][1] or 0) <= p[1] + 0.01:
                    usado += atendimentos[i][1] or 0
                    db.execute("UPDATE agendamentos SET pagamento_barbeiro_id = ? WHERE id = ?", (p[0], atendimentos[i][0]))
                    i += 1
        print("Banco atualizado: pagamentos dos barbeiros ligados aos atendimentos.")


def ip_da_rede():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def redefinir_senha_dono():
    """python servidor/servidor.py --senha-dono NOVA_SENHA  (para quando o dono esquece e não tem e-mail/WhatsApp cadastrado)"""
    i = sys.argv.index("--senha-dono")
    nova = sys.argv[i + 1] if len(sys.argv) > i + 1 else ""
    if len(nova) < SENHA_MINIMA["dono"]:
        print(f"Use: python servidor/servidor.py --senha-dono NOVA_SENHA  (pelo menos {SENHA_MINIMA['dono']} caracteres)")
        return
    with conectar() as db:
        r = db.execute("SELECT id, usuario FROM donos ORDER BY id LIMIT 1").fetchone()
        db.execute("UPDATE donos SET senha_hash = ? WHERE id = ?", (gerar_hash(nova), r["id"]))
        db.execute("DELETE FROM sessoes WHERE tipo = 'dono'")
    print(f"Senha do dono trocada. Entre com o usuário \"{r['usuario']}\" e a senha nova.")


def main():
    iniciar_banco(resetar="--resetar" in sys.argv)
    if "--senha-dono" in sys.argv:
        return redefinir_senha_dono()
    na_rede = "--rede" in sys.argv
    servidor = ThreadingHTTPServer(("0.0.0.0" if na_rede else "127.0.0.1", PORTA), Handler)
    print()
    print("  ✂  Servidor da barbearia ligado!")
    print(f"     Site:               http://localhost:{PORTA}")
    print(f"     Painel do dono:     http://localhost:{PORTA}/dono")
    print(f"     Painel do barbeiro: http://localhost:{PORTA}/barbeiro")
    if na_rede and ip_da_rede():
        print(f"     No celular (mesmo Wi-Fi): http://{ip_da_rede()}:{PORTA}")
    print()
    print(f"  Conta de teste do dono:    usuário {CONTA_DONO['usuario']}  /  senha {CONTA_DONO['senha']}")
    print(f"  Conta de teste do cliente: WhatsApp {CONTA_CLIENTE['telefone']}  /  senha {CONTA_CLIENTE['senha']}")
    print(f"  Barbeiro de teste (João):  WhatsApp {BARBEIROS_PADRAO[0][2]}  /  senha {SENHA_BARBEIROS_TESTE}")
    print("\n  Para desligar: Ctrl + C\n")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor desligado.")


if __name__ == "__main__":
    main()
