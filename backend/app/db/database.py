from pathlib import Path

import aiosqlite


BACKEND_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BACKEND_DIR / "data"
DATABASE_PATH = DATA_DIR / "drone_imagery.sqlite3"


async def get_connection() -> aiosqlite.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = await aiosqlite.connect(DATABASE_PATH)
    connection.row_factory = aiosqlite.Row
    await connection.execute("PRAGMA foreign_keys = ON")
    return connection


async def initialize_database() -> None:
    connection = await get_connection()
    try:
        await connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS images (
                image_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                size_bytes INTEGER,
                south REAL,
                west REAL,
                north REAL,
                east REAL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS detections (
                detection_id TEXT PRIMARY KEY,
                image_id TEXT NOT NULL,
                model_used TEXT NOT NULL,
                detections_json TEXT NOT NULL,
                mask_path TEXT,
                inference_time_ms INTEGER,
                confidence_threshold REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (image_id) REFERENCES images(image_id)
            );
            """
        )
        await _ensure_column(
            connection,
            table_name="images",
            column_name="display_name",
            column_sql="display_name TEXT",
        )
        await connection.execute(
            """
            UPDATE images
            SET display_name = COALESCE(NULLIF(display_name, ''), filename, image_id)
            WHERE display_name IS NULL OR display_name = ''
            """
        )
        await connection.commit()
    finally:
        await connection.close()


async def _ensure_column(
    connection: aiosqlite.Connection,
    *,
    table_name: str,
    column_name: str,
    column_sql: str,
) -> None:
    cursor = await connection.execute(f"PRAGMA table_info({table_name})")
    rows = await cursor.fetchall()
    existing_columns = {row["name"] for row in rows}
    if column_name not in existing_columns:
        await connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}")
