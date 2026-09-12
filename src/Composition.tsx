import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

export interface PopupData {
  headline: string;
  subtext?: string;
  badgeText?: string;

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
  subtextColor?: string;
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
  time: string | number | undefined
): number => {
  if (time === undefined || time === null) return 0;

  if (typeof time === "number") {
    return time;
  }

  const str = String(time).trim();

  if (!str) return 0;

  if (str.includes(":")) {
    const parts = str.split(":").map(Number);

    if (parts.length === 3) {
      return (
        parts[0] * 3600 +
        parts[1] * 60 +
        parts[2]
      );
    }

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  const parsed = parseFloat(str);

  return Number.isNaN(parsed) ? 0 : parsed;
};

/*
 * Mobile-safe popup zones.
 *
 * The main change is that "center" no longer means the
 * exact center of the video.
 *
 * The center zones are intentionally moved lower so that
 * they are less likely to cover a person's face.
 */
const POSITION_STYLES: Record<
  string,
  React.CSSProperties
> = {
  /*
   * TOP
   */
  top: {
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: "8%",
    paddingLeft: "20px",
    paddingRight: "20px",
  },

  "top-left": {
    justifyContent: "flex-start",
    alignItems: "flex-start",
    paddingTop: "8%",
    paddingLeft: "30px",
  },

  "top-right": {
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: "8%",
    paddingRight: "30px",
  },

  /*
   * CENTER
   *
   * Instead of placing these popups at 50%,
   * move them to roughly the lower-middle area.
   *
   * This keeps the popup above the true bottom zone,
   * while leaving the face area much more visible.
   */
  center: {
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: "61%",
    paddingLeft: "20px",
    paddingRight: "20px",
  },

  "center-left": {
    justifyContent: "flex-start",
    alignItems: "flex-start",
    paddingTop: "61%",
    paddingLeft: "30px",
  },

  "center-right": {
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: "61%",
    paddingRight: "30px",
  },

  /*
   * BOTTOM
   */
  bottom: {
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: "10%",
    paddingLeft: "20px",
    paddingRight: "20px",
  },

  "bottom-left": {
    justifyContent: "flex-end",
    alignItems: "flex-start",
    paddingBottom: "10%",
    paddingLeft: "30px",
  },

  "bottom-right": {
    justifyContent: "flex-end",
    alignItems: "flex-end",
    paddingBottom: "10%",
    paddingRight: "30px",
  },
};

const Popup: React.FC<{
  popup: PopupData;
  durationInFrames: number;
}> = ({
  popup,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const safeDuration = Math.max(
    1,
    durationInFrames
  );

  const fadeFrames = Math.max(
    1,
    Math.min(
      6,
      Math.floor(safeDuration / 4)
    )
  );

  const fadeOutStart = Math.max(
    fadeFrames,
    safeDuration - fadeFrames
  );

  const opacity = interpolate(
    frame,
    [
      0,
      fadeFrames,
      fadeOutStart,
      safeDuration,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  let transformStyle = "";

  const animType =
    popup.animationType || "bounce";

  if (
    animType === "bounce" ||
    animType === "spring"
  ) {
    const scaleSpring = spring({
      frame,
      fps,
      config: {
        damping: 11,
        stiffness: 120,
      },
    });

    transformStyle = `scale(${scaleSpring})`;
  } else if (
    animType === "zoom-out"
  ) {
    const scaleZoom = interpolate(
      frame,
      [0, fadeFrames],
      [1.4, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }
    );

    transformStyle = `scale(${scaleZoom})`;
  } else if (
    animType === "slide"
  ) {
    const translateY = interpolate(
      frame,
      [0, fadeFrames],
      [-40, 0],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }
    );

    transformStyle =
      `translateY(${translateY}px)`;
  } else {
    const scaleDefault = interpolate(
      frame,
      [0, fadeFrames],
      [0.85, 1],
      {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }
    );

    transformStyle =
      `scale(${scaleDefault})`;
  }

  const positionStyle =
    POSITION_STYLES[
      popup.position || "center"
    ] ||
    POSITION_STYLES.center;

  const containerStyle: React.CSSProperties = {
    backgroundColor:
      popup.bgColor ||
      "rgba(15, 23, 42, 0.92)",

    border:
      `2px solid ${
        popup.borderColor ||
        "#4ADE80"
      }`,

    borderRadius: 20,

    padding: "18px 30px",

    boxShadow:
      "0 20px 30px rgba(0,0,0,0.5)",

    backdropFilter:
      "blur(10px)",

    display: "flex",
    flexDirection: "column",
    alignItems: "center",

    maxWidth: "80%",

    /*
     * Prevent extremely long text from
     * overflowing the mobile frame.
     */
    boxSizing: "border-box",
  };

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        pointerEvents: "none",
        boxSizing: "border-box",
        ...positionStyle,
      }}
    >
      <div
        style={{
          opacity,
          transform: transformStyle,
          ...containerStyle,
        }}
      >
        {popup.badgeText ? (
          <div
            style={{
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.1em",
              color:
                popup.borderColor ||
                "#4ADE80",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {popup.badgeText}
          </div>
        ) : null}

        <div
          style={{
            fontSize: 48,
            fontWeight: 900,
            color:
              popup.textColor ||
              "#FFFFFF",
            textAlign: "center",
            lineHeight: 1.1,
            textTransform: "uppercase",
            wordBreak: "break-word",
          }}
        >
          {popup.headline}
        </div>

        {popup.subtext ? (
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color:
                popup.subtextColor ||
                "#4ADE80",
              textAlign: "center",
              marginTop: 6,
              lineHeight: 1.15,
              wordBreak: "break-word",
            }}
          >
            {popup.subtext}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

export const MainReel: React.FC<
  MainReelProps
> = ({
  videoUrl,
  popups,
}) => {
  const { fps } = useVideoConfig();

  const safePopups =
    Array.isArray(popups)
      ? popups
      : [];

  let cleanUrl =
    String(videoUrl || "").trim();

  /*
   * Fallback video protection.
   */
  if (
    !cleanUrl ||
    cleanUrl === "undefined" ||
    cleanUrl === "null" ||
    cleanUrl.includes(
      "remotion-assets.s3"
    ) ||
    cleanUrl.includes(
      "commondatastorage.googleapis.com"
    )
  ) {
    cleanUrl =
      "https://vjs.zencdn.net/v/oceans.mp4";
  }

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "black",
      }}
    >
      {cleanUrl ? (
        <OffthreadVideo
          src={cleanUrl}
          onError={(err) =>
            console.warn(
              "Video stream load warning:",
              err
            )
          }
          style={{
            width: "100%",
            height: "100%",

            /*
             * IMPORTANT:
             * "cover" fills the entire 1080x1920
             * mobile frame.
             *
             * Landscape source videos will be
             * cropped on the left/right instead
             * of producing letterboxing.
             */
            objectFit: "cover",

            /*
             * Keep the middle of the source visible.
             * This is generally the safest choice
             * for talking-head videos.
             */
            objectPosition: "center center",
          }}
        />
      ) : null}

      {safePopups.map(
        (popup, i) => {
          const startSec =
            parseTimeToSeconds(
              popup.start_time
            );

          const rawEndSec =
            parseTimeToSeconds(
              popup.end_time
            );

          const endSec =
            rawEndSec > startSec
              ? rawEndSec
              : startSec + 3;

          const startFrame =
            popup.start_frame ??
            Math.max(
              0,
              Math.round(
                startSec * fps
              )
            );

          const endFrame =
            popup.end_frame ??
            Math.round(
              endSec * fps
            );

          const durationInFrames =
            popup.duration_in_frames ??
            Math.max(
              1,
              endFrame - startFrame
            );

          return (
            <Sequence
              key={`${popup.headline}-${startFrame}-${i}`}
              from={startFrame}
              durationInFrames={
                durationInFrames
              }
            >
              <Popup
                popup={popup}
                durationInFrames={
                  durationInFrames
                }
              />
            </Sequence>
          );
        }
      )}
    </AbsoluteFill>
  );
};

export const MainComposition =
  MainReel;

export default MainReel;