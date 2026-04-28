"use client";

import { memo, useMemo } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import { MapContainer, TileLayer, ZoomControl } from "react-leaflet";
import type { Detection, ImageMetadata } from "@/lib/api";
import { DetectionBoxes } from "./DetectionBoxes";
import { FitBounds } from "./FitBounds";
import { MaskOverlay } from "./MaskOverlay";
import { RasterOverlay } from "./RasterOverlay";

const fallbackCenter: [number, number] = [23.8103, 90.4125];

type DroneMapProps = {
  image: ImageMetadata | null;
  detections: Detection[];
  maskUrl: string | null;
};

function DroneMapComponent({ image, detections, maskUrl }: DroneMapProps) {
  const imageBounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!image) {
      return null;
    }

    return [
      [image.bounds.south, image.bounds.west],
      [image.bounds.north, image.bounds.east]
    ];
  }, [
    image?.bounds.east,
    image?.bounds.north,
    image?.bounds.south,
    image?.bounds.west
  ]);

  return (
    <div className="relative h-full min-h-[520px]">
      <MapContainer
        center={fallbackCenter}
        scrollWheelZoom
        zoom={13}
        zoomControl={false}
      >
        <ZoomControl position="topright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {image && imageBounds ? (
          <>
            <RasterOverlay bounds={imageBounds} imageUrl={image.image_url} />
            <MaskOverlay bounds={imageBounds} maskUrl={maskUrl} />
            <DetectionBoxes detections={detections} image={image} />
            <FitBounds bounds={imageBounds} />
          </>
        ) : null}
      </MapContainer>
      <div className="absolute left-4 top-4 z-[500] rounded border border-line bg-white px-3 py-2 shadow-sm">
        <p className="text-sm font-semibold text-ink">
          {image ? image.filename : "Map ready"}
        </p>
        <p className="text-xs text-muted">
          {image ? "Drone image overlay" : "Choose an image to view"}
        </p>
      </div>
    </div>
  );
}

export default memo(DroneMapComponent);
