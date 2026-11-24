// ===== Funções usadas tanto pelo app do cliente quanto pelo painel do dono =====

const $ = (id) => document.getElementById(id);
const real = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const paraMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const paraHora = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const soDigitos = (s) => String(s || "").replace(/\D/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function chaveDia(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dataDe = (iso) => new Date(iso + "T12:00");
const dataBonita = (iso) => dataDe(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
const dataCurta = (iso) => dataDe(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");

function ler(chave, padrao) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
}
function salvar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

// ===== Conversa com o servidor =====
async function api(metodo, caminho, corpo, token) {
  const opcoes = { method: metodo, headers: {} };
  if (token) opcoes.headers.Authorization = "Bearer " + token;
  if (corpo !== undefined) {
    opcoes.headers["Content-Type"] = "application/json";
    opcoes.body = JSON.stringify(corpo);
  }
  let resp;
  try { resp = await fetch(caminho, opcoes); }
  catch { throw new Error("Sem conexão com o servidor. Verifique se ele está ligado."); }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const erro = new Error(dados.erro || "Erro no servidor.");
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

// Aberto direto pelo arquivo (sem o servidor)? Mostra como ligar.
if (location.protocol === "file:") {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML = `
      <div style="max-width:520px;margin:60px auto;padding:24px;font-family:system-ui;color:#f3ece4;background:#1f1a17;border-radius:16px;line-height:1.6">
        <h2>Ligue o servidor primeiro</h2>
        <p>Abra o terminal na pasta do projeto e rode:</p>
        <pre style="background:#000;padding:12px;border-radius:8px">python servidor/servidor.py</pre>
        <p>Depois acesse <b>http://localhost:8000</b> (cliente) ou <b>http://localhost:8000/dono</b> (dono).</p>
      </div>`;
  });
}

function avisar(texto) {
  const el = $("aviso");
  el.textContent = texto;
  el.classList.add("mostrar");
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => el.classList.remove("mostrar"), 2800);
}

function mostrarTela(id) {
  document.querySelectorAll(".tela").forEach((t) => (t.hidden = t.id !== id));
  window.scrollTo(0, 0);
}

// ===== Regras da agenda =====
function lojaAbertaNoDia(d) {
  if ((FUNCIONAMENTO.datasFechadas || []).some((x) => x.data === chaveDia(d))) return false;
  return !!FUNCIONAMENTO.semana[d.getDay()]?.aberto;
}

function barbeiroTrabalha(b, d) {
  return !(b.folga || []).includes(d.getDay());
}

function ocupadoEm(lista, barbeiroId, dia, inicio, duracao, ignorarId) {
  return lista.some((a) => {
    if (a.id === ignorarId || a.status === "cancelado" || a.barbeiroId !== barbeiroId || a.dia !== dia) return false;
    const ai = paraMin(a.hora);
    return inicio < ai + a.duracao && ai < inicio + duracao;
  });
}

// Lista de horários do dia com a informação se está livre
function gradeHorarios(lista, barbeiroId, diaIso, duracao, ignorarId) {
  const cfg = FUNCIONAMENTO.semana[dataDe(diaIso).getDay()];
  const agora = new Date();
  const ehHoje = diaIso === chaveDia(agora);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const out = [];
  for (let m = paraMin(cfg.abre); m + duracao <= paraMin(cfg.fecha); m += Number(FUNCIONAMENTO.intervalo)) {
    out.push({
      hora: paraHora(m),
      livre: !(ehHoje && m <= minAgora) && !ocupadoEm(lista, barbeiroId, diaIso, m, duracao, ignorarId),
    });
  }
  return out;
}

// Estoque descontando o que já está reservado em agendamentos ainda não atendidos
function estoqueDisponivel(produto, lista) {
  const reservado = lista
    .filter((a) => a.status === "confirmado")
    .reduce((s, a) => s + (a.produtos || []).filter((p) => p.id === produto.id).reduce((x, p) => x + p.qtd, 0), 0);
  return Math.max(0, produto.estoque - reservado);
}

// Situação do agendamento vista pelo cliente
function statusDe(a) {
  if (a.status === "cancelado") return "cancelado";
  if (a.status === "atendido") return "concluido";
  if (a.status === "faltou") return "faltou";
  const fim = new Date(`${a.dia}T${a.hora}`);
  fim.setMinutes(fim.getMinutes() + a.duracao);
  return fim < new Date() ? "concluido" : "agendado";
}
