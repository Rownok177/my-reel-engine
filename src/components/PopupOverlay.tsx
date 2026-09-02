import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { PopupItem } from "../types";

export const PopupOverlay: React.FC<{ item: PopupItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });

  let transformStyle = `scale(${entrance})`;
  if (item.animationType === "slide") {
    const slideX = interpolate(entrance, [0, 1], [-100, 0]);
    transformStyle = `translateX(${slideX}px)`;
  } else if (item.animationType === "zoom-out") {
    const scale = interpolate(entrance, [0, 1], [1.5, 1]);
    transformStyle = `scale(${scale})`;
  }

  const positionClasses: Record<string, React.CSSProperties> = {
    "top-left": { top: 60, left: 60 },
    "top-right": { top: 60, right: 60 },
    center: { top: "45%", left: "50%", transform: `translate(-50%, -50%) ${transformStyle}` },
    bottom: { bottom: 80, left: "50%", transform: `translateX(-50%) ${transformStyle}` },
  };

  const selectedPos = positionClasses[item.position || "center"] || positionClasses.center;

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 10,
        padding: "16px 24px",
        borderRadius: "12px",
        backgroundColor: item.bgColor || "rgba(15, 23, 42, 0.92)",
        border: `2px solid ${item.borderColor || "#4ADE80"}`,
        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
        transform: selectedPos.transform || transformStyle,
        ...selectedPos,
      }}
    >
      {item.badgeText && (
        <span
          style={{
            fontSize: "12px",
            fontWeight: "bold",
            color: item.borderColor || "#4ADE80",
            textTransform: "uppercase",
            letterSpacing: "1px",
            display: "block",
            marginBottom: "4px",
          }}
        >
          {item.badgeText}
        </span>
      )}
      <h2
        style={{
          margin: "4px 0",
          fontSize: "28px",
          fontWeight: "800",
          color: item.textColor || "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        {item.headline}
      </h2>
      {item.subtext && (
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: "600",
            color: item.subtextColor || "#4ADE80",
            fontFamily: "sans-serif",
          }}
        >
          {item.subtext}
        </p>
      )}
    </div>
  );
};