"use client";

import { MapContainer, Rectangle, TileLayer } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

const initialCenter: [number, number] = [23.8103, 90.4125];
const sampleBounds: LatLngBoundsExpression = [
  [23.8068, 90.4078],
  [23.8142, 90.4174]
];

export function MapViewport() {
  return (
    <div className="relative h-full min-h-[520px]">
      <MapContainer center={initialCenter} zoom={14} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Rectangle
          bounds={sampleBounds}
          pathOptions={{ color: "#0f766e", fillOpacity: 0.08, weight: 2 }}
        />
      </MapContainer>
      <div className="absolute left-4 top-4 z-[500] rounded border border-line bg-white px-3 py-2 shadow-sm">
        <p className="text-sm font-semibold text-ink">Bounding box layer</p>
        <p className="text-xs text-muted">Ready for future predictions</p>
      </div>
    </div>
  );
}

