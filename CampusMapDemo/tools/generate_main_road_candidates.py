from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


MIN_CLEARANCE_CELLS = 2
MIN_COMPONENT_CELLS = 25
EXPAND_FROM_CORE_CELLS = 1


def load_grid(path: Path) -> tuple[np.ndarray, dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    grid = np.array([[char == "1" for char in row] for row in payload["rows"]], dtype=np.bool_)
    return grid, payload


def build_clearance(grid: np.ndarray) -> np.ndarray:
    height, width = grid.shape
    clearance = np.full((height, width), height + width + 1, dtype=np.int16)
    queue: deque[tuple[int, int]] = deque()

    for row in range(height):
        for col in range(width):
            if not grid[row, col]:
                clearance[row, col] = 0
                queue.append((row, col))

    while queue:
        row, col = queue.popleft()
        next_value = clearance[row, col] + 1
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr = row + dr
            nc = col + dc
            if nr < 0 or nr >= height or nc < 0 or nc >= width:
                continue
            if next_value < clearance[nr, nc]:
                clearance[nr, nc] = next_value
                queue.append((nr, nc))

    return clearance


def keep_long_wide_components(grid: np.ndarray, clearance: np.ndarray) -> np.ndarray:
    height, width = grid.shape
    core = grid & (clearance >= MIN_CLEARANCE_CELLS)
    visited = np.zeros((height, width), dtype=np.bool_)
    kept = np.zeros((height, width), dtype=np.bool_)

    for start_row in range(height):
        for start_col in range(width):
            if visited[start_row, start_col] or not core[start_row, start_col]:
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
                        if visited[nr, nc] or not core[nr, nc]:
                            continue
                        visited[nr, nc] = True
                        queue.append((nr, nc))

            if len(component) >= MIN_COMPONENT_CELLS:
                for row, col in component:
                    kept[row, col] = True

    return kept


def expand_to_full_road_width(core_mask: np.ndarray, grid: np.ndarray) -> np.ndarray:
    height, width = grid.shape
    expanded = np.zeros((height, width), dtype=np.bool_)

    for row, col in zip(*np.where(core_mask)):
        for dr in range(-EXPAND_FROM_CORE_CELLS, EXPAND_FROM_CORE_CELLS + 1):
            for dc in range(-EXPAND_FROM_CORE_CELLS, EXPAND_FROM_CORE_CELLS + 1):
                nr = row + dr
                nc = col + dc
                if nr < 0 or nr >= height or nc < 0 or nc >= width:
                    continue
                if grid[nr, nc]:
                    expanded[nr, nc] = True

    return expanded


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
    candidates = sorted(project_dir.parent.glob("*.png"))
    return candidates[0] if candidates else None


def save_overlay_preview(
    candidate_image: Image.Image,
    project_dir: Path,
    output_path: Path,
) -> None:
    base_path = find_base_image(project_dir)
    if base_path is None:
        return

    base = Image.open(base_path).convert("RGBA")
    mask = np.asarray(candidate_image) > 0
    overlay_pixels = np.zeros((base.height, base.width, 4), dtype=np.uint8)
    overlay_pixels[mask] = [37, 99, 235, 130]
    overlay_pixels[~mask] = [0, 0, 0, 80]
    overlay = Image.fromarray(overlay_pixels, mode="RGBA")
    preview = Image.alpha_composite(base, overlay)
    preview.resize((base.width // 4, base.height // 4), Image.Resampling.LANCZOS).save(output_path)


def main() -> None:
    project_dir = Path(__file__).resolve().parents[1]
    data_dir = project_dir / "data"
    visual_dir = project_dir / "visual_check"

    grid, payload = load_grid(data_dir / "road_grid_16.json")
    clearance = build_clearance(grid)
    core = keep_long_wide_components(grid, clearance)
    candidate = expand_to_full_road_width(core, grid)
    candidate_image = grid_mask_to_image(candidate, payload)

    output_path = data_dir / "main_road_candidates.png"
    desktop_path = Path.home() / "Desktop" / "main_road_candidates.png"
    preview_path = visual_dir / "main_road_candidates_preview.png"
    overlay_path = visual_dir / "main_road_candidates_overlay_preview.png"

    candidate_image.save(output_path)
    candidate_image.save(desktop_path)
    candidate_image.resize(
        (math.ceil(candidate_image.width / 4), math.ceil(candidate_image.height / 4)),
        Image.Resampling.NEAREST,
    ).save(preview_path)
    save_overlay_preview(candidate_image, project_dir, overlay_path)

    print(f"Main road cells: {int(candidate.sum())} / {int(grid.sum())} road cells")
    print(f"Saved editable mask: {output_path}")
    print(f"Saved desktop copy: {desktop_path}")
    print(f"Saved preview: {preview_path}")
    print(f"Saved overlay preview: {overlay_path}")


if __name__ == "__main__":
    main()
