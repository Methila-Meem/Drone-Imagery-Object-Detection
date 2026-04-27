from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError


DEMO_IMAGE_ID = "drone_image_001"
DEMO_IMAGE_FILENAME = "drone_001.jpg"
STATIC_IMAGES_DIR = Path(__file__).resolve().parents[2] / "static" / "images"


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


_IMAGES: dict[str, RegisteredImage] = {
    DEMO_IMAGE_ID: RegisteredImage(
        image_id=DEMO_IMAGE_ID,
        filename=DEMO_IMAGE_FILENAME,
        width=2048,
        height=1536,
        bounds=ImageBounds(
            north=23.005,
            south=23.000,
            east=90.006,
            west=90.000,
        ),
    )
}


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
        image = ImageOps.exif_transpose(image)
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("Uploaded file is not a readable image.") from exc

    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    STATIC_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    image.save(temp_path, format="JPEG", quality=95)
    temp_path.replace(target_path)

    updated_image = RegisteredImage(
        image_id=current_image.image_id,
        filename=current_image.filename,
        width=image.width,
        height=image.height,
        bounds=current_image.bounds,
    )
    _IMAGES[DEMO_IMAGE_ID] = updated_image
    return updated_image
