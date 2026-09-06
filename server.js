require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const cors = require("cors");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { renderMedia, selectComposition } = require("@remotion/renderer");

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const bundleLocation = path.join(__dirname, "build");

app.use(cors());
app.use(express.json({ limit: "100mb" }));

process.on("uncaughtException", (err) => {
  console.error("[Fatal Uncaught Exception]:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection]:", reason);
});

// Initialize Cloud Storage Client (Cloudflare R2 / S3)
const s3Client = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

// Configure Multer for Disk Storage
const uploadDir = path.join(os.tmpdir(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

// Clean Markdown links [text](url) -> url
function cleanMarkdownUrls(obj) {
  if (typeof obj === "string") {
    return obj.replace(/\[(?:[^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1");
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

// Health check endpoints
app.get("/", (req, res) => {
  res.status(200).send("Cloud Video Render Engine Server is Running!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Remotion render engine active" });
});

// 1. Upload Video Endpoint (Receives file from UI)
app.post("/upload", upload.single("video"), async (req, res) => {
  let tempFilePath = req.file?.path;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No video file provided" });
    }

    const sanitizedName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filename = `raw-uploads/${Date.now()}_${sanitizedName}`;

    console.log(`[Cloud Upload Start]: Uploading ${req.file.originalname} to bucket...`);

    const fileStream = fs.createReadStream(tempFilePath);

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filename,
        Body: fileStream,
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
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.warn("[Upload Cleanup Warning]: Could not delete temp file:", err.message);
      }
    }
  }
});

// 2. Render Video Endpoint (Renders the uploaded video URL)
app.post("/render", async (req, res) => {
  // Extend request timeout to 5 minutes for heavy render jobs
  req.setTimeout(300000);

  let tempOutputPath = null;

  try {
    const { composition = "MainReel", props, propsPath, outputPath } = req.body;

    let sanitizedProps = props ? cleanMarkdownUrls(props) : {};

    // Fallback URL resolution: inspects props.videoUrl, props.mediaUrl, body.videoUrl, and body.mediaUrl
    const videoUrl =
      sanitizedProps.videoUrl ||
      sanitizedProps.mediaUrl ||
      req.body.videoUrl ||
      req.body.mediaUrl;

    if (!videoUrl) {
      return res.status(400).json({
        error: "Missing videoUrl in props",
        details: "Please provide videoUrl or mediaUrl in props or request body.",
        receivedBody: req.body,
      });
    }

    // Assign back to sanitizedProps so Remotion receives the parameter correctly
    sanitizedProps.videoUrl = videoUrl;

    const outputFilename = outputPath ? path.basename(outputPath) : `render_${Date.now()}.mp4`;
    tempOutputPath = path.join(os.tmpdir(), outputFilename);

    console.log(`[Render Engine]: Selecting composition "${composition}"...`);
    const compositionMeta = await selectComposition({
      serveUrl: bundleLocation,
      id: composition,
      inputProps: sanitizedProps,
    });

    console.log(`[Render Engine]: Rendering video frames for video: ${sanitizedProps.videoUrl}`);
    let lastLoggedProgress = 0;

    await renderMedia({
      composition: compositionMeta,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: tempOutputPath,
      inputProps: sanitizedProps,
      concurrency: 1, // Restrict to single thread to prevent Render RAM limit spikes (502 OOM)
      jpegQuality: 70, // Lower quality buffer to reduce memory footprint
      onProgress: ({ progress }) => {
        const percent = Math.round(progress * 100);
        if (percent >= lastLoggedProgress + 20) {
          console.log(`[Render Progress]: ${percent}%`);
          lastLoggedProgress = percent;
        }
      },
      chromiumOptions: {
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", // Force Chromium to use disk space (/tmp) instead of shared memory RAM
          "--disable-gpu",
          "--single-process",
          "--no-zygote",
          "--js-flags=--max-old-space-size=256", // Enforce maximum V8 heap size to keep memory within container limits
        ],
      },
    });

    console.log(`[Render Engine]: Uploading rendered MP4 to storage...`);
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
      details: error.message || String(error),
    });
  } finally {
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try {
        fs.unlinkSync(tempOutputPath);
      } catch (err) {
        console.warn("[Cleanup Warning]: Could not delete temp render file:", err.message);
      }
    }
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 [Server] Running on http://${HOST}:${PORT}`);
  console.log(`☁️ [Server] Cloud Storage: ${process.env.S3_BUCKET_NAME}\n`);
});

// Configure server socket timeouts to prevent 502/504 Bad Gateway dropouts during long renders
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 120000; // 2 minutes