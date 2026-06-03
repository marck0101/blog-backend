const express = require("express");
const router = express.Router();
const sharp = require("sharp");
const auth = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");
const admin = require("../config/firebase.admin");

router.post("/cover", auth, upload.single("cover"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhuma imagem enviada" });
    }

    if (!admin.apps.length) {
      return res.status(503).json({
        error: "Serviço de upload não disponível. Configure o Firebase Admin SDK.",
      });
    }

    const webpBuffer = await sharp(req.file.buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const bucket = admin.storage().bucket();
    const filename = `covers/${Date.now()}.webp`;

    const fileRef = bucket.file(filename);

    await fileRef.save(webpBuffer, {
      metadata: { contentType: "image/webp" },
    });

    await fileRef.makePublic();

    const url = `https://storage.googleapis.com/${bucket.name}/${filename}`;

    res.status(201).json({ url });
  } catch (err) {
    console.error("Upload error:", err);
    next(err);
  }
});

// Tratamento de erros do multer
router.use((err, req, res, next) => {
  console.error("Upload middleware error:", err.code, err.message);
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(422).json({ error: "Imagem muito grande. Máximo: 5MB" });
  }
  if (err.message?.includes("Formato inválido")) {
    return res.status(422).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
