import React from "react";
import { Composition } from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";
import { MainComposition, type MainCompositionProps } from "./Composition";
import "./index.css";

const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MainReel"
        component={MainComposition}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={1}
        calculateMetadata={async ({ props }) => {
          const typedProps = props as MainCompositionProps;

          const videoUrl = String(
            typedProps?.videoUrl || ""
          ).trim();

          if (!videoUrl) {
            console.warn("[Root] No video URL found.");
            return {
              durationInFrames: 1,
            };
          }

          try {
            const metadata = await getVideoMetadata(videoUrl);

            const durationInSeconds = Number(
              metadata?.durationInSeconds
            );

            if (
              !Number.isFinite(durationInSeconds) ||
              durationInSeconds <= 0
            ) {
              throw new Error(
                `Invalid source video duration: ${metadata?.durationInSeconds}`
              );
            }

            const durationInFrames = Math.max(
              1,
              Math.ceil(durationInSeconds * FPS)
            );

            console.log(
              `[Root] Source video duration: ${durationInSeconds}s`
            );

            console.log(
              `[Root] Composition duration: ${durationInFrames} frames`
            );

            return {
              durationInFrames,
            };
          } catch (error) {
            console.error(
              "[Root] Failed to determine source video duration:",
              error
            );

            // Do not silently create a 60-second video.
            return {
              durationInFrames: 1,
            };
          }
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