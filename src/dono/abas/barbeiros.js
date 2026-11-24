// =====================================================================
//  ABA BARBEIROS — cadastro com foto, acesso ao painel e pagamento por atendimento
//  (usa as funções do núcleo: src/dono/dono.js)
// =====================================================================

function renderBarbeiros() {
  const mes = mesAtual();
  const lista = ativos(CONFIG.barbeiros);
  const desligados = CONFIG.barbeiros.filter((b) => b.ativo === false);

  $("conteudo").innerHTML = `
    <div class="cab">
      <h1>Barbeiros</h1>
      <div class="acoes"><button class="btn-peq ouro" data-acao="novoBarb">+ Adicionar barbeiro</button></div>
    </div>

    <div class="cards-barb">
      ${lista.map((b) => {
        const atMes = agendamentos.filter((a) => a.barbeiroId === b.id && a.status === "atendido" && a.dia.startsWith(mes));
        const pendentes = aReceber(b.id);
        const saldo = saldoBarbeiro(b.id);
        const abertos = agendamentos.filter((a) => a.barbeiroId === b.id && a.status === "confirmado").length;
        const ultimo = pagamentos.filter((p) => p.barbeiroId === b.id).sort((x, y) => y.data.localeCompare(x.data))[0];
        return `
        <div class="card-barb">
          <div class="topo-b">
            ${fotoOuInicial(b, "grande")}
            <div><h3>${esc(b.nome)}</h3><p class="sub">${esc(b.especialidade || "")}</p><p class="sub">${b.telefone ? `${fmtTel(b.telefone)} · ${linkZap(b.telefone)}` : ""}</p></div>
          </div>
          <div class="dados">
            <div><span>Comissão</span>${b.comissao}% serviços · ${b.comissaoProdutos || 0}% produtos</div>
            <div><span>Folga</span>${(b.folga || []).length ? b.folga.map((i) => DIAS_SEMANA[i].slice(0, 3)).join(", ") : "Nenhuma"}</div>
            <div><span>Atendimentos no mês</span>${atMes.length} · ${real(soma(atMes, totalAg))}</div>
            <div><span>Ganhou no mês</span>${real(soma(atMes, comissaoDe))}</div>
          </div>
          <div class="saldo ${saldo <= 0.009 ? "zerado" : ""}">
            <span>${saldo > 0.009 ? `A pagar · ${pendentes.length} atendimento(s)` : "✓ Tudo pago"}</span>
            <strong>${real(saldo)}</strong>
          </div>
          <p class="sub">
            ${ultimo ? `Último pagamento: ${dataCurta(ultimo.data)} (${real(ultimo.valor)})` : "Nenhum pagamento ainda"} ·
            ${abertos} agendamento(s) em aberto<br>
            ${b.temAcesso ? `🔑 Acessa o painel do barbeiro com ${fmtTel(b.telefone)}` : `<span style="color:var(--perigo)">⚠ Sem acesso ao painel: edite e crie uma senha</span>`}<br>
            ${b.chavePix ? `⚡ Pix: ${esc(b.chavePix)}` : `<span class="sub">Sem chave Pix (cadastre para pagar pelo site)</span>`}
          </p>
          <div class="botoes">
            <button class="btn-peq ouro" data-acao="pagar" data-id="${b.id}">💵 Pagar</button>
            <button class="btn-peq" data-acao="histPag" data-id="${b.id}">Pagamentos</button>
            <button class="btn-peq" data-acao="editarBarb" data-id="${b.id}">Editar</button>
            <button class="btn-peq vermelho" data-acao="removerBarb" data-id="${b.id}">Remover</button>
          </div>
        </div>`;
      }).join("") || vazio("Nenhum barbeiro ativo. Clique em “Adicionar barbeiro”.")}
    </div>

    ${desligados.length ? `
    <div class="bloco" style="margin-top:20px">
      <h2>Barbeiros desligados</h2>
      <div class="tabela-wrap"><table>
        <tr><th>Nome</th><th>Saiu em</th><th class="num">A receber</th><th></th></tr>
        ${desligados.map((b) => `<tr>
          <td>${esc(b.nome)}</td><td>${b.desligadoEm ? dataCurta(b.desligadoEm) : "—"}</td>
          <td class="num">${real(saldoBarbeiro(b.id))}</td>
          <td class="num"><button class="btn-peq" data-acao="histPag" data-id="${b.id}">Pagamentos</button>
            <button class="btn-peq" data-acao="reativarBarb" data-id="${b.id}">Reativar</button></td></tr>`).join("")}
      </table></div>
    </div>` : ""}`;
}

// ---- Formulário de cadastro / edição do barbeiro (com foto e acesso ao painel)
let fotoEscolhida; // undefined = não mexeu · null = remover · texto = foto nova

function formBarbeiro(b = {}) {
  const novo = !b.id;
  return `
    <div class="foto-campo">
      <div id="fotoPrevia">${b.nome ? fotoOuInicial(b, "enorme") : `<span class="avatar enorme">📷</span>`}</div>
      <div class="botoes">
        <label class="btn-peq ouro" style="cursor:pointer">📷 ${b.foto ? "Trocar foto" : "Escolher foto"}<input type="file" accept="image/*" id="fotoArquivo" hidden></label>
        <button type="button" class="btn-peq vermelho" id="fotoRemover" ${b.foto ? "" : "hidden"}>Remover foto</button>
      </div>
      <p class="sub">A foto aparece para os clientes na hora de escolher o barbeiro.</p>
    </div>
    <label>Nome<input name="nome" required value="${esc(b.nome || "")}"></label>
    <div class="dupla">
      <label>WhatsApp (é o login dele)<input name="telefone" type="tel" ${novo ? "required" : ""} placeholder="(00) 00000-0000" value="${esc(fmtTel(b.telefone) === "—" ? "" : fmtTel(b.telefone))}"></label>
      <label>${novo ? "Senha de acesso" : "Nova senha (vazio = manter)"}<input name="novaSenha" type="password" autocomplete="new-password" minlength="4" ${novo ? "required" : ""} placeholder="${novo ? "Mínimo 4 caracteres" : "••••"}"></label>
    </div>
    <div class="dupla">
      <label>Especialidade<input name="especialidade" value="${esc(b.especialidade || "")}" placeholder="Ex.: Degradê"></label>
      <label>Chave Pix dele<input name="chavePix" value="${esc(b.chavePix || "")}" placeholder="CPF, e-mail, +55 telefone..."></label>
    </div>
    <div class="dupla">
      <label>Comissão nos serviços (%)<input type="number" name="comissao" min="0" max="100" step="1" required value="${b.comissao ?? 50}"></label>
      <label>Comissão nos produtos (%)<input type="number" name="comissaoProdutos" min="0" max="100" step="1" required value="${b.comissaoProdutos ?? 10}"></label>
    </div>
    <div>
      <p class="sub" style="margin-bottom:6px">Dias de folga</p>
      <div class="dias-check">${DIAS_SEMANA.map((d, i) =>
        `<label><input type="checkbox" name="folga" value="${i}" ${(b.folga || []).includes(i) ? "checked" : ""}>${d.slice(0, 3)}</label>`).join("")}</div>
    </div>
    <p class="sub">${novo ? "Com o WhatsApp e a senha, ele entra em <strong>/barbeiro</strong> para ver a agenda e quanto vai receber."
      : "Mudanças na comissão valem para os próximos atendimentos. Os já feitos continuam com o valor da época."}</p>`;
}

// Diminui a foto (quadrada, 480 px) antes de enviar, para o site continuar rápido
function reduzirFoto(arquivo) {
  return new Promise((ok, falha) => {
    if (!arquivo.type.startsWith("image/")) return falha(new Error("Escolha um arquivo de imagem."));
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.width, img.height), tam = Math.min(480, lado);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = tam;
      canvas.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, tam, tam);
      URL.revokeObjectURL(img.src);
      ok(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => falha(new Error("Não foi possível abrir essa imagem."));
    img.src = URL.createObjectURL(arquivo);
  });
}

function prepararCampoFoto(b = {}) {
  fotoEscolhida = undefined;
  $("fotoArquivo").addEventListener("change", async (e) => {
    const arq = e.target.files[0];
    if (!arq) return;
    try {
      fotoEscolhida = await reduzirFoto(arq);
      $("fotoPrevia").innerHTML = `<img class="avatar enorme foto" src="${fotoEscolhida}" alt="">`;
      $("fotoRemover").hidden = false;
    } catch (er) { avisar(er.message); }
  });
  $("fotoRemover").addEventListener("click", () => {
    fotoEscolhida = null;
    $("fotoPrevia").innerHTML = `<span class="avatar enorme">${esc((b.nome || "📷")[0])}</span>`;
    $("fotoRemover").hidden = true;
  });
}

function lerFormBarbeiro(fd) {
  return {
    nome: fd.get("nome").trim(),
    telefone: soDigitos(fd.get("telefone")),
    novaSenha: fd.get("novaSenha"),
    chavePix: fd.get("chavePix").trim(),
    especialidade: fd.get("especialidade").trim(),
    comissao: Number(fd.get("comissao")),
    comissaoProdutos: Number(fd.get("comissaoProdutos")),
    folga: fd.getAll("folga").map(Number),
  };
}

function validarBarbeiro(d, novo) {
  if (d.telefone && ![10, 11].includes(d.telefone.length)) return "Digite o WhatsApp com DDD.";
  if ((novo || d.novaSenha) && !d.telefone) return "Digite o WhatsApp: ele é o login do barbeiro.";
  if (novo && !d.novaSenha) return "Crie uma senha para o barbeiro.";
  if (d.novaSenha && d.novaSenha.length < 4) return "A senha precisa ter pelo menos 4 caracteres.";
  return "";
}

async function salvarBarbeiro(id, mensagem) {
  const foto = fotoEscolhida;
  if (!(await salvarConfig())) return;
  if (foto !== undefined) await enviar("PUT", `/api/dono/barbeiros/${id}/foto`, { imagem: foto });
  avisar(mensagem);
}

ACOES.novoBarb = () => {
  abrirModal({
    titulo: "Adicionar barbeiro",
    ok: "Adicionar",
    corpo: formBarbeiro(),
    aoSalvar: (fd) => {
      const dados = lerFormBarbeiro(fd);
      const erro = validarBarbeiro(dados, true);
      if (erro) { avisar(erro); return false; }
      const id = novoId("b");
      CONFIG.barbeiros.push({ id, ...dados, ativo: true, entrouEm: hojeIso() });
      salvarBarbeiro(id, `${dados.nome} foi adicionado. Já aparece para os clientes e pode entrar no painel dele.`);
    },
  });
  prepararCampoFoto();
};

ACOES.editarBarb = (id) => {
  const b = barbeiro(id);
  abrirModal({
    titulo: `Editar ${b.nome}`,
    corpo: formBarbeiro(b),
    aoSalvar: (fd) => {
      const dados = lerFormBarbeiro(fd);
      const erro = validarBarbeiro(dados, false);
      if (erro) { avisar(erro); return false; }
      Object.assign(b, dados);
      const conflito = agendamentos.filter((a) => a.barbeiroId === b.id && a.dia >= hojeIso() && foraDoHorario(a)).length;
      salvarBarbeiro(b.id, conflito ? `Salvo. Atenção: ${conflito} agendamento(s) caem na folga nova.` : "Barbeiro atualizado.");
    },
  });
  prepararCampoFoto(b);
};

ACOES.removerBarb = (id) => {
  const b = barbeiro(id), saldo = saldoBarbeiro(id);
  const abertos = agendamentos.filter((a) => a.barbeiroId === id && a.status === "confirmado");

  if (saldo > 0.009) {
    abrirModal({
      titulo: "Ainda não dá para remover",
      ok: "Pagar agora",
      corpo: `<div class="alerta vermelho"><span>${esc(b.nome)} ainda tem <strong>${real(saldo)}</strong> a receber (${aReceber(id).length} atendimento(s)). Para tirar o barbeiro do sistema, faça o pagamento antes.</span></div>`,
      aoSalvar: () => ACOES.pagar(id),
    });
    return;
  }
  if (abertos.length) {
    abrirModal({
      titulo: "Ainda não dá para remover",
      ok: "Ver na agenda",
      corpo: `<div class="alerta vermelho"><span>${esc(b.nome)} tem <strong>${abertos.length}</strong> agendamento(s) em aberto. Troque o barbeiro, cancele ou marque como atendido antes de remover.</span></div>`,
      aoSalvar: () => { fAg = { dia: "", barbeiro: id, status: "confirmado" }; abaAtual = "agenda"; renderAba(); },
    });
    return;
  }
  abrirModal({
    titulo: `Remover ${b.nome}?`,
    ok: "Remover barbeiro",
    corpo: `
      <div class="info-caixa">
        <span>✓ Todos os atendimentos pagos</span>
        <span>✓ Nenhum agendamento em aberto</span>
      </div>
      <p class="sub">Ele deixa de aparecer para os clientes e perde o acesso ao painel. O histórico de atendimentos e pagamentos continua guardado, e você pode reativá-lo depois.</p>`,
    aoSalvar: () => {
      enviar("POST", `/api/dono/barbeiros/${b.id}/remover`, {}, `${b.nome} foi removido do sistema.`);
    },
  });
};

ACOES.reativarBarb = (id) => {
  const b = barbeiro(id);
  enviar("POST", `/api/dono/barbeiros/${b.id}/reativar`, {}, `${b.nome} voltou para a equipe.`);
};

// ---- Pagar o barbeiro: o dono marca quais atendimentos está pagando
ACOES.pagar = (id) => {
  const b = barbeiro(id), lista = aReceber(id);
  if (!lista.length) {
    abrirModal({ titulo: `Pagar ${b.nome}`, cancelar: false, ok: "Fechar",
      corpo: `<div class="info-caixa"><span>✓ Todos os atendimentos de ${esc(b.nome)} já foram pagos.</span></div>` });
    return;
  }
  const rotulos = { "Pix pelo site": "⚡ Pix pelo site (gera QR code)", Pix: "Pix (pelo app do banco)" };
  const formas = OPCOES.formasPagBarbeiro.filter((v) => v !== "Pix pelo site" || b.chavePix).map((v) => [v, rotulos[v] || v]);
  abrirModal({
    titulo: `Pagar ${b.nome}`,
    ok: "Continuar",
    corpo: `
      <p class="sub">Marque os atendimentos que você está pagando agora. Eles ficam registrados como pagos, e o barbeiro vê isso no painel dele.</p>
      <div class="tabela-wrap" style="max-height:260px;overflow-y:auto"><table>
        <tr><th><input type="checkbox" id="marcarTodos" checked aria-label="Marcar todos"></th><th>Data</th><th>Atendimento</th><th class="num">Comissão</th></tr>
        ${lista.map((a) => `<tr>
          <td><input type="checkbox" name="ag" value="${a.id}" checked></td>
          <td>${dataCurta(a.dia)}<br><span class="sub">${a.hora}</span></td>
          <td>${esc(a.servico)}<br><span class="sub">${esc(a.cliente)}</span></td>
          <td class="num">${real(comissaoDe(a))}</td></tr>`).join("")}
      </table></div>
      <div class="saldo"><span>Total a pagar agora</span><strong id="totalRepasse">${real(soma(lista, comissaoDe))}</strong></div>
      <div class="dupla">
        <label>Como vai pagar<select name="forma">${formas.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
        <label>Data<input type="date" name="data" required value="${hojeIso()}"></label>
      </div>
      ${b.chavePix ? "" : `<p class="sub">Para pagar pelo site com QR code, cadastre a chave Pix de ${esc(b.nome)} em Editar.</p>`}
      <label>Observação<input name="obs" placeholder="Ex.: comissões da semana"></label>`,
    aoSalvar: (fd) => {
      const ids = fd.getAll("ag").map(Number);
      if (!ids.length) { avisar("Marque pelo menos um atendimento."); return false; }
      const valor = r2(soma(lista.filter((a) => ids.includes(a.id)), comissaoDe));
      const pedido = { barbeiroId: id, agendamentoIds: ids, forma: fd.get("forma"), data: fd.get("data"), obs: fd.get("obs") };
      if (pedido.forma === "Pix pelo site") { pagarPorPix(b, pedido, valor); return; }
      enviar("POST", "/api/dono/pagamentos", pedido, `Pagamento de ${real(valor)} para ${b.nome} registrado (${ids.length} atendimento(s)).`);
    },
  });
  const atualizarTotal = () => {
    const ids = [...$("modalCorpo").querySelectorAll('input[name="ag"]:checked')].map((x) => Number(x.value));
    $("totalRepasse").textContent = real(soma(lista.filter((a) => ids.includes(a.id)), comissaoDe));
  };
  $("modalCorpo").querySelectorAll('input[name="ag"]').forEach((x) => x.addEventListener("change", atualizarTotal));
  $("marcarTodos").addEventListener("change", (e) => {
    $("modalCorpo").querySelectorAll('input[name="ag"]').forEach((x) => (x.checked = e.target.checked));
    atualizarTotal();
  });
};

// Mostra o QR code Pix com a chave do barbeiro e o valor certo; o dono paga pelo app do banco
async function pagarPorPix(b, pedido, valor) {
  let pix;
  try { pix = await apiDono("POST", `/api/dono/barbeiros/${b.id}/pix`, { valor }); }
  catch (e) { falhou(e); return; }
  abrirModal({
    titulo: `Pagar ${b.nome} por Pix`,
    ok: "✓ Já paguei, registrar",
    corpo: `
      <div class="valor-grande"><span class="sub">Valor</span><strong>${real(valor)}</strong></div>
      <div class="qr" id="qrBarbeiro"></div>
      <ol class="passos-pix">
        <li>Abra o app do seu banco e escolha <strong>Pix → Ler QR code</strong></li>
        <li>Confira: <strong>${esc(pix.nome)}</strong> · chave ${esc(pix.chave)}</li>
        <li>Depois de pagar, clique em <strong>Já paguei, registrar</strong></li>
      </ol>
      <div class="copia-cola"><input id="pixBarbCodigo" readonly value="${esc(pix.codigo)}"><button type="button" class="btn-secundario" data-acao="copiarPixBarb">Copiar</button></div>`,
    aoSalvar: () => {
      enviar("POST", "/api/dono/pagamentos", pedido, `Pagamento de ${real(valor)} para ${b.nome} registrado.`);
    },
  });
  if (window.qrcode) {
    const q = qrcode(0, "M"); q.addData(pix.codigo); q.make();
    $("qrBarbeiro").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } else $("qrBarbeiro").innerHTML = `<span style="color:#333;font-size:.85rem">Sem internet para desenhar o QR. Use o copia e cola.</span>`;
}

ACOES.copiarPixBarb = async () => {
  const campo = $("pixBarbCodigo");
  try { await navigator.clipboard.writeText(campo.value); } catch { campo.select(); document.execCommand("copy"); }
  avisar("Código Pix copiado!");
};

ACOES.histPag = (id) => {
  const b = barbeiro(id);
  const lista = pagamentos.filter((p) => p.barbeiroId === id).sort((x, y) => y.data.localeCompare(x.data));
  const pend = aReceber(id);
  abrirModal({
    titulo: `Pagamentos — ${b.nome}`,
    cancelar: false, ok: "Fechar",
    corpo: `
      <div class="saldo ${pend.length ? "" : "zerado"}"><span>${pend.length ? `A receber · ${pend.length} atendimento(s)` : "✓ Tudo pago"}</span><strong>${real(saldoBarbeiro(id))}</strong></div>
      ${lista.length ? `
      <div class="tabela-wrap"><table>
        <tr><th>Data</th><th>Forma</th><th class="num">Atend.</th><th class="num">Valor</th><th></th></tr>
        ${verMais("histPag" + id, lista.map((p) => `<tr><td>${dataCurta(p.data)}${p.obs ? `<br><span class="sub">${esc(p.obs)}</span>` : ""}</td><td>${esc(p.forma)}</td>
          <td class="num">${agendamentos.filter((a) => a.repasseId === p.id).length}</td>
          <td class="num">${real(p.valor)}</td>
          <td class="num"><button type="button" class="btn-peq vermelho" data-acao="excluirPag" data-id="${p.id}">Desfazer</button></td></tr>`), 5).itens}
      </table></div>${verMais("histPag" + id, lista, 5).botao}
      <p class="sub">“Desfazer” apaga um pagamento registrado por engano: os atendimentos dele voltam a ficar “a receber”.</p>` : vazio("Nenhum pagamento registrado ainda.")}`,
  });
};

ACOES.excluirPag = (id) => {
  const p = pagamentos.find((x) => x.id === id);
  if (!p || !confirm(`Desfazer o pagamento de ${real(p.valor)} (${dataCurta(p.data)})?\nOs atendimentos dele voltam a ficar "a receber".`)) return;
  enviar("DELETE", `/api/dono/pagamentos/${id}`, undefined, "Pagamento desfeito.").then(() => ACOES.histPag(p.barbeiroId));
};
