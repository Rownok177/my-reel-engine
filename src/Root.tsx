import React from 'react';
import { Composition } from 'remotion';
import { MainComposition } from './Composition';
import './index.css';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="MainReel"
        component={MainComposition}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          videoUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          popups: [
            {
              start_time: 1.0,
              end_time: 4.0,
              headline: 'Sample Headline',
              subtext: 'Sample Subtext',
              position: 'bottom',
              theme: 'youtube_shorts',
            },
          ],
        }}
      />
    </>
  );
};