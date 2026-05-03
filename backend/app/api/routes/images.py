from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status

from app.schemas.images import ImageListResponse, ImageMetadata, MapBounds
from app.services.image_registry import (
    InvalidImageError,
    RegisteredImage,
    UnknownImageError,
    get_static_image_url_path,
    get_image,
    list_images,
    register_uploaded_image,
    validate_bounds,
)


router = APIRouter(prefix="/api/images", tags=["images"])
upload_router = APIRouter(prefix="/api/upload", tags=["images"])


def _to_response_image(request: Request, image: RegisteredImage) -> ImageMetadata:
    image_url = str(request.url_for("static", path=get_static_image_url_path(image)))

    return ImageMetadata(
        image_id=image.image_id,
        display_name=image.display_name,
        filename=image.filename,
        image_url=image_url,
        width=image.width,
        height=image.height,
        size_bytes=image.size_bytes,
        bounds=MapBounds(
            north=image.bounds.north,
            south=image.bounds.south,
            east=image.bounds.east,
            west=image.bounds.west,
        ),
        created_at=image.created_at,
    )


@router.get("", response_model=ImageListResponse)
async def get_images(request: Request) -> ImageListResponse:
    return ImageListResponse(
        images=[_to_response_image(request, image) for image in await list_images()]
    )


@router.get("/{image_id}", response_model=ImageMetadata)
async def get_image_by_id(image_id: str, request: Request) -> ImageMetadata:
    try:
        image = await get_image(image_id)
    except UnknownImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown image_id: {exc.image_id}",
        ) from exc

    return _to_response_image(request, image)


async def _handle_upload(
    request: Request,
    file: UploadFile,
    display_name: str | None,
    south: float | None,
    west: float | None,
    north: float | None,
    east: float | None,
) -> ImageMetadata:
    content_type = file.content_type
    content = await file.read()

    try:
        bounds = validate_bounds(south=south, west=west, north=north, east=east)
        image = await register_uploaded_image(
            content=content,
            content_type=content_type,
            original_filename=file.filename,
            display_name=display_name,
            bounds=bounds,
        )
    except InvalidImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    finally:
        await file.close()

    return _to_response_image(request, image)


@router.post("", response_model=ImageMetadata)
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    display_name: str | None = Form(default=None),
    south: float | None = Form(default=None),
    west: float | None = Form(default=None),
    north: float | None = Form(default=None),
    east: float | None = Form(default=None),
) -> ImageMetadata:
    return await _handle_upload(request, file, display_name, south, west, north, east)


@upload_router.post("", response_model=ImageMetadata)
async def upload_image_alias(
    request: Request,
    file: UploadFile = File(...),
    display_name: str | None = Form(default=None),
    south: float | None = Form(default=None),
    west: float | None = Form(default=None),
    north: float | None = Form(default=None),
    east: float | None = Form(default=None),
) -> ImageMetadata:
    return await _handle_upload(request, file, display_name, south, west, north, east)
