"use client";

import type { Detection, ImageMetadata } from "@/lib/api";
import DroneMap from "@/components/map/DroneMap";

type MapViewportProps = {
  image: ImageMetadata | null;
  detections: Detection[];
  maskUrl: string | null;
  droneOpacity?: number;
  selectedDetectionIndex?: number | null;
  onDetectionSelect?: (index: number) => void;
};

export function MapViewport({
  image,
  detections,
  maskUrl,
  droneOpacity = 0.85,
  selectedDetectionIndex = null,
  onDetectionSelect
}: MapViewportProps) {
  return (
    <DroneMap
      detections={detections}
      droneOpacity={droneOpacity}
      image={image}
      maskUrl={maskUrl}
      onDetectionSelect={onDetectionSelect}
      selectedDetectionIndex={selectedDetectionIndex}
    />
  );
}
