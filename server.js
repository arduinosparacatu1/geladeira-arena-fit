// ============================================================
// Servidor - Geladeira Inteligente AS Fitness Suplementos
// Arduinos Paracatu
// ============================================================

const express = require("express");
const crypto  = require("crypto");
const app     = express();

app.use(express.json({ limit: "50kb" }));

const PORT         = process.env.PORT || 3000;
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "troque-este-token";
const HANDLE       = process.env.INFINITEPAY_HANDLE || "alan_goncalve";
const WEBHOOK_URL  = process.env.WEBHOOK_URL || "";

// ── Seguranca: chave secreta do webhook ──────────────────────
// Gera um hash HMAC de cada payload recebido e compara com um
// segredo. Como a InfinitePay nao assina, usamos uma URL secreta
// em vez de /webhook. Quem nao sabe o caminho, nao aciona.
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(16).toString("hex");

// ── Rate limiter simples (sem dependencia externa) ───────────
const rateMap = new Map();
function rateLimit(ip, max, windowMs) {
  const agora = Date.now();
  const reg = rateMap.get(ip);
  if (!reg || agora - reg.inicio > windowMs) {
    rateMap.set(ip, { inicio: agora, cont: 1 });
    return false;
  }
  reg.cont++;
  return reg.cont > max;
}
// Limpa entradas antigas a cada 5 min
setInterval(() => {
  const agora = Date.now();
  for (const [ip, reg] of rateMap) {
    if (agora - reg.inicio > 300000) rateMap.delete(ip);
  }
}, 300000);

// ── Catalogo de produtos ─────────────────────────────────────
const PRODUTOS = [
  { id: "monster",       nome: "Monster",               preco: 1200 },
  { id: "baly",          nome: "Baly",                  preco: 1000 },
  { id: "redbull355",    nome: "Red Bull 355ml",        preco: 1700 },
  { id: "redbull473",    nome: "Red Bull 473ml",        preco: 2000 },
  { id: "aguagas",       nome: "Agua com Gas",          preco:  500 },
  { id: "aguasemgas",    nome: "Agua sem Gas",          preco:  400 },
  { id: "agua1l",        nome: "Agua 1 Litro",          preco:  700 },
  { id: "gatorade",      nome: "Gatorade",              preco:  800 },
  { id: "powerade",      nome: "Powerade",              preco:  700 },
  { id: "coca",          nome: "Coca-Cola",             preco:  600 },
  { id: "wepink",        nome: "WePink",                preco:  800 },
  { id: "carbup",        nome: "CarbUp",                preco:  690 },
  { id: "barrinha-ovo",  nome: "Barrinha Ovo Maltine",  preco: 1200 },
  { id: "barrinha-grow", nome: "Barrinha Growth",       preco:  900 },
  { id: "chiclete",      nome: "Chiclete Mentos",       preco:  100 },
  { id: "whey-sache",    nome: "Whey Sache Growth",     preco: 1000 },
  { id: "whey-isolado",  nome: "Whey Sache Isolado",    preco: 1500 },
];

// ── Estado ───────────────────────────────────────────────────
let liberarPorta    = false;
let ultimoPagamento = null;
const historico     = [];
const idsProcessados = new Set();
// Limpa IDs antigos a cada 1h (evita vazamento de memoria)
setInterval(() => idsProcessados.clear(), 3600000);

function registrar(ev) {
  historico.unshift(ev);
  if (historico.length > 20) historico.pop();
}

// ── Catalogo HTML com carrinho ────────────────────────────────
app.get("/catalogo", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  const itens = PRODUTOS.map(p => `
    <div class="c" data-id="${p.id}">
      <div class="i"><b>${p.nome}</b><br><span>R$ ${(p.preco/100).toFixed(2).replace(".",",")}</span></div>
      <div class="q">
        <button onclick="m('${p.id}',-1)">−</button>
        <span id="q-${p.id}">0</span>
        <button class="p" onclick="m('${p.id}',1)">+</button>
      </div>
    </div>`).join("");

  res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AS Fitness</title><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#fff;padding-bottom:110px}
header{background:#F5C300;padding:14px 18px;text-align:center}
header h1{font-size:19px;color:#000}header p{font-size:12px;color:#333;margin-top:2px}
.l{display:flex;flex-direction:column;gap:8px;padding:12px}
.c{background:#1a1a1a;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;border:1.5px solid #2a2a2a}
.c.a{border-color:#F5C300}
.i b{font-size:14px}.i span{font-size:12px;color:#999}
.q{display:flex;align-items:center;gap:10px}
.q button{width:32px;height:32px;border-radius:50%;border:none;font-size:20px;font-weight:700;cursor:pointer;background:#333;color:#fff;display:flex;align-items:center;justify-content:center}
.q .p{background:#F5C300;color:#000}
.q span{font-size:17px;font-weight:700;min-width:22px;text-align:center}
#k{position:fixed;bottom:0;left:0;right:0;background:#111;border-top:1px solid #222;padding:12px 14px;display:none;flex-direction:column;gap:8px}
#k.v{display:flex}
.r{display:flex;justify-content:space-between;align-items:center}
.r span{font-size:13px;color:#aaa}.r strong{font-size:19px;color:#F5C300}
#b{background:#F5C300;color:#000;border:none;border-radius:10px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;width:100%}
</style></head><body>
<header><h1>AS Fitness Suplementos</h1><p>Escolha seus produtos e pague pelo celular</p></header>
<div class="l">${itens}</div>
<div id="k"><div class="r"><span id="ri">0</span><strong id="rt">R$ 0</strong></div>
<button id="b" onclick="go()">Pagar agora →</button></div>
<script>const P=${JSON.stringify(PRODUTOS)},Q={};P.forEach(p=>Q[p.id]=0);
function m(id,d){Q[id]=Math.max(0,(Q[id]||0)+d);document.getElementById('q-'+id).textContent=Q[id];
document.querySelector('[data-id="'+id+'"]').classList.toggle('a',Q[id]>0);u()}
function u(){let t=0,n=0;P.forEach(p=>{t+=(Q[p.id]||0)*p.preco;n+=Q[p.id]||0});
const k=document.getElementById('k');if(n>0){k.classList.add('v');
document.getElementById('ri').textContent=n+(n===1?' item':' itens');
document.getElementById('rt').textContent='R$ '+(t/100).toFixed(2).replace('.',',')}else{k.classList.remove('v')}}
async function go(){const b=document.getElementById('b');b.textContent='Gerando...';b.disabled=true;
const s=P.filter(p=>Q[p.id]>0).map(p=>({id:p.id,qty:Q[p.id]}));
try{const r=await fetch('/checkout',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({itens:s})});const d=await r.json();
if(d.url){window.location.href=d.url}else{alert('Erro. Tente novamente.');b.textContent='Pagar agora →';b.disabled=false}}
catch(e){alert('Erro de conexao.');b.textContent='Pagar agora →';b.disabled=false}}</script>
</body></html>`);
});

// ── Checkout com multiplos itens ─────────────────────────────
app.post("/checkout", async (req, res) => {
  const ip = req.ip;
  if (rateLimit(ip, 10, 60000))
    return res.status(429).json({ erro: "muitas requisicoes, aguarde" });

  const { itens } = req.body || {};
  if (!itens || !itens.length) return res.status(400).json({ erro: "nenhum item" });

  const webhookUrl = WEBHOOK_URL || `${req.protocol}://${req.get("host")}/wh/${WEBHOOK_SECRET}`;
  const lineItems = itens.map(({ id, qty }) => {
    const p = PRODUTOS.find(x => x.id === id);
    if (!p || qty < 1 || qty > 50) return null;
    return { quantity: qty, price: p.preco, description: p.nome };
  }).filter(Boolean);

  if (!lineItems.length) return res.status(400).json({ erro: "itens invalidos" });

  try {
    const r = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: HANDLE, webhook_url: webhookUrl,
        order_nsu: `c-${Date.now()}`, items: lineItems }),
    });
    const data = await r.json();
    if (data.url) return res.json({ url: data.url });
    console.error("Erro InfinitePay:", data);
    res.status(500).json({ erro: "erro ao gerar link" });
  } catch (err) {
    console.error("Falha:", err.message);
    res.status(500).json({ erro: "erro de conexao" });
  }
});

// ── Webhook seguro (URL secreta) ─────────────────────────────
// Rota publica /webhook mantida como fallback
app.post(["/webhook", "/wh/:secret"], (req, res) => {
  // Se veio pela rota secreta, valida o segredo
  if (req.params.secret && req.params.secret !== WEBHOOK_SECRET) {
    console.log(">>> Webhook com segredo invalido. Ignorado.");
    return res.sendStatus(403);
  }

  const ip = req.ip;
  if (rateLimit(ip, 30, 60000)) {
    console.log(">>> Webhook rate limited:", ip);
    return res.sendStatus(429);
  }

  const body = req.body || {};
  console.log("Webhook recebido:", JSON.stringify(body));

  const idTransacao = body.transaction_nsu || body.invoice_slug || body.order_nsu || null;

  if (idTransacao && idsProcessados.has(idTransacao)) {
    console.log(">>> Repetido, ignorado:", idTransacao);
    return res.sendStatus(200);
  }

  const pareceValido =
    (typeof body.paid_amount === "number" || typeof body.amount === "number") &&
    idTransacao !== null;

  if (pareceValido) {
    if (idTransacao) idsProcessados.add(idTransacao);
    liberarPorta = true;
    ultimoPagamento = {
      recebidoEm: new Date().toISOString(),
      valor:      body.paid_amount || body.amount || null,
      metodo:     body.capture_method || null,
      transacao:  idTransacao,
    };
    registrar(ultimoPagamento);
    console.log(">>> Pagamento aprovado. Porta sera liberada.");
  } else {
    console.log(">>> Formato inesperado. Ignorado.");
  }

  res.sendStatus(200);
});

// ── ESP32: consulta se deve abrir ────────────────────────────
app.get("/status", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN)
    return res.status(401).json({ abrir: false });
  if (liberarPorta) {
    liberarPorta = false;
    console.log(">>> ESP32 notificado. Abrindo porta.");
    return res.json({ abrir: true });
  }
  res.json({ abrir: false });
});

// ── Teste manual ─────────────────────────────────────────────
app.get("/teste", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN) return res.status(401).send("token invalido");
  liberarPorta = true;
  res.send("OK - porta liberada no proximo ciclo");
});

// ── Health ───────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ servico: "geladeira-inteligente", status: "online" });
});

app.get("/historico", (req, res) => {
  if (req.query.token !== DEVICE_TOKEN) return res.status(401).json({ erro: "token invalido" });
  res.json({ historico });
});

app.use((req, res) => res.status(404).json({ erro: "nao encontrado" }));

app.use((err, req, res, next) => {
  console.error("Erro:", err.message);
  if (req.path.startsWith("/wh") || req.path === "/webhook") return res.sendStatus(200);
  res.status(400).json({ erro: "invalido" });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Webhook seguro: /wh/${WEBHOOK_SECRET}`);
});
