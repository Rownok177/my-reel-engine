// src/remotion/Composition.tsx
import React, { useEffect, useRef } from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  staticFile,
  delayRender,
  continueRender,
} from "remotion";

export type PopupTheme = "bold_clean" | "bangla_reel" | string;
export type HighlightColor = "green" | "red" | "blue" | "yellow" | string;

export interface PopupData {
  headline: string;
  badgeText?: string;
  theme?: PopupTheme;
  highlightColor?: HighlightColor;
  highlightText?: string;
  fontFamily?: string;
  position?:
    | "top"
    | "top-left"
    | "top-right"
    | "center"
    | "center-left"
    | "center-right"
    | "bottom"
    | "bottom-left"
    | "bottom-right"
    | string;
  animationType?: "bounce" | "slide" | "zoom-out" | "spring" | string;
  textColor?: string;
  bgColor?: string;
  borderColor?: string;
  start_time: number | string;
  end_time?: number | string;
  start_frame?: number;
  end_frame?: number;
  duration_in_frames?: number;
}

export interface MainReelProps extends Record<string, unknown> {
  videoUrl: string;
  popups: PopupData[];
}

export type MainCompositionProps = MainReelProps;

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;

// IMPORTANT:
// The current input/output in this project is already a 9:16 (1080x1920) canvas.
// The previous version used a ~3.18x transform on the whole video. That is wrong
// for a 1080x1920 input because it unnecessarily magnifies/crops the source.
// Keep the video at the reel canvas size and let the source's own framing stay intact.

// The supplied reel preview has a visible picture band in the middle, with black
// areas above/below it. All props are deliberately rendered inside this band.
// This prevents captions/cards from landing in the black area even when Gemini says
// "top" or "bottom".
const VIDEO_SAFE_TOP = "34%";
const VIDEO_SAFE_BOTTOM = "76%";

const HIGHLIGHT_COLORS: Record<string, string> = {
  green: "#B7F000",
  red: "#FF3B30",
  blue: "#28A9FF",
  yellow: "#FFD60A",
};

const FONT_CONFIG = {
  "Hind Siliguri": {
    family: "Hind Siliguri",
    src: staticFile("fonts/HindSiliguri-Bold.ttf"),
    weight: "700 900",
  },
  "Noto Sans Bengali": {
    family: "Noto Sans Bengali",
    src: staticFile("fonts/NotoSansBengali-VariableFont_wdth,wght.ttf"),
    weight: "100 900",
  },
  "Anek Bangla": {
    family: "Anek Bangla",
    src: staticFile("fonts/AnekBangla-VariableFont_wdth,wght.ttf"),
    weight: "100 900",
  },
} as const;

type SupportedFont = keyof typeof FONT_CONFIG;

function normalizeFontName(value?: string): SupportedFont {
  const name = String(value || "Hind Siliguri").trim();
  return name in FONT_CONFIG ? (name as SupportedFont) : "Hind Siliguri";
}

function getHighlightColor(value?: string): string {
  return (
    HIGHLIGHT_COLORS[String(value || "green").toLowerCase()] ||
    HIGHLIGHT_COLORS.green
  );
}

function parseTimeToSeconds(time: number | string | undefined): number {
  if (time === undefined || time === null) return 0;
  if (typeof time === "number") return Number.isFinite(time) ? time : 0;

  const value = String(time).trim();
  if (!value) return 0;

  if (value.includes(":")) {
    const parts = value.split(":").map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
      return parts[0] * 60 + parts[1];
    }
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function FontLoader() {
  const handleRef = useRef<number | null>(null);
  const [handle] = React.useState(() =>
    delayRender("Loading local caption fonts"),
  );

  useEffect(() => {
    handleRef.current = handle;
    let cancelled = false;

    const load = async () => {
      try {
        const entries = Object.values(FONT_CONFIG);
        for (const font of entries) {
          const face = new FontFace(font.family, `url("${font.src}")`, {
            weight: font.weight,
            style: "normal",
            display: "block",
          });
          const loaded = await face.load();
          document.fonts.add(loaded);
        }

        await Promise.all(
          entries.map((font) =>
            document.fonts.load(`800 56px "${font.family}"`),
          ),
        );
      } catch (error) {
        console.error("[Fonts] Failed to load local fonts:", error);
      } finally {
        if (!cancelled && handleRef.current !== null) {
          continueRender(handleRef.current);
          handleRef.current = null;
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return null;
}

function splitBanglaReelText(
  headline: string,
  requestedHighlight?: string,
): { before: string; highlight: string; after: string } {
  const text = String(headline || "").trim();
  if (!text) return { before: "", highlight: "", after: "" };

  const requested = String(requestedHighlight || "").trim();
  if (requested) {
    const textLower = text.toLocaleLowerCase();
    const requestedLower = requested.toLocaleLowerCase();
    const index = textLower.lastIndexOf(requestedLower);

    if (index >= 0) {
      return {
        before: text.slice(0, index),
        highlight: text.slice(index, index + requested.length),
        after: text.slice(index + requested.length),
      };
    }
  }

  return { before: text, highlight: "", after: "" };
}

function BanglaReelHeadline({ popup }: { popup: PopupData }) {
  const { before, highlight, after } = splitBanglaReelText(
    popup.headline,
    popup.highlightText,
  );
  const fontName = normalizeFontName(popup.fontFamily);
  const accent = getHighlightColor(popup.highlightColor);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        margin: 0,
        boxSizing: "border-box",
        fontFamily: `"${fontName}", sans-serif`,
        fontSize: 54,
        fontWeight: 800,
        lineHeight: 1.04,
        textAlign: "center",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        color: "#fff",
        textShadow:
          "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 12px rgba(0,0,0,.85)",
      }}
    >
      <span>{before}</span>
      {highlight ? (
        <span
          style={{
            color: accent,
            fontWeight: 900,
            fontSize: "1.18em",
            marginInline: "0.06em",
          }}
        >
          {highlight}
        </span>
      ) : null}
      {after ? <span>{after}</span> : null}
    </div>
  );
}

function getSafePositionStyle(position?: string): React.CSSProperties {
  const key = String(position || "center").trim();

  // Horizontal placement is preserved. Vertical placement is remapped to the
  // middle video-safe frame so overlays can NEVER enter the black letterbox area.
  switch (key) {
    case "top":
      return { position: "absolute", top: "5%", left: "50%", width: "90%" };
    case "top-left":
      return { position: "absolute", top: "5%", left: "5%", width: "90%" };
    case "top-right":
      return {
        position: "absolute",
        top: "5%",
        right: "5%",
        width: "90%",
        alignItems: "flex-end",
      };
    case "bottom":
      return {
        position: "absolute",
        bottom: "5%",
        left: "50%",
        width: "90%",
      };
    case "bottom-left":
      return { position: "absolute", bottom: "5%", left: "5%", width: "90%" };
    case "bottom-right":
      return {
        position: "absolute",
        bottom: "5%",
        right: "5%",
        width: "90%",
        alignItems: "flex-end",
      };
    case "center-left":
      return {
        position: "absolute",
        top: "47%",
        left: "5%",
        width: "90%",
        alignItems: "flex-start",
      };
    case "center-right":
      return {
        position: "absolute",
        top: "47%",
        right: "5%",
        width: "90%",
        alignItems: "flex-end",
      };
    case "center":
    default:
      return {
        position: "absolute",
        top: "47%",
        left: "50%",
        width: "90%",
      };
  }
}

const Popup: React.FC<{
  popup: PopupData;
  durationInFrames: number;
}> = ({ popup, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const safeDuration = Math.max(1, durationInFrames);
  const fadeFrames = Math.max(1, Math.min(6, Math.floor(safeDuration / 4)));
  const fadeOutStart = Math.max(fadeFrames, safeDuration - fadeFrames);

  const opacity = interpolate(
    frame,
    [0, fadeFrames, fadeOutStart, safeDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const animationType = popup.animationType || "bounce";
  let animationTransform = "scale(1)";

  if (animationType === "bounce" || animationType === "spring") {
    animationTransform = `scale(${spring({
      frame,
      fps,
      config: { damping: 12, stiffness: 110 },
    })})`;
  } else if (animationType === "zoom-out") {
    const scale = interpolate(frame, [0, fadeFrames], [1.12, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    animationTransform = `scale(${scale})`;
  } else if (animationType === "slide") {
    const y = interpolate(frame, [0, fadeFrames], [-24, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    animationTransform = `translateY(${y}px)`;
  }

  const theme = popup.theme === "bangla_reel" ? "bangla_reel" : "bold_clean";
  const fontName = normalizeFontName(popup.fontFamily);
  const isBanglaReel = theme === "bangla_reel";
  const accent = getHighlightColor(popup.highlightColor);
  const rawPosition = getSafePositionStyle(popup.position);
  const positionStyle: React.CSSProperties = { ...rawPosition };

  const isCentered =
    popup.position === "top" ||
    popup.position === "center" ||
    popup.position === "bottom" ||
    !popup.position;

  const textBox: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    overflow: "hidden",
    transform: animationTransform,
    transformOrigin: "center center",
    backgroundColor: isBanglaReel
      ? "transparent"
      : popup.bgColor || "rgba(15,23,42,.90)",
    border: isBanglaReel
      ? "none"
      : `2px solid ${popup.borderColor || accent}`,
    borderRadius: isBanglaReel ? 0 : 18,
    padding: isBanglaReel ? "4px 8px" : "14px 22px",
    boxShadow: isBanglaReel
      ? "none"
      : "0 12px 24px rgba(0,0,0,.40)",
  };

  return (
    <div
      style={{
        ...positionStyle,
        pointerEvents: "none",
        display: "flex",
        justifyContent: isCentered ? "center" : undefined,
        boxSizing: "border-box",
      }}
    >
      <div style={{ ...textBox, opacity }}>
        {popup.badgeText ? (
          <div
            style={{
              fontFamily: `"${fontName}", sans-serif`,
              fontSize: 14,
              fontWeight: 800,
              color: popup.borderColor || accent,
              marginBottom: 5,
              textAlign: "center",
              maxWidth: "100%",
            }}
          >
            {popup.badgeText}
          </div>
        ) : null}

        {isBanglaReel ? (
          <BanglaReelHeadline popup={popup} />
        ) : (
          <div
            style={{
              width: "100%",
              fontFamily: `"${fontName}", sans-serif`,
              fontSize: 48,
              fontWeight: 900,
              lineHeight: 1.08,
              color: popup.textColor || "#fff",
              textAlign: "center",
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {popup.headline}
          </div>
        )}
      </div>
    </div>
  );
};

export const MainReel: React.FC<MainReelProps> = ({ videoUrl, popups }) => {
  const { fps, width, height } = useVideoConfig();
  const safePopups = Array.isArray(popups) ? popups : [];
  const cleanUrl = String(videoUrl || "").trim();

  return (
    <AbsoluteFill
      style={{
        width: REEL_WIDTH,
        height: REEL_HEIGHT,
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      <FontLoader />

      {cleanUrl ? (
        <OffthreadVideo
          src={cleanUrl}
          onError={(err) =>
            console.warn("[Video] Failed to load source video:", err)
          }
          style={{
            position: "absolute",
            inset: 0,
            width: width || REEL_WIDTH,
            height: height || REEL_HEIGHT,
            objectFit: "cover",
            objectPosition: "50% 50%",
            display: "block",
          }}
        />
      ) : null}

      {/*
        Overlay clipping frame.
        This is the actual fix for the "props entering the black box" problem.
        Any popup that tries to go above or below this area is clipped away.
      */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: VIDEO_SAFE_TOP,
          height: `calc(${VIDEO_SAFE_BOTTOM} - ${VIDEO_SAFE_TOP})`,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        {safePopups.map((popup, index) => {
          const startSec = parseTimeToSeconds(popup.start_time);
          const endRaw = parseTimeToSeconds(popup.end_time);
          const endSec = endRaw > startSec ? endRaw : startSec + 3;

          const startFrame =
            popup.start_frame ?? Math.max(0, Math.round(startSec * fps));
          const endFrame =
            popup.end_frame ?? Math.max(startFrame + 1, Math.round(endSec * fps));
          const durationInFrames =
            popup.duration_in_frames ?? Math.max(1, endFrame - startFrame);

          return (
            <Sequence
              key={`${popup.headline}-${startFrame}-${index}`}
              from={startFrame}
              durationInFrames={durationInFrames}
            >
              <Popup popup={popup} durationInFrames={durationInFrames} />
            </Sequence>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const MainComposition = MainReel;
export default MainReel;
