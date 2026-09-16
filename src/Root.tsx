import React from "react";
import { Composition } from "remotion";
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
        durationInFrames={1800}
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