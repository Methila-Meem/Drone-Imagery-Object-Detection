from dataclasses import dataclass

import aiosqlite


@dataclass(frozen=True)
class ImageRecord:
    image_id: str
    display_name: str
    filename: str
    filepath: str
    width: int
    height: int
    size_bytes: int
    south: float
    west: float
    north: float
    east: float
    created_at: str


def _row_to_image(row: aiosqlite.Row) -> ImageRecord:
    return ImageRecord(
        image_id=row["image_id"],
        display_name=row["display_name"],
        filename=row["filename"],
        filepath=row["filepath"],
        width=row["width"],
        height=row["height"],
        size_bytes=row["size_bytes"],
        south=row["south"],
        west=row["west"],
        north=row["north"],
        east=row["east"],
        created_at=row["created_at"],
    )


async def list_images(connection: aiosqlite.Connection) -> list[ImageRecord]:
    cursor = await connection.execute(
        """
        SELECT image_id, display_name, filename, filepath, width, height, size_bytes,
               south, west, north, east, created_at
        FROM images
        ORDER BY created_at DESC, filename ASC
        """
    )
    rows = await cursor.fetchall()
    return [_row_to_image(row) for row in rows]


async def get_image(
    connection: aiosqlite.Connection, image_id: str
) -> ImageRecord | None:
    cursor = await connection.execute(
        """
        SELECT image_id, display_name, filename, filepath, width, height, size_bytes,
               south, west, north, east, created_at
        FROM images
        WHERE image_id = ?
        """,
        (image_id,),
    )
    row = await cursor.fetchone()
    return _row_to_image(row) if row is not None else None


async def upsert_image(
    connection: aiosqlite.Connection,
    image: ImageRecord,
) -> None:
    await connection.execute(
        """
        INSERT INTO images (
            image_id, display_name, filename, filepath, width, height, size_bytes,
            south, west, north, east, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(image_id) DO UPDATE SET
            display_name = excluded.display_name,
            filename = excluded.filename,
            filepath = excluded.filepath,
            width = excluded.width,
            height = excluded.height,
            size_bytes = excluded.size_bytes,
            south = excluded.south,
            west = excluded.west,
            north = excluded.north,
            east = excluded.east
        """,
        (
            image.image_id,
            image.display_name,
            image.filename,
            image.filepath,
            image.width,
            image.height,
            image.size_bytes,
            image.south,
            image.west,
            image.north,
            image.east,
            image.created_at,
        ),
    )
