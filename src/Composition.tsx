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

const HIGHLIGHT_COLORS: Record<string, string> = {
  green: "#B7F000",
  red: "#FF3B30",
  blue: "#28A9FF",
  yellow: "#FFD60A",
};

const FONT_CONFIG = {
  "Hind Siliguri": {
    family: "Hind Siliguri",
    regularSrc: staticFile("fonts/HindSiliguri-Regular.ttf"),
    boldSrc: staticFile("fonts/HindSiliguri-Bold.ttf"),
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
          const sources =
            "regularSrc" in font
              ? [
                  { src: font.regularSrc, weight: "400" },
                  { src: font.boldSrc, weight: "700" },
                ]
              : [{ src: font.src, weight: font.weight }];

          for (const source of sources) {
            const face = new FontFace(font.family, `url("${source.src}")`, {
              weight: source.weight,
              style: "normal",
              display: "block",
            });
            const loaded = await face.load();
            document.fonts.add(loaded);
          }
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
  const fontName = normalizeFontName(popup.fontFamily);
  const accent = getHighlightColor(popup.highlightColor);
  const normalWeight = fontName === "Hind Siliguri" ? 400 : 500;
  const highlightWeight = fontName === "Hind Siliguri" ? 700 : 900;

  // Split the text to locate the exact highlight phrase
  const { before, highlight: match, after } = splitBanglaReelText(
    popup.headline,
    popup.highlightText,
  );

  // Break text into individual words so the reel stays within five words per line.
  const tokens: { text: string; isHighlight: boolean }[] = [];
  if (before) before.split(/\s+/).filter(Boolean).forEach((word) => tokens.push({ text: word, isHighlight: false }));
  if (match) match.split(/\s+/).filter(Boolean).forEach((word) => tokens.push({ text: word, isHighlight: true }));
  if (after) after.split(/\s+/).filter(Boolean).forEach((word) => tokens.push({ text: word, isHighlight: false }));

  const normalTextStyle: React.CSSProperties = {
    fontFamily: `"${fontName}", sans-serif`,
    fontSize: 52,
    fontWeight: normalWeight,
    color: "#fff",
    lineHeight: 1,
    textShadow:
      "-2px -2px 0 rgba(0,0,0,.85), 2px -2px 0 rgba(0,0,0,.85), -2px 2px 0 rgba(0,0,0,.85), 2px 2px 0 rgba(0,0,0,.85), 0 4px 12px rgba(0,0,0,.65)",
  };

  const highlightTextStyle: React.CSSProperties = {
    ...normalTextStyle,
    fontSize: 78,
    fontWeight: highlightWeight,
    color: accent,
    lineHeight: 0.92,
    marginInline: 6,
    textShadow:
      "-3px -3px 0 rgba(0,0,0,.9), 3px -3px 0 rgba(0,0,0,.9), -3px 3px 0 rgba(0,0,0,.9), 3px 3px 0 rgba(0,0,0,.9), 0 5px 14px rgba(0,0,0,.75)",
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        margin: 0,
        boxSizing: "border-box",
        display: "block",
        textAlign: "center",
        wordBreak: "break-word",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
      }}
    >
      {tokens.map((token, i) => {
        const isLastInLine = (i + 1) % 5 === 0;
        const isLastOverall = i === tokens.length - 1;

        return (
          <React.Fragment key={i}>
            {token.isHighlight ? (
              <span
                style={{
                  ...highlightTextStyle,
                }}
              >
                {token.text}
              </span>
            ) : (
              <span style={normalTextStyle}>{token.text}</span>
            )}
            
            {!isLastOverall && (isLastInLine ? <br /> : " ")}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Adjust positioning to sit just before the video borders (96% width)
function getSafePositionStyle(position?: string): React.CSSProperties {
  const key = String(position || "center").trim();

  switch (key) {
    case "top":
      return { position: "absolute", top: "10%", left: "2%", width: "96%" };
    case "top-left":
      return { position: "absolute", top: "10%", left: "2%", width: "90%", alignItems: "flex-start" };
    case "top-right":
      return { position: "absolute", top: "10%", right: "2%", width: "90%", alignItems: "flex-end" };
    case "bottom":
      return { position: "absolute", bottom: "10%", left: "2%", width: "96%" };
    case "bottom-left":
      return { position: "absolute", bottom: "10%", left: "2%", width: "90%", alignItems: "flex-start" };
    case "bottom-right":
      return { position: "absolute", bottom: "10%", right: "2%", width: "90%", alignItems: "flex-end" };
    case "center-left":
      return { position: "absolute", top: "50%", transform: "translateY(-50%)", left: "2%", width: "90%", alignItems: "flex-start" };
    case "center-right":
      return { position: "absolute", top: "50%", transform: "translateY(-50%)", right: "2%", width: "90%", alignItems: "flex-end" };
    case "center":
    default:
      return { position: "absolute", top: "68%", transform: "translateY(-50%)", left: "2%", width: "96%" };
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

  const textBox: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: positionStyle.alignItems || "center",
    overflow: "hidden",
    transform: animationTransform,
    transformOrigin: "center center",
    backgroundColor: isBanglaReel
      ? "rgba(0, 0, 0, 0.34)"
      : popup.bgColor || "rgba(15,23,42,.90)",
    border: isBanglaReel
      ? "none"
      : `2px solid ${popup.borderColor || accent}`,
    borderRadius: isBanglaReel ? 16 : 18,
    padding: isBanglaReel ? "8px 18px 10px" : "14px 22px",
    ...(isBanglaReel ? { backdropFilter: "blur(3px)" } : {}),
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
              lineHeight: 1.1,
              color: popup.textColor || "#fff",
              textAlign: "center",
              wordBreak: "break-word",
              whiteSpace: "normal",
              overflowWrap: "anywhere",
            }}
          >
            {(() => {
              // Same 8 word constraint applies to regular non-Bangla popups
              const tokens = (popup.headline || "").split(/\s+/).filter(Boolean);
              return tokens.map((word, i) => {
                const isLastInLine = (i + 1) % 8 === 0;
                const isLastOverall = i === tokens.length - 1;
                return (
                  <React.Fragment key={i}>
                    {word}
                    {!isLastOverall && (isLastInLine ? <br /> : " ")}
                  </React.Fragment>
                );
              });
            })()}
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

      <div
        style={{
          position: "absolute",
          inset: 0, 
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