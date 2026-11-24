// =====================================================================
//  CONFIGURAÇÕES — desenha "Meus dados" e "Trocar senha" dentro de um elemento.
//
//  desenharConfiguracoes(elemento, {
//    login:       "(11) 99999-9999",           // como a pessoa entra (só mostra)
//    loginRotulo: "WhatsApp",                   // nome do login
//    loginBruto:  "11999999999",                // usado no "esqueci a senha atual"
//    dados:       { nome: "Davi", email: "" },  // campos que a pessoa pode mudar
//    campos:      ["nome", "email"],            // quais mostrar: nome, email, telefone
//    minimo:      4,                            // tamanho mínimo da senha
//    salvarDados: async (dados) => {...},       // manda para o servidor
//    trocarSenha: async (atual, nova) => {...},
//  })
// =====================================================================
const CFG_CAMPOS = {
  nome: ["Nome", "text", "name", ""],
  email: ["E-mail", "email", "email", "seuemail@exemplo.com"],
  telefone: ["WhatsApp", "tel", "tel", "(00) 00000-0000"],
};

function desenharConfiguracoes(el, o) {
  const temEmail = o.campos.includes("email"), temTel = o.campos.includes("telefone");
  el.innerHTML = `
    <div class="cfg">
      <form class="cfg-bloco form" data-cfg="dados">
        <h2>👤 Meus dados</h2>
        <p class="cfg-login">🔑 Você entra com: <strong>${esc(o.loginRotulo)} ${esc(o.login)}</strong></p>
        ${o.campos.map((c) => {
          const [rotulo, tipo, auto, ph] = CFG_CAMPOS[c];
          return `<label>${rotulo}<input name="${c}" type="${tipo}" autocomplete="${auto}" placeholder="${ph}" value="${esc(o.dados[c] || "")}" ${c === "nome" ? "required" : ""}></label>`;
        }).join("")}
        ${temEmail || temTel ? `<p class="sub cfg-dica">📩 ${temEmail && temTel ? "O e-mail e o WhatsApp servem" : temEmail ? "O e-mail serve" : "O WhatsApp serve"}
          para receber o código se você esquecer a senha.${temEmail && !o.dados.email ? " <strong>Cadastre seu e-mail</strong> para poder recuperar por ele." : ""}</p>` : ""}
        <button class="btn-principal">Salvar dados</button>
      </form>

      <form class="cfg-bloco form" data-cfg="senha">
        <h2>🔒 Trocar senha</h2>
        <label>Senha atual<input type="password" name="atual" required autocomplete="current-password"></label>
        <label>Senha nova<input type="password" name="nova" required minlength="${o.minimo}" autocomplete="new-password" placeholder="Mínimo ${o.minimo} caracteres"></label>
        <label>Repita a senha nova<input type="password" name="nova2" required autocomplete="new-password"></label>
        <button class="btn-principal">Trocar senha</button>
        <button type="button" class="link esqueci" data-esqueci data-login="${esc(o.loginBruto || "")}">Esqueci a senha atual</button>
        <p class="sub cfg-dica">Ao trocar a senha, os outros aparelhos conectados saem da sua conta.</p>
      </form>
    </div>`;

  const enviar = async (form, fn) => {
    const botao = form.querySelector(".btn-principal");
    botao.disabled = true;
    try { await fn(); } finally { botao.disabled = false; }
  };
  el.querySelector('[data-cfg="dados"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const dados = Object.fromEntries(o.campos.map((c) => [c, (fd.get(c) || "").trim()]));
    enviar(e.target, () => o.salvarDados(dados));
  });
  el.querySelector('[data-cfg="senha"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("nova") !== fd.get("nova2")) { avisar("As senhas novas não são iguais."); return; }
    enviar(e.target, async () => { if ((await o.trocarSenha(fd.get("atual"), fd.get("nova"))) !== false) e.target.reset(); });
  });
}
