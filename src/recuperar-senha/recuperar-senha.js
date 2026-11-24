// =====================================================================
//  ESQUECI MINHA SENHA — pede um código (e-mail ou WhatsApp) e cria a senha nova
// =====================================================================
(() => {
  const caixa = document.getElementById("recuperarSenha");
  if (!caixa) return;
  const tipo = caixa.dataset.tipo;
  let login = "";

  function abrir(loginInicial) {
    $("recPasso1").reset(); $("recPasso2").reset();
    $("recErro1").textContent = ""; $("recErro2").textContent = "";
    $("recPasso1").hidden = false; $("recPasso2").hidden = true;
    $("recLogin").value = loginInicial || $(caixa.dataset.campo)?.value || "";
    caixa.hidden = false;
    ($("recLogin").value ? $("recPasso1").querySelector("button[type=submit]") : $("recLogin")).focus();
  }
  const fechar = () => { caixa.hidden = true; };

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-esqueci]");
    if (b) { e.preventDefault(); abrir(b.dataset.login); }
    if (e.target.closest("[data-rec-fechar]") || e.target === caixa) fechar();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !caixa.hidden) fechar(); });

  async function enviar(form, erro, fn) {
    const botao = form.querySelector("button[type=submit]");
    botao.disabled = true; $(erro).textContent = "";
    try { await fn(); } catch (er) { $(erro).textContent = er.message; } finally { botao.disabled = false; }
  }

  $("recPasso1").addEventListener("submit", (e) => {
    e.preventDefault();
    enviar($("recPasso1"), "recErro1", async () => {
      login = $("recLogin").value.trim();
      const canal = $("recPasso1").querySelector("[name=recCanal]:checked").value;
      const r = await api("POST", "/api/recuperar/pedir", { tipo, login, canal });
      $("recEnviado").textContent = r.mensagem;
      $("recModoTeste").hidden = !r.modoTeste;
      $("recPasso1").hidden = true; $("recPasso2").hidden = false;
      $("recCodigo").focus();
    });
  });

  $("recCodigo").addEventListener("input", (e) => (e.target.value = soDigitos(e.target.value).slice(0, 6)));

  $("recPasso2").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("recNova").value !== $("recNova2").value) { $("recErro2").textContent = "As senhas não são iguais."; return; }
    enviar($("recPasso2"), "recErro2", async () => {
      const r = await api("POST", "/api/recuperar/confirmar", { tipo, login, codigo: $("recCodigo").value, nova: $("recNova").value });
      fechar();
      avisar(r.mensagem);
      // volta para o login com o campo preenchido (se estava logado, a sessão foi encerrada)
      const campo = $(caixa.dataset.campo);
      if (campo) campo.value = login;
      document.dispatchEvent(new CustomEvent("barbearia:senha-recuperada"));
    });
  });
  $("recVoltar").addEventListener("click", () => { $("recPasso2").hidden = true; $("recPasso1").hidden = false; });
})();
