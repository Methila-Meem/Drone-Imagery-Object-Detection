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
  filename: string;
  image_url: string;
  width: number;
  height: number;
  bounds: MapBounds;
};

export type ImageListResponse = {
  images: ImageMetadata[];
};

export type Detection = {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
};

export type DetectionResponse = {
  image_id: string;
  mode: "simulated";
  detections: Detection[];
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

export async function uploadDroneImage(file: File): Promise<ImageMetadata> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/images`, {
    method: "POST",
    body: formData,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Image upload failed: ${response.status}`);
  }

  return response.json() as Promise<ImageMetadata>;
}

export async function runDetection({
  imageId,
  confidenceThreshold
}: {
  imageId: string;
  confidenceThreshold: number;
}): Promise<DetectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/detect`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      image_id: imageId,
      confidence_threshold: confidenceThreshold
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Detection request failed: ${response.status}`);
  }

  return response.json() as Promise<DetectionResponse>;
}
