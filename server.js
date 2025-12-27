const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const cors = require("cors");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const path = require("path");
const axios = require("axios");
const pdfParse = require("pdf-parse");

const uploadRouter = require("./upload");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

/* =========================
   TRUST PROXY (REQUIRED ON RENDER)
========================= */
app.set("trust proxy", 1);

/* =========================
   CORS SETUP (LOCAL NOW, VERCEL LATER)
========================= */
const allowedOrigins = [
  "http://localhost:5173" // local frontend
  // add Vercel URL later
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

/* =========================
   UPLOAD DIRECTORY
========================= */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}
app.use("/uploads", express.static(UPLOAD_DIR));

/* =========================
   DB CONNECT
========================= */
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ MongoDB Error:", err));

/* =========================
   USER MODEL
========================= */
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String
});
const User = mongoose.model("User", userSchema);

/* =========================
   JWT HELPERS
========================= */
const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });

const isProd = process.env.NODE_ENV === "production";

const sendToken = (res, token) => {
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,                 // true on Render
    sameSite: isProd ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
};

/* =========================
   AUTH MIDDLEWARE
========================= */
const checkToken = (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token) throw new Error("No token");

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
};

/* =========================
   SIGNUP
========================= */
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "All fields required" });

  const exists = await User.findOne({ email });
  if (exists)
    return res.status(409).json({ message: "User already exists" });

  const hashed = await bcrypt.hash(password, 12);
  const user = await User.create({ email, password: hashed });

  sendToken(res, generateToken(user._id));
  res.json({ success: true, user: { email: user.email } });
});

/* =========================
   LOGIN
========================= */
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user)
    return res.status(401).json({ message: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.status(401).json({ message: "Invalid credentials" });

  sendToken(res, generateToken(user._id));
  res.json({ success: true, user: { email: user.email } });
});

/* =========================
   AUTH CHECK
========================= */
app.get("/api/auth/check", checkToken, async (req, res) => {
  const user = await User.findById(req.userId);
  res.json({
    isAuthenticated: true,
    user: { email: user.email }
  });
});

/* =========================
   LOGOUT
========================= */
app.post("/api/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  res.json({ success: true });
});

/* =========================
   AI CHAT FROM PDF
========================= */
app.post("/api/chat", checkToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ reply: "Message required" });
    }

    const UploadedFile =
      mongoose.models.UploadedFile ||
      mongoose.model("UploadedFile");

    const file = await UploadedFile
      .findOne({ uploadedBy: req.userId })
      .sort({ uploadedAt: -1 });

    if (!file) {
      return res.json({ reply: "❌ Please upload a PDF first." });
    }

    const filePath = path.join(UPLOAD_DIR, file.filename);
    if (!fs.existsSync(filePath)) {
      return res.json({ reply: "❌ Uploaded file missing on server." });
    }

    const pdfBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(pdfBuffer);

    if (!pdfData.text || !pdfData.text.trim()) {
      return res.json({ reply: "❌ No readable text found in PDF." });
    }

    const context = pdfData.text.slice(0, 6000);

    const groqRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: `
You are a strict document-based assistant.

RULES:
- Answer ONLY from document content
- If not found, say:
"Answer not found in the provided document."

FORMAT:
- Use **bold headings**
- Bullet points only
`
          },
          {
            role: "user",
            content: `Document Content:\n${context}\n\nQuestion:\n${message}`
          }
        ],
        temperature: 0,
        max_tokens: 512
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      reply: groqRes.data.choices[0].message.content
    });

  } catch (err) {
    console.error("🔥 AI ERROR:", err.response?.data || err.message);
    res.status(500).json({
      reply: "❌ AI failed to answer from the document"
    });
  }
});

/* =========================
   UPLOAD ROUTES
========================= */
app.use("/api/uploads", uploadRouter);

/* =========================
   ROOT TEST (OPTIONAL)
========================= */
app.get("/", (req, res) => {
  res.send("🚀 Backend running successfully");
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
