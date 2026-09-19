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
        durationInFrames={1800} // Fallback baseline for Remotion preview
        calculateMetadata={async ({ props }: { props: Record<string, any> }) => {
          const fps = 30;

          // 1. Check if n8n passed duration explicitly (handling nested or string formats)
          const explicitDuration =
            props?.durationInFrames ||
            props?.duration ||
            props?.props?.durationInFrames ||
            props?.inputProps?.durationInFrames;

          if (explicitDuration && !isNaN(Number(explicitDuration)) && Number(explicitDuration) > 0) {
            return {
              durationInFrames: Math.ceil(Number(explicitDuration)),
            };
          }

          // 2. Try fetching video metadata directly from videoUrl or mediaUrl
          const targetUrl = props?.videoUrl || props?.mediaUrl;
          if (targetUrl) {
            try {
              const metadata = await getVideoMetadata(targetUrl);
              if (metadata?.durationInSeconds) {
                return {
                  durationInFrames: Math.ceil(metadata.durationInSeconds * fps),
                };
              }
            } catch (err) {
              console.error("Failed to fetch video metadata via URL:", err);
            }
          }

          // 3. Fallback: Calculate duration from the highest popup or overlay end_time
          const subtitleItems = props?.popups || props?.overlays || [];
          if (Array.isArray(subtitleItems) && subtitleItems.length > 0) {
            const maxEndTime = subtitleItems.reduce((max: number, item: any) => {
              const endTime = Number(item.end_time || item.endTime || 0);
              return endTime > max ? endTime : max;
            }, 0);

            if (maxEndTime > 0) {
              return {
                durationInFrames: Math.ceil(maxEndTime * fps),
              };
            }
          }

          // 4. Default fallback to 60 seconds (1800 frames at 30fps) if all else fails
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