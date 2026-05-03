"use client";

import { memo, useMemo } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import { Popup, Rectangle, Tooltip } from "react-leaflet";
import type { Detection, ImageMetadata } from "@/lib/api";

type DetectionBoxesProps = {
  detections: Detection[];
  image: ImageMetadata | null;
};

const detectionStyles: Record<string, { color: string; fillColor: string }> = {
  building: { color: "#dc2626", fillColor: "#fecaca" },
  vegetation: { color: "#16a34a", fillColor: "#bbf7d0" },
  open_land: { color: "#ca8a04", fillColor: "#fef08a" },
  "earth/ground": { color: "#ca8a04", fillColor: "#fef08a" },
  road: { color: "#2563eb", fillColor: "#bfdbfe" },
  "road/path": { color: "#2563eb", fillColor: "#bfdbfe" }
};

function DetectionBoxesComponent({ detections, image }: DetectionBoxesProps) {
  const detectionBounds = useMemo(() => {
    if (!image) {
      return [];
    }

    return detections.map((detection, index) => ({
      detection,
      bounds: pixelBboxToMapBounds(detection.bbox, image),
      key: `${detection.label}-${index}-${detection.bbox.join("-")}`
    }));
  }, [
    detections,
    image?.bounds.east,
    image?.bounds.north,
    image?.bounds.south,
    image?.bounds.west,
    image?.height,
    image?.width
  ]);

  return (
    <>
      {detectionBounds.map(({ detection, bounds, key }) => {
        const style = detectionStyles[detection.label] ?? {
          color: detection.color ?? "#0f766e",
          fillColor: "#99f6e4"
        };
        const color = detection.color ?? style.color;

        return (
          <Rectangle
            bounds={bounds}
            key={key}
            pathOptions={{
              color,
              fillColor: style.fillColor,
              fillOpacity: 0.18,
              weight: 2
            }}
          >
            <Tooltip sticky>
              {detection.label} {(detection.confidence * 100).toFixed(0)}%
            </Tooltip>
            <Popup>
              <div className="space-y-1">
                <p className="font-semibold">{detection.label}</p>
                <p>Confidence {(detection.confidence * 100).toFixed(1)}%</p>
              </div>
            </Popup>
          </Rectangle>
        );
      })}
    </>
  );
}

function pixelBboxToMapBounds(
  bbox: Detection["bbox"],
  image: ImageMetadata
): LatLngBoundsExpression {
  const [xMin, yMin, xMax, yMax] = bbox;
  const { north, south, east, west } = image.bounds;
  const latSpan = north - south;
  const lngSpan = east - west;

  const clampX = (value: number) => Math.min(Math.max(value, 0), image.width);
  const clampY = (value: number) => Math.min(Math.max(value, 0), image.height);
  const toLng = (x: number) => west + (clampX(x) / image.width) * lngSpan;
  const toLat = (y: number) => north - (clampY(y) / image.height) * latSpan;

  return [
    [toLat(yMax), toLng(xMin)],
    [toLat(yMin), toLng(xMax)]
  ];
}

export const DetectionBoxes = memo(DetectionBoxesComponent);
