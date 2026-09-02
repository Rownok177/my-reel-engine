export interface PopupItem {
  start_time: number;
  end_time?: number;
  start_frame?: number;
  duration_in_frames?: number;
  headline: string;
  subtext?: string;
  badgeText?: string;
  position?: "top-left" | "top-right" | "center" | "bottom" | "bottom-left" | "bottom-right";
  animationType?: "bounce" | "slide" | "zoom-out" | "spring";
  textColor?: string;
  subtextColor?: string;
  bgColor?: string;
  borderColor?: string;
}

export interface LowerThirdItem {
  name: string;
  title: string;
  position?: string;
  start_time: number;
  end_time?: number;
  start_frame?: number;
  duration_in_frames?: number;
}

export interface MainReelProps {
  videoUrl: string;
  popups?: PopupItem[];
  lower_thirds?: LowerThirdItem[];
}