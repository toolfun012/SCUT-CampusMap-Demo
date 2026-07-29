from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


DEFAULT_ROAD_GRID = Path("data/road_grid_16.json")
DEFAULT_MAIN_GRID = Path("data/main_road_weight_grid_16.json")
DEFAULT_MAIN_MASK = Path("data/main_road_weight_mask.png")
DEFAULT_PREVIEW = Path("visual_check/main_road_weight_preview.png")
DEFAULT_OVERLAY = Path("visual_check/main_road_weight_overlay_preview.png")


def project_dir_from_script() -> Path:
    return Path(__file__).resolve().parents[1]


def load_grid(path: Path) -> tuple[np.ndarray, dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    grid = np.array([[cell == "1" for cell in row] for row in payload["rows"]], dtype=np.bool_)
    return grid, payload


def load_seed_grid(payload: dict) -> tuple[np.ndarray, bool]:
    source_rows = payload.get("sourceRowsBeforeResync")
    if source_rows is not None:
        rows = source_rows
        already_resynced_without_seed = False
    else:
        rows = payload["rows"]
        already_resynced_without_seed = "resyncedToRoadGrid" in payload

    grid = np.array([[cell == "1" for cell in row] for row in rows], dtype=np.bool_)
    return grid, already_resynced_without_seed


def grid_rows(mask: np.ndarray) -> list[str]:
    return ["".join("1" if value else "0" for value in row) for row in mask]


def dilate_to_current_road(seed: np.ndarray, road_grid: np.ndarray, radius: int) -> np.ndarray:
    height, width = road_grid.shape
    expanded = np.zeros((height, width), dtype=np.bool_)
    rows, cols = np.where(seed)

    for dr in range(-radius, radius + 1):
        for dc in range(-radius, radius + 1):
            shifted_rows = rows + dr
            shifted_cols = cols + dc
            ok = (
                (shifted_rows >= 0)
                & (shifted_rows < height)
                & (shifted_cols >= 0)
                & (shifted_cols < width)
            )
            expanded[shifted_rows[ok], shifted_cols[ok]] = True

    return expanded & road_grid


def grid_mask_to_image(mask: np.ndarray, payload: dict) -> Image.Image:
    cell_size = int(payload["cellSize"])
    image_width = int(payload["imageWidth"])
    image_height = int(payload["imageHeight"])
    image = np.zeros((image_height, image_width), dtype=np.uint8)

    for row, col in zip(*np.where(mask)):
        x0 = col * cell_size
        y0 = row * cell_size
        x1 = min(x0 + cell_size, image_width)
        y1 = min(y0 + cell_size, image_height)
        image[y0:y1, x0:x1] = 255

    return Image.fromarray(image, mode="L")


def find_base_image(project_dir: Path, size: tuple[int, int]) -> Path | None:
    bundled = project_dir / "web" / "assets" / "campus_map.png"
    if bundled.exists():
        try:
            with Image.open(bundled) as image:
                if image.size == size:
                    return bundled
        except OSError:
            pass

    for path in sorted(project_dir.parent.glob("*.png")):
        try:
            with Image.open(path) as image:
                if image.size == size:
                    return path
        except OSError:
            continue
    return None


def save_overlay_preview(mask_image: Image.Image, project_dir: Path, output_path: Path) -> None:
    base_path = find_base_image(project_dir, mask_image.size)
    if base_path is None:
        return

    base = Image.open(base_path).convert("RGBA")
    mask = np.asarray(mask_image) > 0
    overlay_pixels = np.zeros((base.height, base.width, 4), dtype=np.uint8)
    overlay_pixels[mask] = [0, 160, 224, 150]
    overlay_pixels[~mask] = [0, 0, 0, 70]
    overlay = Image.fromarray(overlay_pixels, mode="RGBA")
    preview = Image.alpha_composite(base, overlay)
    preview.resize((base.width // 4, base.height // 4), Image.Resampling.LANCZOS).save(output_path)


def main() -> None:
    project_dir = project_dir_from_script()
    road_grid, road_payload = load_grid(project_dir / DEFAULT_ROAD_GRID)
    current_main_grid, seed_payload = load_grid(project_dir / DEFAULT_MAIN_GRID)
    seed_grid, already_resynced_without_seed = load_seed_grid(seed_payload)
    if seed_grid.shape != road_grid.shape:
        raise ValueError("main road grid shape does not match road grid")

    radius = 0 if already_resynced_without_seed else 2
    resynced = (
        seed_grid & road_grid
        if radius == 0
        else dilate_to_current_road(seed_grid, road_grid, radius)
    )
    mask_image = grid_mask_to_image(resynced, road_payload)

    output_payload = dict(seed_payload)
    if already_resynced_without_seed:
        output_payload.pop("sourceRowsBeforeResync", None)
    else:
        output_payload["sourceRowsBeforeResync"] = grid_rows(seed_grid)
    output_payload.update(
        {
            "cellSize": int(road_payload["cellSize"]),
            "imageWidth": int(road_payload["imageWidth"]),
            "imageHeight": int(road_payload["imageHeight"]),
            "gridWidth": int(road_payload["gridWidth"]),
            "gridHeight": int(road_payload["gridHeight"]),
            "encoding": "row strings, 1 means manually preferred main road, 0 means normal road",
            "resyncedToRoadGrid": str(DEFAULT_ROAD_GRID),
            "resyncExpandRadiusCells": radius,
            "seedMainRoadCellCount": int(seed_grid.sum()),
            "previousMainRoadCellCount": int(current_main_grid.sum()),
            "mainRoadCellCount": int(resynced.sum()),
            "roadCellCount": int(road_grid.sum()),
            "rows": grid_rows(resynced),
        }
    )

    (project_dir / DEFAULT_MAIN_GRID).write_text(
        json.dumps(output_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    mask_image.save(project_dir / DEFAULT_MAIN_MASK)
    mask_image.resize(
        (math.ceil(mask_image.width / 4), math.ceil(mask_image.height / 4)),
        Image.Resampling.NEAREST,
    ).save(project_dir / DEFAULT_PREVIEW)
    save_overlay_preview(mask_image, project_dir, project_dir / DEFAULT_OVERLAY)

    print(f"Seed main road cells: {int(seed_grid.sum())}")
    print(f"Resynced main road cells: {int(resynced.sum())}")
    print(f"Road cells: {int(road_grid.sum())}")
    print(f"Saved: {project_dir / DEFAULT_MAIN_GRID}")
    print(f"Saved: {project_dir / DEFAULT_MAIN_MASK}")


if __name__ == "__main__":
    main()
