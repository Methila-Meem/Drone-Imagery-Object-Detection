"use client";

import {
  ImageOverlay,
  MapContainer,
  Popup,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { useEffect, useMemo } from "react";
import type { Detection, ImageMetadata } from "@/lib/api";

const fallbackCenter: [number, number] = [23.8103, 90.4125];

type MapViewportProps = {
  image: ImageMetadata | null;
  detections: Detection[];
};

const detectionStyles: Record<string, { color: string; fillColor: string }> = {
  building: { color: "#dc2626", fillColor: "#fecaca" },
  vegetation: { color: "#16a34a", fillColor: "#bbf7d0" },
  open_land: { color: "#ca8a04", fillColor: "#fef08a" },
  "road/path": { color: "#2563eb", fillColor: "#bfdbfe" }
};

export function MapViewport({ image, detections }: MapViewportProps) {
  const imageBounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!image) {
      return null;
    }

    return [
      [image.bounds.south, image.bounds.west],
      [image.bounds.north, image.bounds.east]
    ];
  }, [image]);

  const detectionBounds = useMemo(() => {
    if (!image) {
      return [];
    }

    return detections.map((detection, index) => ({
      detection,
      bounds: pixelBboxToMapBounds(detection.bbox, image),
      key: `${detection.label}-${index}-${detection.bbox.join("-")}`
    }));
  }, [detections, image]);

  return (
    <div className="relative h-full min-h-[520px]">
      <MapContainer
        center={fallbackCenter}
        zoom={13}
        zoomControl={false}
        scrollWheelZoom
      >
        <ZoomControl position="topright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {image && imageBounds ? (
          <>
            <ImageOverlay
              bounds={imageBounds}
              opacity={0.9}
              url={image.image_url}
            />
            <FitImageBounds bounds={imageBounds} />
            {detectionBounds.map(({ detection, bounds, key }) => {
              const style = detectionStyles[detection.label] ?? {
                color: "#0f766e",
                fillColor: "#99f6e4"
              };

              return (
                <Rectangle
                  bounds={bounds}
                  key={key}
                  pathOptions={{
                    color: style.color,
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

function FitImageBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(bounds, {
      animate: false,
      padding: [32, 32]
    });
  }, [bounds, map]);

  return null;
}
