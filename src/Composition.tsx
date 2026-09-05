import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

export interface PopupData {
  headline: string;
  subtext?: string;
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
  theme?: "bold_clean" | "youtube_shorts" | string;
  start_time: number;
  end_time: number;
  start_frame?: number;
  end_frame?: number;
  duration_in_frames?: number;
}

export interface MainReelProps extends Record<string, unknown> {
  videoUrl: string;
  popups: PopupData[];
}

export type MainCompositionProps = MainReelProps;

function unwrapProxyUrl(rawUrl: string): string {
  let url = String(rawUrl || "").trim();
  let prev = "";
  while (url !== prev) {
    prev = url;
    try {
      url = decodeURIComponent(url);
    } catch {
      // Ignore decoding errors
    }
    const match = url.match(/proxy-video\?url=(.+)$/i);
    if (match && match[1]) {
      url = match[1].trim();
    }
  }
  return url;
}

const POSITION_STYLES: Record<string, React.CSSProperties> = {
  top: { justifyContent: "flex-start", alignItems: "center", paddingTop: "10vh", paddingLeft: "20px", paddingRight: "20px" },
  "top-left": { justifyContent: "flex-start", alignItems: "flex-start", paddingTop: "10vh", paddingLeft: "30px" },
  "top-right": { justifyContent: "flex-start", alignItems: "flex-end", paddingTop: "10vh", paddingRight: "30px" },

  center: { justifyContent: "center", alignItems: "center", paddingLeft: "20px", paddingRight: "20px" },
  "center-left": { justifyContent: "center", alignItems: "flex-start", paddingLeft: "30px" },
  "center-right": { justifyContent: "center", alignItems: "flex-end", paddingRight: "30px" },

  bottom: { justifyContent: "flex-end", alignItems: "center", paddingBottom: "10vh", paddingLeft: "20px", paddingRight: "20px" },
  "bottom-left": { justifyContent: "flex-end", alignItems: "flex-start", paddingBottom: "10vh", paddingLeft: "30px" },
  "bottom-right": { justifyContent: "flex-end", alignItems: "flex-end", paddingBottom: "10vh", paddingRight: "30px" },
};

const THEME_STYLES: Record<
  string,
  {
    container: React.CSSProperties;
    headline: React.CSSProperties;
    subtext: React.CSSProperties;
  }
> = {
  bold_clean: {
    container: {
      backgroundColor: "rgba(15, 23, 42, 0.85)",
      border: "2px solid rgba(16, 185, 129, 0.6)",
      borderRadius: 24,
      padding: "20px 36px",
      boxShadow: "0 20px 30px rgba(0,0,0,0.5)",
      backdropFilter: "blur(8px)",
    },
    headline: {
      fontSize: 54,
      fontWeight: 900,
      color: "#FFFFFF",
      letterSpacing: "0.02em",
      textAlign: "center",
      textTransform: "uppercase",
    },
    subtext: {
      fontSize: 32,
      fontWeight: 700,
      color: "#34D399",
      textAlign: "center",
      marginTop: 8,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    },
  },
  youtube_shorts: {
    container: {
      backgroundColor: "rgba(0, 0, 0, 0.75)",
      borderRadius: 16,
      padding: "16px 28px",
      border: "1px solid rgba(255, 255, 255, 0.2)",
    },
    headline: {
      fontSize: 60,
      fontWeight: 900,
      color: "#FACC15",
      textAlign: "center",
      lineHeight: 1.1,
      textShadow: "-3px 3px 0 #000, 3px 3px 0 #000, 3px -3px 0 #000, -3px -3px 0 #000",
    },
    subtext: {
      fontSize: 34,
      fontWeight: 800,
      color: "#FFFFFF",
      textAlign: "center",
      marginTop: 10,
      textShadow: "-2px 2px 0 #000, 2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000",
    },
  },
};

const Popup: React.FC<{ popup: PopupData; durationInFrames: number }> = ({
  popup,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();

  const fadeFrames = Math.max(1, Math.min(5, Math.floor(durationInFrames / 3)));
  const opacity = interpolate(
    frame,
    [0, fadeFrames, Math.max(fadeFrames, durationInFrames - fadeFrames), durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const scale = interpolate(frame, [0, fadeFrames], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const positionStyle = POSITION_STYLES[popup.position || "center"] || POSITION_STYLES.center;
  const activeTheme = THEME_STYLES[popup.theme || "bold_clean"] || THEME_STYLES.bold_clean;

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        pointerEvents: "none",
        ...positionStyle,
      }}
    >
      <div
        style={{
          opacity,
          transform: `scale(${scale})`,
          ...activeTheme.container,
        }}
      >
        <div style={activeTheme.headline}>{popup.headline}</div>
        {popup.subtext ? <div style={activeTheme.subtext}>{popup.subtext}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

export const MainReel: React.FC<MainReelProps> = ({ videoUrl, popups }) => {
  const { fps } = useVideoConfig();
  const safePopups = Array.isArray(popups) ? popups : [];

  // 1. Fully unwrap nested proxy URLs back down to the source media target
  let targetUrl = unwrapProxyUrl(videoUrl);

  // 2. Fallback to default asset if URL is empty
  if (!targetUrl) {
    targetUrl = "https://remotion-assets.s3.eu-central-1.amazonaws.com/BigBuckBunny.mp4";
  }

  // 3. Attach standard proxy prefix to raw remote video URL
  let finalUrl = targetUrl;
  if (targetUrl.startsWith("http") && !targetUrl.includes("localhost")) {
    finalUrl = `/api/proxy-video?url=${encodeURIComponent(targetUrl)}`;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {finalUrl ? <OffthreadVideo src={finalUrl} /> : null}

      {safePopups.map((popup, i) => {
        const startSec = Number(popup.start_time);
        const endSec = Number(popup.end_time);

        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
          return null;
        }

        const startFrame = Math.max(0, Math.round(startSec * fps));
        const endFrame = Math.round(endSec * fps);
        const durationInFrames = Math.max(1, endFrame - startFrame);

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