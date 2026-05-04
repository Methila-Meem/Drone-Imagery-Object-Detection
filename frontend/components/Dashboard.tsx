"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  deleteDetectionHistoryItem,
  downloadDetectionGeoJson,
  getDetectionHistory,
  getHealth,
  getImages,
  runDetection,
  uploadDroneImage,
  type Detection,
  type DetectionHistoryItem,
  type DetectionMode,
  type DetectionResponse,
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

type HistoryState =
  | { status: "idle"; history: DetectionHistoryItem[]; message: string | null }
  | { status: "loading"; history: DetectionHistoryItem[]; message: string }
  | { status: "ready"; history: DetectionHistoryItem[]; message: string | null }
  | { status: "error"; history: DetectionHistoryItem[]; message: string };

type DetectionRun = DetectionResponse & {
  created_at?: string;
  source: "current" | "history";
};

type PanelTab = "results" | "history";
type BoundsInputState = Record<"south" | "west" | "north" | "east", string>;

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

const FALLBACK_UPLOAD_BOUNDS = {
  south: 23.778,
  west: 90.354,
  north: 23.782,
  east: 90.358
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
  const [imageRevision, setImageRevision] = useState(0);
  const [lastUploadedImage, setLastUploadedImage] =
    useState<ImageMetadata | null>(null);
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("segformer");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [activeRun, setActiveRun] = useState<DetectionRun | null>(null);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [visibleClasses, setVisibleClasses] = useState<Record<string, boolean>>(
    {}
  );
  const [droneOpacity, setDroneOpacity] = useState(0.85);
  const [selectedDetectionIndex, setSelectedDetectionIndex] =
    useState<number | null>(null);
  const [detectionState, setDetectionState] = useState<DetectionState>({
    status: "idle",
    message: null
  });
  const [historyState, setHistoryState] = useState<HistoryState>({
    status: "idle",
    history: [],
    message: null
  });
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("results");
  const [exportState, setExportState] = useState<string | null>(null);

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

  useEffect(() => {
    void refreshHistory(false);
  }, []);

  const isOnline = backend.status === "online";
  const images = useMemo(
    () => (imagesState.status === "ready" ? imagesState.images : []),
    [imagesState]
  );
  const sortedImages = useMemo(() => sortImagesNewestFirst(images), [images]);
  const selectedImageBase = useMemo(
    () => images.find((image) => image.image_id === selectedImageId) ?? null,
    [images, selectedImageId]
  );
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

  const classSummaries = useMemo(
    () => buildClassSummaries(activeRun?.detections ?? []),
    [activeRun]
  );
  const filteredDetections = useMemo(() => {
    if (!activeRun) {
      return [];
    }

    return activeRun.detections.filter(
      (detection) =>
        detection.confidence >= confidenceThreshold &&
        visibleClasses[detection.label] !== false
    );
  }, [activeRun, confidenceThreshold, visibleClasses]);

  const allClassesHidden =
    classSummaries.length > 0 &&
    classSummaries.every((summary) => visibleClasses[summary.label] === false);
  const hasHiddenClasses =
    classSummaries.length > 0 &&
    classSummaries.some((summary) => visibleClasses[summary.label] === false);
  const isOverlayVisible =
    showOverlay &&
    !allClassesHidden &&
    !hasHiddenClasses &&
    filteredDetections.length > 0 &&
    Boolean(maskUrl);

  const handleUpload = async (file: File, options?: UploadImageOptions) => {
    setUploadState({ status: "uploading", message: "Uploading image" });

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
      clearDetections();
      setUploadState({ status: "success", message: "Image uploaded" });
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
    setActivePanelTab("results");
    setExportState(null);

    try {
      const response = await runDetection({
        imageId: selectedImageId,
        confidenceThreshold: 0,
        mode: detectionMode
      });
      applyDetectionRun({ ...response, source: "current" });
      setDetectionState({
        status: "success",
        message:
          response.detections.length > 0
            ? `${response.detections.length} detections loaded. Use filters without rerunning inference.`
            : "No detections returned by the model."
      });
      await refreshHistory(false);
    } catch (error: unknown) {
      clearDetections();
      setDetectionState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unable to run detection"
      });
    }
  };

  const applyDetectionRun = (run: DetectionRun) => {
    setActiveRun(run);
    setMaskUrl(run.mask_url);
    setSelectedDetectionIndex(null);
    setVisibleClasses(createVisibleClassMap(run.detections));
  };

  const clearDetections = () => {
    setActiveRun(null);
    setMaskUrl(null);
    setSelectedDetectionIndex(null);
    setVisibleClasses({});
    setExportState(null);
    setDetectionState({ status: "idle", message: null });
  };

  async function refreshHistory(showLoading = true) {
    if (showLoading) {
      setHistoryState((current) => ({
        status: "loading",
        history: current.history,
        message: "Loading detection history"
      }));
    }

    try {
      const data = await getDetectionHistory();
      setHistoryState({
        status: "ready",
        history: data.history,
        message: data.history.length ? null : "No detection history yet."
      });
    } catch (error: unknown) {
      setHistoryState((current) => ({
        status: "error",
        history: current.history,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load detection history"
      }));
    }
  }

  const handleHistorySelect = (record: DetectionHistoryItem) => {
    const historyImage = historyRecordToImage(record);
    setImagesState((currentState) => {
      if (currentState.status !== "ready") {
        return { status: "ready", images: [historyImage] };
      }

      const exists = currentState.images.some(
        (image) => image.image_id === historyImage.image_id
      );
      return exists
        ? currentState
        : { status: "ready", images: [historyImage, ...currentState.images] };
    });
    setSelectedImageId(record.image_id);
    setDetectionMode(record.mode === "real" ? "segformer" : record.mode);
    setConfidenceThreshold(record.confidence_threshold);
    applyDetectionRun({
      detection_id: record.detection_id,
      image_id: record.image_id,
      mode: record.mode,
      model_used: record.model_used,
      inference_time_ms: record.inference_time_ms,
      image_width: record.image_width,
      image_height: record.image_height,
      detections: record.detections,
      mask_url: record.mask_url,
      source: "history",
      created_at: record.created_at
    });
    setDetectionState({
      status: "success",
      message: `Reloaded ${record.detections.length} detections from history.`
    });
    setActivePanelTab("results");
  };

  const handleHistoryDelete = async (record: DetectionHistoryItem) => {
    const shouldDelete = window.confirm(
      `Delete detection history record ${record.detection_id}?`
    );
    if (!shouldDelete) {
      return;
    }

    setHistoryState((current) => ({
      status: "loading",
      history: current.history,
      message: "Deleting detection history record"
    }));

    try {
      await deleteDetectionHistoryItem(record.detection_id);
      setHistoryState((current) => {
        const nextHistory = current.history.filter(
          (item) => item.detection_id !== record.detection_id
        );
        return {
          status: "ready",
          history: nextHistory,
          message: nextHistory.length
            ? "Detection history record deleted."
            : "No detection history yet."
        };
      });

      if (activeRun?.detection_id === record.detection_id) {
        clearDetections();
      }
    } catch (error: unknown) {
      setHistoryState((current) => ({
        status: "error",
        history: current.history,
        message:
          error instanceof Error
            ? error.message
            : "Unable to delete detection history record"
      }));
    }
  };

  const handleExportGeoJson = async () => {
    if (!activeRun?.detection_id) {
      setExportState("Run or load a saved detection before exporting.");
      return;
    }

    try {
      setExportState("Preparing backend GeoJSON");
      const blob = await downloadDetectionGeoJson(activeRun.detection_id);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `detections_${activeRun.detection_id}.geojson`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setExportState("GeoJSON downloaded from backend");
    } catch (error: unknown) {
      setExportState(
        error instanceof Error ? error.message : "Unable to export GeoJSON"
      );
    }
  };

  return (
    <main className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-none flex-col px-4 py-4 sm:px-5 lg:px-6">
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

        <section className="grid flex-1 gap-4 py-4 lg:min-h-[calc(100vh-112px)] lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          <aside className="min-w-0 rounded border border-line bg-white p-4 shadow-sm">
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
                  clearDetections();
                }}
              />
              <DetectionControls
                confidenceThreshold={confidenceThreshold}
                detectionCount={filteredDetections.length}
                detectionMode={detectionMode}
                droneOpacity={droneOpacity}
                disabled={!selectedImage || detectionState.status === "running"}
                exportDisabled={!activeRun?.detection_id}
                hasMask={Boolean(maskUrl)}
                showOverlay={showOverlay}
                state={detectionState}
                onClear={clearDetections}
                onExportGeoJson={handleExportGeoJson}
                onOverlayVisibilityChange={setShowOverlay}
                onModeChange={(mode) => {
                  setDetectionMode(mode);
                  clearDetections();
                }}
                onOpacityChange={setDroneOpacity}
                onRun={handleRunDetection}
                onThresholdChange={(threshold) => {
                  setConfidenceThreshold(threshold);
                  setSelectedDetectionIndex(null);
                }}
              />
              {exportState ? (
                <p className="rounded border border-line bg-slate-50 p-3 text-sm text-muted">
                  {exportState}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Metric
                  label="Model Used"
                  value={formatShortModel(activeRun?.model_used)}
                />
                <Metric
                  label="Inference Time"
                  value={formatInferenceTime(activeRun?.inference_time_ms)}
                />
                <Metric
                  label="Returned"
                  value={`${activeRun?.detections.length ?? 0} boxes`}
                />
                <Metric
                  label="Threshold"
                  value={confidenceThreshold.toFixed(2)}
                />
              </div>
              <Legend summaries={classSummaries} />
            </div>
          </aside>

          <section className="relative min-h-[560px] min-w-0 overflow-hidden rounded-lg border border-line bg-white shadow-sm lg:min-h-[calc(100vh-112px)]">
            <DroneMap
              detections={filteredDetections}
              droneOpacity={droneOpacity}
              image={selectedImage}
              maskUrl={
                isOverlayVisible ? maskUrl : null
              }
              onDetectionSelect={setSelectedDetectionIndex}
              selectedDetectionIndex={selectedDetectionIndex}
            />
            {detectionState.status === "running" ? (
              <MapBusyOverlay message="Inference is running" />
            ) : null}
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

          <aside className="min-w-0 rounded border border-line bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Image details</h2>
            <ImageDetails image={selectedImage} />
            <PanelTabs activeTab={activePanelTab} onChange={setActivePanelTab} />
            {activePanelTab === "results" ? (
              <>
                <ClassFilters
                  summaries={classSummaries}
                  visibleClasses={visibleClasses}
                  onToggle={(label, isVisible) => {
                    setVisibleClasses((current) => ({
                      ...current,
                      [label]: isVisible
                    }));
                    setSelectedDetectionIndex(null);
                  }}
                />
                <DetectionResults
                  detections={filteredDetections}
                  onSelectDetection={setSelectedDetectionIndex}
                  rawCount={activeRun?.detections.length ?? 0}
                  returnedClassCount={classSummaries.length}
                  run={activeRun}
                  selectedDetectionIndex={selectedDetectionIndex}
                  state={detectionState}
                  threshold={confidenceThreshold}
                />
              </>
            ) : (
              <HistoryPanel
                state={historyState}
                onDelete={(record) => {
                  void handleHistoryDelete(record);
                }}
                onRefresh={() => {
                  void refreshHistory(true);
                }}
                onSelect={handleHistorySelect}
              />
            )}
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
    return <InfoBox title="Available imagery" message={status.message} />;
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
    return <InfoBox title="Available imagery" message="No images registered yet." />;
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
  const [clientError, setClientError] = useState<string | null>(null);
  const [useCustomBounds, setUseCustomBounds] = useState(false);
  const [boundsInput, setBoundsInput] = useState<BoundsInputState>({
    south: FALLBACK_UPLOAD_BOUNDS.south.toString(),
    west: FALLBACK_UPLOAD_BOUNDS.west.toString(),
    north: FALLBACK_UPLOAD_BOUNDS.north.toString(),
    east: FALLBACK_UPLOAD_BOUNDS.east.toString()
  });

  const previewUrl = useMemo(
    () => (selectedFile ? URL.createObjectURL(selectedFile) : null),
    [selectedFile]
  );

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPTED_UPLOAD_TYPES,
    disabled: isUploading,
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
    multiple: false,
    noClick: true,
    onDropAccepted: ([file]) => {
      if (file) {
        setSelectedFile(file);
        setClientError(null);
      }
    },
    onDropRejected: (rejections: FileRejection[]) => {
      const firstError = rejections[0]?.errors[0];
      if (!firstError) {
        setClientError("Upload a JPEG or PNG image up to 50MB.");
      } else if (firstError.code === "file-too-large") {
        setClientError("Image must be 50MB or smaller.");
      } else if (firstError.code === "file-invalid-type") {
        setClientError("Only JPEG and PNG images are supported.");
      } else {
        setClientError(firstError.message);
      }
    }
  });

  const handleSubmit = () => {
    if (!selectedFile) {
      setClientError("Choose a JPEG or PNG image before uploading.");
      return;
    }

    if (!useCustomBounds) {
      void onUpload(selectedFile);
      return;
    }

    const bounds = parseBoundsInput(boundsInput);
    if (!bounds) {
      setClientError("Enter valid SW and NE bounds before uploading.");
      return;
    }

    void onUpload(selectedFile, { bounds });
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
              <img alt="" className="h-16 w-16 rounded object-cover" src={previewUrl} />
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
      <div className="mt-3 rounded border border-line bg-white p-3">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            checked={useCustomBounds}
            className="h-4 w-4 accent-teal-700"
            disabled={isUploading}
            onChange={(event) => setUseCustomBounds(event.currentTarget.checked)}
            type="checkbox"
          />
          Custom SW/NE bounds
        </label>
        {useCustomBounds ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <BoundsInput
              disabled={isUploading}
              label="South"
              value={boundsInput.south}
              onChange={(value) =>
                setBoundsInput((current) => ({ ...current, south: value }))
              }
            />
            <BoundsInput
              disabled={isUploading}
              label="West"
              value={boundsInput.west}
              onChange={(value) =>
                setBoundsInput((current) => ({ ...current, west: value }))
              }
            />
            <BoundsInput
              disabled={isUploading}
              label="North"
              value={boundsInput.north}
              onChange={(value) =>
                setBoundsInput((current) => ({ ...current, north: value }))
              }
            />
            <BoundsInput
              disabled={isUploading}
              label="East"
              value={boundsInput.east}
              onChange={(value) =>
                setBoundsInput((current) => ({ ...current, east: value }))
              }
            />
          </div>
        ) : null}
      </div>
      {clientError ? <p className="mt-2 text-sm text-rose-700">{clientError}</p> : null}
      {state.message ? (
        <p className={`mt-2 text-sm ${state.status === "error" ? "text-rose-700" : "text-muted"}`}>
          {state.message}
        </p>
      ) : null}
      {uploadedImage && state.status === "success" ? (
        <div className="mt-3 overflow-hidden rounded border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex min-w-0 gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" className="h-14 w-14 flex-none rounded object-cover" src={uploadedImage.image_url} />
            <div className="min-w-0 flex-1 text-sm leading-tight">
              <p className="truncate font-semibold text-emerald-950" title={uploadedImage.filename}>
                {uploadedImage.filename}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-emerald-800" title={uploadedImage.image_id}>
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

function BoundsInput({
  disabled,
  label,
  value,
  onChange
}: {
  disabled: boolean;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-medium uppercase tracking-[0.12em] text-muted">
      {label}
      <input
        className="mt-1 w-full rounded border border-line bg-white px-2 py-1.5 font-mono text-sm normal-case tracking-normal text-ink outline-none ring-accent/20 transition focus:border-accent focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        inputMode="decimal"
        onChange={(event) => onChange(event.currentTarget.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

function parseBoundsInput(bounds: BoundsInputState) {
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);

  if (
    !Number.isFinite(south) ||
    !Number.isFinite(west) ||
    !Number.isFinite(north) ||
    !Number.isFinite(east) ||
    south >= north ||
    west >= east ||
    south < -90 ||
    north > 90 ||
    west < -180 ||
    east > 180
  ) {
    return null;
  }

  return { south, west, north, east };
}

function DetectionControls({
  confidenceThreshold,
  detectionCount,
  detectionMode,
  droneOpacity,
  disabled,
  exportDisabled,
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
  exportDisabled: boolean;
  hasMask: boolean;
  showOverlay: boolean;
  state: DetectionState;
  onClear: () => void;
  onExportGeoJson: () => Promise<void>;
  onOverlayVisibilityChange: (isVisible: boolean) => void;
  onModeChange: (mode: DetectionMode) => void;
  onOpacityChange: (opacity: number) => void;
  onRun: () => Promise<void>;
  onThresholdChange: (threshold: number) => void;
}) {
  const isRunning = state.status === "running";
  const overlayLabel =
    detectionMode === "segformer" || detectionMode === "real"
      ? "Show segmentation mask"
      : "Show overlay";

  return (
    <div className="rounded border border-line bg-white p-4">
      <p className="text-sm font-medium text-ink">Detection mode</p>
      <div className="mt-2 grid grid-cols-1 gap-1 rounded border border-line bg-slate-50 p-1">
        {detectionModeOptions.map((mode) => (
          <button
            className={`min-h-9 w-full whitespace-nowrap rounded px-3 py-1.5 text-center text-sm font-semibold leading-5 transition ${
              detectionMode === mode
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
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-ink" htmlFor="threshold">
          Confidence filter
        </label>
        <span className="font-mono text-sm text-muted">
          {confidenceThreshold.toFixed(2)}
        </span>
      </div>
      <input
        className="mt-3 w-full accent-teal-700"
        id="threshold"
        max="1"
        min="0"
        onChange={(event) => onThresholdChange(Number(event.currentTarget.value))}
        step="0.01"
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
        min="0"
        onChange={(event) => onOpacityChange(Number(event.currentTarget.value))}
        step="0.01"
        type="range"
        value={droneOpacity}
      />
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input
          checked={showOverlay}
          className="h-4 w-4 accent-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRunning || !hasMask}
          onChange={(event) => onOverlayVisibilityChange(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{overlayLabel}</span>
      </label>
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
        disabled={exportDisabled || isRunning}
        onClick={() => {
          void onExportGeoJson();
        }}
        type="button"
      >
        Export GeoJSON
      </button>
      {state.message ? (
        <p className={`mt-2 text-sm ${state.status === "error" ? "text-rose-700" : "text-muted"}`}>
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

function PanelTabs({
  activeTab,
  onChange
}: {
  activeTab: PanelTab;
  onChange: (tab: PanelTab) => void;
}) {
  return (
    <div className="mt-6 grid grid-cols-2 rounded border border-line bg-slate-50 p-1">
      {(["results", "history"] as const).map((tab) => (
        <button
          className={`min-h-9 rounded px-3 py-1.5 text-sm font-semibold capitalize transition ${
            activeTab === tab ? "bg-white text-ink shadow-sm" : "text-muted"
          }`}
          key={tab}
          onClick={() => onChange(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function ClassFilters({
  summaries,
  visibleClasses,
  onToggle
}: {
  summaries: ClassSummary[];
  visibleClasses: Record<string, boolean>;
  onToggle: (label: string, isVisible: boolean) => void;
}) {
  if (summaries.length === 0) {
    return null;
  }

  return (
    <section className="mt-4 rounded border border-line bg-slate-50 p-3">
      <p className="text-sm font-semibold text-ink">Class visibility</p>
      <div className="mt-2 space-y-2">
        {summaries.map((summary) => (
          <label className="flex items-center justify-between gap-3 text-sm" key={summary.label}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <input
                checked={visibleClasses[summary.label] !== false}
                className="h-4 w-4 flex-none accent-teal-700"
                onChange={(event) => onToggle(summary.label, event.currentTarget.checked)}
                type="checkbox"
              />
              <span className="h-3 w-3 flex-none rounded-sm" style={{ backgroundColor: summary.color }} />
              <span className="truncate font-medium text-ink">{summary.label}</span>
            </span>
            <span className="font-mono text-xs text-muted">{summary.count}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function DetectionResults({
  detections,
  onSelectDetection,
  rawCount,
  returnedClassCount,
  run,
  selectedDetectionIndex,
  state,
  threshold
}: {
  detections: Detection[];
  onSelectDetection: (index: number) => void;
  rawCount: number;
  returnedClassCount: number;
  run: DetectionRun | null;
  selectedDetectionIndex: number | null;
  state: DetectionState;
  threshold: number;
}) {
  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">Detection results</h3>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-muted">
          {detections.length}/{rawCount}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <ResultMeta label="Model" value={run?.model_used ?? "Not run"} />
        <ResultMeta
          label="Inference"
          value={formatInferenceTime(run?.inference_time_ms)}
        />
        <ResultMeta
          label="Returned"
          value={`${rawCount} boxes`}
        />
        <ResultMeta
          label="Classes"
          value={`${buildClassSummaries(detections).length}/${returnedClassCount}`}
        />
        <ResultMeta label="Filter" value={threshold.toFixed(2)} />
      </dl>
      {state.status === "idle" && !run ? (
        <InfoBox message="Run detection to show bounding boxes from the selected mode." />
      ) : null}
      {state.status === "running" ? <ResultSkeleton /> : null}
      {state.status === "error" ? (
        <p className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {state.message ?? "Backend or model inference failed."}
        </p>
      ) : null}
      {state.status === "success" && run && detections.length === 0 ? (
        <InfoBox message="No detections match the current confidence and class filters." />
      ) : null}
      {detections.length > 0 ? (
        <ul className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1">
          {detections.map((detection, index) => {
            const color = detection.color ?? getDetectionColor(detection.label);
            return (
              <li
                className={`rounded border p-3 ${
                  selectedDetectionIndex === index
                    ? "border-orange-300 bg-orange-50"
                    : "border-line bg-slate-50 hover:border-accent hover:bg-white"
                } cursor-pointer transition`}
                key={`${detection.label}-${index}-${detection.bbox.join("-")}`}
                onClick={() => onSelectDetection(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectDetection(index);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 flex-none rounded-sm" style={{ backgroundColor: color }} />
                    <span className="truncate text-sm font-semibold text-ink">
                      {detection.label}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {(detection.confidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
                  <div
                    className="h-full rounded"
                    style={{
                      backgroundColor: color,
                      width: `${Math.min(Math.max(detection.confidence, 0), 1) * 100}%`
                    }}
                  />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
                  <div>
                    <dt>Pixel area</dt>
                    <dd className="font-mono text-ink">
                      {formatNumber(getPixelArea(detection))}
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd className="truncate font-mono text-ink" title={run?.model_used ?? ""}>
                      {run?.model_used ?? "Unknown"}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function HistoryPanel({
  state,
  onDelete,
  onRefresh,
  onSelect
}: {
  state: HistoryState;
  onDelete: (record: DetectionHistoryItem) => void;
  onRefresh: () => void;
  onSelect: (record: DetectionHistoryItem) => void;
}) {
  return (
    <section className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">History</h3>
        <button
          className="rounded border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-slate-50"
          onClick={onRefresh}
          type="button"
        >
          Refresh
        </button>
      </div>
      {state.status === "loading" ? <ResultSkeleton /> : null}
      {state.message ? (
        <p className={`mt-3 rounded border p-3 text-sm ${
          state.status === "error"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-line bg-slate-50 text-muted"
        }`}>
          {state.message}
        </p>
      ) : null}
      {state.history.length > 0 ? (
        <ul className="mt-3 max-h-[520px] space-y-2 overflow-auto pr-1">
          {state.history.map((record) => (
            <li
              className="rounded border border-line bg-slate-50 p-3 transition hover:border-accent hover:bg-white"
              key={record.detection_id}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-ink">
                    {record.filename}
                  </p>
                  <span className="rounded bg-white px-2 py-1 text-xs font-semibold text-muted">
                    {record.detections.length}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {formatDetectionMode(record.mode)} / {formatInferenceTime(record.inference_time_ms)}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-muted">
                  {record.detection_id}
                </p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  className="flex-1 rounded border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-slate-50"
                  onClick={() => onSelect(record)}
                  type="button"
                >
                  Load
                </button>
                <button
                  className="rounded border border-rose-200 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                  onClick={() => onDelete(record)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Legend({ summaries }: { summaries: ClassSummary[] }) {
  if (summaries.length === 0) {
    return null;
  }

  return (
    <div className="rounded border border-line bg-white p-3">
      <p className="text-sm font-semibold text-ink">Legend</p>
      <div className="mt-2 space-y-2">
        {summaries.map((summary) => (
          <div className="flex items-center justify-between gap-3 text-sm" key={summary.label}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="h-3 w-3 flex-none rounded-sm" style={{ backgroundColor: summary.color }} />
              <span className="truncate text-ink">{summary.label}</span>
            </span>
            <span className="font-mono text-xs text-muted">{summary.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="mt-3 space-y-2 rounded border border-line bg-slate-50 p-3">
      <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
      <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200" />
    </div>
  );
}

function MapBusyOverlay({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-[4] flex items-center justify-center bg-white/55 backdrop-blur-[1px]">
      <div className="rounded border border-line bg-white px-4 py-3 shadow-sm">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          {message}
        </span>
      </div>
    </div>
  );
}

function InfoBox({ title, message }: { title?: string; message: string }) {
  return (
    <div className="mt-3 rounded border border-line bg-slate-50 p-4">
      {title ? <p className="text-sm font-medium text-ink">{title}</p> : null}
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

function ResultMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-slate-50 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
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

function formatShortModel(modelUsed: string | null | undefined): string {
  if (!modelUsed) {
    return "Not run";
  }
  if (modelUsed.includes("segformer")) {
    return "SegFormer-B2";
  }
  if (modelUsed.toLowerCase().includes("yolo")) {
    return "YOLOv8s";
  }
  return modelUsed;
}

function formatInferenceTime(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "Not run";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function sortImagesNewestFirst(images: ImageMetadata[]): ImageMetadata[] {
  return [...images].sort(
    (first, second) =>
      Date.parse(second.created_at) - Date.parse(first.created_at)
  );
}

function formatImageOptionLabel(image: ImageMetadata): string {
  return `${image.filename} — ${shortImageId(image.image_id)}`;
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
    <div className="absolute inset-x-4 top-20 z-[3] rounded border border-line bg-white px-4 py-3 text-sm shadow-sm">
      <p className={tone === "error" ? "text-rose-700" : "text-muted"}>
        {message}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-line bg-white p-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}

type ClassSummary = {
  label: string;
  color: string;
  count: number;
};

function buildClassSummaries(detections: Detection[]): ClassSummary[] {
  const summaries = new Map<string, ClassSummary>();
  for (const detection of detections) {
    const existing = summaries.get(detection.label);
    if (existing) {
      existing.count += 1;
    } else {
      summaries.set(detection.label, {
        label: detection.label,
        color: detection.color ?? getDetectionColor(detection.label),
        count: 1
      });
    }
  }
  return [...summaries.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function createVisibleClassMap(detections: Detection[]): Record<string, boolean> {
  return Object.fromEntries(
    buildClassSummaries(detections).map((summary) => [summary.label, true])
  );
}

function getPixelArea(detection: Detection): number {
  if (typeof detection.pixel_area === "number") {
    return detection.pixel_area;
  }

  const [xMin, yMin, xMax, yMax] = detection.bbox;
  return Math.max(xMax - xMin, 0) * Math.max(yMax - yMin, 0);
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
  if (label === "person" || label === "car" || label === "truck") {
    return "#7c3aed";
  }
  return "#0f766e";
}

function historyRecordToImage(record: DetectionHistoryItem): ImageMetadata {
  return {
    image_id: record.image_id,
    filename: record.filename,
    image_url: record.image_url,
    width: record.image_width,
    height: record.image_height,
    size_bytes: 0,
    bounds: record.bounds,
    created_at: record.created_at
  };
}
