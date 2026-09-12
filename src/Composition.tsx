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

  animationType?:
    | "bounce"
    | "slide"
    | "zoom-out"
    | "spring"
    | string;

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

export interface MainReelProps
  extends Record<string, unknown> {
  videoUrl: string;
  popups: PopupData[];
}

export type MainCompositionProps = MainReelProps;

const parseTimeToSeconds = (
  time: string | number | undefined
): number => {
  if (time === undefined || time === null) {
    return 0;
  }

  if (typeof time === "number") {
    return time;
  }

  const str = String(time).trim();

  if (!str) {
    return 0;
  }

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
 * Explicit mobile popup zones.
 *
 * These positions are based on the 1080 x 1920
 * portrait composition.
 *
 * top:
 *      approximately 10% from top
 *
 * center:
 *      approximately 62% from top
 *      This is intentionally LOWER than the
 *      mathematical center so it is less likely
 *      to cover a person's face.
 *
 * bottom:
 *      approximately 8% from bottom
 */
const POSITION_STYLES: Record<
  string,
  React.CSSProperties
> = {
  /*
   * TOP
   */
  top: {
    position: "absolute",
    top: "10%",
    left: "50%",
    width: "80%",
  },

  "top-left": {
    position: "absolute",
    top: "10%",
    left: "5%",
    width: "80%",
  },

  "top-right": {
    position: "absolute",
    top: "10%",
    right: "5%",
    width: "80%",
    alignItems: "flex-end",
  },

  /*
   * CENTER SAFE ZONE
   *
   * This is NOT the exact center.
   * It is deliberately moved downward.
   */
  center: {
    position: "absolute",
    top: "62%",
    left: "50%",
    width: "80%",
  },

  "center-left": {
    position: "absolute",
    top: "62%",
    left: "5%",
    width: "80%",
  },

  "center-right": {
    position: "absolute",
    top: "62%",
    right: "5%",
    width: "80%",
    alignItems: "flex-end",
  },

  /*
   * BOTTOM
   */
  bottom: {
    position: "absolute",
    bottom: "8%",
    left: "50%",
    width: "80%",
  },

  "bottom-left": {
    position: "absolute",
    bottom: "8%",
    left: "5%",
    width: "80%",
  },

  "bottom-right": {
    position: "absolute",
    bottom: "8%",
    right: "5%",
    width: "80%",
    alignItems: "flex-end",
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

  let animationTransform = "";

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

    animationTransform =
      `scale(${scaleSpring})`;
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

    animationTransform =
      `scale(${scaleZoom})`;
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

    animationTransform =
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

    animationTransform =
      `scale(${scaleDefault})`;
  }

  const positionStyle =
    POSITION_STYLES[
      popup.position || "center"
    ] ||
    POSITION_STYLES.center;

  /*
   * Positioning transform is kept separate
   * from the animation transform.
   *
   * This prevents the animation from replacing
   * the horizontal centering.
   */
  let positionalTransform = "";

  if (
    popup.position === "top" ||
    popup.position === "center" ||
    popup.position === "bottom"
  ) {
    positionalTransform =
      "translateX(-50%)";
  }

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

    boxSizing: "border-box",

    transform:
      `${positionalTransform} ${animationTransform}`.trim(),
  };

  /*
   * Remove only the transform property from
   * POSITION_STYLES without creating an unused
   * variable.
   */
  const positionWithoutTransform: React.CSSProperties =
    {
      ...positionStyle,
    };

  delete positionWithoutTransform.transform;

  return (
    <div
      style={{
        ...positionWithoutTransform,
        pointerEvents: "none",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          opacity,
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
    </div>
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
        overflow: "hidden",
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
            position: "absolute",
            width: "100%",
            height: "100%",

            /*
             * Fill the complete 1080 x 1920
             * portrait composition.
             */
            objectFit: "cover",

            /*
             * Crop from the center of the
             * source video.
             */
            objectPosition: "50% 50%",

            display: "block",
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