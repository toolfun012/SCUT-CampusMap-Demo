from __future__ import annotations

import argparse
import heapq
import json
import math
import shutil
from collections import deque
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


CELL_SIZE = 16
WALKABLE_RATIO_THRESHOLD = 0.58


def project_dir_from_script() -> Path:
    return Path(__file__).resolve().parents[1]


def find_base_image(project_dir: Path, size: tuple[int, int]) -> Path:
    for path in sorted(project_dir.parent.glob("*.png")):
        try:
            with Image.open(path) as image:
                if image.size == size:
                    return path
        except OSError:
            continue
    raise FileNotFoundError(f"no {size[0]}x{size[1]} PNG found next to CampusMapDemo")


def resolve_project_path(project_dir: Path, path: Path) -> Path:
    return path if path.is_absolute() else project_dir / path


def mask_to_walkable(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA"))
    alpha = rgba[..., 3] > 0
    luminance = (
        rgba[..., 0].astype(np.float32) * 0.299
        + rgba[..., 1].astype(np.float32) * 0.587
        + rgba[..., 2].astype(np.float32) * 0.114
    )
    return alpha & (luminance >= 128.0)


def build_grid(walkable: np.ndarray, cell_size: int = CELL_SIZE) -> np.ndarray:
    height, width = walkable.shape
    grid_width = math.ceil(width / cell_size)
    grid_height = math.ceil(height / cell_size)
    padded = np.zeros((grid_height * cell_size, grid_width * cell_size), dtype=np.bool_)
    padded[:height, :width] = walkable
    cells = padded.reshape(grid_height, cell_size, grid_width, cell_size)
    ratios = cells.mean(axis=(1, 3))
    return ratios >= WALKABLE_RATIO_THRESHOLD


def rgb_to_hsv(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    arr = rgb.astype(np.float32) / 255.0
    r = arr[..., 0]
    g = arr[..., 1]
    b = arr[..., 2]
    maxc = np.max(arr, axis=2)
    minc = np.min(arr, axis=2)
    delta = maxc - minc

    hue = np.zeros_like(maxc)
    nonzero = delta > 1e-6
    red_max = (maxc == r) & nonzero
    green_max = (maxc == g) & nonzero
    blue_max = (maxc == b) & nonzero
    hue[red_max] = ((g[red_max] - b[red_max]) / delta[red_max]) % 6.0
    hue[green_max] = ((b[green_max] - r[green_max]) / delta[green_max]) + 2.0
    hue[blue_max] = ((r[blue_max] - g[blue_max]) / delta[blue_max]) + 4.0
    hue *= 60.0

    saturation = np.zeros_like(maxc)
    bright = maxc > 1e-6
    saturation[bright] = delta[bright] / maxc[bright]
    return hue, saturation, maxc


def cell_ratio(pixel_mask: np.ndarray, grid_shape: tuple[int, int]) -> np.ndarray:
    height, width = pixel_mask.shape
    grid_height, grid_width = grid_shape
    padded = np.zeros((grid_height * CELL_SIZE, grid_width * CELL_SIZE), dtype=np.bool_)
    padded[:height, :width] = pixel_mask
    return padded.reshape(grid_height, CELL_SIZE, grid_width, CELL_SIZE).mean(axis=(1, 3))


def build_cell_cost(base_image: Image.Image, walkable_grid: np.ndarray) -> np.ndarray:
    rgb = np.asarray(base_image.convert("RGB"))
    hue, saturation, value = rgb_to_hsv(rgb)
    red = rgb[..., 0].astype(np.int16)
    green = rgb[..., 1].astype(np.int16)
    blue = rgb[..., 2].astype(np.int16)

    outside_blank = (red >= 248) & (green >= 248) & (blue >= 248)
    vegetation = (
        (hue >= 55.0)
        & (hue <= 165.0)
        & (saturation >= 0.18)
        & (value >= 0.18)
        & (green >= red - 5)
        & (green >= blue - 10)
    )
    water = (
        (hue >= 165.0)
        & (hue <= 220.0)
        & (saturation >= 0.12)
        & (value >= 0.30)
        & (blue >= red + 10)
    )
    pink_roof = (((hue >= 320.0) | (hue <= 5.0)) & (saturation >= 0.10) & (value >= 0.45))
    dark_shadow = value < 0.28
    beige_or_paving = (
        (hue >= 8.0)
        & (hue <= 48.0)
        & (saturation >= 0.05)
        & (saturation <= 0.58)
        & (value >= 0.48)
    )
    light_gray_road = (saturation <= 0.18) & (value >= 0.50) & (value <= 0.96)
    pale_walkway = (
        (hue >= 35.0)
        & (hue <= 85.0)
        & (saturation <= 0.30)
        & (value >= 0.58)
        & (red >= 150)
        & (green >= 140)
    )

    grid_shape = walkable_grid.shape
    outside_ratio = cell_ratio(outside_blank, grid_shape)
    vegetation_ratio = cell_ratio(vegetation, grid_shape)
    water_ratio = cell_ratio(water, grid_shape)
    roof_ratio = cell_ratio(pink_roof | dark_shadow, grid_shape)
    paving_ratio = cell_ratio(beige_or_paving | light_gray_road | pale_walkway, grid_shape)

    cost = np.full(grid_shape, 12.0, dtype=np.float32)
    cost[paving_ratio >= 0.12] = 2.0
    cost[paving_ratio >= 0.35] = 1.35
    cost[vegetation_ratio >= 0.35] += 10.0
    cost[water_ratio >= 0.25] += 18.0
    cost[roof_ratio >= 0.35] += 8.0
    cost[outside_ratio >= 0.20] = 1000.0
    cost[walkable_grid] = 0.7
    return cost


def find_components(grid: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    height, width = grid.shape
    component_id = np.full((height, width), -1, dtype=np.int32)
    visited = np.zeros((height, width), dtype=np.bool_)
    components: list[dict] = []
    directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    for start_row in range(height):
        for start_col in range(width):
            if visited[start_row, start_col] or not grid[start_row, start_col]:
                continue
            cid = len(components)
            queue: deque[tuple[int, int]] = deque([(start_row, start_col)])
            visited[start_row, start_col] = True
            cells: list[tuple[int, int]] = []

            while queue:
                row, col = queue.popleft()
                cells.append((row, col))
                component_id[row, col] = cid
                for dr, dc in directions:
                    nr = row + dr
                    nc = col + dc
                    if nr < 0 or nr >= height or nc < 0 or nc >= width:
                        continue
                    if visited[nr, nc] or not grid[nr, nc]:
                        continue
                    visited[nr, nc] = True
                    queue.append((nr, nc))

            rows = [row for row, _ in cells]
            cols = [col for _, col in cells]
            components.append(
                {
                    "id": cid,
                    "size": len(cells),
                    "cells": cells,
                    "bboxPx": (
                        min(cols) * CELL_SIZE,
                        min(rows) * CELL_SIZE,
                        (max(cols) + 1) * CELL_SIZE,
                        (max(rows) + 1) * CELL_SIZE,
                    ),
                    "centroidPx": (
                        round((sum(cols) / len(cols) + 0.5) * CELL_SIZE, 1),
                        round((sum(rows) / len(rows) + 0.5) * CELL_SIZE, 1),
                    ),
                }
            )

    return component_id, components


def step_cost(dr: int, dc: int) -> float:
    return math.sqrt(2.0) if dr != 0 and dc != 0 else 1.0


def dijkstra_from_main(cost: np.ndarray, main_mask: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width = cost.shape
    distance = np.full((height, width), np.inf, dtype=np.float64)
    parent_row = np.full((height, width), -1, dtype=np.int16)
    parent_col = np.full((height, width), -1, dtype=np.int16)
    heap: list[tuple[float, int, int]] = []

    for row, col in zip(*np.where(main_mask)):
        distance[row, col] = 0.0
        heapq.heappush(heap, (0.0, int(row), int(col)))

    directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    while heap:
        current_cost, row, col = heapq.heappop(heap)
        if current_cost != distance[row, col]:
            continue
        for dr, dc in directions:
            nr = row + dr
            nc = col + dc
            if nr < 0 or nr >= height or nc < 0 or nc >= width:
                continue
            if cost[nr, nc] >= 999.0:
                continue
            move_cost = step_cost(dr, dc) * ((cost[row, col] + cost[nr, nc]) / 2.0)
            candidate = current_cost + move_cost
            if candidate < distance[nr, nc]:
                distance[nr, nc] = candidate
                parent_row[nr, nc] = row
                parent_col[nr, nc] = col
                heapq.heappush(heap, (candidate, nr, nc))

    return distance, parent_row, parent_col


def reconstruct_path(
    start: tuple[int, int],
    parent_row: np.ndarray,
    parent_col: np.ndarray,
    main_mask: np.ndarray,
) -> list[tuple[int, int]]:
    row, col = start
    path = [(row, col)]
    guard = parent_row.size
    while not main_mask[row, col] and guard > 0:
        pr = int(parent_row[row, col])
        pc = int(parent_col[row, col])
        if pr < 0 or pc < 0:
            break
        row, col = pr, pc
        path.append((row, col))
        guard -= 1
    return path


def paint_path(draw: ImageDraw.ImageDraw, path: list[tuple[int, int]], width: int) -> None:
    if not path:
        return
    centers = [((col + 0.5) * CELL_SIZE, (row + 0.5) * CELL_SIZE) for row, col in path]
    if len(centers) >= 2:
        draw.line(centers, fill=255, width=width, joint="curve")
    radius = width // 2
    for x, y in centers:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)


def save_preview(
    base_image: Image.Image,
    output_mask: Image.Image,
    connector_paths: list[dict],
    output_dir: Path,
) -> None:
    base = base_image.convert("RGBA")
    mask = np.asarray(output_mask.convert("L")) > 0
    overlay_pixels = np.zeros((base.height, base.width, 4), dtype=np.uint8)
    overlay_pixels[mask] = [14, 165, 233, 45]
    overlay = Image.fromarray(overlay_pixels, mode="RGBA")
    preview = Image.alpha_composite(base, overlay)
    draw = ImageDraw.Draw(preview)
    try:
        font = ImageFont.truetype("arial.ttf", 30)
    except OSError:
        font = None

    for index, item in enumerate(connector_paths, start=1):
        centers = [((col + 0.5) * CELL_SIZE, (row + 0.5) * CELL_SIZE) for row, col in item["path"]]
        if len(centers) >= 2:
            draw.line(centers, fill=(245, 158, 11, 255), width=14, joint="curve")
        x, y = item["centroidPx"]
        draw.text(
            (x + 12, y + 12),
            str(index),
            fill=(255, 255, 255, 255),
            font=font,
            stroke_width=4,
            stroke_fill=(146, 64, 14, 255),
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    preview_path = output_dir / "walkable_island_connectors_overlay.png"
    small_path = output_dir / "walkable_island_connectors_overlay_small.png"
    preview.convert("RGB").save(preview_path)
    preview.resize((base.width // 4, base.height // 4), Image.Resampling.LANCZOS).convert("RGB").save(small_path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Connect disconnected walkable islands to the main campus road network.")
    parser.add_argument("--input-mask", type=Path, default=Path.home() / "Desktop" / "walkable_mask.png")
    parser.add_argument("--desktop-output", type=Path)
    parser.add_argument("--project-output", type=Path, default=Path("data/road_manual_override.png"))
    parser.add_argument("--min-component-cells", type=int, default=8)
    parser.add_argument("--connector-width", type=int, default=24)
    parser.add_argument("--max-path-cells", type=int, default=90)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    project_dir = project_dir_from_script()
    input_mask = args.input_mask
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    desktop_output = args.desktop_output or (Path.home() / "Desktop" / f"walkable_mask_connected_{timestamp}.png")
    project_output = resolve_project_path(project_dir, args.project_output)
    visual_dir = project_dir / "visual_check" / "connectivity_diagnosis"

    source_image = Image.open(input_mask).convert("L")
    walkable = np.asarray(source_image) >= 128
    grid = build_grid(walkable)
    component_id, components = find_components(grid)
    if not components:
        raise ValueError("no walkable components found")

    sorted_components = sorted(components, key=lambda item: item["size"], reverse=True)
    main_id = int(sorted_components[0]["id"])
    main_mask = component_id == main_id
    base_image = Image.open(find_base_image(project_dir, source_image.size)).convert("RGB")
    cost = build_cell_cost(base_image, grid)
    distance, parent_row, parent_col = dijkstra_from_main(cost, main_mask)

    target_components = [
        component
        for component in sorted_components[1:]
        if component["size"] >= args.min_component_cells
    ]
    connector_paths: list[dict] = []
    for component in target_components:
        best_cell: tuple[int, int] | None = None
        best_distance = math.inf
        for row, col in component["cells"]:
            current_distance = float(distance[row, col])
            if current_distance < best_distance:
                best_distance = current_distance
                best_cell = (row, col)
        if best_cell is None or not math.isfinite(best_distance):
            continue

        path = reconstruct_path(best_cell, parent_row, parent_col, main_mask)
        if len(path) > args.max_path_cells:
            path = path[: args.max_path_cells]
        connector_paths.append(
            {
                "componentId": int(component["id"]),
                "componentSize": int(component["size"]),
                "bboxPx": component["bboxPx"],
                "centroidPx": component["centroidPx"],
                "pathCellCount": len(path),
                "pathCost": round(best_distance, 2),
                "path": path,
            }
        )

    output_mask = source_image.copy()
    draw = ImageDraw.Draw(output_mask)
    for item in connector_paths:
        paint_path(draw, item["path"], args.connector_width)

    desktop_output.parent.mkdir(parents=True, exist_ok=True)
    output_mask.save(desktop_output)
    project_output.parent.mkdir(parents=True, exist_ok=True)
    if project_output.exists():
        backup = project_output.with_name(f"{project_output.stem}_backup_{timestamp}{project_output.suffix}")
        shutil.copy2(project_output, backup)
    output_mask.save(project_output)

    new_grid = build_grid(np.asarray(output_mask) >= 128)
    _, new_components = find_components(new_grid)
    save_preview(base_image, output_mask, connector_paths, visual_dir)
    summary_path = visual_dir / "walkable_island_connectors_summary.json"
    summary = {
        "inputMask": str(input_mask),
        "desktopOutput": str(desktop_output),
        "projectOutput": str(project_output),
        "minComponentCells": args.min_component_cells,
        "connectorWidth": args.connector_width,
        "connectedComponentCount": len(connector_paths),
        "beforeComponentCount": len(components),
        "afterComponentCount": len(new_components),
        "beforeLargestComponentCells": int(sorted_components[0]["size"]),
        "afterLargestComponentCells": int(max(component["size"] for component in new_components)),
        "connectors": [
            {key: value for key, value in item.items() if key != "path"}
            for item in connector_paths
        ],
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Connected components: {len(connector_paths)}")
    print(f"Component count: {len(components)} -> {len(new_components)}")
    print(f"Largest component: {int(sorted_components[0]['size'])} -> {int(max(component['size'] for component in new_components))}")
    print(f"Saved desktop copy: {desktop_output}")
    print(f"Saved project override: {project_output}")
    print(f"Saved summary: {summary_path}")


if __name__ == "__main__":
    main()
