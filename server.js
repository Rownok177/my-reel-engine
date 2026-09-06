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

const DEFAULT_FALLBACK_VIDEO = "https://raw.githubusercontent.com/remotion-dev/template-helloworld/main/public/video.mp4";
const bundleLocation = path.join(__dirname, "build");

app.use(cors());
app.use(express.json({ limit: "100mb" }));

process.on("uncaughtException", (err) => {
  console.error("[Fatal Uncaught Exception]:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection]:", reason);
});

const s3Client = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

const uploadDir = path.join(os.tmpdir(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 },
});

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

// Pre-flight check for external media URLs
async function validateMediaUrl(url) {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (response.ok) return { valid: true, status: response.status };

    // Fallback to ranged GET if server rejects HEAD requests
    const getResponse = await fetch(url, {
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(5000),
    });
    return { valid: getResponse.ok, status: getResponse.status };
  } catch (err) {
    return { valid: false, status: err.name === "TimeoutError" ? 408 : 500, error: err.message };
  }
}

app.get("/", (req, res) => {
  res.status(200).send("Cloud Video Render Engine Server is Running!");
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Remotion render engine active" });
});

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

app.post("/render", async (req, res) => {
  let tempOutputPath = null;

  try {
    const { composition = "MainReel", props, propsPath, outputPath } = req.body;

    if (!composition || (!props && !propsPath)) {
      return res.status(400).json({
        error: "Missing required parameters",
        required: ["composition", "props OR propsPath"],
        received: req.body,
      });
    }

    let sanitizedProps = props ? cleanMarkdownUrls(props) : {};
    const warnings = [];

    // Pre-flight check for videoUrl prop
    if (sanitizedProps.videoUrl && typeof sanitizedProps.videoUrl === "string") {
      console.log(`[Pre-Flight Check]: Validating media asset ${sanitizedProps.videoUrl}...`);
      const validation = await validateMediaUrl(sanitizedProps.videoUrl);

      if (!validation.valid) {
        console.warn(`[Pre-Flight Warning]: Asset unreachable (HTTP ${validation.status}). Swapping to default fallback URL.`);
        warnings.push({
          type: "ASSET_SUBSTITUTED",
          originalUrl: sanitizedProps.videoUrl,
          reason: `HTTP ${validation.status}`,
          fallbackUrl: DEFAULT_FALLBACK_VIDEO,
        });
        sanitizedProps.videoUrl = DEFAULT_FALLBACK_VIDEO;
      }
    }

    const outputFilename = outputPath ? path.basename(outputPath) : `render_${Date.now()}.mp4`;
    tempOutputPath = path.join(os.tmpdir(), outputFilename);

    console.log(`[Render Engine]: Selecting composition "${composition}"...`);
    const compositionMeta = await selectComposition({
      serveUrl: bundleLocation,
      id: composition,
      inputProps: sanitizedProps,
    });

    console.log(`[Render Engine]: Rendering video frames...`);
    let lastLoggedProgress = 0;

    await renderMedia({
      composition: compositionMeta,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: tempOutputPath,
      inputProps: sanitizedProps,
      concurrency: 1,
      jpegQuality: 80,
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
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--single-process",
          "--no-zygote",
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
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    console.error("[Render Error]:", error);
    return res.status(422).json({
      error: "Remotion render failed",
      errorType: "RENDER_EXECUTION_ERROR",
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

app.listen(PORT, HOST, () => {
  console.log(`🚀 [Server] Running on http://${HOST}:${PORT}`);
  console.log(`☁️ [Server] Cloud Storage: ${process.env.S3_BUCKET_NAME}\n`);
});