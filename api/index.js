// Only load .env locally — Vercel injects env vars automatically
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// 1. CACHED DATABASE CONNECTION
//    Vercel spins up a new function instance on each cold start.
//    Without caching, every request opens a new MongoDB connection
//    and you'll quickly hit Atlas's connection limit.
// ─────────────────────────────────────────────
let cachedConnection = null;

async function connectDB() {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }
  cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
    // These options prevent connection pool exhaustion in serverless
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB Connected");
  return cachedConnection;
}

// ─────────────────────────────────────────────
// 2. SCHEMAS & MODELS
// ─────────────────────────────────────────────
const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  stack: [String],
  diffDots: {
    type: [String],
    default: ["#7c5cfc", "#2a2a3d", "#2a2a3d"],
  },
});

// Clean output: expose `id` as a plain string, drop `__v` and raw `_id`
projectSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
  },
});

const userSchema = new mongoose.Schema({
  name: String,
  role: String,
  skills: [String],
  college: String,
});

userSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
  },
});

// Prevent model re-compilation on hot reloads (common Vercel/Next error)
const Project =
  mongoose.models.Project || mongoose.model("Project", projectSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);

// ─────────────────────────────────────────────
// 3. MIDDLEWARE: connect DB before every request
// ─────────────────────────────────────────────
app.use(async (_req, _res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────
// 4. ROUTES
// ─────────────────────────────────────────────

// GET /api/projects?tech=React
app.get("/api/projects", async (req, res) => {
  const { tech } = req.query;
  try {
    let projects = await Project.find().lean();
    if (tech && tech !== "All") {
      const needle = tech.toLowerCase();
      projects = projects.filter((p) =>
        p.stack.some(
          (s) =>
            s.toLowerCase().includes(needle) ||
            (needle === "ai / llm" && s.toLowerCase().includes("ai"))
        )
      );
    }
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

// POST /api/projects
app.post("/api/projects", async (req, res) => {
  try {
    const { title, description, stack, diffDots } = req.body;
    if (!title) return res.status(400).json({ error: "title is required" });

    const project = await Project.create({ title, description, stack, diffDots });
    res.status(201).json(project);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Failed to create project", details: err.message });
  }
});

// GET /api/users
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().lean();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// POST /api/users/match  body: { mySkills: string[], projectId: string }
app.post("/api/users/match", async (req, res) => {
  const { mySkills, projectId } = req.body;
  if (!mySkills || !projectId) {
    return res.status(400).json({ error: "mySkills and projectId are required" });
  }
  try {
    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const commonSkills = project.stack.filter((s) => mySkills.includes(s));
    const matchPercentage = Math.min(50 + commonSkills.length * 15, 99);

    res.json({ matchPercentage, commonSkills, project });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Match calculation failed" });
  }
});

// ─────────────────────────────────────────────
// 5. GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Vercel needs a default export; local dev can still `node api/index.js`
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
