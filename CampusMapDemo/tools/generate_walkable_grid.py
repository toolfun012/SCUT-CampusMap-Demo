from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


CELL_SIZE = 16
WALKABLE_RATIO_THRESHOLD = 0.58

CROP_BOXES = {
    "crop_road_west_c_area_preview.png": (0, 650, 1250, 2100),
    "crop_road_shangxue_west_stadium_preview.png": (780, 900, 1320, 1900),
    "crop_road_library_core_preview.png": (1200, 2050, 2150, 2900),
    "crop_road_d_eastgate_preview.png": (800, 1450, 1350, 2100),
    "crop_road_southgate_preview.png": (2000, 2050, 3250, 3250),
}

# A coarse campus boundary to prevent external roads from entering the road grid.
# The navigation network is only meant to cover roads inside the campus map.
CAMPUS_BOUNDARY = [
    (260, 680),
    (820, 470),
    (1360, 155),
    (2050, 55),
    (3335, 70),
    (3270, 530),
    (3140, 1120),
    (3080, 1710),
    (3160, 2260),
    (3185, 2880),
    (2940, 3460),
    (2290, 4160),
    (1720, 3570),
    (910, 3310),
    (510, 2700),
    (220, 1900),
    (120, 1180),
]

# Road-looking pixels in these polygons are outside the campus boundary in the
# source map. Keep this independent from place/building annotations.
OFF_CAMPUS_ROAD_EXCLUSIONS = [
    [
        (0, 0),
        (3629, 0),
        (3629, 165),
        (2550, 150),
        (2200, 130),
        (1830, 130),
        (1440, 200),
        (1120, 330),
        (800, 470),
        (260, 690),
        (0, 760),
    ],
    [
        (0, 760),
        (260, 690),
        (220, 1050),
        (230, 1500),
        (265, 1880),
        (430, 2300),
        (200, 2300),
        (0, 2100),
    ],
    [
        (3135, 130),
        (3629, 130),
        (3629, 3020),
        (3310, 3020),
        (3140, 2610),
        (3025, 2080),
        (2955, 1590),
        (3015, 1040),
        (3110, 600),
    ],
    [
        (3310, 3020),
        (3629, 3020),
        (3629, 4161),
        (2350, 4161),
        (2920, 3480),
    ],
]

# Keep the central vehicle road out of hard-coded exclusions for now. If a
# hand-drawn data/road_manual_override.png is provided, black pixels there will
# remove it much more accurately than approximate rectangles.
CENTRAL_OFF_CAMPUS_ROAD_EXCLUSIONS: list[list[tuple[float, float]]] = []

# No hard-coded bridge bands for now. If bridge paths need to be preserved
# later, draw them precisely in data/road_manual_override.png with white pixels.
PEDESTRIAN_BRIDGE_INCLUSIONS: list[list[tuple[float, float]]] = []


def apply_manual_override(project_dir: Path, road: np.ndarray) -> tuple[np.ndarray, str | None]:
    override_path = project_dir / "data" / "road_manual_override.png"
    if not override_path.exists():
        legacy_path = project_dir / "data" / "walkable_manual_override.png"
        if not legacy_path.exists():
            return road, None
        override_path = legacy_path

    override = Image.open(override_path).convert("RGBA")
    if override.size != (road.shape[1], road.shape[0]):
        raise ValueError(
            f"{override_path.name} must have the same size as the base image"
        )

    arr = np.asarray(override)
    alpha = arr[..., 3] > 0
    luminance = (
        arr[..., 0].astype(np.float32) * 0.299
        + arr[..., 1].astype(np.float32) * 0.587
        + arr[..., 2].astype(np.float32) * 0.114
    )
    force_road = alpha & (luminance >= 128.0)
    force_blocked = alpha & (luminance < 128.0)

    result = road.copy()
    result[force_road] = True
    result[force_blocked] = False
    return result, str(override_path)


def find_base_image(project_dir: Path) -> Path:
    bundled = project_dir / "web" / "assets" / "campus_map.png"
    if bundled.exists():
        return bundled

    candidates = sorted(project_dir.parent.glob("*.png"))
    if not candidates:
        raise FileNotFoundError("No campus base PNG found in web/assets or next to CampusMapDemo")
    return candidates[0]


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


def build_color_obstacle_mask(base_image: Image.Image) -> np.ndarray:
    rgb = np.asarray(base_image.convert("RGB"))
    hue, saturation, value = rgb_to_hsv(rgb)
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)

    vegetation = (
        (hue >= 55.0)
        & (hue <= 165.0)
        & (saturation >= 0.18)
        & (value >= 0.18)
        & (g >= r - 5)
        & (g >= b - 10)
    )

    water = (
        (hue >= 165.0)
        & (hue <= 220.0)
        & (saturation >= 0.12)
        & (value >= 0.30)
        & (b >= r + 10)
    )

    outside_blank = (r >= 248) & (g >= 248) & (b >= 248)

    return vegetation | water | outside_blank


def build_road_candidate_masks(base_image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    rgb = np.asarray(base_image.convert("RGB"))
    hue, saturation, value = rgb_to_hsv(rgb)
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)

    outside_blank = (r >= 248) & (g >= 248) & (b >= 248)
    pink_roof = (((hue >= 320.0) | (hue <= 5.0)) & (saturation >= 0.10) & (value >= 0.45))
    dark_shadow = value < 0.28

    beige_or_paving = (
        (hue >= 8.0)
        & (hue <= 48.0)
        & (saturation >= 0.05)
        & (saturation <= 0.58)
        & (value >= 0.48)
    )
    light_gray_road = (
        (saturation <= 0.18)
        & (value >= 0.50)
        & (value <= 0.96)
    )
    pale_walkway = (
        (hue >= 35.0)
        & (hue <= 85.0)
        & (saturation <= 0.30)
        & (value >= 0.58)
        & (r >= 150)
        & (g >= 140)
    )

    base_filter = ~pink_roof & ~dark_shadow & ~outside_blank
    strong_road = beige_or_paving & base_filter
    weak_road = (light_gray_road | pale_walkway) & base_filter
    return strong_road, weak_road


def build_campus_boundary_mask(size: tuple[int, int]) -> np.ndarray:
    image = Image.new("L", size, 0)
    ImageDraw.Draw(image).polygon(CAMPUS_BOUNDARY, fill=255)
    return np.asarray(image) > 0


def polygon_mask(size: tuple[int, int], polygons: list[list[tuple[float, float]]]) -> np.ndarray:
    image = Image.new("L", size, 0)
    draw = ImageDraw.Draw(image)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    return np.asarray(image) > 0


def build_off_campus_road_mask(size: tuple[int, int]) -> np.ndarray:
    return polygon_mask(size, OFF_CAMPUS_ROAD_EXCLUSIONS + CENTRAL_OFF_CAMPUS_ROAD_EXCLUSIONS)


def build_pedestrian_bridge_mask(size: tuple[int, int]) -> np.ndarray:
    return polygon_mask(size, PEDESTRIAN_BRIDGE_INCLUSIONS)


def build_grid(walkable: np.ndarray, cell_size: int) -> np.ndarray:
    height, width = walkable.shape
    grid_width = math.ceil(width / cell_size)
    grid_height = math.ceil(height / cell_size)

    padded = np.zeros((grid_height * cell_size, grid_width * cell_size), dtype=np.bool_)
    padded[:height, :width] = walkable

    cells = padded.reshape(grid_height, cell_size, grid_width, cell_size)
    ratios = cells.mean(axis=(1, 3))
    return ratios >= WALKABLE_RATIO_THRESHOLD


def save_grid_json(path: Path, grid: np.ndarray, image_size: tuple[int, int]) -> None:
    rows = ["".join("1" if value else "0" for value in row) for row in grid]
    payload = {
        "cellSize": CELL_SIZE,
        "walkableRatioThreshold": WALKABLE_RATIO_THRESHOLD,
        "imageWidth": image_size[0],
        "imageHeight": image_size[1],
        "gridWidth": int(grid.shape[1]),
        "gridHeight": int(grid.shape[0]),
        "encoding": "row strings, 1 means walkable, 0 means blocked",
        "coordinate": "cell center x=(col+0.5)*cellSize, y=(row+0.5)*cellSize",
        "rows": rows,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def save_mask_images(
    base_image: Image.Image,
    road: np.ndarray,
    grid: np.ndarray,
    output_dir: Path,
) -> None:
    mask_image = Image.fromarray(np.where(road, 255, 0).astype(np.uint8), mode="L")
    mask_image.save(output_dir / "road_mask.png")
    mask_image.save(output_dir / "walkable_mask.png")

    base_rgba = base_image.convert("RGBA")
    obstacle_layer = Image.new("RGBA", base_rgba.size, (0, 0, 0, 0))
    obstacle_pixels = np.zeros((base_rgba.height, base_rgba.width, 4), dtype=np.uint8)
    obstacle_pixels[~road] = [220, 38, 38, 85]
    obstacle_pixels[road] = [14, 165, 233, 38]
    obstacle_layer = Image.fromarray(obstacle_pixels, mode="RGBA")
    preview_full = Image.alpha_composite(base_rgba, obstacle_layer)
    preview = preview_full.resize(
        (base_rgba.width // 4, base_rgba.height // 4),
        Image.Resampling.LANCZOS,
    )
    preview.convert("RGB").save(output_dir / "road_mask_preview.png")
    preview.convert("RGB").save(output_dir / "walkable_mask_preview.png")

    for name, box in CROP_BOXES.items():
        crop = preview_full.crop(box).convert("RGB")
        crop.save(output_dir / name)
        crop.save(output_dir / name.replace("crop_road_", "crop_walkable_"))

    grid_image = Image.fromarray(np.where(grid, 255, 0).astype(np.uint8), mode="L")
    grid_image.resize(
        (grid.shape[1] * 4, grid.shape[0] * 4),
        Image.Resampling.NEAREST,
    ).save(output_dir / "road_grid_16_preview.png")
    grid_image.resize(
        (grid.shape[1] * 4, grid.shape[0] * 4),
        Image.Resampling.NEAREST,
    ).save(output_dir / "walkable_grid_16_preview.png")

    cell_scale = CELL_SIZE / 4.0
    overlay = base_rgba.resize((base_rgba.width // 4, base_rgba.height // 4), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(overlay, "RGBA")
    for row in range(grid.shape[0]):
        for col in range(grid.shape[1]):
            x0 = col * cell_scale
            y0 = row * cell_scale
            x1 = x0 + cell_scale
            y1 = y0 + cell_scale
            if grid[row, col]:
                draw.rectangle((x0, y0, x1, y1), fill=(14, 165, 233, 35))
            else:
                draw.rectangle((x0, y0, x1, y1), fill=(220, 38, 38, 55))
    overlay.convert("RGB").save(output_dir / "road_grid_overlay_preview.png")
    overlay.convert("RGB").save(output_dir / "walkable_grid_overlay_preview.png")


def main() -> None:
    project_dir = Path(__file__).resolve().parents[1]
    visual_dir = project_dir / "visual_check"
    data_dir = project_dir / "data"
    data_dir.mkdir(exist_ok=True)
    visual_dir.mkdir(exist_ok=True)

    base_path = find_base_image(project_dir)
    base_image = Image.open(base_path).convert("RGB")
    campus_mask = build_campus_boundary_mask(base_image.size)
    off_campus_road = build_off_campus_road_mask(base_image.size)
    pedestrian_bridges = build_pedestrian_bridge_mask(base_image.size)
    natural_obstacles = build_color_obstacle_mask(base_image)
    strong_road, weak_road = build_road_candidate_masks(base_image)
    road_candidate = strong_road | weak_road

    road_image = Image.fromarray(np.where(road_candidate, 255, 0).astype(np.uint8), mode="L")
    road_image = road_image.filter(ImageFilter.MaxFilter(3))
    road = (np.asarray(road_image) > 0) & campus_mask & ~natural_obstacles & ~off_campus_road
    road = road | (pedestrian_bridges & campus_mask)
    road, override_used = apply_manual_override(project_dir, road)

    grid = build_grid(road, CELL_SIZE)

    save_grid_json(data_dir / "road_grid_16.json", grid, base_image.size)
    save_grid_json(data_dir / "walkable_grid_16.json", grid, base_image.size)
    save_mask_images(base_image, road, grid, visual_dir)

    print(f"Base image: {base_path.name} {base_image.width}x{base_image.height}")
    print(f"Grid: {grid.shape[1]}x{grid.shape[0]} cells, cell size {CELL_SIZE}px")
    print(f"Road cells: {int(grid.sum())} / {grid.size}")
    if override_used:
        print(f"Manual override: {override_used}")
    else:
        print("Manual override: not found")
    print(f"Saved: {data_dir / 'road_grid_16.json'}")
    print(f"Saved compatibility copy: {data_dir / 'walkable_grid_16.json'}")
    print(f"Saved: {visual_dir / 'road_mask.png'}")
    print(f"Saved previews in: {visual_dir}")


if __name__ == "__main__":
    main()
