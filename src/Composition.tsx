import React, {useEffect, useRef} from "react";
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
  continueRender ,
} from "remotion";

export type PopupTheme = "bold_clean" | "bangla_reel";
export type HighlightColor = "green" | "red" | "blue" | "yellow";

export interface PopupData {
  headline: string;
  badgeText?: string;
  theme?: PopupTheme | string;
  highlightColor?: HighlightColor | string;
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

const parseTimeToSeconds = (
  time: string | number | undefined,
): number => {
  if (time === undefined || time === null) return 0;
  if (typeof time === "number") return time;

  const str = String(time).trim();
  if (!str) return 0;

  if (str.includes(":")) {
    const parts = str.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }

  const parsed = parseFloat(str);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// The uploaded source videos used by this pipeline are portrait containers (1080x1920)
// that contain a centered 16:9 video inside large black letterbox areas.
// A normal objectFit: "cover" cannot remove those baked-in bars because the bars
// are already part of the source pixels. We therefore zoom the source layer so the
// embedded 16:9 picture fills the 1080x1920 portrait composition.
const LETTERBOX_CONTENT_ASPECT = 16 / 9;
const PORTRAIT_ASPECT = 9 / 16;
const PORTRAIT_FILL_SCALE = Math.max(1, (1 / PORTRAIT_ASPECT) / (1 / LETTERBOX_CONTENT_ASPECT));
// Equivalent to ~3.16x for a 16:9 image embedded in a 9:16 source canvas.
// Slightly round upward to guarantee the black bars are fully cropped.
const VIDEO_FILL_SCALE = Math.max(3.18, PORTRAIT_FILL_SCALE);

const POSITION_STYLES: Record<string, React.CSSProperties> = {
  top: {position: "absolute", top: "10%", left: "50%", width: "80%"},
  "top-left": {position: "absolute", top: "10%", left: "5%", width: "80%"},
  "top-right": {
    position: "absolute",
    top: "10%",
    right: "5%",
    width: "80%",
    alignItems: "flex-end",
  },
  center: {position: "absolute", top: "62%", left: "50%", width: "80%"},
  "center-left": {position: "absolute", top: "62%", left: "5%", width: "80%"},
  "center-right": {
    position: "absolute",
    top: "62%",
    right: "5%",
    width: "80%",
    alignItems: "flex-end",
  },
  bottom: {position: "absolute", bottom: "8%", left: "50%", width: "80%"},
  "bottom-left": {position: "absolute", bottom: "8%", left: "5%", width: "80%"},
  "bottom-right": {
    position: "absolute",
    bottom: "8%",
    right: "5%",
    width: "80%",
    alignItems: "flex-end",
  },
};

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
  if (name in FONT_CONFIG) return name as SupportedFont;
  return "Hind Siliguri";
}

function getHighlightColor(value?: string): string {
  return (
    HIGHLIGHT_COLORS[String(value || "green").toLowerCase()] ||
    HIGHLIGHT_COLORS.green
  );
}

function FontLoader() {
  const handleRef = useRef<number | null>(null);
  const [handle] = React.useState(() => delayRender("Loading local caption fonts"));

  useEffect(() => {
    handleRef.current = handle;
    let cancelled = false;

    const load = async () => {
      try {
        const fontEntries = Object.values(FONT_CONFIG);

        for (const font of fontEntries) {
          const face = new FontFace(font.family, `url("${font.src}")`, {
            weight: font.weight,
            style: "normal",
            display: "block",
          });
          const loaded = await face.load();
          document.fonts.add(loaded);
        }

        await Promise.all(
          fontEntries.map((font) => document.fonts.load(`800 56px "${font.family}"`)),
        );
      } catch (error) {
        console.error("[Fonts] Failed to load one or more local fonts:", error);
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
): {before: string; highlight: string; after: string} {
  const text = String(headline || "").trim();
  if (!text) return {before: "", highlight: "", after: ""};

  const requested = String(requestedHighlight || "").trim();
  if (requested) {
    const index = text.toLocaleLowerCase().lastIndexOf(requested.toLocaleLowerCase());
    if (index >= 0) {
      return {
        before: text.slice(0, index),
        highlight: text.slice(index, index + requested.length),
        after: text.slice(index + requested.length),
      };
    }
  }

  // No automatic last-word highlighting. Only highlight when highlightText
  // explicitly identifies a phrase that exists in the spoken line.
  return {before: text, highlight: "", after: ""};
}

function BanglaReelHeadline({popup}: {popup: PopupData}) {
  const {before, highlight, after} = splitBanglaReelText(
    popup.headline,
    popup.highlightText,
  );
  const accent = getHighlightColor(popup.highlightColor);
  const fontName = normalizeFontName(popup.fontFamily);

  return (
    <div
      style={{
        fontFamily: `"${fontName}", sans-serif`,
        fontSize: 54,
        fontWeight: 800,
        lineHeight: 1.02,
        textAlign: "center",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        textShadow:
          "-2px -2px 0 rgba(0,0,0,0.95), 2px -2px 0 rgba(0,0,0,0.95), -2px 2px 0 rgba(0,0,0,0.95), 2px 2px 0 rgba(0,0,0,0.95), 0 4px 12px rgba(0,0,0,0.85)",
        maxWidth: "100%",
        margin: "0 auto",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <span style={{color: "#FFFFFF"}}>{before}</span>
      {highlight ? (
        <span
          style={{
            color: accent,
            fontWeight: 900,
            fontSize: "1.28em",
            display: "inline-block",
            marginInline: "0.08em",
            textShadow:
              "-2px -2px 0 rgba(0,0,0,0.98), 2px -2px 0 rgba(0,0,0,0.98), -2px 2px 0 rgba(0,0,0,0.98), 2px 2px 0 rgba(0,0,0,0.98), 0 5px 16px rgba(0,0,0,0.8)",
          }}
        >
          {highlight}
        </span>
      ) : null}
      {after ? <span style={{color: "#FFFFFF"}}> {after}</span> : null}
    </div>
  );
}

const Popup: React.FC<{popup: PopupData; durationInFrames: number}> = ({
  popup,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const safeDuration = Math.max(1, durationInFrames);
  const fadeFrames = Math.max(1, Math.min(6, Math.floor(safeDuration / 4)));
  const fadeOutStart = Math.max(fadeFrames, safeDuration - fadeFrames);

  const opacity = interpolate(
    frame,
    [0, fadeFrames, fadeOutStart, safeDuration],
    [0, 1, 1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );

  let animationTransform = "";
  const animType = popup.animationType || "bounce";

  if (animType === "bounce" || animType === "spring") {
    const scaleSpring = spring({
      frame,
      fps,
      config: {damping: 11, stiffness: 120},
    });
    animationTransform = `scale(${scaleSpring})`;
  } else if (animType === "zoom-out") {
    const scaleZoom = interpolate(frame, [0, fadeFrames], [1.4, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    animationTransform = `scale(${scaleZoom})`;
  } else if (animType === "slide") {
    const translateY = interpolate(frame, [0, fadeFrames], [-40, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    animationTransform = `translateY(${translateY}px)`;
  } else {
    const scaleDefault = interpolate(frame, [0, fadeFrames], [0.85, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    animationTransform = `scale(${scaleDefault})`;
  }

  const positionKey = popup.position || "center";
  const positionStyle = POSITION_STYLES[positionKey] || POSITION_STYLES.center;

  let positionalTransform = "";
  if (positionKey === "top" || positionKey === "center" || positionKey === "bottom") {
    positionalTransform = "translateX(-50%)";
  }

  const isBanglaReel = popup.theme === "bangla_reel";
  const fontName = normalizeFontName(popup.fontFamily);

  const containerStyle: React.CSSProperties = {
    backgroundColor: isBanglaReel
      ? "transparent"
      : popup.bgColor || "rgba(15, 23, 42, 0.92)",
    border: isBanglaReel
      ? "none"
      : `2px solid ${popup.borderColor || "#4ADE80"}`,
    borderRadius: isBanglaReel ? 0 : 20,
    padding: isBanglaReel ? "4px 8px" : "18px 30px",
    boxShadow: isBanglaReel ? "none" : "0 20px 30px rgba(0,0,0,0.5)",
    backdropFilter: isBanglaReel ? "none" : "blur(10px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    maxWidth: isBanglaReel ? "88%" : "80%",
    boxSizing: "border-box",
    transform: `${positionalTransform} ${animationTransform}`.trim(),
  };

  const positionWithoutTransform: React.CSSProperties = {...positionStyle};
  delete positionWithoutTransform.transform;

  return (
    <div
      style={{
        ...positionWithoutTransform,
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
    >
      <div style={{opacity, ...containerStyle}}>
        {popup.badgeText ? (
          <div
            style={{
              fontFamily: `"${fontName}", sans-serif`,
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.1em",
              color: popup.borderColor || "#4ADE80",
              marginBottom: 6,
            }}
          >
            {popup.badgeText}
          </div>
        ) : null}

        {isBanglaReel ? (
          <BanglaReelHeadline
            popup={{
              ...popup,
              highlightColor: popup.highlightColor || "green",
            }}
          />
        ) : (
          <div
            style={{
              fontFamily: `"${fontName}", sans-serif`,
              fontSize: 48,
              fontWeight: 900,
              color: popup.textColor || "#FFFFFF",
              textAlign: "center",
              lineHeight: 1.1,
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

export const MainReel: React.FC<MainReelProps> = ({videoUrl, popups}) => {
  const {fps} = useVideoConfig();
  const safePopups = Array.isArray(popups) ? popups : [];

  let cleanUrl = String(videoUrl || "").trim();
  if (
    !cleanUrl ||
    cleanUrl === "undefined" ||
    cleanUrl === "null" ||
    cleanUrl.includes("remotion-assets.s3") ||
    cleanUrl.includes("commondatastorage.googleapis.com")
  ) {
    cleanUrl = "https://vjs.zencdn.net/v/oceans.mp4";
  }

  return (
    <AbsoluteFill style={{backgroundColor: "black", overflow: "hidden"}}>
      <FontLoader />

      {cleanUrl ? (
        <OffthreadVideo
          src={cleanUrl}
          onError={(err) => console.warn("Video stream load warning:", err)}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "50% 50%",
            transform: `scale(${VIDEO_FILL_SCALE})`,
            transformOrigin: "50% 50%",
            display: "block",
          }}
        />
      ) : null}

      {safePopups.map((popup, i) => {
        const startSec = parseTimeToSeconds(popup.start_time);
        const rawEndSec = parseTimeToSeconds(popup.end_time);
        const endSec = rawEndSec > startSec ? rawEndSec : startSec + 3;

        const startFrame =
          popup.start_frame ?? Math.max(0, Math.round(startSec * fps));
        const endFrame = popup.end_frame ?? Math.round(endSec * fps);
        const durationInFrames =
          popup.duration_in_frames ?? Math.max(1, endFrame - startFrame);

        return (
          <Sequence
            key={`${popup.headline}-${startFrame}-${i}`}
            from={startFrame}
            durationInFrames={durationInFrames}
          >
            <Popup popup={popup} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const MainComposition = MainReel;
export default MainReel;
