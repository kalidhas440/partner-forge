if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ── CACHED DB CONNECTION ──────────────────────────────────────────────────────
let cachedConn = null;
async function connectDB() {
  if (cachedConn && mongoose.connection.readyState === 1) return cachedConn;
  cachedConn = await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  return cachedConn;
}

// ── SCHEMAS ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, default: "" },
    college: { type: String, default: "" },
    year: { type: String, default: "" },
    bio: { type: String, default: "" },
    skills: { type: [String], default: [] },
    interests: { type: [String], default: [] },
    avatar: { type: String, default: "🧑‍💻" },
    lookingFor: { type: String, default: "partners" },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  virtuals: true, versionKey: false,
  transform: (_, ret) => { ret.id = ret._id.toString(); delete ret._id; },
});

const projectSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    stack: { type: [String], default: [] },
    interests: { type: [String], default: [] },
    difficulty: { type: String, default: "Intermediate" },
    teamSize: { type: Number, default: 4 },
    membersCount: { type: Number, default: 1 },
    duration: { type: String, default: "4 weeks" },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    authorName: { type: String, default: "" },
    authorCollege: { type: String, default: "" },
  },
  { timestamps: true }
);

projectSchema.set("toJSON", {
  virtuals: true, versionKey: false,
  transform: (_, ret) => { ret.id = ret._id.toString(); delete ret._id; },
});

const User    = mongoose.models.User    || mongoose.model("User",    userSchema);
const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);

// ── CONNECT MIDDLEWARE ────────────────────────────────────────────────────────
app.use(async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) { res.status(503).json({ error: "Database unavailable" }); }
});

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: "name and email required" });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "Email already registered", user: existing });
    const AVATARS = ["🧑‍💻","👩‍💻","🧑‍🔬","👩‍🔬","🧑‍🎨","👨‍🎨","🧑‍🚀","👩‍🚀","🧑‍🏫","👩‍🏫"];
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const user = await User.create({ name, email, avatar });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "No account found with that email" });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
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
      const author = await User.findById(authorId);
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

app.use((err, _req, res, _next) => { res.status(500).json({ error: "Internal server error" }); });

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Running on :${PORT}`));
}
