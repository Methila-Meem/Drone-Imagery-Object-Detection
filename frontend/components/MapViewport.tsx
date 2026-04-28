"use client";

import type { Detection, ImageMetadata } from "@/lib/api";
import DroneMap from "@/components/map/DroneMap";

type MapViewportProps = {
  image: ImageMetadata | null;
  detections: Detection[];
  maskUrl: string | null;
};

export function MapViewport({ image, detections, maskUrl }: MapViewportProps) {
  return <DroneMap detections={detections} image={image} maskUrl={maskUrl} />;
}
