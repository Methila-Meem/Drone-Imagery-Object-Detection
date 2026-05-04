from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from shutil import copy2
from uuid import uuid4

from PIL import ExifTags, Image, ImageOps, UnidentifiedImageError

from app.db.database import get_connection, initialize_database
from app.db.image_repo import delete_legacy_images_except
from app.db.image_repo import ImageRecord, get_image as repo_get_image
from app.db.image_repo import list_images as repo_list_images
from app.db.image_repo import upsert_image


STATIC_DIR = Path(__file__).resolve().parents[2] / "static"
STATIC_IMAGES_DIR = STATIC_DIR / "images"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/pjpeg", "image/png"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
ALLOWED_PIL_FORMATS = {"JPEG": ".jpg", "MPO": ".jpg", "PNG": ".png"}
JPEG_LIKE_PIL_FORMATS = {"JPEG", "MPO"}

SAMPLE_IMAGE_SOURCE = STATIC_IMAGES_DIR / "drone_001.jpg"
SAMPLE_IMAGES = (
    (
        "11111111-1111-4111-8111-111111111111",
        "DJI_0059_Kafrul",
        "dji_sample_001.jpg",
        "dji_sample_001.jpg",
    ),
    (
        "22222222-2222-4222-8222-222222222222",
        "DJI_0060_Kafrul",
        "dji_sample_002.jpg",
        "dji_sample_002.jpg",
    ),
    (
        "33333333-3333-4333-8333-333333333333",
        "DJI_0061_Kafrul",
        "dji_sample_003.jpg",
        "dji_sample_003.jpg",
    ),
)

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
    display_name: str
    filename: str
    filepath: Path
    width: int
    height: int
    size_bytes: int
    bounds: ImageBounds
    created_at: str


class UnknownImageError(KeyError):
    def __init__(self, image_id: str) -> None:
        self.image_id = image_id
        super().__init__(image_id)


class InvalidImageError(ValueError):
    pass


FALLBACK_BOUNDS = ImageBounds(
    south=23.778,
    west=90.354,
    north=23.782,
    east=90.358,
)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


async def initialize_image_registry() -> None:
    await initialize_database()
    await cleanup_legacy_image_records()
    await seed_sample_images()


async def seed_sample_images() -> None:
    STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    if not SAMPLE_IMAGE_SOURCE.exists():
        return

    connection = await get_connection()
    try:
        for image_id, display_name, filename, stored_filename in SAMPLE_IMAGES:
            target_path = STATIC_IMAGES_DIR / stored_filename
            if not target_path.exists():
                copy2(SAMPLE_IMAGE_SOURCE, target_path)

            width, height = _read_image_size(target_path)
            size_bytes = target_path.stat().st_size
            await upsert_image(
                connection,
                ImageRecord(
                    image_id=image_id,
                    display_name=display_name,
                    filename=filename,
                    filepath=str(target_path),
                    width=width,
                    height=height,
                    size_bytes=size_bytes,
                    south=FALLBACK_BOUNDS.south,
                    west=FALLBACK_BOUNDS.west,
                    north=FALLBACK_BOUNDS.north,
                    east=FALLBACK_BOUNDS.east,
                    created_at=f"2026-01-01T00:00:0{len(filename) % 3}Z",
                    source="seed",
                ),
            )
        await connection.commit()
    finally:
        await connection.close()


async def cleanup_legacy_image_records() -> int:
    seed_image_ids = {image_id for image_id, *_ in SAMPLE_IMAGES}
    connection = await get_connection()
    try:
        removed_count = await delete_legacy_images_except(connection, seed_image_ids)
        await connection.commit()
        return removed_count
    finally:
        await connection.close()


async def list_images() -> list[RegisteredImage]:
    connection = await get_connection()
    try:
        records = await repo_list_images(connection)
    finally:
        await connection.close()
    return [_record_to_registered_image(record) for record in records]


async def get_image(image_id: str) -> RegisteredImage:
    connection = await get_connection()
    try:
        record = await repo_get_image(connection, image_id)
    finally:
        await connection.close()

    if record is None:
        raise UnknownImageError(image_id)
    return _record_to_registered_image(record)


async def register_uploaded_image(
    *,
    content: bytes,
    content_type: str | None,
    original_filename: str | None,
    display_name: str | None = None,
    bounds: ImageBounds | None = None,
) -> RegisteredImage:
    if not content:
        raise InvalidImageError("Uploaded image is empty.")

    if len(content) > MAX_UPLOAD_BYTES:
        raise InvalidImageError("Uploaded image exceeds the 50MB limit.")

    if not _has_allowed_upload_type(content_type, original_filename):
        raise InvalidImageError(
            "Uploaded file must be a JPEG or PNG image with a .jpg, .jpeg, or .png filename."
        )

    try:
        with Image.open(BytesIO(content)) as opened_image:
            image_format = opened_image.format
            if image_format not in ALLOWED_PIL_FORMATS:
                raise InvalidImageError(
                    f"Uploaded file must contain JPEG, DJI MPO/JPG, or PNG image data; detected {image_format or 'unknown'} data."
                )

            if image_format == "MPO":
                opened_image.seek(0)

            image = ImageOps.exif_transpose(opened_image)
            if image.mode not in ("RGB", "RGBA", "L"):
                image = image.convert("RGB")

            image_id = str(uuid4())
            extension = ALLOWED_PIL_FORMATS[image_format]
            saved_filename = f"{image_id}{extension}"
            target_path = STATIC_IMAGES_DIR / saved_filename
            save_format = "JPEG" if image_format in JPEG_LIKE_PIL_FORMATS else "PNG"

            if save_format == "JPEG" and image.mode != "RGB":
                image = image.convert("RGB")

            STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
            image.save(target_path, format=save_format)
            width = image.width
            height = image.height
    except InvalidImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidImageError("Uploaded file is not a readable JPEG or PNG image.") from exc

    image_bounds = bounds if bounds is not None else FALLBACK_BOUNDS
    stored_image = ImageRecord(
        image_id=image_id,
        filename=_display_filename(original_filename, saved_filename),
        display_name=_display_name(display_name, original_filename, image_id),
        filepath=str(target_path),
        width=width,
        height=height,
        size_bytes=target_path.stat().st_size,
        south=image_bounds.south,
        west=image_bounds.west,
        north=image_bounds.north,
        east=image_bounds.east,
        created_at=_utc_now(),
        source="upload",
    )

    connection = await get_connection()
    try:
        await upsert_image(connection, stored_image)
        await connection.commit()
    finally:
        await connection.close()

    return _record_to_registered_image(stored_image)


def validate_bounds(
    *,
    south: float | None,
    west: float | None,
    north: float | None,
    east: float | None,
) -> ImageBounds | None:
    values = (south, west, north, east)
    if all(value is None for value in values):
        return None
    if any(value is None for value in values):
        raise InvalidImageError(
            "Upload bounds must include south, west, north, and east together."
        )

    assert south is not None
    assert west is not None
    assert north is not None
    assert east is not None

    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise InvalidImageError("Upload latitude bounds must be between -90 and 90.")
    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise InvalidImageError("Upload longitude bounds must be between -180 and 180.")
    if south >= north:
        raise InvalidImageError("Upload bounds require south to be less than north.")
    if west >= east:
        raise InvalidImageError("Upload bounds require west to be less than east.")

    return ImageBounds(south=south, west=west, north=north, east=east)


def get_static_image_path(image: RegisteredImage) -> Path:
    return image.filepath


def get_static_image_url_path(image: RegisteredImage) -> str:
    try:
        return image.filepath.relative_to(STATIC_DIR).as_posix()
    except ValueError:
        return f"images/{image.filepath.name}"


def _record_to_registered_image(record: ImageRecord) -> RegisteredImage:
    return RegisteredImage(
        image_id=record.image_id,
        display_name=record.display_name,
        filename=record.filename,
        filepath=Path(record.filepath),
        width=record.width,
        height=record.height,
        size_bytes=record.size_bytes,
        bounds=ImageBounds(
            south=record.south,
            west=record.west,
            north=record.north,
        east=record.east,
        ),
        created_at=record.created_at,
    )


def _read_image_size(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            return image.width, image.height
    except (UnidentifiedImageError, OSError):
        return 2048, 1536


def _display_filename(original_filename: str | None, saved_filename: str) -> str:
    if original_filename is None:
        return saved_filename

    filename = Path(original_filename).name.strip()
    return filename or saved_filename


def _has_allowed_upload_type(
    content_type: str | None,
    original_filename: str | None,
) -> bool:
    normalized_content_type = (content_type or "").split(";")[0].strip().lower()
    extension = Path(original_filename or "").suffix.lower()

    return (
        normalized_content_type in ALLOWED_IMAGE_CONTENT_TYPES
        or extension in ALLOWED_IMAGE_EXTENSIONS
    )


def _display_name(
    requested_display_name: str | None,
    original_filename: str | None,
    fallback: str,
) -> str:
    if requested_display_name is not None and requested_display_name.strip():
        return requested_display_name.strip()

    if original_filename is None:
        return fallback

    display_name = Path(original_filename).stem.strip()
    return display_name or fallback
