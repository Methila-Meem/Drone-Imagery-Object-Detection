"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { buildDetectionGeoJson } from "@/lib/geojson";
import {
  getHealth,
  getImages,
  runDetection,
  uploadDroneImage,
  type Detection,
  type DetectionMode,
  type HealthResponse,
  type ImageMetadata,
  type UploadImageOptions
} from "@/lib/api";

const DroneMap = dynamic(() => import("@/components/map/DroneMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-muted">
      Loading map...
    </div>
  )
});

type BackendState =
  | { status: "loading"; message: string }
  | { status: "online"; data: HealthResponse }
  | { status: "offline"; message: string };

type ImagesState =
  | { status: "loading"; message: string }
  | { status: "ready"; images: ImageMetadata[] }
  | { status: "error"; message: string };

type UploadState =
  | { status: "idle"; message: string | null }
  | { status: "uploading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type DetectionState =
  | { status: "idle"; message: string | null }
  | { status: "running"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type DetectionRunSummary = {
  mode: DetectionMode;
  count: number;
  confidenceThreshold: number;
} | null;

const detectionModeOptions = [
  "simulated",
  "segformer",
  "yolo"
] as const satisfies readonly DetectionMode[];

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ACCEPTED_UPLOAD_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/jpg": [".jpg", ".jpeg"],
  "image/pjpeg": [".jpg", ".jpeg"],
  "image/png": [".png"]
};

export function Dashboard() {
  const [backend, setBackend] = useState<BackendState>({
    status: "loading",
    message: "Checking backend"
  });
  const [imagesState, setImagesState] = useState<ImagesState>({
    status: "loading",
    message: "Loading available imagery"
  });
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
    message: null
  });
  const [imageRevision, setImageRevision] = useState<number>(0);
  const [lastUploadedImage, setLastUploadedImage] =
    useState<ImageMetadata | null>(null);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("segformer");
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.5);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [droneOpacity, setDroneOpacity] = useState<number>(0.85);
  const [selectedDetectionIndex, setSelectedDetectionIndex] =
    useState<number | null>(null);
  const [detectionState, setDetectionState] = useState<DetectionState>({
    status: "idle",
    message: null
  });
  const [detectionRunSummary, setDetectionRunSummary] =
    useState<DetectionRunSummary>(null);

  useEffect(() => {
    let isMounted = true;

    getHealth()
      .then((data) => {
        if (isMounted) {
          setBackend({ status: "online", data });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setBackend({
            status: "offline",
            message:
              error instanceof Error
                ? error.message
                : "Unable to reach backend"
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    getImages()
      .then((data) => {
        if (!isMounted) {
          return;
        }

        const sortedImages = sortImagesNewestFirst(data.images);
        setImagesState({ status: "ready", images: sortedImages });
        setSelectedImageId(sortedImages[0]?.image_id ?? null);
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setImagesState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load available imagery"
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const isOnline = backend.status === "online";
  const images = imagesState.status === "ready" ? imagesState.images : [];
  const sortedImages = useMemo(() => sortImagesNewestFirst(images), [images]);
  const selectedImageBase =
    images.find((image) => image.image_id === selectedImageId) ?? null;
  const selectedImage = useMemo(() => {
    if (!selectedImageBase) {
      return null;
    }

    return {
      ...selectedImageBase,
      image_url:
        imageRevision > 0
          ? `${selectedImageBase.image_url}?v=${imageRevision}`
          : selectedImageBase.image_url
    };
  }, [imageRevision, selectedImageBase]);

  const handleUpload = async (file: File, options?: UploadImageOptions) => {
    setUploadState({
      status: "uploading",
      message: "Uploading image"
    });

    try {
      const uploadedImage = await uploadDroneImage(file, options);
      setImagesState((currentState) => {
        if (currentState.status !== "ready") {
          return { status: "ready", images: [uploadedImage] };
        }

        const existingIndex = currentState.images.findIndex(
          (image) => image.image_id === uploadedImage.image_id
        );

        if (existingIndex === -1) {
          return {
            status: "ready",
            images: [uploadedImage, ...currentState.images]
          };
        }

        return {
          status: "ready",
          images: currentState.images.map((image, index) =>
            index === existingIndex ? uploadedImage : image
          )
        };
      });
      setSelectedImageId(uploadedImage.image_id);
      setLastUploadedImage(uploadedImage);
      setImageRevision((currentRevision) => currentRevision + 1);
      setDetections([]);
      setMaskUrl(null);
      setDetectionRunSummary(null);
      setDetectionState({ status: "idle", message: null });
      setUploadState({
        status: "success",
        message: "Image uploaded"
      });
    } catch (error: unknown) {
      setUploadState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to upload image"
      });
    }
  };

  const handleRunDetection = async () => {
    if (!selectedImageId) {
      setDetectionState({
        status: "error",
        message: "Select an image before running detection"
      });
      return;
    }

    setDetectionState({
      status: "running",
      message: `Running ${formatDetectionMode(detectionMode)} detection`
    });

    try {
      const response = await runDetection({
        imageId: selectedImageId,
        confidenceThreshold,
        mode: detectionMode
      });
      setDetections(response.detections);
      setMaskUrl(response.mask_url);
      setSelectedDetectionIndex(null);
      setDetectionRunSummary({
        mode: response.mode,
        count: response.detections.length,
        confidenceThreshold
      });
      setDetectionState({
        status: "success",
        message:
          response.detections.length > 0
            ? `${response.detections.length} detections returned from ${formatDetectionMode(
                response.mode
              )}`
            : "No detections found above this threshold."
      });
    } catch (error: unknown) {
      setDetections([]);
      setMaskUrl(null);
      setSelectedDetectionIndex(null);
      setDetectionRunSummary(null);
      setDetectionState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to run detection"
      });
    }
  };

  const handleClearDetections = () => {
    setDetections([]);
    setMaskUrl(null);
    setSelectedDetectionIndex(null);
    setDetectionRunSummary(null);
    setDetectionState({ status: "idle", message: null });
  };

  const handleExportGeoJson = () => {
    if (!selectedImage || detections.length === 0 || !detectionRunSummary) {
      return;
    }

    if (typeof document === "undefined") {
      return;
    }

    const geoJson = buildDetectionGeoJson({
      detections,
      image: selectedImage,
      mode: detectionRunSummary.mode
    });
    const blob = new Blob([`${JSON.stringify(geoJson, null, 2)}\n`], {
      type: "application/geo+json"
    });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = `detections_${selectedImage.image_id}.geojson`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-5">
        <header className="flex flex-col gap-4 border-b border-line pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.12em] text-accent">
              Drone imagery
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">
              Semantic segmentation workspace
            </h1>
          </div>
          <div className="flex items-center gap-3 rounded border border-line bg-white px-4 py-3 shadow-sm">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? "bg-emerald-500" : "bg-rose-500"
              }`}
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-ink">
                Backend {isOnline ? "online" : "not connected"}
              </p>
              <p className="text-xs text-muted">
                {backend.status === "online"
                  ? `${backend.data.service}: ${backend.data.status}`
                  : backend.message}
              </p>
            </div>
          </div>
        </header>

        <section className="grid flex-1 gap-5 py-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <aside className="rounded border border-line bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Image workflow</h2>
            <div className="mt-4 space-y-3">
              <ImageUpload
                uploadedImage={lastUploadedImage}
                state={uploadState}
                onUpload={handleUpload}
              />
              <ImageSelector
                images={sortedImages}
                selectedImageId={selectedImageId}
                status={imagesState}
                onSelect={(imageId) => {
                  setSelectedImageId(imageId);
                  handleClearDetections();
                }}
              />
              <DetectionControls
                confidenceThreshold={confidenceThreshold}
                detectionCount={detections.length}
                detectionMode={detectionMode}
                droneOpacity={droneOpacity}
                disabled={!selectedImage || detectionState.status === "running"}
                hasMask={Boolean(maskUrl)}
                showOverlay={showOverlay}
                state={detectionState}
                onClear={handleClearDetections}
                onExportGeoJson={handleExportGeoJson}
                onOverlayVisibilityChange={setShowOverlay}
                onModeChange={(mode) => {
                  setDetectionMode(mode);
                  handleClearDetections();
                }}
                onOpacityChange={setDroneOpacity}
                onRun={handleRunDetection}
                onThresholdChange={setConfidenceThreshold}
              />
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Boxes" value={detections.length.toString()} />
                <Metric label="Overlay" value={maskUrl ? "1" : "0"} />
              </div>
            </div>
          </aside>

          <section className="relative min-h-[520px] overflow-hidden rounded border border-line bg-white shadow-sm">
            <DroneMap
              detections={detections}
              droneOpacity={droneOpacity}
              image={selectedImage}
              maskUrl={showOverlay ? maskUrl : null}
              onDetectionSelect={setSelectedDetectionIndex}
              selectedDetectionIndex={selectedDetectionIndex}
            />
            {imagesState.status === "loading" ? (
              <MapStatus message={imagesState.message} />
            ) : null}
            {imagesState.status === "error" ? (
              <MapStatus message={imagesState.message} tone="error" />
            ) : null}
            {imagesState.status === "ready" && images.length === 0 ? (
              <MapStatus message="No registered images are available." />
            ) : null}
          </section>

          <aside className="rounded border border-line bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Image details</h2>
            <ImageDetails image={selectedImage} />
            <DetectionResults
              detections={detections}
              mode={detectionRunSummary?.mode ?? detectionMode}
              runSummary={detectionRunSummary}
              selectedDetectionIndex={selectedDetectionIndex}
              state={detectionState}
            />
          </aside>
        </section>
      </div>
    </main>
  );
}

function ImageSelector({
  images,
  selectedImageId,
  status,
  onSelect
}: {
  images: ImageMetadata[];
  selectedImageId: string | null;
  status: ImagesState;
  onSelect: (imageId: string) => void;
}) {
  if (status.status === "loading") {
    return (
      <div className="rounded border border-line bg-slate-50 p-4">
        <p className="text-sm font-medium text-ink">Available imagery</p>
        <p className="mt-1 text-sm text-muted">{status.message}</p>
      </div>
    );
  }

  if (status.status === "error") {
    return (
      <div className="rounded border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-medium text-rose-900">
          Could not load imagery
        </p>
        <p className="mt-1 text-sm text-rose-700">{status.message}</p>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="rounded border border-line bg-slate-50 p-4">
        <p className="text-sm font-medium text-ink">Available imagery</p>
        <p className="mt-1 text-sm text-muted">No images registered yet.</p>
      </div>
    );
  }

  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">Available imagery</span>
      <select
        className="mt-2 w-full rounded border border-line bg-white px-3 py-2 text-sm text-ink outline-none ring-accent/20 transition focus:border-accent focus:ring-4"
        onChange={(event) => onSelect(event.target.value)}
        value={selectedImageId ?? ""}
      >
        {images.map((image) => (
          <option key={image.image_id} value={image.image_id}>
            {formatImageOptionLabel(image)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImageUpload({
  uploadedImage,
  state,
  onUpload
}: {
  uploadedImage: ImageMetadata | null;
  state: UploadState;
  onUpload: (file: File, options?: UploadImageOptions) => Promise<void>;
}) {
  const isUploading = state.status === "uploading";
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [selectedFile]);

  const handleAcceptedFile = (file: File) => {
    setSelectedFile(file);
    setClientError(null);
  };

  const handleRejectedFiles = (rejections: FileRejection[]) => {
    const firstError = rejections[0]?.errors[0];
    if (!firstError) {
      setClientError("Upload a JPEG or PNG image up to 50MB.");
      return;
    }

    if (firstError.code === "file-too-large") {
      setClientError("Image must be 50MB or smaller.");
      return;
    }

    if (firstError.code === "file-invalid-type") {
      setClientError("Only JPEG and PNG images are supported.");
      return;
    }

    setClientError(firstError.message);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPTED_UPLOAD_TYPES,
    disabled: isUploading,
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    multiple: false,
    noClick: true,
    onDropAccepted: ([file]) => {
      if (file) {
        handleAcceptedFile(file);
      }
    },
    onDropRejected: handleRejectedFiles
  });

  const handleSubmit = () => {
    if (!selectedFile) {
      setClientError("Choose a JPEG or PNG image before uploading.");
      return;
    }

    void onUpload(selectedFile);
  };

  return (
    <div className="rounded border border-line bg-slate-50 p-4">
      <p className="text-sm font-medium text-ink">Upload drone image</p>
      <div
        {...getRootProps({
          className: `mt-2 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded border border-dashed px-4 py-5 text-center transition ${
            isDragActive
              ? "border-accent bg-teal-50"
              : "border-line bg-white hover:border-accent"
          } ${isUploading ? "cursor-not-allowed opacity-60" : ""}`
        })}
      >
        <input {...getInputProps()} />
        <p className="text-sm font-semibold text-ink">
          {isDragActive ? "Drop image here" : "Drag and drop JPEG or PNG"}
        </p>
        <p className="mt-1 text-xs text-muted">Maximum file size: 50MB</p>
        <button
          className="mt-3 rounded border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed"
          disabled={isUploading}
          onClick={open}
          type="button"
        >
          Browse image
        </button>
      </div>
      {selectedFile ? (
        <div className="mt-3 rounded border border-line bg-white p-3">
          <div className="flex gap-3">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="h-16 w-16 rounded object-cover"
                src={previewUrl}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                {selectedFile.name}
              </p>
              <p className="mt-1 text-xs text-muted">
                {formatBytes(selectedFile.size)}
              </p>
            </div>
          </div>
          <button
            className="mt-3 min-h-10 w-full rounded bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isUploading}
            onClick={handleSubmit}
            type="button"
          >
            {isUploading ? "Uploading" : "Upload image"}
          </button>
        </div>
      ) : null}
      {clientError ? <p className="mt-2 text-sm text-rose-700">{clientError}</p> : null}
      {state.message ? (
        <p
          className={`mt-2 text-sm ${
            state.status === "error" ? "text-rose-700" : "text-muted"
          }`}
        >
          {state.message}
        </p>
      ) : null}
      {uploadedImage && state.status === "success" ? (
        <div className="mt-3 overflow-hidden rounded border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex min-w-0 gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="h-14 w-14 flex-none rounded object-cover"
              src={uploadedImage.image_url}
            />
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <p
                className="truncate font-semibold text-emerald-950"
                title={uploadedImage.filename}
              >
                {uploadedImage.filename}
              </p>
              <p
                className="mt-1 truncate font-mono text-xs text-emerald-800"
                title={uploadedImage.image_id}
              >
                {uploadedImage.image_id}
              </p>
              <p className="mt-1 truncate text-xs text-emerald-800">
                {formatBytes(uploadedImage.size_bytes)}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetectionControls({
  confidenceThreshold,
  detectionCount,
  detectionMode,
  droneOpacity,
  disabled,
  hasMask,
  showOverlay,
  state,
  onClear,
  onExportGeoJson,
  onOverlayVisibilityChange,
  onModeChange,
  onOpacityChange,
  onRun,
  onThresholdChange
}: {
  confidenceThreshold: number;
  detectionCount: number;
  detectionMode: DetectionMode;
  droneOpacity: number;
  disabled: boolean;
  hasMask: boolean;
  showOverlay: boolean;
  state: DetectionState;
  onClear: () => void;
  onExportGeoJson: () => void;
  onOverlayVisibilityChange: (isVisible: boolean) => void;
  onModeChange: (mode: DetectionMode) => void;
  onOpacityChange: (opacity: number) => void;
  onRun: () => Promise<void>;
  onThresholdChange: (threshold: number) => void;
}) {
  const isRunning = state.status === "running";
  const overlayLabel =
    detectionMode === "yolo" ? "Show YOLO overlay" : "Show segmentation mask";

  return (
    <div className="rounded border border-line bg-white p-4">
      <div>
        <p className="text-sm font-medium text-ink">Detection mode</p>
        <div className="mt-2 grid grid-cols-1 gap-1 rounded border border-line bg-slate-50 p-1">
          {detectionModeOptions.map((mode) => {
            const isSelected = detectionMode === mode;

            return (
              <button
                className={`min-h-9 w-full whitespace-nowrap rounded px-3 py-1.5 text-center text-sm font-semibold leading-5 transition ${
                  isSelected
                    ? "bg-white text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                } disabled:cursor-not-allowed disabled:opacity-60`}
                disabled={isRunning}
                key={mode}
                onClick={() => onModeChange(mode)}
                type="button"
              >
                {formatDetectionMode(mode)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-ink" htmlFor="threshold">
          Confidence
        </label>
        <span className="font-mono text-sm text-muted">
          {confidenceThreshold.toFixed(2)}
        </span>
      </div>
      <input
        className="mt-3 w-full accent-teal-700"
        disabled={isRunning}
        id="threshold"
        max="0.95"
        min="0.1"
        onChange={(event) =>
          onThresholdChange(Number(event.currentTarget.value))
        }
        step="0.05"
        type="range"
        value={confidenceThreshold}
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-ink" htmlFor="drone-opacity">
          Drone opacity
        </label>
        <span className="font-mono text-sm text-muted">
          {Math.round(droneOpacity * 100)}%
        </span>
      </div>
      <input
        className="mt-3 w-full accent-teal-700"
        disabled={isRunning}
        id="drone-opacity"
        max="1"
        min="0.4"
        onChange={(event) =>
          onOpacityChange(Number(event.currentTarget.value))
        }
        step="0.05"
        type="range"
        value={droneOpacity}
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input
          checked={showOverlay}
          className="h-4 w-4 accent-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRunning || !hasMask}
          onChange={(event) =>
            onOverlayVisibilityChange(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>{overlayLabel}</span>
      </label>
      {detectionMode === "yolo" ? (
        <p className="mt-2 rounded border border-line bg-slate-50 p-2 text-xs text-muted">
          YOLOv8s produces object-detection bounding boxes. The transparent overlay is generated from bounding boxes and is not a true semantic segmentation mask.
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
        <button
          className="inline-flex min-h-10 items-center justify-center rounded bg-accent px-3 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => {
            void onRun();
          }}
          type="button"
        >
          {isRunning ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Running
            </span>
          ) : (
            "Run Detection"
          )}
        </button>
        <button
          className="min-h-10 rounded border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={detectionCount === 0 || isRunning}
          onClick={onClear}
          type="button"
        >
          Clear Results
        </button>
      </div>
      <button
        className="mt-2 min-h-10 w-full rounded border border-line bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={detectionCount === 0 || isRunning}
        onClick={onExportGeoJson}
        type="button"
      >
        Export GeoJSON
      </button>
      {state.message ? (
        <p
          className={`mt-2 text-sm ${
            state.status === "error" ? "text-rose-700" : "text-muted"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function ImageDetails({ image }: { image: ImageMetadata | null }) {
  if (!image) {
    return (
      <p className="mt-4 rounded border border-line bg-slate-50 p-4 text-sm text-muted">
        Select a registered image to inspect its map metadata.
      </p>
    );
  }

  return (
    <dl className="mt-4 space-y-4">
      <DetailRow label="Filename" value={image.filename} />
      <DetailRow label="image_id" value={image.image_id} />
      <DetailRow label="Image size" value={`${image.width} x ${image.height}`} />
      <div>
        <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
          Image bounds
        </dt>
        <dd className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <BoundValue label="North" value={image.bounds.north} />
          <BoundValue label="South" value={image.bounds.south} />
          <BoundValue label="East" value={image.bounds.east} />
          <BoundValue label="West" value={image.bounds.west} />
        </dd>
      </div>
    </dl>
  );
}

function DetectionResults({
  detections,
  mode,
  runSummary,
  selectedDetectionIndex,
  state
}: {
  detections: Detection[];
  mode: DetectionMode;
  runSummary: DetectionRunSummary;
  selectedDetectionIndex: number | null;
  state: DetectionState;
}) {
  const returnedCount = runSummary?.count ?? detections.length;

  return (
    <section className="mt-6 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">Detection results</h3>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-muted">
          {returnedCount}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <ResultMeta label="Current mode" value={formatDetectionMode(mode)} />
        <ResultMeta label="Returned" value={returnedCount.toString()} />
        <ResultMeta
          label="Threshold"
          value={runSummary ? runSummary.confidenceThreshold.toFixed(2) : "Not run"}
        />
      </dl>
      {state.status === "idle" && detections.length === 0 ? (
        <p className="mt-3 rounded border border-line bg-slate-50 p-3 text-sm text-muted">
          Run detection to show bounding boxes from the selected mode.
        </p>
      ) : null}
      {state.status === "running" ? (
        <p className="mt-3 rounded border border-line bg-slate-50 p-3 text-sm text-muted">
          Detection is running.
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {state.message ?? "Backend or model inference failed."}
        </p>
      ) : null}
      {state.status === "success" && detections.length === 0 ? (
        <p className="mt-3 rounded border border-line bg-slate-50 p-3 text-sm text-muted">
          No detections found above this threshold.
        </p>
      ) : null}
      {detections.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {detections.map((detection, index) => (
            <li
              className={`rounded border p-3 ${
                selectedDetectionIndex === index
                  ? "border-orange-300 bg-orange-50"
                  : "border-line bg-slate-50"
              }`}
              key={`${detection.label}-${index}-${detection.bbox.join("-")}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">
                  {detection.label}
                </p>
                <p className="font-mono text-xs text-muted">
                  {(detection.confidence * 100).toFixed(1)}%
                </p>
              </div>
              <p className="mt-1 font-mono text-xs text-muted">
                [{detection.bbox.join(", ")}]
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ResultMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-slate-50 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function formatDetectionMode(mode: DetectionMode): string {
  if (mode === "yolo") {
    return "YOLOv8s";
  }

  if (mode === "segformer" || mode === "real") {
    return "SegFormer";
  }

  return "Simulated";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function sortImagesNewestFirst(images: ImageMetadata[]): ImageMetadata[] {
  return [...images]
    .sort(
      (first, second) =>
        Date.parse(second.created_at) - Date.parse(first.created_at)
    );
}

function formatImageOptionLabel(image: ImageMetadata): string {
  return `${image.filename} - ${shortImageId(image.image_id)}`;
}

function shortImageId(imageId: string): string {
  return imageId.slice(0, 8);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}

function BoundValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line bg-slate-50 px-3 py-2">
      <span className="block text-xs text-muted">{label}</span>
      <span className="mt-0.5 block font-mono text-xs text-ink">
        {value.toFixed(6)}
      </span>
    </div>
  );
}

function MapStatus({
  message,
  tone = "default"
}: {
  message: string;
  tone?: "default" | "error";
}) {
  return (
    <div className="absolute inset-x-4 top-20 z-[500] rounded border border-line bg-white px-4 py-3 text-sm shadow-sm">
      <p className={tone === "error" ? "text-rose-700" : "text-muted"}>
        {message}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}
