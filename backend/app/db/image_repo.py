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
    source: str


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
        source=row["source"],
    )


async def list_images(connection: aiosqlite.Connection) -> list[ImageRecord]:
    cursor = await connection.execute(
        """
        SELECT image_id, display_name, filename, filepath, width, height, size_bytes,
               south, west, north, east, created_at, source
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
               south, west, north, east, created_at, source
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
            south, west, north, east, created_at, source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            east = excluded.east,
            source = excluded.source
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
            image.source,
        ),
    )


async def delete_legacy_images_except(
    connection: aiosqlite.Connection, image_ids_to_keep: set[str]
) -> int:
    placeholders = ",".join("?" for _ in image_ids_to_keep)
    cursor = await connection.execute(
        f"""
        SELECT image_id
        FROM images
        WHERE source = 'legacy'
          AND image_id NOT IN ({placeholders})
        """,
        tuple(image_ids_to_keep),
    )
    rows = await cursor.fetchall()
    image_ids = [row["image_id"] for row in rows]
    if not image_ids:
        return 0

    delete_placeholders = ",".join("?" for _ in image_ids)
    await connection.execute(
        f"DELETE FROM detections WHERE image_id IN ({delete_placeholders})",
        tuple(image_ids),
    )
    await connection.execute(
        f"DELETE FROM images WHERE image_id IN ({delete_placeholders})",
        tuple(image_ids),
    )
    return len(image_ids)
