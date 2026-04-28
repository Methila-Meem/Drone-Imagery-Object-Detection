"use client";

import { memo, useEffect } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import { useMap } from "react-leaflet";

type FitBoundsProps = {
  bounds: LatLngBoundsExpression;
};

function FitBoundsComponent({ bounds }: FitBoundsProps) {
  const map = useMap();

  useEffect(() => {
    map.fitBounds(bounds, {
      animate: false,
      padding: [32, 32]
    });
  }, [bounds, map]);

  return null;
}

export const FitBounds = memo(FitBoundsComponent);
