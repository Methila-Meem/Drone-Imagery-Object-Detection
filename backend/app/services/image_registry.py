from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import ExifTags, Image, ImageOps, UnidentifiedImageError


DEMO_IMAGE_ID = "drone_image_001"
DEMO_IMAGE_FILENAME = "drone_001.jpg"
STATIC_IMAGES_DIR = Path(__file__).resolve().parents[2] / "static" / "images"

GPS_INFO_TAG = next(
    tag_id for tag_id, tag_name in ExifTags.TAGS.items() if tag_name == "GPSInfo"
)
GPS_TAGS_BY_NAME = {tag_name: tag_id for tag_id, tag_name in ExifTags.GPSTAGS.items()}


@dataclass(frozen=True)
class ImageBounds:
    north: float
    south: float
    east: float
    west: float


@dataclass(frozen=True)
class RegisteredImage:
    image_id: str
    filename: str
    width: int
    height: int
    bounds: ImageBounds


class UnknownImageError(KeyError):
    def __init__(self, image_id: str) -> None:
        self.image_id = image_id
        super().__init__(image_id)


class InvalidImageError(ValueError):
    pass


FALLBACK_BOUNDS = ImageBounds(
    north=23.005,
    south=23.000,
    east=90.006,
    west=90.000,
)


def _bounds_from_center(
    latitude: float,
    longitude: float,
    fallback_bounds: ImageBounds = FALLBACK_BOUNDS,
) -> ImageBounds:
    """Center the current demo footprint on EXIF GPS coordinates."""
    lat_span = fallback_bounds.north - fallback_bounds.south
    lng_span = fallback_bounds.east - fallback_bounds.west
    half_lat_span = lat_span / 2
    half_lng_span = lng_span / 2

    return ImageBounds(
        north=latitude + half_lat_span,
        south=latitude - half_lat_span,
        east=longitude + half_lng_span,
        west=longitude - half_lng_span,
    )


def _rational_to_float(value: object) -> float:
    if isinstance(value, tuple) and len(value) == 2:
        numerator, denominator = value
        return float(numerator) / float(denominator)

    return float(value)


def _gps_coordinate_to_decimal(
    coordinate: object,
    reference: object,
) -> float | None:
    if not isinstance(coordinate, (tuple, list)) or len(coordinate) != 3:
        return None

    degrees = _rational_to_float(coordinate[0])
    minutes = _rational_to_float(coordinate[1])
    seconds = _rational_to_float(coordinate[2])
    decimal = degrees + minutes / 60 + seconds / 3600

    if isinstance(reference, bytes):
        reference_text = reference.decode(errors="ignore")
    else:
        reference_text = str(reference)

    if reference_text.upper() in {"S", "W"}:
        return -decimal

    return decimal


def _extract_gps_center(image: Image.Image) -> tuple[float, float] | None:
    try:
        exif = image.getexif()
    except (AttributeError, OSError, ValueError):
        return None

    gps_info = exif.get_ifd(GPS_INFO_TAG) if GPS_INFO_TAG in exif else None
    if not gps_info:
        return None

    latitude = _gps_coordinate_to_decimal(
        gps_info.get(GPS_TAGS_BY_NAME["GPSLatitude"]),
        gps_info.get(GPS_TAGS_BY_NAME["GPSLatitudeRef"]),
    )
    longitude = _gps_coordinate_to_decimal(
        gps_info.get(GPS_TAGS_BY_NAME["GPSLongitude"]),
        gps_info.get(GPS_TAGS_BY_NAME["GPSLongitudeRef"]),
    )

    if latitude is None or longitude is None:
        return None

    return latitude, longitude


def _read_demo_image_from_disk() -> RegisteredImage:
    target_path = STATIC_IMAGES_DIR / DEMO_IMAGE_FILENAME
    width = 2048
    height = 1536
    bounds = FALLBACK_BOUNDS

    if target_path.exists():
        try:
            with Image.open(target_path) as image:
                width = image.width
                height = image.height
                gps_center = _extract_gps_center(image)
        except (UnidentifiedImageError, OSError):
            gps_center = None

        if gps_center is not None:
            bounds = _bounds_from_center(*gps_center)

    return RegisteredImage(
        image_id=DEMO_IMAGE_ID,
        filename=DEMO_IMAGE_FILENAME,
        width=width,
        height=height,
        bounds=bounds,
    )


_IMAGES: dict[str, RegisteredImage] = {DEMO_IMAGE_ID: _read_demo_image_from_disk()}


def list_images() -> list[RegisteredImage]:
    return list(_IMAGES.values())


def get_image(image_id: str) -> RegisteredImage:
    try:
        return _IMAGES[image_id]
    except KeyError as exc:
        raise UnknownImageError(image_id) from exc


def replace_demo_image(file: BinaryIO) -> RegisteredImage:
    current_image = get_image(DEMO_IMAGE_ID)
    target_path = STATIC_IMAGES_DIR / DEMO_IMAGE_FILENAME
    temp_path = target_path.with_suffix(".uploading.jpg")

    try:
        image = Image.open(file)
        exif_bytes = image.info.get("exif")
        gps_center = _extract_gps_center(image)
        image = ImageOps.exif_transpose(image)
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("Uploaded file is not a readable image.") from exc

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    save_kwargs = {"format": "JPEG", "quality": 95}
    if exif_bytes:
        save_kwargs["exif"] = exif_bytes

    image.save(temp_path, **save_kwargs)
    temp_path.replace(target_path)

    bounds = (
        _bounds_from_center(*gps_center, fallback_bounds=current_image.bounds)
        if gps_center is not None
        else current_image.bounds
    )

    updated_image = RegisteredImage(
        image_id=current_image.image_id,
        filename=current_image.filename,
        width=image.width,
        height=image.height,
        bounds=bounds,
    )
    _IMAGES[DEMO_IMAGE_ID] = updated_image
    return updated_image
