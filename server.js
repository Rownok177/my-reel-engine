require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cors = require("cors");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { bundle } = require("@remotion/bundler");
const { renderMedia, selectComposition } = require("@remotion/renderer");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));

// Initialize S3 / Cloud Storage Client (Cloudflare R2)
const s3Client = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

// Configure Multer for In-Memory Buffer Processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

// Helper: Strips markdown link syntax [url](url) -> url
function cleanMarkdownUrls(obj) {
  if (typeof obj === "string") {
    let cleaned = obj.replace(/\[(https?:\/\/[^\]]+)\]\([^\)]+\)/g, "$1");
    const match = cleaned.match(/https?:\/\/[^\s\)\"]+/);
    return match ? match[0] : cleaned;
  } else if (Array.isArray(obj)) {
    return obj.map(cleanMarkdownUrls);
  } else if (obj !== null && typeof obj === "object") {
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = cleanMarkdownUrls(obj[key]);
    }
    return result;
  }
  return obj;
}

// Health check endpoints for Render cold-start polling
app.get("/", (req, res) => {
  res.status(200).send("Cloud Video Render Engine Server is Running!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Remotion render engine active" });
});

// 1. Direct Cloud Upload Endpoint
app.post("/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No video file provided" });
    }

    const sanitizedName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `raw-uploads/${Date.now()}_${sanitizedName}`;

    console.log(`[Cloud Upload Start]: Uploading ${req.file.originalname} to R2 bucket...`);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filename,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || "video/mp4",
      })
    );

    const publicDomain = (process.env.S3_PUBLIC_DOMAIN || "").replace(/\/$/, "");
    const mediaUrl = `${publicDomain}/${filename}`;

    console.log(`[Cloud Upload Success]: ${mediaUrl}`);

    return res.json({
      success: true,
      fileName: filename,
      originalName: req.file.originalname,
      mediaUrl: mediaUrl,
    });
  } catch (error) {
    console.error("[Cloud Upload Error]:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Programmatic Cloud Render Endpoint
app.post("/render", async (req, res) => {
  let tempOutputPath = null;

  try {
    const { entryPoint, composition, props, propsPath, outputPath } = req.body;

    if (!composition || (!props && !propsPath)) {
      return res.status(400).json({
        error: "Missing required parameters",
        required: ["composition", "props OR propsPath"],
        received: req.body,
      });
    }

    // Sanitize incoming props and URLs
    let sanitizedProps = props ? cleanMarkdownUrls(props) : {};

    const entryFile = entryPoint ? path.resolve(entryPoint) : path.join(__dirname, "src/index.ts");
    const outputFilename = outputPath ? path.basename(outputPath) : `render_${Date.now()}.mp4`;

    tempOutputPath = path.join(os.tmpdir(), outputFilename);

    console.log(`[Render Engine]: Bundling Remotion project from ${entryFile}...`);
    const bundled = await bundle({
      entryPoint: entryFile,
    });

    console.log(`[Render Engine]: Selecting composition "${composition}"...`);
    const compositionMeta = await selectComposition({
      serveUrl: bundled,
      id: composition,
      inputProps: sanitizedProps,
    });

    console.log(`[Render Engine]: Rendering video frames...`);
    await renderMedia({
      composition: compositionMeta,
      serveUrl: bundled,
      codec: "h264",
      outputLocation: tempOutputPath,
      inputProps: sanitizedProps,
    });

    console.log(`[Render Engine]: Uploading rendered MP4 to Cloudflare R2...`);
    const cloudRenderKey = `renders/${Date.now()}_${outputFilename}`;
    const fileStream = fs.createReadStream(tempOutputPath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: cloudRenderKey,
        Body: fileStream,
        ContentType: "video/mp4",
      })
    );

    const publicDomain = (process.env.S3_PUBLIC_DOMAIN || "").replace(/\/$/, "");
    const mediaUrl = `${publicDomain}/${cloudRenderKey}`;

    console.log(`[Render Success]: ${mediaUrl}`);

    return res.json({
      success: true,
      message: "Render completed successfully",
      mediaUrl: mediaUrl,
    });
  } catch (error) {
    console.error("[Render Error]:", error);
    return res.status(500).json({
      error: "Remotion render failed",
      details: error.message,
    });
  } finally {
    // Cleanup temporary files from OS temp directory
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try {
        fs.unlinkSync(tempOutputPath);
      } catch (err) {
        console.warn("[Cleanup Warning]: Could not delete temp render file:", err.message);
      }
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 [Server] Running on http://localhost:${PORT}`);
  console.log(`☁️ [Server] Cloud Storage: ${process.env.S3_BUCKET_NAME}\n`);
});