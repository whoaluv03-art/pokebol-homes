require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
const MongoStore = require("connect-mongo");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = "pokebol.sid";
const requiredEnvironment = ["MONGODB_URI", "ADMIN_LOGIN", "ADMIN_HASH", "SESSION_SECRET"];

for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    console.error(`Не задана обязательная переменная окружения: ${name}`);
    process.exit(1);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET должен содержать не менее 32 символов.");
  process.exit(1);
}

if (!/^\$2[aby]\$\d{2}\$/.test(process.env.ADMIN_HASH)) {
  console.error("ADMIN_HASH должен быть bcrypt-хешем. Создайте его командой npm run create-admin-hash.");
  process.exit(1);
}

if (isProduction) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000
});

let leads;

app.use(session({
  name: sessionCookieName,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    client: mongoClient,
    collectionName: "sessions",
    ttl: 60 * 60 * 8,
    autoRemove: "native"
  }),
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много заявок. Попробуйте позже." }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Слишком много попыток входа. Попробуйте позже."
});

function isValidCsrfToken(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string") return false;
  const submitted = Buffer.from(value);
  const stored = Buffer.from(expected);
  return submitted.length === stored.length && crypto.timingSafeEqual(submitted, stored);
}

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Требуется вход администратора." });
  }
  return res.redirect(303, "/admin/login");
}

async function sendLoginPage(req, res, statusCode = 200, errorMessage = "") {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  const template = await fs.readFile(path.join(__dirname, "admin-login.html"), "utf8");
  const errorBlock = errorMessage
    ? `<p class="login-error" role="alert">${errorMessage}</p>`
    : "";
  const html = template
    .replace("__CSRF_TOKEN__", req.session.csrfToken)
    .replace("<!-- LOGIN_ERROR -->", errorBlock);

  res.set("Cache-Control", "no-store");
  return res.status(statusCode).type("html").send(html);
}

app.get("/healthz", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "styles.css")));
app.get("/script.js", (req, res) => res.sendFile(path.join(__dirname, "script.js")));
app.get("/privacy.html", (req, res) => res.sendFile(path.join(__dirname, "privacy.html")));

app.post("/api/leads", leadLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const consentGiven = body.consent === "on" || body.consent === true;
    const digits = phone.replace(/\D/g, "");

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Укажите имя длиной от 2 до 100 символов." });
    }
    if (!/^[+\d\s().-]{7,24}$/.test(phone) || digits.length < 7 || digits.length > 15) {
      return res.status(400).json({ error: "Проверьте номер телефона." });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Сообщение не должно быть длиннее 2000 символов." });
    }
    if (!consentGiven) {
      return res.status(400).json({ error: "Для отправки заявки необходимо согласие на обработку данных." });
    }

    await leads.insertOne({
      name,
      phone,
      message,
      createdAt: new Date(),
      status: "new"
    });

    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.get("/admin/login", async (req, res, next) => {
  if (req.session.isAdmin) return res.redirect(303, "/admin");
  try {
    return await sendLoginPage(req, res);
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/login", loginLimiter, async (req, res, next) => {
  try {
    if (!isValidCsrfToken(req.body.csrfToken, req.session.csrfToken)) {
      return await sendLoginPage(req, res, 403, "Форма устарела. Обновите страницу и попробуйте снова.");
    }

    const login = typeof req.body.login === "string" ? req.body.login : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const passwordMatches = await bcrypt.compare(password, process.env.ADMIN_HASH);
    if (login !== process.env.ADMIN_LOGIN || !passwordMatches) {
      return await sendLoginPage(req, res, 401, "Неверный логин или пароль.");
    }

    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.isAdmin = true;
      return req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.redirect(303, "/admin");
      });
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/admin", requireAdmin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.js", requireAdmin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "admin.js"));
});

app.get("/api/admin/leads", requireAdmin, async (req, res, next) => {
  try {
    const entries = await leads.find({}, {
      projection: { name: 1, phone: 1, message: 1, createdAt: 1, status: 1 }
    }).sort({ createdAt: -1 }).limit(100).toArray();

    return res.json(entries.map((entry) => ({
      id: entry._id.toString(),
      name: entry.name,
      phone: entry.phone,
      message: entry.message,
      createdAt: entry.createdAt,
      status: entry.status
    })));
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/logout", requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie(sessionCookieName, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax"
    });
    return res.redirect(303, "/admin/login");
  });
});

app.use((req, res) => {
  res.status(404).type("text").send("Страница не найдена.");
});

app.use((error, req, res, next) => {
  console.error("Ошибка обработки запроса:", error);
  if (res.headersSent) return next(error);
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: "Не удалось выполнить запрос. Попробуйте позже." });
  }
  return res.status(500).type("text").send("Произошла ошибка сервера.");
});

async function start() {
  await mongoClient.connect();
  const database = mongoClient.db();
  leads = database.collection("leads");
  await leads.createIndex({ createdAt: -1 });

  const server = app.listen(port, () => {
    console.log(`Покебол запущен на порту ${port}.`);
  });

  const shutdown = () => {
    server.close(async () => {
      await mongoClient.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error("Не удалось запустить приложение:", error);
  process.exit(1);
});
