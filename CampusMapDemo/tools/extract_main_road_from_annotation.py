from __future__ import annotations

import argparse
import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


DEFAULT_GRID = Path("data/road_grid_16.json")
DEFAULT_OUTPUT_GRID = Path("data/main_road_weight_grid_16.json")
DEFAULT_OUTPUT_MASK = Path("data/main_road_weight_mask.png")
DEFAULT_PREVIEW = Path("visual_check/main_road_weight_preview.png")
DEFAULT_OVERLAY = Path("visual_check/main_road_weight_overlay_preview.png")
DEFAULT_ANNOTATION_GLOB = "*20260728175700*143*1.png"


def project_dir_from_script() -> Path:
    return Path(__file__).resolve().parents[1]


def resolve_project_path(project_dir: Path, path: Path) -> Path:
    return path if path.is_absolute() else project_dir / path


def find_default_annotation() -> Path:
    matches = sorted((Path.home() / "Desktop").glob(DEFAULT_ANNOTATION_GLOB))
    if not matches:
        raise FileNotFoundError(
            "No desktop annotation image found. Pass --annotation with the marked map path."
        )
    return matches[-1]


def load_grid(path: Path) -> tuple[np.ndarray, dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    grid = np.array([[char == "1" for char in row] for row in payload["rows"]], dtype=np.bool_)
    return grid, payload


def blue_annotation_mask(image: Image.Image) -> np.ndarray:
    pixels = np.asarray(image.convert("RGBA"), dtype=np.int16)
    red = pixels[:, :, 0]
    green = pixels[:, :, 1]
    blue = pixels[:, :, 2]
    alpha = pixels[:, :, 3]

    return (
        (alpha > 0)
        & (blue >= 150)
        & (green >= 120)
        & (red <= 80)
        & ((blue - red) >= 80)
        & ((green - red) >= 70)
        & ((blue + green - 2 * red) >= 210)
    )


def downsample_blue_mask(
    mask: np.ndarray,
    payload: dict,
    min_blue_pixels_per_cell: int,
) -> np.ndarray:
    cell_size = int(payload["cellSize"])
    grid_height = int(payload["gridHeight"])
    grid_width = int(payload["gridWidth"])
    counts = np.zeros((grid_height, grid_width), dtype=np.uint16)
    ys, xs = np.where(mask)

    if len(xs) == 0:
        return counts.astype(np.bool_)

    rows = np.minimum(ys // cell_size, grid_height - 1)
    cols = np.minimum(xs // cell_size, grid_width - 1)
    np.add.at(counts, (rows, cols), 1)
    return counts >= min_blue_pixels_per_cell


def keep_large_components(hit_grid: np.ndarray, min_component_cells: int) -> tuple[np.ndarray, list[int]]:
    height, width = hit_grid.shape
    visited = np.zeros((height, width), dtype=np.bool_)
    kept = np.zeros((height, width), dtype=np.bool_)
    component_sizes: list[int] = []

    for start_row in range(height):
        for start_col in range(width):
            if visited[start_row, start_col] or not hit_grid[start_row, start_col]:
                continue

            queue: deque[tuple[int, int]] = deque([(start_row, start_col)])
            visited[start_row, start_col] = True
            component: list[tuple[int, int]] = []

            while queue:
                row, col = queue.popleft()
                component.append((row, col))
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        if dr == 0 and dc == 0:
                            continue
                        nr = row + dr
                        nc = col + dc
                        if nr < 0 or nr >= height or nc < 0 or nc >= width:
                            continue
                        if visited[nr, nc] or not hit_grid[nr, nc]:
                            continue
                        visited[nr, nc] = True
                        queue.append((nr, nc))

            component_sizes.append(len(component))
            if len(component) >= min_component_cells:
                for row, col in component:
                    kept[row, col] = True

    return kept, sorted(component_sizes, reverse=True)


def dilate_grid(mask: np.ndarray, radius_cells: int) -> np.ndarray:
    if radius_cells <= 0:
        return mask.copy()

    height, width = mask.shape
    expanded = np.zeros((height, width), dtype=np.bool_)
    rows, cols = np.where(mask)

    for dr in range(-radius_cells, radius_cells + 1):
        for dc in range(-radius_cells, radius_cells + 1):
            shifted_rows = rows + dr
            shifted_cols = cols + dc
            ok = (
                (shifted_rows >= 0)
                & (shifted_rows < height)
                & (shifted_cols >= 0)
                & (shifted_cols < width)
            )
            expanded[shifted_rows[ok], shifted_cols[ok]] = True

    return expanded


def grid_rows(mask: np.ndarray) -> list[str]:
    return ["".join("1" if value else "0" for value in row) for row in mask]


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


def find_base_image(project_dir: Path) -> Path | None:
    bundled = project_dir / "web" / "assets" / "campus_map.png"
    if bundled.exists():
        return bundled

    candidates = sorted(project_dir.parent.glob("*.png"))
    return candidates[0] if candidates else None


def save_overlay_preview(mask_image: Image.Image, project_dir: Path, output_path: Path) -> None:
    base_path = find_base_image(project_dir)
    if base_path is None:
        return

    base = Image.open(base_path).convert("RGBA")
    mask = np.asarray(mask_image) > 0
    overlay_pixels = np.zeros((base.height, base.width, 4), dtype=np.uint8)
    overlay_pixels[mask] = [0, 160, 224, 170]
    overlay_pixels[~mask] = [0, 0, 0, 70]
    overlay = Image.fromarray(overlay_pixels, mode="RGBA")
    preview = Image.alpha_composite(base, overlay)
    preview.resize((base.width // 4, base.height // 4), Image.Resampling.LANCZOS).save(output_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Extract manually marked main roads from a blue annotation image.")
    parser.add_argument("--annotation", type=Path, help="full-size campus map with blue main-road markup")
    parser.add_argument("--grid", type=Path, default=DEFAULT_GRID)
    parser.add_argument("--out-grid", type=Path, default=DEFAULT_OUTPUT_GRID)
    parser.add_argument("--out-mask", type=Path, default=DEFAULT_OUTPUT_MASK)
    parser.add_argument("--preview", type=Path, default=DEFAULT_PREVIEW)
    parser.add_argument("--overlay", type=Path, default=DEFAULT_OVERLAY)
    parser.add_argument("--min-blue-pixels-per-cell", type=int, default=8)
    parser.add_argument("--min-component-cells", type=int, default=50)
    parser.add_argument("--snap-radius-cells", type=int, default=1)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    project_dir = project_dir_from_script()

    annotation_path = args.annotation or find_default_annotation()
    grid_path = resolve_project_path(project_dir, args.grid)
    out_grid = resolve_project_path(project_dir, args.out_grid)
    out_mask = resolve_project_path(project_dir, args.out_mask)
    preview_path = resolve_project_path(project_dir, args.preview)
    overlay_path = resolve_project_path(project_dir, args.overlay)

    road_grid, payload = load_grid(grid_path)
    expected_size = (int(payload["imageWidth"]), int(payload["imageHeight"]))
    annotation = Image.open(annotation_path).convert("RGBA")
    if annotation.size != expected_size:
        annotation = annotation.resize(expected_size, Image.Resampling.BILINEAR)

    blue_mask = blue_annotation_mask(annotation)
    hit_grid = downsample_blue_mask(blue_mask, payload, args.min_blue_pixels_per_cell)
    kept_blue_grid, component_sizes = keep_large_components(hit_grid, args.min_component_cells)
    snapped_blue_grid = dilate_grid(kept_blue_grid, args.snap_radius_cells)
    main_road_grid = road_grid & snapped_blue_grid
    mask_image = grid_mask_to_image(main_road_grid, payload)

    output_payload = {
        "cellSize": int(payload["cellSize"]),
        "imageWidth": int(payload["imageWidth"]),
        "imageHeight": int(payload["imageHeight"]),
        "gridWidth": int(payload["gridWidth"]),
        "gridHeight": int(payload["gridHeight"]),
        "encoding": "row strings, 1 means manually preferred main road, 0 means normal road",
        "sourceAnnotation": str(annotation_path),
        "minBluePixelsPerCell": args.min_blue_pixels_per_cell,
        "minComponentCells": args.min_component_cells,
        "snapRadiusCells": args.snap_radius_cells,
        "bluePixelCount": int(blue_mask.sum()),
        "blueHitCellCount": int(hit_grid.sum()),
        "keptBlueCellCount": int(kept_blue_grid.sum()),
        "mainRoadCellCount": int(main_road_grid.sum()),
        "roadCellCount": int(road_grid.sum()),
        "largestBlueComponents": component_sizes[:12],
        "rows": grid_rows(main_road_grid),
    }

    out_grid.parent.mkdir(parents=True, exist_ok=True)
    out_grid.write_text(json.dumps(output_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    out_mask.parent.mkdir(parents=True, exist_ok=True)
    mask_image.save(out_mask)
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    mask_image.resize(
        (math.ceil(mask_image.width / 4), math.ceil(mask_image.height / 4)),
        Image.Resampling.NEAREST,
    ).save(preview_path)
    overlay_path.parent.mkdir(parents=True, exist_ok=True)
    save_overlay_preview(mask_image, project_dir, overlay_path)

    print(f"Blue pixels: {int(blue_mask.sum())}")
    print(f"Blue hit cells: {int(hit_grid.sum())}")
    print(f"Kept blue cells: {int(kept_blue_grid.sum())}")
    print(f"Manual main road cells: {int(main_road_grid.sum())} / {int(road_grid.sum())}")
    print(f"Largest blue components: {component_sizes[:8]}")
    print(f"Saved: {out_grid}")
    print(f"Saved: {out_mask}")
    print(f"Saved: {preview_path}")
    print(f"Saved: {overlay_path}")


if __name__ == "__main__":
    main()
