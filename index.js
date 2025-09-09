import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";


const app = express();
app.use(express.json());

let usuarios = [];          // Usuários em memória
let tokensPendentes = {};   // Código de verificação: { codigo: email }
let consumos = [];          // Consumos: { user, kwh, timestamp }

const JWT_SECRET = "chave-secreta";

// =====================
// Tarifas médias aproximadas por região/estado (R$/kWh)
const tarifas = {
  "SP": 0.85,
  "RJ": 0.80,
  "MG": 0.82,
  "ES": 0.81,
  "RS": 0.78,
  "PR": 0.77,
  "SC": 0.79,
  "BA": 0.76,
  "PE": 0.75,
  "CE": 0.74,
  "OUTRO": 0.80
};

// =====================
// Funções utilitárias
// =====================
function gerarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function enviarConfirmacao(email, codigo) {
  console.log(`\n📩 Simulação de envio de e-mail para: ${email}`);
  console.log(`Seu código de confirmação é: ${codigo}\n`);
}

// Middleware de autenticação
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(403).json({ error: "Token não fornecido" });

  const token = authHeader.split(" ")[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: "Token inválido" });
  }
}

// =====================
// Rotas de Auth
// =====================

// Registro
app.post("/auth/register", async (req, res) => {
  const { email, senha, regiao } = req.body;
  if (usuarios.find(u => u.email === email)) {
    return res.status(400).json({ error: "E-mail já registrado" });
  }

  const hash = await bcrypt.hash(senha, 10);
  usuarios.push({ email, senha: hash, verificado: false, regiao: regiao || "OUTRO" });

  const codigo = gerarCodigo();
  tokensPendentes[codigo] = email;
  await enviarConfirmacao(email, codigo);

  res.json({ msg: "Cadastro realizado! Confirme seu e-mail com o código enviado (console)." });
});

// Verificação de e-mail
app.post("/auth/verify", (req, res) => {
  const { codigo } = req.body;
  const email = tokensPendentes[codigo];
  if (!email) return res.status(400).send("❌ Código inválido ou expirado");

  usuarios = usuarios.map(u => u.email === email ? { ...u, verificado: true } : u);
  delete tokensPendentes[codigo];
  res.send("✅ Conta verificada com sucesso!");
});

// Login
app.post("/auth/login", async (req, res) => {
  const { email, senha } = req.body;
  const user = usuarios.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  if (!user.verificado) return res.status(403).json({ error: "Confirme seu e-mail primeiro" });

  const ok = await bcrypt.compare(senha, user.senha);
  if (!ok) return res.status(401).json({ error: "Senha inválida" });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1d" });
  res.json({ token });
});

// =====================
// Rotas de Consumo
// =====================

// Adicionar consumo
app.post("/consumo", authMiddleware, (req, res) => {
  const { kwh, timestamp } = req.body;
  consumos.push({ user: req.user.email, kwh, timestamp: timestamp || new Date().toISOString() });
  res.json({ status: "ok" });
});

// Relatórios com cálculo em R$
app.get("/relatorio/:periodo", authMiddleware, (req, res) => {
  const { periodo } = req.params;
  const usuario = usuarios.find(u => u.email === req.user.email);
  const tarifa = tarifas[usuario.regiao] || tarifas["OUTRO"];

  const userConsumos = consumos.filter(c => c.user === req.user.email);

  let inicio;
  const agora = dayjs();

  switch (periodo) {
    case "diario": inicio = agora.startOf("day"); break;
    case "semanal": inicio = agora.startOf("week"); break;
    case "quinzenal": inicio = agora.subtract(15, "day"); break;
    case "mensal": inicio = agora.startOf("month"); break;
    default: return res.status(400).json({ error: "Período inválido" });
  }

  const filtrados = userConsumos.filter(c => dayjs(c.timestamp).isAfter(inicio));
  const totalKwh = filtrados.reduce((sum, c) => sum + c.kwh, 0);
  const totalR$ = totalKwh * tarifa;

  res.json({
    periodo,
    regiao: usuario.regiao,
    tarifa_por_kwh: tarifa,
    inicio: inicio.toISOString(),
    fim: agora.toISOString(),
    consumo_total_kwh: totalKwh.toFixed(2),
    valor_estimado_R$: totalR$.toFixed(2)
  });
});
