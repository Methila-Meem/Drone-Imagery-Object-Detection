export type HealthResponse = {
  status: string;
  service: string;
};

export type MapBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type ImageMetadata = {
  image_id: string;
  display_name?: string | null;
  filename: string;
  image_url: string;
  width: number;
  height: number;
  size_bytes: number;
  bounds: MapBounds;
  created_at: string;
};

export type ImageListResponse = {
  images: ImageMetadata[];
};

export type UploadImageOptions = {
  bounds?: Partial<MapBounds>;
};

export type Detection = {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  pixel_area?: number | null;
  color?: string | null;
};

export type DetectionMode = "simulated" | "segformer" | "yolo" | "real";

export type DetectionResponse = {
  detection_id: string | null;
  image_id: string;
  mode: DetectionMode;
  model_used: string | null;
  inference_time_ms: number | null;
  image_width: number | null;
  image_height: number | null;
  detections: Detection[];
  mask_url: string | null;
  mask_base64?: string | null;
};

export type DetectionHistoryItem = {
  detection_id: string;
  image_id: string;
  timestamp: string;
  filename: string;
  image_url: string;
  image_width: number;
  image_height: number;
  bounds: MapBounds;
  mode: DetectionMode;
  model_used: string;
  class_count: number;
  detected_classes: string[];
  inference_time_ms: number | null;
  confidence_threshold: number;
  detections: Detection[];
  mask_url: string | null;
  created_at: string;
};

export type DetectionHistoryResponse = {
  history: DetectionHistoryItem[];
  page: number;
  page_size: number;
  total: number;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Backend health check failed: ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}

export async function getImages(): Promise<ImageListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/images`, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Image registry request failed: ${response.status}`);
  }

  return response.json() as Promise<ImageListResponse>;
}

export async function uploadDroneImage(
  file: File,
  options: UploadImageOptions = {}
): Promise<ImageMetadata> {
  const formData = new FormData();
  formData.append("file", file);

  if (options.bounds) {
    appendOptionalNumber(formData, "south", options.bounds.south);
    appendOptionalNumber(formData, "west", options.bounds.west);
    appendOptionalNumber(formData, "north", options.bounds.north);
    appendOptionalNumber(formData, "east", options.bounds.east);
  }

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: "POST",
    body: formData,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Image upload failed"));
  }

  return response.json() as Promise<ImageMetadata>;
}

function appendOptionalNumber(
  formData: FormData,
  key: string,
  value: number | undefined
) {
  if (typeof value === "number" && Number.isFinite(value)) {
    formData.append(key, value.toString());
  }
}

export async function runDetection({
  imageId,
  confidenceThreshold,
  mode = "segformer"
}: {
  imageId: string;
  confidenceThreshold: number;
  mode?: DetectionMode;
}): Promise<DetectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/detect`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image_id: imageId,
      mode,
      confidence_threshold: confidenceThreshold
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Detection request failed")
    );
  }

  return response.json() as Promise<DetectionResponse>;
}

export async function getDetectionHistory(): Promise<DetectionHistoryResponse> {
  const response = await fetch(`${API_BASE_URL}/api/history`, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Detection history request failed: ${response.status}`);
  }

  return response.json() as Promise<DetectionHistoryResponse>;
}

export async function downloadDetectionGeoJson(
  detectionId: string
): Promise<Blob> {
  const response = await fetch(
    `${API_BASE_URL}/api/export/geojson/${encodeURIComponent(detectionId)}`,
    {
      headers: {
        Accept: "application/geo+json, application/json"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "GeoJSON export failed"));
  }

  return response.blob();
}

export async function deleteDetectionHistoryItem(
  detectionId: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/history/${encodeURIComponent(detectionId)}`,
    {
      method: "DELETE",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(
      await getApiErrorMessage(response, "Detection history delete failed")
    );
  }
}

async function getApiErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };

    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return `${fallback}: ${payload.detail}`;
    }
  } catch {
    // Keep the status fallback if the backend did not return JSON.
  }

  return `${fallback}: ${response.status}`;
}
