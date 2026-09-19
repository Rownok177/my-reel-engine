import React from "react";
import { Composition } from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";
import { MainComposition } from "./Composition";
import "./index.css";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MainReel"
        component={MainComposition}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1800} // This acts as a fallback for the editor
        calculateMetadata={async ({ props }) => {
          // 1. If n8n passed the duration explicitly, use it immediately
          if (props.durationInFrames) {
            return {
              durationInFrames: Number(props.durationInFrames),
            };
          }

          // 2. Otherwise, fetch the video duration dynamically from the URL
          if (props.videoUrl) {
            try {
              const metadata = await getVideoMetadata(props.videoUrl);
              return {
                durationInFrames: Math.ceil(metadata.durationInSeconds * 30),
              };
            } catch (err) {
              console.error("Failed to fetch video metadata:", err);
            }
          }

          // 3. Fallback to 60 seconds (1800 frames at 30fps) if all else fails
          return { durationInFrames: 1800 };
        }}
        defaultProps={{
          videoUrl:
            "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
          popups: [
            {
              headline: "Meeting a Professional",
              position: "center",
              start_time: 0.5,
              end_time: 3.0,
            },
            {
              headline: "1992: The First Step",
              position: "center",
              start_time: 7.5,
              end_time: 12.0,
            },
          ],
        }}
      />
    </>
  );
};