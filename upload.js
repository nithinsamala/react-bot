const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const uploadRouter = express.Router();

/* =========================
   FILE METADATA SCHEMA
========================= */
const uploadedFileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  contentType: String,
  size: Number,
  uploadedBy: String,
  uploadedAt: { type: Date, default: Date.now }
});

/* ✅ SAFE MODEL CREATION */
const UploadedFile =
  mongoose.models.UploadedFile ||
  mongoose.model("UploadedFile", uploadedFileSchema);

/* =========================
   AUTH MIDDLEWARE
========================= */
const uploadAuth = (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
};

/* =========================
   MULTER STORAGE
========================= */
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain"
    ];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("File type not allowed"));
  }
});

/* =========================
   UPLOAD FILE
========================= */
uploadRouter.post(
  "/upload",
  uploadAuth,
  upload.single("file"),
  async (req, res) => {
    if (!req.file)
      return res.status(400).json({ message: "No file uploaded" });

    const file = await UploadedFile.create({
      filename: req.file.filename,
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
      size: req.file.size,
      uploadedBy: req.userId
    });

    res.json({
      success: true,
      file,
      downloadUrl: `/uploads/${file.filename}`
    });
  }
);

/* =========================
   GET USER FILES
========================= */
uploadRouter.get("/files", uploadAuth, async (req, res) => {
  const files = await UploadedFile.find({ uploadedBy: req.userId })
    .sort({ uploadedAt: -1 });

  res.json({ success: true, files });
});

/* =========================
   DELETE FILE
========================= */
uploadRouter.delete("/files/:id", uploadAuth, async (req, res) => {
  const file = await UploadedFile.findOne({
    _id: req.params.id,
    uploadedBy: req.userId
  });

  if (!file)
    return res.status(404).json({ message: "File not found" });

  const filePath = path.join("uploads", file.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await file.deleteOne();
  res.json({ success: true });
});

module.exports = uploadRouter;
