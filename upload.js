const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const router = express.Router();

/* =========================
   SCHEMA
========================= */
const uploadedFileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  uploadedBy: String,
  uploadedAt: { type: Date, default: Date.now }
});

const UploadedFile =
  mongoose.models.UploadedFile ||
  mongoose.model("UploadedFile", uploadedFileSchema);

/* =========================
   AUTH MIDDLEWARE
========================= */
const auth = (req, res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

/* =========================
   UPLOAD DIRECTORY
========================= */
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

/* =========================
   MULTER CONFIG
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "text/plain",
      "image/png",
      "image/jpeg"
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("File type not allowed"));
    }

    cb(null, true);
  }
});

/* =========================
   ROUTES
========================= */

/**
 * Upload File
 * POST /api/uploads/upload
 */
router.post("/upload", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const file = await UploadedFile.create({
      filename: req.file.filename,
      originalName: req.file.originalname,
      uploadedBy: req.userId
    });

    res.json({
      success: true,
      file,
      downloadUrl: `/uploads/${file.filename}`
    });
  } catch (err) {
    console.error("❌ Upload Error:", err.message);
    res.status(500).json({ message: "File upload failed" });
  }
});

/**
 * Get User Files
 * GET /api/uploads/files
 */
router.get("/files", auth, async (req, res) => {
  const files = await UploadedFile.find({ uploadedBy: req.userId })
    .sort({ uploadedAt: -1 });

  res.json({ success: true, files });
});

/**
 * Delete File
 * DELETE /api/uploads/files/:id
 */
router.delete("/files/:id", auth, async (req, res) => {
  try {
    const file = await UploadedFile.findOne({
      _id: req.params.id,
      uploadedBy: req.userId
    });

    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    fs.unlinkSync(path.join(UPLOAD_DIR, file.filename));
    await file.deleteOne();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
