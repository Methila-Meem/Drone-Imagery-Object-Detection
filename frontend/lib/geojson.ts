import type { Detection, DetectionMode, ImageMetadata } from "@/lib/api";

type GeoJsonPosition = [number, number];

type DetectionFeature = {
  type: "Feature";
  geometry: {
    type: "Polygon";
    coordinates: GeoJsonPosition[][];
  };
  properties: {
    label: string;
    confidence: number;
    image_id: string;
    mode: DetectionMode;
  };
};

export type DetectionFeatureCollection = {
  type: "FeatureCollection";
  features: DetectionFeature[];
};

export function buildDetectionGeoJson({
  detections,
  image,
  mode
}: {
  detections: Detection[];
  image: ImageMetadata;
  mode: DetectionMode;
}): DetectionFeatureCollection {
  return {
    type: "FeatureCollection",
    features: detections.map((detection) => ({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [pixelBboxToPolygon(detection.bbox, image)]
      },
      properties: {
        label: detection.label,
        confidence: detection.confidence,
        image_id: image.image_id,
        mode
      }
    }))
  };
}

function pixelBboxToPolygon(
  bbox: Detection["bbox"],
  image: ImageMetadata
): GeoJsonPosition[] {
  const [xMin, yMin, xMax, yMax] = bbox;
  const { north, south, east, west } = image.bounds;
  const latSpan = north - south;
  const lngSpan = east - west;

  const clampX = (value: number) => Math.min(Math.max(value, 0), image.width);
  const clampY = (value: number) => Math.min(Math.max(value, 0), image.height);
  const toLng = (x: number) => west + (clampX(x) / image.width) * lngSpan;
  const toLat = (y: number) => north - (clampY(y) / image.height) * latSpan;

  const topLeft: GeoJsonPosition = [toLng(xMin), toLat(yMin)];
  const topRight: GeoJsonPosition = [toLng(xMax), toLat(yMin)];
  const bottomRight: GeoJsonPosition = [toLng(xMax), toLat(yMax)];
  const bottomLeft: GeoJsonPosition = [toLng(xMin), toLat(yMax)];

  return [topLeft, topRight, bottomRight, bottomLeft, topLeft];
}
