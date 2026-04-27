from pydantic import BaseModel


class MapBounds(BaseModel):
    north: float
    south: float
    east: float
    west: float


class ImageMetadata(BaseModel):
    image_id: str
    filename: str
    image_url: str
    width: int
    height: int
    bounds: MapBounds


class ImageListResponse(BaseModel):
    images: list[ImageMetadata]

