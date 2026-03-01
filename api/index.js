if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

// ── DB CONNECTION ─────────────────────────────────────────────────────────────
let connectionPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI environment variable is not set");

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      socketTimeoutMS: 45000,
    });
  }

  await connectionPromise;
}

// simple hash — no bcrypt dependency needed
function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw + "pf_salt_2025").digest("hex");
}

// ── SCHEMAS ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role:         { type: String, default: "" },
    college:      { type: String, default: "" },
    year:         { type: String, default: "" },
    bio:          { type: String, default: "" },
    skills:       { type: [String], default: [] },
    interests:    { type: [String], default: [] },
    avatar:       { type: String, default: "🧑‍💻" },
    lookingFor:   { type: String, default: "partners" },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.passwordHash; // never send hash to client
  },
});

const projectSchema = new mongoose.Schema(
  {
    title:         { type: String, required: true },
    description:   { type: String, default: "" },
    stack:         { type: [String], default: [] },
    interests:     { type: [String], default: [] },
    difficulty:    { type: String, default: "Intermediate" },
    teamSize:      { type: Number, default: 4 },
    membersCount:  { type: Number, default: 1 },
    duration:      { type: String, default: "4 weeks" },
    author:        { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    authorName:    { type: String, default: "" },
    authorCollege: { type: String, default: "" },
  },
  { timestamps: true }
);

projectSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => { ret.id = ret._id.toString(); delete ret._id; },
});

const User    = mongoose.models.User    || mongoose.model("User",    userSchema);
const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);

// ── DB MIDDLEWARE ─────────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("DB connection error:", err.message);
    res.status(503).json({ error: "Database unavailable: " + err.message });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.use(express.static(path.join(__dirname, "../public")));
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "name, email and password required" });
    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ error: "Email already registered" });

    const AVATARS = ["🧑‍💻","👩‍💻","🧑‍🔬","👩‍🔬","🧑‍🎨","👨‍🎨","🧑‍🚀","👩‍🚀","🧑‍🏫","👩‍🏫"];
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const user = await User.create({ name, email, passwordHash: hashPassword(password), avatar });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password required" });

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user)
      return res.status(404).json({ error: "No account found with that email" });

    if (user.passwordHash !== hashPassword(password))
      return res.status(401).json({ error: "Incorrect password" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── USERS ─────────────────────────────────────────────────────────────────────
app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch("/api/users/:id", async (req, res) => {
  try {
    const allowed = ["name","role","college","year","bio","skills","interests","avatar","lookingFor"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/users/:id/matches", async (req, res) => {
  try {
    const me = await User.findById(req.params.id);
    if (!me) return res.status(404).json({ error: "User not found" });

    const others = await User.find({ _id: { $ne: me._id } });
    const mySkillSet = new Set(me.skills);

    const scored = others.map((u) => {
      let score = 0;
      const sharedInterests = me.interests.filter(i => u.interests.includes(i));
      score += sharedInterests.length * 20;
      const complementary = u.skills.filter(s => !mySkillSet.has(s));
      score += Math.min(complementary.length * 8, 40);
      const overlap = u.skills.filter(s => mySkillSet.has(s));
      score += Math.min(overlap.length * 5, 20);
      if (me.college && u.college && me.college === u.college) score += 10;
      return { ...u.toJSON(), matchPercentage: Math.min(score, 99), sharedInterests };
    });

    scored.sort((a, b) => b.matchPercentage - a.matchPercentage);
    res.json(scored);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PROJECTS ──────────────────────────────────────────────────────────────────
app.get("/api/projects", async (req, res) => {
  try {
    const { tech, interest } = req.query;
    let projects = await Project.find().sort({ createdAt: -1 }).lean();
    if (tech && tech !== "All")
      projects = projects.filter(p => p.stack.some(s => s.toLowerCase().includes(tech.toLowerCase())));
    if (interest && interest !== "All")
      projects = projects.filter(p => p.interests.some(i => i.toLowerCase().includes(interest.toLowerCase())));
    res.json(projects);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { title, description, stack, interests, difficulty, teamSize, duration, authorId } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });

    let authorName = "", authorCollege = "";
    if (authorId) {
      const author = await User.findById(authorId).catch(() => null);
      if (author) { authorName = author.name; authorCollege = author.college; }
    }

    const project = await Project.create({
      title, description: description || "", stack: stack || [],
      interests: interests || [], difficulty: difficulty || "Intermediate",
      teamSize: teamSize || 4, duration: duration || "4 weeks",
      author: authorId || null, authorName, authorCollege,
    });
    res.status(201).json(project);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// ── LOCAL DEV ─────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`PartnerForge running on :${PORT}`));
}

module.exports = app;
