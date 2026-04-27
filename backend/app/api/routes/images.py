from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status

from app.schemas.images import ImageListResponse, ImageMetadata, MapBounds
from app.services.image_registry import (
    InvalidImageError,
    RegisteredImage,
    UnknownImageError,
    get_image,
    list_images,
    replace_demo_image,
)


router = APIRouter(prefix="/api/images", tags=["images"])


def _to_response_image(request: Request, image: RegisteredImage) -> ImageMetadata:
    image_url = str(request.url_for("static", path=f"images/{image.filename}"))

    return ImageMetadata(
        image_id=image.image_id,
        filename=image.filename,
        image_url=image_url,
        width=image.width,
        height=image.height,
        bounds=MapBounds(
            north=image.bounds.north,
            south=image.bounds.south,
            east=image.bounds.east,
            west=image.bounds.west,
        ),
    )


@router.get("", response_model=ImageListResponse)
async def get_images(request: Request) -> ImageListResponse:
    return ImageListResponse(
        images=[_to_response_image(request, image) for image in list_images()]
    )


@router.get("/{image_id}", response_model=ImageMetadata)
async def get_image_by_id(image_id: str, request: Request) -> ImageMetadata:
    try:
        image = get_image(image_id)
    except UnknownImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown image_id: {exc.image_id}",
        ) from exc

    return _to_response_image(request, image)


@router.post("", response_model=ImageMetadata)
async def upload_image(
    request: Request, file: UploadFile = File(...)
) -> ImageMetadata:
    if file.content_type is not None and not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be an image.",
        )

    try:
        image = replace_demo_image(file.file)
    except InvalidImageError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    finally:
        await file.close()

    return _to_response_image(request, image)
