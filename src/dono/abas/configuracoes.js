// =====================================================================
//  ABA CONFIGURAÇÕES — minha conta (dados e senha), envio dos códigos de
//  "esqueci minha senha" (e-mail e WhatsApp) e cópia de segurança.
//  (usa as funções do núcleo: src/dono/dono.js e o módulo src/configuracoes)
// =====================================================================

function renderConfigDono() {
  const m = MENSAGENS;
  $("conteudo").innerHTML = `
    <div class="cab"><h1>Configurações</h1></div>
    <div id="configDono"></div>

    <div class="bloco" style="margin-top:16px">
      <h2>📩 Envio do código de "esqueci minha senha"</h2>
      <p class="sub" style="margin-bottom:12px">Quando alguém (cliente, barbeiro ou você) esquece a senha, o site manda um código de 6 números
        por e-mail ou WhatsApp. Enquanto um canal não estiver configurado, ele funciona em <strong>modo de teste</strong>:
        o código aparece só na janela preta do servidor.</p>
      ${m.ultimoErro ? `<div class="alerta vermelho"><span>⚠ Último erro de envio: ${esc(m.ultimoErro)}</span></div>` : ""}

      <div class="colunas" style="grid-template-columns:1fr 1fr">
        <div>
          <h3 style="margin-bottom:8px">✉️ E-mail ${m.emailAtivo ? `<span class="pg pago">✓ ligado</span>` : `<span class="pg na_barbearia">modo de teste</span>`}</h3>
          <div class="form">
            <div class="dupla-cfg">
              <label>Servidor (SMTP)<input id="smtpHost" value="${esc(m.smtpHost)}" placeholder="smtp.gmail.com"></label>
              <label>Porta<input id="smtpPorta" type="number" value="${esc(m.smtpPorta)}" placeholder="465"></label>
            </div>
            <label>E-mail (usuário)<input id="smtpUsuario" type="email" value="${esc(m.smtpUsuario)}" placeholder="barbearia@gmail.com"></label>
            <label>Senha${m.smtpSenhaGuardada ? " (guardada — deixe vazio para manter)" : ""}<input id="smtpSenha" type="password" autocomplete="off" placeholder="No Gmail: senha de app"></label>
            <label>Nome do remetente (opcional)<input id="smtpRemetente" value="${esc(m.smtpRemetente)}" placeholder="Barbearia Real &lt;barbearia@gmail.com&gt;"></label>
            <p class="sub">Gmail: ative a verificação em 2 etapas e crie uma <strong>senha de app</strong> em myaccount.google.com → Segurança.</p>
            <div class="botoes">
              <button class="btn-peq ouro" data-acao="salvarMsg">Salvar</button>
              <button class="btn-peq" data-acao="testarMsg" data-id="email" ${m.emailAtivo ? "" : "disabled"}>Enviar teste</button>
              ${m.emailAtivo ? `<button class="btn-peq vermelho" data-acao="desligarMsg" data-id="email">Desligar</button>` : ""}
            </div>
          </div>
        </div>
        <div>
          <h3 style="margin-bottom:8px">💬 WhatsApp ${m.whatsappAtivo ? `<span class="pg pago">✓ ligado</span>` : `<span class="pg na_barbearia">modo de teste</span>`}</h3>
          <div class="form">
            <label>Token de acesso${m.waTokenFinal ? ` (guardado …${esc(m.waTokenFinal)} — deixe vazio para manter)` : ""}<input id="waToken" type="password" autocomplete="off" placeholder="EAAG..."></label>
            <label>ID do número de telefone<input id="waNumeroId" inputmode="numeric" value="${esc(m.waNumeroId)}" placeholder="1234567890"></label>
            <label>Nome do modelo de autenticação<input id="waModelo" value="${esc(m.waModelo)}" placeholder="codigo_senha"></label>
            <p class="sub">Use a <strong>API oficial do WhatsApp</strong> (developers.facebook.com → WhatsApp). Para mandar códigos a qualquer
              pessoa, a Meta exige um modelo da categoria <strong>Autenticação</strong> aprovado. Sem modelo, só chega para números de teste.</p>
            <div class="botoes">
              <button class="btn-peq ouro" data-acao="salvarMsg">Salvar</button>
              <button class="btn-peq" data-acao="testarMsg" data-id="whatsapp" ${m.whatsappAtivo ? "" : "disabled"}>Enviar teste</button>
              ${m.whatsappAtivo ? `<button class="btn-peq vermelho" data-acao="desligarMsg" data-id="whatsapp">Desligar</button>` : ""}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="bloco">
      <h2>💾 Cópia de segurança</h2>
      <p class="sub" style="margin-bottom:12px">Os dados ficam no arquivo <strong>servidor/barbearia.db</strong>. Baixe uma cópia de vez em quando para não perder nada.</p>
      <div class="botoes"><button class="btn-peq ouro" data-acao="backup">⬇ Baixar backup</button></div>
      <p class="sub" style="margin-top:10px">Para restaurar: desligue o servidor, renomeie o backup para <strong>barbearia.db</strong> e coloque na pasta <strong>servidor</strong>.</p>
    </div>`;

  desenharConfiguracoes($("configDono"), {
    login: DONO.usuario, loginRotulo: "usuário", loginBruto: DONO.usuario,
    dados: { nome: DONO.nome, email: DONO.email, telefone: fmtTel(DONO.telefone) === "—" ? "" : fmtTel(DONO.telefone) },
    campos: ["nome", "email", "telefone"], minimo: 6,
    salvarDados: async (d) => { await enviar("PUT", "/api/dono/eu", { ...d, telefone: soDigitos(d.telefone) }, "Seus dados foram salvos."); },
    trocarSenha: async (atual, nova) => (await enviar("POST", "/api/dono/senha", { atual, nova }, "Senha trocada.")) || false,
  });
}

ACOES.salvarMsg = () => enviar("PUT", "/api/dono/mensagens", {
  smtpHost: $("smtpHost").value.trim(), smtpPorta: Number($("smtpPorta").value) || 465, smtpUsuario: $("smtpUsuario").value.trim(),
  smtpSenha: $("smtpSenha").value, smtpRemetente: $("smtpRemetente").value.trim(),
  waToken: $("waToken").value.trim(), waNumeroId: $("waNumeroId").value.trim(), waModelo: $("waModelo").value.trim(),
}, "Configuração de envio salva.");

ACOES.desligarMsg = (canal) => {
  if (!confirm(`Desligar o envio por ${canal === "email" ? "e-mail" : "WhatsApp"}? Os dados guardados serão apagados.`)) return;
  enviar("PUT", "/api/dono/mensagens", { remover: canal });
};

ACOES.testarMsg = async (canal, botao) => {
  const destino = prompt(canal === "email" ? "Mandar o teste para qual e-mail?" : "Mandar o teste para qual WhatsApp (com DDD)?",
    canal === "email" ? DONO.email : DONO.telefone);
  if (!destino) return;
  botao.disabled = true; botao.textContent = "Enviando...";
  await enviar("POST", "/api/dono/mensagens/teste", { canal, destino });
};

ACOES.backup = async () => {
  try {
    const resp = await fetch("/api/dono/backup", { headers: { Authorization: "Bearer " + tokenDono } });
    if (!resp.ok) throw Object.assign(new Error((await resp.json().catch(() => ({}))).erro || "Não foi possível gerar o backup."), { status: resp.status });
    const url = URL.createObjectURL(await resp.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `backup-barbearia-${hojeIso()}.db`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { falhou(e); }
};
