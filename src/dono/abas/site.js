// =====================================================================
//  ABA PÁGINA INICIAL — nome da barbearia, textos e listas do site
//  Tudo fica no banco (tabelas configuracoes e site_itens).
//  (usa as funções do núcleo: src/dono/dono.js)
// =====================================================================

let rascunhoSite = null;   // o que o dono está editando (só vai para o banco ao clicar em Salvar)

function novoRascunhoSite() {
  return {
    textos: { ...CONFIG.site.textosBrutos },
    itens: Object.fromEntries(Object.keys(CONFIG.site.secoes).map((s) => [s, (CONFIG.site.itens[s] || []).map((x) => ({ ...x }))])),
  };
}

function renderSite() {
  rascunhoSite ??= novoRascunhoSite();
  const r = rascunhoSite;
  const campo = (c) => {
    const valor = esc(r.textos[c.chave] ?? "");
    const comum = `data-digitar="siteTexto" data-chave="${c.chave}" maxlength="${c.maximo}"`;
    return `<label>${esc(c.rotulo)}${c.maximo > 150 ? `<textarea rows="3" ${comum}>${valor}</textarea>` : `<input ${comum} value="${valor}">`}</label>`;
  };

  $("conteudo").innerHTML = `
    <div class="cab">
      <div><h1>Página inicial</h1><p class="sub">O que os clientes veem em ${esc(location.host)}/</p></div>
      <div class="acoes">
        <a class="btn-peq" href="/" target="_blank" rel="noopener">Ver o site ↗</a>
        <button class="btn-peq" data-acao="descartarSite">Descartar alterações</button>
        <button class="btn-peq ouro" data-acao="salvarSite">Salvar alterações</button>
      </div>
    </div>

    <div class="bloco">
      <h2>Textos</h2>
      <p class="sub" style="margin-bottom:12px">Escreva <strong>{nome}</strong> para colocar o nome da barbearia (ele muda sozinho se você trocar o nome).
        Os serviços, barbeiros, preços e horários vêm das outras abas.</p>
      <div class="grade-site">${CONFIG.site.campos.map(campo).join("")}</div>
    </div>

    ${Object.entries(CONFIG.site.secoes).map(([secao, regra]) => {
      const lista = r.itens[secao];
      return `
      <div class="bloco">
        <h2><span>${esc(regra.rotulo)} <span class="sub">(${lista.length} de ${regra.maximo})</span></span>
          <button class="btn-peq ouro" data-acao="addItemSite" data-id="${secao}" ${lista.length >= regra.maximo ? "disabled" : ""}>+ Adicionar</button></h2>
        ${lista.length ? lista.map((item, i) => `
          <div class="item-site">
            ${regra.campos.includes("icone") ? `<input class="icone-site" maxlength="8" placeholder="🙂" aria-label="Ícone" value="${esc(item.icone)}" data-digitar="siteItem" data-secao="${secao}" data-i="${i}" data-campo="icone">` : ""}
            ${regra.campos.includes("titulo") ? `<input placeholder="Título" aria-label="Título" maxlength="200" value="${esc(item.titulo)}" data-digitar="siteItem" data-secao="${secao}" data-i="${i}" data-campo="titulo">` : ""}
            <input placeholder="Texto" aria-label="Texto" maxlength="200" value="${esc(item.texto)}" data-digitar="siteItem" data-secao="${secao}" data-i="${i}" data-campo="texto">
            <div class="botoes">
              <button class="btn-peq" data-acao="moverItemSite" data-id="${secao}:${i}:-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
              <button class="btn-peq" data-acao="moverItemSite" data-id="${secao}:${i}:1" ${i === lista.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button>
              <button class="btn-peq vermelho" data-acao="rmItemSite" data-id="${secao}:${i}" aria-label="Remover">✕</button>
            </div>
          </div>`).join("") : vazio("Nenhum item. Esta parte não aparece no site.")}
      </div>`;
    }).join("")}`;
}

DIGITAR.siteTexto = (el) => { rascunhoSite.textos[el.dataset.chave] = el.value; };
DIGITAR.siteItem = (el) => { rascunhoSite.itens[el.dataset.secao][Number(el.dataset.i)][el.dataset.campo] = el.value; };

ACOES.addItemSite = (secao) => {
  rascunhoSite.itens[secao].push({ icone: "", titulo: "", texto: "" });
  renderSite();
  const campos = $("conteudo").querySelectorAll(`[data-secao="${secao}"]`);
  campos[campos.length - 1]?.focus();
};
ACOES.rmItemSite = (id) => {
  const [secao, i] = id.split(":");
  rascunhoSite.itens[secao].splice(Number(i), 1);
  renderSite();
};
ACOES.moverItemSite = (id) => {
  const [secao, i, d] = id.split(":");
  const lista = rascunhoSite.itens[secao], de = Number(i), para = de + Number(d);
  [lista[de], lista[para]] = [lista[para], lista[de]];
  renderSite();
};
ACOES.descartarSite = () => { rascunhoSite = null; renderSite(); avisar("Alterações descartadas."); };
ACOES.salvarSite = async () => {
  const ok = await enviar("PUT", "/api/dono/site", rascunhoSite, "Página inicial salva. Os clientes já veem os textos novos.");
  if (ok) { rascunhoSite = null; renderSite(); }
};
