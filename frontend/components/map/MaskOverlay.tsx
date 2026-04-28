"use client";

import { memo } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import { ImageOverlay } from "react-leaflet";

type MaskOverlayProps = {
  bounds: LatLngBoundsExpression;
  maskUrl: string | null;
};

function MaskOverlayComponent({ bounds, maskUrl }: MaskOverlayProps) {
  if (!maskUrl) {
    return null;
  }

  return (
    <ImageOverlay
      bounds={bounds}
      interactive={false}
      opacity={0.85}
      url={maskUrl}
      zIndex={300}
    />
  );
}

export const MaskOverlay = memo(MaskOverlayComponent);
