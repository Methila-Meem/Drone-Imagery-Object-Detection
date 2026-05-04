"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  AttributionControl,
  Layer,
  NavigationControl,
  Source,
  type MapRef
} from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import type { Detection, ImageMetadata } from "@/lib/api";

const fallbackCenter = { latitude: 23.8103, longitude: 90.4125, zoom: 12 };
const maskRasterOpacity = 0.6;

const mapStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm"
    }
  ]
};

type DroneMapProps = {
  image: ImageMetadata | null;
  detections: Detection[];
  maskUrl: string | null;
  droneOpacity?: number;
  selectedDetectionIndex?: number | null;
  onDetectionSelect?: (index: number) => void;
};

type LngLat = [number, number];

type ProjectedDetection = {
  detection: Detection;
  index: number;
  key: string;
  label: string;
  color: string;
  points: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
};

function DroneMapComponent({
  image,
  detections,
  maskUrl,
  droneOpacity = 0.85,
  selectedDetectionIndex = null,
  onDetectionSelect
}: DroneMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  const [projectedDetections, setProjectedDetections] = useState<
    ProjectedDetection[]
  >([]);

  const imageCoordinates = useMemo(() => {
    if (!image) {
      return null;
    }

    return getImageCoordinates(image);
  }, [image]);

  const fitImageBounds = useCallback(() => {
    if (!image || !mapRef.current) {
      return;
    }

    mapRef.current.fitBounds(
      [
        [image.bounds.west, image.bounds.south],
        [image.bounds.east, image.bounds.north]
      ],
      { duration: 0, padding: 48 }
    );
  }, [image]);

  useEffect(() => {
    fitImageBounds();
  }, [fitImageBounds]);

  const updateProjection = useCallback(() => {
    const map = mapRef.current;

    if (!image || !map) {
      setProjectedDetections([]);
      return;
    }

    setProjectedDetections(
      detections.map((detection, index) =>
        projectDetection({
          detection,
          image,
          index,
          map
        })
      )
    );
  }, [detections, image]);

  useEffect(() => {
    updateProjection();
  }, [updateProjection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        mapRef.current?.getMap().resize();
        updateProjection();
      });
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, [updateProjection]);

  const handleMapLoad = useCallback(() => {
    fitImageBounds();
    updateProjection();
  }, [fitImageBounds, updateProjection]);

  return (
    <div className="relative h-full min-h-[560px] w-full" ref={containerRef}>
      <Map
        attributionControl={false}
        initialViewState={fallbackCenter}
        mapStyle={mapStyle}
        onLoad={handleMapLoad}
        onMove={updateProjection}
        onResize={updateProjection}
        onZoom={updateProjection}
        ref={mapRef}
        reuseMaps
        style={{ height: "100%", width: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} />
        <AttributionControl compact position="bottom-right" />
        {image && imageCoordinates ? (
          <>
            <Source
              coordinates={imageCoordinates}
              id="drone-image"
              type="image"
              url={image.image_url}
            >
              <Layer
                id="drone-image-raster"
                paint={{ "raster-opacity": droneOpacity }}
                source="drone-image"
                type="raster"
              />
            </Source>
            {maskUrl ? (
              <Source
                coordinates={imageCoordinates}
                id="detection-mask"
                type="image"
                url={maskUrl}
              >
                <Layer
                  id="detection-mask-raster"
                  paint={{ "raster-opacity": maskRasterOpacity }}
                  source="detection-mask"
                  type="raster"
                />
              </Source>
            ) : null}
          </>
        ) : null}
      </Map>
      <DetectionSvgOverlay
        detections={projectedDetections}
        onDetectionSelect={onDetectionSelect}
        selectedDetectionIndex={selectedDetectionIndex}
      />
      <div className="absolute left-4 top-4 z-[2] rounded border border-line bg-white px-3 py-2 shadow-sm">
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

function DetectionSvgOverlay({
  detections,
  selectedDetectionIndex,
  onDetectionSelect
}: {
  detections: ProjectedDetection[];
  selectedDetectionIndex: number | null;
  onDetectionSelect?: (index: number) => void;
}) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-[1] h-full w-full overflow-visible">
      {detections.map(({ color, index, key, label, points }) => {
        const isSelected = selectedDetectionIndex === index;
        const polygonPoints = [
          points.topLeft,
          points.topRight,
          points.bottomRight,
          points.bottomLeft
        ]
          .map((point) => `${point.x},${point.y}`)
          .join(" ");

        return (
          <g
            className="pointer-events-auto cursor-pointer"
            key={key}
            onClick={() => onDetectionSelect?.(index)}
          >
            <polygon
              fill={isSelected ? "rgba(20, 184, 166, 0.22)" : "rgba(15, 118, 110, 0.14)"}
              points={polygonPoints}
              stroke={isSelected ? "#f97316" : color}
              strokeWidth={isSelected ? 4 : 2}
              vectorEffect="non-scaling-stroke"
            />
            <DetectionLabel color={isSelected ? "#f97316" : color} label={label} point={points.topLeft} />
          </g>
        );
      })}
    </svg>
  );
}

function DetectionLabel({
  color,
  label,
  point
}: {
  color: string;
  label: string;
  point: { x: number; y: number };
}) {
  const x = point.x + 6;
  const y = point.y - 8;
  const labelWidth = Math.max(72, Math.min(190, label.length * 7 + 18));

  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        fill="rgba(255,255,255,0.94)"
        height="24"
        rx="4"
        stroke={color}
        strokeWidth="1.5"
        width={labelWidth}
        x="0"
        y="-20"
      />
      <text
        fill="#172033"
        fontSize="12"
        fontWeight="700"
        textLength={label.length > 20 ? labelWidth - 14 : undefined}
        x="8"
        y="-5"
      >
        {label}
      </text>
    </g>
  );
}

function getImageCoordinates(image: ImageMetadata): [LngLat, LngLat, LngLat, LngLat] {
  const { north, south, east, west } = image.bounds;

  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south]
  ];
}

function projectDetection({
  detection,
  image,
  index,
  map
}: {
  detection: Detection;
  image: ImageMetadata;
  index: number;
  map: MapRef;
}): ProjectedDetection {
  const corners = pixelBboxToLngLatCorners(detection.bbox, image);
  const projected = {
    topLeft: map.project(corners.topLeft),
    topRight: map.project(corners.topRight),
    bottomRight: map.project(corners.bottomRight),
    bottomLeft: map.project(corners.bottomLeft)
  };
  const label = `${detection.label} ${(detection.confidence * 100).toFixed(0)}%`;

  return {
    detection,
    index,
    key: `${detection.label}-${index}-${detection.bbox.join("-")}`,
    label,
    color: detection.color ?? getDetectionColor(detection.label),
    points: projected
  };
}

function pixelBboxToLngLatCorners(bbox: Detection["bbox"], image: ImageMetadata) {
  const [xMin, yMin, xMax, yMax] = bbox;

  return {
    topLeft: pixelToLngLat(xMin, yMin, image),
    topRight: pixelToLngLat(xMax, yMin, image),
    bottomRight: pixelToLngLat(xMax, yMax, image),
    bottomLeft: pixelToLngLat(xMin, yMax, image)
  };
}

function pixelToLngLat(x: number, y: number, image: ImageMetadata): LngLat {
  const { north, south, east, west } = image.bounds;
  const latSpan = north - south;
  const lngSpan = east - west;
  const clampedX = Math.min(Math.max(x, 0), image.width);
  const clampedY = Math.min(Math.max(y, 0), image.height);
  const lng = west + (clampedX / image.width) * lngSpan;
  const lat = north - (clampedY / image.height) * latSpan;

  return [lng, lat];
}

function getDetectionColor(label: string): string {
  if (label === "building") {
    return "#dc2626";
  }

  if (label === "vegetation") {
    return "#16a34a";
  }

  if (label === "road" || label === "road/path") {
    return "#2563eb";
  }

  if (label === "open_land" || label === "earth/ground") {
    return "#ca8a04";
  }

  return "#0f766e";
}

export default memo(DroneMapComponent);
