import React from "react";
import { Composition } from "remotion";
import { getVideoMetadata } from "@remotion/media-utils";
import { MainReel, MainReelProps } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MainReel"
      component={MainReel}
      fps={30}
      width={1080}
      height={1920}
      calculateMetadata={async ({ props }: { props: MainReelProps }) => {
        try {
          const videoPath = props?.videoUrl;
          if (typeof videoPath === "string" && videoPath.length > 0) {
            let cleanUrl = videoPath.trim();
            const matchedUrl = cleanUrl.match(/https?:\/\/[^\s\)\"]+/);
            if (matchedUrl) {
              cleanUrl = matchedUrl[0];
            }
            const { durationInSeconds } = await getVideoMetadata(cleanUrl);
            return {
              durationInFrames: Math.ceil(durationInSeconds * 30),
            };
          }
        } catch {
          // Fallback gracefully without relying on ambient console globals
        }
        return {
          durationInFrames: 1250,
        };
      }}
      defaultProps={{
        videoUrl: "http://localhost:5000/media/input.mp4",
        popups: [
          {
            start_time: 1.0,
            end_time: 4.0,
            headline: "পরিচয় করে নিন মিস্টার আসিফের সাথে,",
            subtext: "ব্র্যান্ডের সিনিয়র এক্সিকিউটিভ",
            position: "bottom",
            theme: "youtube_shorts",
          },
        ],
      }}
    />
  );
};