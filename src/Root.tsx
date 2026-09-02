import React from "react";
import { Composition, staticFile } from "remotion";
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
          if (typeof videoPath === "string" && videoPath.trim().length > 0) {
            let cleanUrl = videoPath.trim();
            const matchedUrl = cleanUrl.match(/(https?:\/\/[^\s\)\"]+|\/[^\s\)\"]+)/);
            if (matchedUrl) {
              cleanUrl = matchedUrl[0];
            }
            const { durationInSeconds } = await getVideoMetadata(cleanUrl);
            return {
              durationInFrames: Math.ceil(durationInSeconds * 30),
            };
          }
        } catch {
          // Fallback duration if metadata fetching fails
        }
        return {
          durationInFrames: 1250,
        };
      }}
      defaultProps={{
        videoUrl: staticFile("input.mp4"),
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