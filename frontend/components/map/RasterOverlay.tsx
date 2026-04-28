"use client";

import { memo } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import { ImageOverlay } from "react-leaflet";

type RasterOverlayProps = {
  bounds: LatLngBoundsExpression;
  imageUrl: string;
};

function RasterOverlayComponent({ bounds, imageUrl }: RasterOverlayProps) {
  return (
    <ImageOverlay
      bounds={bounds}
      opacity={0.9}
      url={imageUrl}
      zIndex={200}
    />
  );
}

export const RasterOverlay = memo(RasterOverlayComponent);
