require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// 1. DATABASE CONNECTION
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("DB Connection Error:", err));

// 2. DATA SCHEMAS (Replacing data.js)
const projectSchema = new mongoose.Schema({
  title: String,
  description: String,
  stack: [String],
  diffDots: {
    type: [String],
    default: ["#7c5cfc", "var(--border)", "var(--border)"],
  },
});

projectSchema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: function (doc, ret) { ret.id = ret._id; }
});

const userSchema = new mongoose.Schema({
  name: String,
  role: String,
  skills: [String],
  college: String,
});

const Project = mongoose.model("Project", projectSchema);
const User = mongoose.model("User", userSchema);

// 3. ROUTES (Original logic, now using async/await)

// Get projects with filtering
app.get("/api/projects", async (req, res) => {
  const { tech } = req.query;
  try {
    let projects = await Project.find();
    if (tech && tech !== "All") {
      projects = projects.filter((p) =>
        p.stack.some(
          (s) =>
            s.toLowerCase().includes(tech.toLowerCase()) ||
            (tech === "AI / LLM" && s.toLowerCase().includes("ai")),
        ),
      );
    }
    res.json(projects);
  } catch (err) {
    res.status(500).json(err);
  }
});

// Post a new project
app.post("/api/projects", async (req, res) => {
  try {
    const newProject = new Project(req.body);
    await newProject.save();
    res.status(201).json(newProject);
  } catch (err) {
    res.status(400).json(err);
  }
});

// Get potential partners
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json(err);
  }
});

// Calculate match percentage
app.post("/api/users/match", async (req, res) => {
  const { mySkills, projectId } = req.body;
  if (!mySkills || !projectId) {
    return res
      .status(400)
      .json({ error: "mySkills and projectId are required" });
  }
  try {
    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    let matchScore = 50;
    const commonSkills = project.stack.filter((s) => mySkills.includes(s));
    matchScore += commonSkills.length * 15;
    if (matchScore > 99) matchScore = 99;

    res.json({ matchPercentage: matchScore, project });
  } catch (err) {
    res.status(500).json(err);
  }
});

// FOR VERCEL
module.exports = app;
