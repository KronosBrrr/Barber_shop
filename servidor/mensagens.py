"""
Envio de mensagens (código de recuperação de senha) por e-mail e por WhatsApp.
Usa só o que já vem com o Python.

- E-mail: qualquer servidor SMTP. Exemplo com Gmail: servidor smtp.gmail.com, porta 465,
  usuário = seu Gmail e senha = "senha de app" (myaccount.google.com → Segurança → Senhas de app).
- WhatsApp: API oficial do WhatsApp (WhatsApp Business Cloud API, da Meta).
  Em developers.facebook.com → seu app → WhatsApp → Configuração da API pegue o "token de acesso"
  e o "ID do número de telefone". Para mandar códigos a qualquer cliente, a Meta exige um
  modelo (template) de "Autenticação" aprovado; coloque o nome dele no painel.
  Sem modelo, a mensagem vai como texto comum (só funciona para números de teste
  cadastrados no app da Meta ou para quem falou com a barbearia nas últimas 24 horas).

Se um canal não estiver configurado, o código é mostrado na janela do servidor (modo de teste).
"""

import json
import os
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage

WHATSAPP_URL = os.environ.get("WHATSAPP_URL", "https://graph.facebook.com/v21.0")  # outro endereço só em testes


class FalhaEnvio(Exception):
    pass


def enviar_email(cfg, para, assunto, texto):
    """cfg: host, porta, usuario, senha, remetente."""
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = cfg.get("remetente") or cfg["usuario"]
    msg["To"] = para
    msg.set_content(texto)
    porta = int(cfg.get("porta") or 465)
    try:
        if porta == 465:
            with smtplib.SMTP_SSL(cfg["host"], porta, context=ssl.create_default_context(), timeout=20) as s:
                s.login(cfg["usuario"], cfg["senha"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], porta, timeout=20) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(cfg["usuario"], cfg["senha"])
                s.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise FalhaEnvio("O servidor de e-mail recusou o usuário ou a senha (no Gmail, use uma senha de app).")
    except (smtplib.SMTPException, OSError) as e:
        raise FalhaEnvio(f"Não foi possível enviar o e-mail: {e}")


def enviar_whatsapp(cfg, telefone, codigo, texto):
    """cfg: token, numero_id, modelo (nome do template de autenticação; vazio = texto comum)."""
    para = "55" + telefone if len(telefone) in (10, 11) else telefone
    if cfg.get("modelo"):
        corpo = {"messaging_product": "whatsapp", "to": para, "type": "template",
                 "template": {"name": cfg["modelo"], "language": {"code": "pt_BR"},
                              "components": [
                                  {"type": "body", "parameters": [{"type": "text", "text": codigo}]},
                                  {"type": "button", "sub_type": "url", "index": "0",
                                   "parameters": [{"type": "text", "text": codigo}]}]}}
    else:
        corpo = {"messaging_product": "whatsapp", "to": para, "type": "text", "text": {"body": texto}}
    req = urllib.request.Request(f"{WHATSAPP_URL}/{cfg['numero_id']}/messages", data=json.dumps(corpo).encode(),
                                 method="POST", headers={"Authorization": "Bearer " + cfg["token"],
                                                         "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
    except urllib.error.HTTPError as e:
        try:
            detalhe = json.loads(e.read()).get("error", {}).get("message", "")
        except ValueError:
            detalhe = ""
        raise FalhaEnvio(f"O WhatsApp recusou a mensagem ({e.code}). {detalhe}".strip())
    except OSError as e:
        raise FalhaEnvio(f"Sem conexão com o WhatsApp: {e}")
