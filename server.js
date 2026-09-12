const path = require("path");

// ============================================================
// LOAD .ENV FROM src/.env
// ============================================================

require("dotenv").config({
  path: path.join(__dirname, "src", ".env"),
});

// ============================================================
// ENVIRONMENT CHECK
// ============================================================

console.log("==============================================");
console.log("[ENV CHECK] Loading configuration...");
console.log(
  "[ENV CHECK] S3_BUCKET_NAME:",
  process.env.S3_BUCKET_NAME || "MISSING"
);
console.log(
  "[ENV CHECK] S3_ENDPOINT:",
  process.env.S3_ENDPOINT ? "SET" : "MISSING"
);
console.log(
  "[ENV CHECK] S3_ACCESS_KEY_ID:",
  process.env.S3_ACCESS_KEY_ID ? "SET" : "MISSING"
);
console.log(
  "[ENV CHECK] S3_SECRET_ACCESS_KEY:",
  process.env.S3_SECRET_ACCESS_KEY ? "SET" : "MISSING"
);
console.log(
  "[ENV CHECK] S3_PUBLIC_DOMAIN:",
  process.env.S3_PUBLIC_DOMAIN ? "SET" : "MISSING"
);
console.log("==============================================");

// ============================================================
// IMPORTS
// ============================================================

const express = require("express");
const fs = require("fs");
const os = require("os");
const cors = require("cors");
const multer = require("multer");

const {
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const {
  renderMedia,
  selectComposition,
} = require("@remotion/renderer");

// ============================================================
// APP CONFIGURATION
// ============================================================

const app = express();

const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

const bundleLocation = path.join(__dirname, "build");

const renderProgress = new Map();

// ============================================================
// EXPRESS MIDDLEWARE
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: "100mb",
  })
);

// ============================================================
// ERROR HANDLERS
// ============================================================

process.on("uncaughtException", (err) => {
  console.error("[Fatal Uncaught Exception]:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Unhandled Rejection]:", reason);
});

// ============================================================
// CLOUD STORAGE CONFIGURATION
// Cloudflare R2 / S3-compatible storage
// ============================================================

const s3Client = new S3Client({
  region: process.env.S3_REGION || "auto",

  endpoint: process.env.S3_ENDPOINT,

  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  },
});

// ============================================================
// R2 CONFIGURATION VALIDATION
// ============================================================

if (!process.env.S3_BUCKET_NAME) {
  console.error(
    "[R2 CONFIG ERROR] S3_BUCKET_NAME is missing."
  );
}

if (!process.env.S3_ENDPOINT) {
  console.error(
    "[R2 CONFIG ERROR] S3_ENDPOINT is missing."
  );
}

if (!process.env.S3_ACCESS_KEY_ID) {
  console.error(
    "[R2 CONFIG ERROR] S3_ACCESS_KEY_ID is missing."
  );
}

if (!process.env.S3_SECRET_ACCESS_KEY) {
  console.error(
    "[R2 CONFIG ERROR] S3_SECRET_ACCESS_KEY is missing."
  );
}

if (!process.env.S3_PUBLIC_DOMAIN) {
  console.error(
    "[R2 CONFIG ERROR] S3_PUBLIC_DOMAIN is missing."
  );
}

// ============================================================
// MULTER CONFIGURATION
// ============================================================

const uploadDir = path.join(
  os.tmpdir(),
  "uploads"
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true,
  });
}

// Serve local uploaded files if required.
app.use(
  "/uploads",
  express.static(uploadDir)
);

const upload = multer({
  dest: uploadDir,

  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

// ============================================================
// HELPER: CLEAN MARKDOWN URLS
// ============================================================

function cleanMarkdownUrls(obj) {
  if (typeof obj === "string") {
    return obj.replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      "$2"
    );
  }

  if (Array.isArray(obj)) {
    return obj.map(cleanMarkdownUrls);
  }

  if (
    obj !== null &&
    typeof obj === "object"
  ) {
    const result = {};

    for (const key of Object.keys(obj)) {
      result[key] = cleanMarkdownUrls(obj[key]);
    }

    return result;
  }

  return obj;
}

// ============================================================
// HELPER: UNWRAP PROXY URL
// ============================================================

function unwrapProxyUrl(rawUrl) {
  if (
    !rawUrl ||
    typeof rawUrl !== "string"
  ) {
    return rawUrl;
  }

  let url = rawUrl.trim();
  let prev = "";

  while (url !== prev) {
    prev = url;

    try {
      url = decodeURIComponent(url);
    } catch {
      // Keep the current value if decoding fails.
    }

    const match = url.match(
      /(?:proxy-video\?url=|proxy\?src=)(https?:\/\/[^\s&]+)/i
    );

    if (match && match[1]) {
      url = match[1].trim();
    }
  }

  // Rewrite Docker hostname for local Chromium.
  if (
    url.includes("host.docker.internal")
  ) {
    url = url.replace(
      /host\.docker\.internal/g,
      "localhost"
    );
  }

  return url;
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/", (req, res) => {
  res
    .status(200)
    .send(
      "Cloud Video Render Engine Server is Running!"
    );
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Remotion render engine active",
  });
});

app.get("/render-progress/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const progressEntry = renderProgress.get(sessionId);

  if (!progressEntry) {
    console.log(
      `[Render Progress API] sessionId=${sessionId} progress=0 status=not_found`
    );

    return res.status(200).json({
      success: false,
      sessionId,
      progress: 0,
      status: "not_found",
      mediaUrl: null,
      error: null,
    });
  }

  console.log(
    `[Render Progress API] sessionId=${sessionId} progress=${progressEntry.progress} status=${progressEntry.status}`
  );

  return res.status(200).json({
    success: true,
    sessionId,
    progress: progressEntry.progress,
    status: progressEntry.status,
    mediaUrl: progressEntry.mediaUrl,
    error: progressEntry.error,
  });
});

// ============================================================
// 1. UPLOAD VIDEO
// ============================================================

app.post(
  "/upload",
  upload.single("video"),
  async (req, res) => {
    let tempFilePath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No video file provided",
        });
      }

      // Validate R2 configuration.
      if (!process.env.S3_BUCKET_NAME) {
        return res.status(500).json({
          success: false,
          error: "R2 configuration error",
          details:
            "S3_BUCKET_NAME is not configured.",
        });
      }

      if (!process.env.S3_ENDPOINT) {
        return res.status(500).json({
          success: false,
          error: "R2 configuration error",
          details:
            "S3_ENDPOINT is not configured.",
        });
      }

      const sanitizedName =
        req.file.originalname.replace(
          /[^a-zA-Z0-9.-]/g,
          "_"
        );

      const filename =
        `raw-uploads/${Date.now()}_${sanitizedName}`;

      console.log(
        `[Cloud Upload Start]: Uploading ${req.file.originalname} to bucket...`
      );

      const fileStream =
        fs.createReadStream(tempFilePath);

      await s3Client.send(
        new PutObjectCommand({
          Bucket:
            process.env.S3_BUCKET_NAME,

          Key: filename,

          Body: fileStream,

          ContentType:
            req.file.mimetype ||
            "video/mp4",
        })
      );

      const publicDomain =
        (
          process.env.S3_PUBLIC_DOMAIN ||
          ""
        ).replace(/\/$/, "");

      if (!publicDomain) {
        throw new Error(
          "S3_PUBLIC_DOMAIN is not configured."
        );
      }

      const mediaUrl =
        `${publicDomain}/${filename}`;

      console.log(
        `[Cloud Upload Success]: ${mediaUrl}`
      );

      return res.json({
        success: true,

        fileName: filename,

        originalName:
          req.file.originalname,

        mediaUrl,

        videoUrl: mediaUrl,
      });

    } catch (error) {
      console.error(
        "[Cloud Upload Error]:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message,
      });

    } finally {
      if (
        tempFilePath &&
        fs.existsSync(tempFilePath)
      ) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (err) {
          console.warn(
            "[Upload Cleanup Warning]: Could not delete temp file:",
            err.message
          );
        }
      }
    }
  }
);

// ============================================================
// 2. RENDER VIDEO
// ============================================================

app.post(
  "/render",
  async (req, res) => {

    // Allow render requests to remain open
    // for up to 15 minutes.
    req.setTimeout(900000);

    let tempOutputPath = null;
    let sessionId = null;

    try {

      // ======================================================
      // 1. VALIDATE R2 CONFIGURATION
      // Do this BEFORE spending time rendering.
      // ======================================================

      if (!process.env.S3_BUCKET_NAME) {
        console.error(
          "[Render Error]: S3_BUCKET_NAME is missing."
        );

        return res.status(500).json({
          success: false,
          error: "R2 configuration error",
          details:
            "S3_BUCKET_NAME is not configured.",
        });
      }

      if (!process.env.S3_ENDPOINT) {
        console.error(
          "[Render Error]: S3_ENDPOINT is missing."
        );

        return res.status(500).json({
          success: false,
          error: "R2 configuration error",
          details:
            "S3_ENDPOINT is not configured.",
        });
      }

      if (!process.env.S3_ACCESS_KEY_ID) {
        console.error(
          "[Render Error]: S3_ACCESS_KEY_ID is missing."
        );

        return res.status(500).json({
          success: false,
          error: "R2 configuration error",
          details:
            "S3_ACCESS_KEY_ID is not configured.",
        });
      }

      if (!process.env.S3_SECRET_ACCESS_KEY) {
        console.error(
          "[Render Error]: S3_SECRET_ACCESS_KEY is missing."
        );

        return res.status(500).json({
          success: false,
          error: "R2 configuration error",
          details:
            "S3_SECRET_ACCESS_KEY is not configured.",
        });
      }

      // ======================================================
      // 2. READ REQUEST
      // ======================================================

      const {
        composition = "MainReel",
        props,
        outputPath,
      } = req.body;

      // ======================================================
      // 3. PARSE PROPS
      // ======================================================

      let parsedProps = props;

      if (
        typeof props === "string"
      ) {
        try {
          parsedProps =
            JSON.parse(props);
        } catch (error) {
          console.warn(
            "[Render Engine]: Failed to parse stringified props."
          );
        }
      }

      let sanitizedProps =
        parsedProps
          ? cleanMarkdownUrls(
              parsedProps
            )
          : {};
                // ======================================================
      // 4. GET VIDEO URL
      // ======================================================

      const rawVideoUrl =
        sanitizedProps.videoUrl ||
        sanitizedProps.mediaUrl ||
        req.body.videoUrl ||
        req.body.mediaUrl;

      const videoUrl =
        unwrapProxyUrl(
          rawVideoUrl
        );

      if (!videoUrl) {
        return res.status(400).json({
          success: false,
          error: "Missing videoUrl",
          details:
            "Please provide videoUrl or mediaUrl in props or request body.",
        });
      }

      if (
        !/^https?:\/\//i.test(
          videoUrl
        )
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid videoUrl",
          details:
            "Render requires a public HTTP/HTTPS video URL.",
        });
      }

      // Prevent browser blob URLs from reaching Remotion.
      if (
        /^blob:/i.test(videoUrl)
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid videoUrl",
          details:
            "Browser blob URLs cannot be rendered. Use the permanent R2 HTTPS URL.",
        });
      }

      // ======================================================
      // 5. PARSE OVERLAYS
      // ======================================================

      let rawOverlays =
        sanitizedProps.overlays ||
        req.body.overlays ||
        sanitizedProps.popups ||
        req.body.plan?.popups;

      if (
        typeof rawOverlays === "string"
      ) {
        try {
          rawOverlays =
            JSON.parse(
              rawOverlays
            );
        } catch (error) {
          console.warn(
            "[Render Engine]: Failed to parse overlays."
          );

          rawOverlays = [];
        }
      }

      if (
        !Array.isArray(
          rawOverlays
        )
      ) {
        rawOverlays = [];
      }

      // ======================================================
      // 6. DIAGNOSTIC
      // SHOW EXACT POPUPS RECEIVED BY RENDER ENGINE
      // ======================================================

      console.log("\n==============================================");
      console.log(
        "[DIAGNOSTIC] /render request received"
      );

      console.log(
        "[DIAGNOSTIC] action:",
        req.body?.action || "N/A"
      );

      console.log(
        "[DIAGNOSTIC] sessionId:",
        req.body?.sessionId ||
          sanitizedProps.sessionId ||
          "N/A"
      );

      console.log(
        "[DIAGNOSTIC] videoUrl:",
        sanitizedProps.videoUrl ||
          sanitizedProps.mediaUrl ||
          req.body?.videoUrl ||
          req.body?.mediaUrl ||
          "N/A"
      );

      console.log(
        "[DIAGNOSTIC] body overlays:",
        Array.isArray(req.body?.overlays)
          ? req.body.overlays.length
          : typeof req.body?.overlays
      );

      console.log(
        "[DIAGNOSTIC] body popups:",
        Array.isArray(req.body?.popups)
          ? req.body.popups.length
          : typeof req.body?.popups
      );

      console.log(
        "[DIAGNOSTIC] props overlays:",
        Array.isArray(
          sanitizedProps?.overlays
        )
          ? sanitizedProps.overlays.length
          : typeof sanitizedProps?.overlays
      );

      console.log(
        "[DIAGNOSTIC] props popups:",
        Array.isArray(
          sanitizedProps?.popups
        )
          ? sanitizedProps.popups.length
          : typeof sanitizedProps?.popups
      );

      console.log(
        "[DIAGNOSTIC] EFFECTIVE popup/overlay count:",
        Array.isArray(rawOverlays)
          ? rawOverlays.length
          : "NOT AN ARRAY"
      );

      if (
        Array.isArray(rawOverlays)
      ) {
        rawOverlays.forEach(
          (popup, index) => {
            console.log(
              `[DIAGNOSTIC] Popup ${index + 1}:`,
              JSON.stringify({
                headline:
                  popup?.headline,

                subtext:
                  popup?.subtext,

                position:
                  popup?.position,

                start_time:
                  popup?.start_time,

                end_time:
                  popup?.end_time,

                start_frame:
                  popup?.start_frame,

                end_frame:
                  popup?.end_frame,

                duration_in_frames:
                  popup?.duration_in_frames,
              })
            );
          }
        );
      }

      console.log(
        "==============================================\n"
      );

      // ======================================================
      // 7. PREPARE REMOTION PROPS
      // ======================================================

      sanitizedProps.videoUrl =
        videoUrl;

      sanitizedProps.mediaUrl =
        videoUrl;

      sanitizedProps.overlays =
        rawOverlays;

      // IMPORTANT:
      // MainReel.tsx renders the `popups` prop,
      // not `overlays`.
      //
      // Keep both names synchronized so the
      // overlays received from n8n are actually
      // passed to Remotion.
      sanitizedProps.popups =
        rawOverlays;

      sanitizedProps.sessionId =
        sanitizedProps.sessionId ||
        req.body.sessionId ||
        `session_${Date.now()}`;

      sessionId = sanitizedProps.sessionId;

      renderProgress.set(sessionId, {
        progress: 0,
        status: "rendering",
        updatedAt: Date.now(),
        mediaUrl: null,
        error: null,
      });

      // ======================================================
      // 8. OUTPUT FILE
      // ======================================================

      const outputFilename =
        outputPath
          ? path.basename(
              outputPath
            )
          : `render_${Date.now()}.mp4`;

      tempOutputPath =
        path.join(
          os.tmpdir(),
          outputFilename
        );

      console.log(
        `[Render Engine]: Selecting composition "${composition}"...`
      );

      // ======================================================
      // 9. SELECT COMPOSITION
      // ======================================================

      const compositionMeta =
        await selectComposition({
          serveUrl:
            bundleLocation,

          id:
            composition,

          inputProps:
            sanitizedProps,
        });

      console.log(
        `[Render Engine]: Rendering frames for source video: ${sanitizedProps.videoUrl}`
      );

      // ======================================================
      // 10. RENDER WITH REMOTION
      // ======================================================

      let lastLoggedProgress = 0;

      await renderMedia({
        composition:
          compositionMeta,

        serveUrl:
          bundleLocation,

        codec:
          "h264",

        outputLocation:
          tempOutputPath,

        inputProps:
          sanitizedProps,

        concurrency:
          1,

        jpegQuality:
          70,

        onProgress: ({
          progress,
        }) => {

          const percent =
            Math.round(
              progress * 100
            );

          renderProgress.set(sessionId, {
            progress: percent,
            status: "rendering",
            updatedAt: Date.now(),
            mediaUrl: null,
            error: null,
          });

          if (
            percent >=
            lastLoggedProgress + 20
          ) {

            console.log(
              `[Render Progress]: ${percent}%`
            );

            lastLoggedProgress =
              percent;
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
            "--js-flags=--max-old-space-size=256",
          ],
        },
      });

      console.log(
        "[Render Engine]: Rendering finished successfully."
      );

      renderProgress.set(sessionId, {
        progress: 100,
        status: "uploading",
        updatedAt: Date.now(),
        mediaUrl: null,
        error: null,
      });

      // ======================================================
      // 11. VERIFY OUTPUT FILE
      // ======================================================

      if (
        !fs.existsSync(
          tempOutputPath
        )
      ) {
        throw new Error(
          `Rendered output file was not found: ${tempOutputPath}`
        );
      }

      const outputStats =
        fs.statSync(
          tempOutputPath
        );

      console.log(
        `[Render Engine]: Output file size: ${outputStats.size} bytes`
      );

      if (
        outputStats.size === 0
      ) {
        throw new Error(
          "Rendered output file is empty."
        );
      }
            // ======================================================
      // 12. UPLOAD RENDERED VIDEO TO R2
      // ======================================================

      console.log(
        "[Render Engine]: Uploading rendered MP4 to storage..."
      );

      const cloudRenderKey =
        `renders/${Date.now()}_${outputFilename}`;

      const fileStream =
        fs.createReadStream(
          tempOutputPath
        );

      await s3Client.send(
        new PutObjectCommand({
          Bucket:
            process.env.S3_BUCKET_NAME,

          Key:
            cloudRenderKey,

          Body:
            fileStream,

          ContentType:
            "video/mp4",
        })
      );

      // ======================================================
      // 13. CREATE PUBLIC URL
      // ======================================================

      const publicDomain =
        (
          process.env.S3_PUBLIC_DOMAIN ||
          ""
        ).replace(/\/$/, "");

      if (!publicDomain) {
        throw new Error(
          "S3_PUBLIC_DOMAIN is not configured."
        );
      }

      const mediaUrl =
        `${publicDomain}/${cloudRenderKey}`;

      console.log(
        `[Render Success]: ${mediaUrl}`
      );

      renderProgress.set(sessionId, {
        progress: 100,
        status: "completed",
        updatedAt: Date.now(),
        mediaUrl,
        error: null,
      });

      setTimeout(() => {
        renderProgress.delete(sessionId);
      }, 30 * 60 * 1000);

      // ======================================================
      // 14. RETURN RESULT TO N8N
      // ======================================================

      return res.json({
        success: true,

        message:
          "Render completed successfully",

        mediaUrl,

        renderedVideoUrl:
          mediaUrl,

        fileName:
          cloudRenderKey,

        sessionId:
          sanitizedProps.sessionId,
      });

    } catch (error) {

      console.error(
        "[Render Error]:",
        error
      );

      if (sessionId) {
        const previousProgress =
          renderProgress.get(sessionId)?.progress || 0;

        renderProgress.set(sessionId, {
          progress: previousProgress,
          status: "failed",
          updatedAt: Date.now(),
          mediaUrl: null,
          error: error.message || String(error),
        });

        setTimeout(() => {
          renderProgress.delete(sessionId);
        }, 30 * 60 * 1000);
      }

      return res.status(500).json({
        success: false,

        error:
          "Remotion render failed",

        details:
          error.message ||
          String(error),
      });

    } finally {

      // ======================================================
      // 15. CLEAN TEMPORARY FILE
      // ======================================================

      if (
        tempOutputPath &&
        fs.existsSync(
          tempOutputPath
        )
      ) {
        try {

          fs.unlinkSync(
            tempOutputPath
          );

          console.log(
            "[Cleanup]: Temporary render file deleted."
          );

        } catch (error) {

          console.warn(
            "[Cleanup Warning]: Could not delete temporary render file:",
            error.message
          );
        }
      }
    }
  }
);

// ============================================================
// START SERVER
// ============================================================

const server =
  app.listen(
    PORT,
    HOST,
    () => {

      console.log(
        `🚀 [Server] Running on http://${HOST}:${PORT}`
      );

      console.log(
        `☁️ [Server] Cloud Storage: ${
          process.env.S3_BUCKET_NAME ||
          "NOT CONFIGURED"
        }`
      );

      console.log(
        `📦 [Server] Remotion bundle: ${bundleLocation}`
      );
    }
  );

// ============================================================
// SERVER TIMEOUTS
// ============================================================

// 15 minutes for long Remotion renders.
server.timeout = 900000;

// Keep-alive connection timeout.
server.keepAliveTimeout = 120000;