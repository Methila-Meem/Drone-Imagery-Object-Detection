from pydantic import BaseModel


class MapBounds(BaseModel):
    north: float
    south: float
    east: float
    west: float


class ImageMetadata(BaseModel):
    image_id: str
    display_name: str | None = None
    filename: str
    image_url: str
    width: int
    height: int
    size_bytes: int
    bounds: MapBounds
    created_at: str


class ImageListResponse(BaseModel):
    images: list[ImageMetadata]
