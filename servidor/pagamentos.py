"""
Pagamentos da barbearia: Pix (QR code) e cartão.

PIX
  Gera o código "Pix copia e cola" (BR Code) no padrão do Banco Central, com a chave
  Pix da barbearia e o valor certo. Esse código vira o QR code que o cliente lê no app
  do banco. O dinheiro cai direto na conta da chave cadastrada.
  Como é um Pix "estático", o sistema não fica sabendo sozinho que o dinheiro caiu:
  o dono confirma o recebimento no painel. (Para confirmar automático, é preciso
  contratar um intermediador: Mercado Pago, PagSeguro, Efí, etc.)

CARTÃO
  Por enquanto funciona em MODO DE TESTE: valida o cartão (número, validade, CVV),
  identifica a bandeira e aprova ou recusa como um banco faria, mas NÃO cobra de verdade.
  Para cobrar de verdade, troque a classe ProvedorTeste por um provedor real
  (ex.: Mercado Pago), que recebe os dados do cartão de forma segura.
  Os dados do cartão nunca são guardados: só a bandeira e os 4 últimos números.

Cartões de teste:
  4111 1111 1111 1111  -> aprovado
  5555 5555 5555 4444  -> aprovado (Mastercard)
  4000 0000 0000 0002  -> recusado (sem limite)
  4000 0000 0000 0069  -> recusado (cartão bloqueado)
"""

import re
import secrets
import unicodedata
from datetime import date


# =====================================================================
#  PIX — código copia e cola (BR Code / EMV)
# =====================================================================
def _campo(identificador, valor):
    return f"{identificador}{len(valor):02d}{valor}"


def _crc16(texto):
    crc = 0xFFFF
    for byte in texto.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return f"{crc:04X}"


def _limpar(texto, maximo):
    """Tira acentos e caracteres especiais (exigência do padrão Pix)."""
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9 .\-]", "", sem_acento).strip().upper()[:maximo] or "BARBEARIA"


def novo_txid():
    return "BARB" + secrets.token_hex(8).upper()  # até 25 letras/números


def codigo_pix(chave, recebedor, cidade, valor, txid, descricao=""):
    conta = _campo("00", "br.gov.bcb.pix") + _campo("01", chave.strip())
    if descricao:
        conta += _campo("02", _limpar(descricao, 40))
    payload = (
        _campo("00", "01")
        + _campo("26", conta)
        + _campo("52", "0000")
        + _campo("53", "986")                       # real brasileiro
        + _campo("54", f"{valor:.2f}")
        + _campo("58", "BR")
        + _campo("59", _limpar(recebedor, 25))
        + _campo("60", _limpar(cidade, 15))
        + _campo("62", _campo("05", re.sub(r"[^A-Za-z0-9]", "", txid)[:25] or "***"))
        + "6304"
    )
    return payload + _crc16(payload)


def validar_chave_pix(chave):
    chave = (chave or "").strip()
    digitos = re.sub(r"\D", "", chave)
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", chave) and len(chave) <= 77:
        return chave.lower()                                     # e-mail
    if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", chave):
        return chave.lower()                                     # chave aleatória
    if chave.startswith("+55") and len(digitos) in (12, 13):
        return "+" + digitos                                     # telefone
    if len(digitos) == 11 and not re.search(r"[A-Za-z@]", chave):
        return digitos                                           # CPF
    if len(digitos) == 14 and not re.search(r"[A-Za-z@]", chave):
        return digitos                                           # CNPJ
    return None


# =====================================================================
#  CARTÃO
# =====================================================================
class CartaoRecusado(Exception):
    pass


def luhn_ok(numero):
    soma, dobrar = 0, False
    for d in reversed(numero):
        n = int(d)
        if dobrar:
            n = n * 2 - 9 if n > 4 else n * 2
        soma += n
        dobrar = not dobrar
    return soma % 10 == 0


def bandeira(numero):
    if re.match(r"^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)", numero):
        return "Elo"
    if re.match(r"^(606282|3841)", numero):
        return "Hipercard"
    if re.match(r"^3[47]", numero):
        return "Amex"
    if re.match(r"^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))", numero):
        return "Mastercard"
    if numero.startswith("4"):
        return "Visa"
    return "Cartão"


def validar_cartao(dados):
    """Confere os dados digitados. Devolve (numero, bandeira) ou lança ValueError."""
    numero = re.sub(r"\D", "", str(dados.get("numero", "")))
    nome = str(dados.get("nome", "")).strip()
    validade = re.sub(r"\s", "", str(dados.get("validade", "")))
    cvv = re.sub(r"\D", "", str(dados.get("cvv", "")))
    if not 13 <= len(numero) <= 19 or not luhn_ok(numero):
        raise ValueError("Número do cartão inválido.")
    if len(nome) < 3:
        raise ValueError("Digite o nome como está no cartão.")
    m = re.fullmatch(r"(0[1-9]|1[0-2])/(\d{2}|\d{4})", validade)
    if not m:
        raise ValueError("Validade inválida. Use MM/AA.")
    mes, ano = int(m.group(1)), int(m.group(2))
    ano += 2000 if ano < 100 else 0
    hoje = date.today()
    if (ano, mes) < (hoje.year, hoje.month):
        raise ValueError("Esse cartão está vencido.")
    b = bandeira(numero)
    if len(cvv) != (4 if b == "Amex" else 3):
        raise ValueError("Código de segurança (CVV) inválido.")
    return numero, b


class ProvedorTeste:
    """Finge ser a operadora do cartão. Não cobra nada de verdade."""
    nome = "teste"

    def cobrar(self, numero, valor, tipo, parcelas):
        if numero.endswith("0002"):
            raise CartaoRecusado("Pagamento recusado pelo banco: limite insuficiente.")
        if numero.endswith("0069"):
            raise CartaoRecusado("Pagamento recusado: cartão bloqueado. Fale com seu banco.")
        return "TESTE-" + secrets.token_hex(6).upper()  # código da transação


PROVEDOR_CARTAO = ProvedorTeste()
