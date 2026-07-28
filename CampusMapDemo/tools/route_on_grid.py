from __future__ import annotations

import argparse
import heapq
import json
import math
from collections import deque
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw


DEFAULT_GRID = Path("data/road_grid_16.json")
DEFAULT_MAIN_ROAD_GRID = Path("data/main_road_weight_grid_16.json")
DEFAULT_SVG = Path("visual_check/campus_map_annotation_overlay.svg")
DEFAULT_ROUTE_JSON = Path("data/last_route.json")
DEFAULT_ROUTE_PREVIEW = Path("visual_check/route_preview.png")
DEFAULT_ROUTE_PREVIEW_SMALL = Path("visual_check/route_preview_small.png")

ORTHOGONAL_DIRS = [(-1, 0), (0, -1), (0, 1), (1, 0)]
DIRECTIONS = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
]


@dataclass(frozen=True)
class Cell:
    row: int
    col: int


@dataclass
class Place:
    id: str
    name: str
    type: str
    center_x: float
    center_y: float
    polygons: list[list[tuple[float, float]]]


def parse_xy(value: str) -> tuple[float, float]:
    if "," not in value:
        raise argparse.ArgumentTypeError("coordinate must use x,y format")
    left, right = value.split(",", 1)
    return float(left.strip()), float(right.strip())


def project_dir_from_script() -> Path:
    return Path(__file__).resolve().parents[1]


def resolve_project_path(project_dir: Path, path: Path) -> Path:
    return path if path.is_absolute() else project_dir / path


def load_grid(path: Path) -> tuple[list[list[bool]], dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    grid = [[char == "1" for char in row] for row in payload["rows"]]
    return grid, payload


def load_optional_main_road_grid(path: Path, road_grid: list[list[bool]]) -> list[list[bool]] | None:
    if not path.exists():
        return None

    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rows", [])
    if len(rows) != len(road_grid) or any(len(row) != len(road_grid[0]) for row in rows):
        raise ValueError(f"main road grid shape does not match road grid: {path}")

    return [
        [char == "1" and road_grid[row_index][col_index] for col_index, char in enumerate(row)]
        for row_index, row in enumerate(rows)
    ]


def parse_points(value: str) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for pair in value.strip().split():
        x_text, y_text = pair.split(",", 1)
        result.append((float(x_text), float(y_text)))
    return result


def polygon_area_and_centroid(points: list[tuple[float, float]]) -> tuple[float, float, float]:
    if len(points) < 3:
        if not points:
            return 0.0, 0.0, 0.0
        x = sum(point[0] for point in points) / len(points)
        y = sum(point[1] for point in points) / len(points)
        return 0.0, x, y

    twice_area = 0.0
    cx_acc = 0.0
    cy_acc = 0.0
    for index, current in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        cross = current[0] * nxt[1] - nxt[0] * current[1]
        twice_area += cross
        cx_acc += (current[0] + nxt[0]) * cross
        cy_acc += (current[1] + nxt[1]) * cross

    if abs(twice_area) < 1e-6:
        x = sum(point[0] for point in points) / len(points)
        y = sum(point[1] for point in points) / len(points)
        return 0.0, x, y

    area = twice_area / 2.0
    return abs(area), cx_acc / (3.0 * twice_area), cy_acc / (3.0 * twice_area)


def centroid_from_polygons(polygons: list[list[tuple[float, float]]]) -> tuple[float, float]:
    total_area = 0.0
    x_acc = 0.0
    y_acc = 0.0
    fallback_points: list[tuple[float, float]] = []

    for polygon in polygons:
        area, cx, cy = polygon_area_and_centroid(polygon)
        if area > 0.0:
            total_area += area
            x_acc += cx * area
            y_acc += cy * area
        fallback_points.extend(polygon)

    if total_area > 0.0:
        return x_acc / total_area, y_acc / total_area
    if fallback_points:
        return (
            sum(point[0] for point in fallback_points) / len(fallback_points),
            sum(point[1] for point in fallback_points) / len(fallback_points),
        )
    return 0.0, 0.0


def load_places(svg_path: Path) -> dict[str, Place]:
    root = ET.parse(svg_path).getroot()
    namespace = ""
    if root.tag.startswith("{"):
        namespace = root.tag.split("}", 1)[0] + "}"

    places: dict[str, Place] = {}
    for group in root.findall(f".//{namespace}g"):
        place_id = group.attrib.get("id")
        place_type = group.attrib.get("data-type", "")
        if not place_id or place_type == "road":
            continue

        polygons: list[list[tuple[float, float]]] = []
        for polygon in group.findall(f"{namespace}polygon"):
            points_text = polygon.attrib.get("points")
            if points_text:
                polygons.append(parse_points(points_text))

        center_x: float | None = None
        center_y: float | None = None
        for circle in group.findall(f"{namespace}circle"):
            if "center" in circle.attrib.get("class", ""):
                center_x = float(circle.attrib["cx"])
                center_y = float(circle.attrib["cy"])
                break

        if center_x is None or center_y is None:
            center_x, center_y = centroid_from_polygons(polygons)

        places[place_id] = Place(
            id=place_id,
            name=group.attrib.get("data-name", place_id),
            type=place_type,
            center_x=center_x,
            center_y=center_y,
            polygons=polygons,
        )

    return places


def find_base_image(project_dir: Path) -> Path:
    candidates = sorted(project_dir.parent.glob("*.png"))
    if not candidates:
        raise FileNotFoundError("No campus base PNG found next to CampusMapDemo")
    return candidates[0]


def in_bounds(grid: list[list[bool]], cell: Cell) -> bool:
    return 0 <= cell.row < len(grid) and 0 <= cell.col < len(grid[0])


def pixel_to_cell(x: float, y: float, cell_size: int, grid: list[list[bool]]) -> Cell:
    col = min(max(int(x // cell_size), 0), len(grid[0]) - 1)
    row = min(max(int(y // cell_size), 0), len(grid) - 1)
    return Cell(row, col)


def cell_center(cell: Cell, cell_size: int) -> tuple[float, float]:
    return (cell.col + 0.5) * cell_size, (cell.row + 0.5) * cell_size


def build_largest_road_component(grid: list[list[bool]]) -> list[list[bool]]:
    height = len(grid)
    width = len(grid[0])
    visited = [[False for _ in range(width)] for _ in range(height)]
    largest: list[Cell] = []

    for start_row in range(height):
        for start_col in range(width):
            if visited[start_row][start_col]:
                continue
            visited[start_row][start_col] = True
            if not grid[start_row][start_col]:
                continue

            queue: deque[Cell] = deque([Cell(start_row, start_col)])
            component: list[Cell] = []

            while queue:
                cell = queue.popleft()
                component.append(cell)
                for dr, dc in DIRECTIONS:
                    nxt = Cell(cell.row + dr, cell.col + dc)
                    if not in_bounds(grid, nxt) or visited[nxt.row][nxt.col]:
                        continue
                    visited[nxt.row][nxt.col] = True
                    if grid[nxt.row][nxt.col]:
                        queue.append(nxt)

            if len(component) > len(largest):
                largest = component

    reachable = [[False for _ in range(width)] for _ in range(height)]
    for cell in largest:
        reachable[cell.row][cell.col] = True
    return reachable


def snap_to_road(
    grid: list[list[bool]],
    x: float,
    y: float,
    cell_size: int,
    max_snap_cells: int,
    reachable_grid: list[list[bool]] | None = None,
) -> tuple[Cell, float]:
    origin = pixel_to_cell(x, y, cell_size, grid)
    best: tuple[float, Cell] | None = None

    for radius in range(max_snap_cells + 1):
        row_min = max(0, origin.row - radius)
        row_max = min(len(grid) - 1, origin.row + radius)
        col_min = max(0, origin.col - radius)
        col_max = min(len(grid[0]) - 1, origin.col + radius)

        for row in range(row_min, row_max + 1):
            for col in range(col_min, col_max + 1):
                if radius > 0 and abs(row - origin.row) != radius and abs(col - origin.col) != radius:
                    continue
                if not grid[row][col] or (reachable_grid is not None and not reachable_grid[row][col]):
                    continue
                cx, cy = cell_center(Cell(row, col), cell_size)
                distance = math.hypot(cx - x, cy - y)
                if best is None or distance < best[0]:
                    best = (distance, Cell(row, col))

        if best is not None:
            return best[1], best[0]

    raise ValueError(f"no road cell found within {max_snap_cells * cell_size}px of ({x:.1f}, {y:.1f})")


def build_clearance(grid: list[list[bool]]) -> list[list[int]]:
    height = len(grid)
    width = len(grid[0])
    large = height + width + 1
    clearance = [[large for _ in range(width)] for _ in range(height)]
    queue: deque[Cell] = deque()

    for row in range(height):
        for col in range(width):
            if not grid[row][col]:
                clearance[row][col] = 0
                queue.append(Cell(row, col))

    while queue:
        cell = queue.popleft()
        next_value = clearance[cell.row][cell.col] + 1
        for dr, dc in ORTHOGONAL_DIRS:
            nxt = Cell(cell.row + dr, cell.col + dc)
            if in_bounds(grid, nxt) and next_value < clearance[nxt.row][nxt.col]:
                clearance[nxt.row][nxt.col] = next_value
                queue.append(nxt)

    return clearance


def build_main_road_score(
    grid: list[list[bool]],
    clearance: list[list[int]],
    min_clearance: int = 2,
    component_reference: int = 420,
) -> list[list[float]]:
    height = len(grid)
    width = len(grid[0])
    visited = [[False for _ in range(width)] for _ in range(height)]
    score = [[0.0 for _ in range(width)] for _ in range(height)]

    for start_row in range(height):
        for start_col in range(width):
            if visited[start_row][start_col]:
                continue
            if not grid[start_row][start_col] or clearance[start_row][start_col] < min_clearance:
                visited[start_row][start_col] = True
                continue

            queue: deque[Cell] = deque([Cell(start_row, start_col)])
            visited[start_row][start_col] = True
            component: list[Cell] = []

            while queue:
                cell = queue.popleft()
                component.append(cell)
                for dr, dc in DIRECTIONS:
                    nxt = Cell(cell.row + dr, cell.col + dc)
                    if not in_bounds(grid, nxt) or visited[nxt.row][nxt.col]:
                        continue
                    if not grid[nxt.row][nxt.col] or clearance[nxt.row][nxt.col] < min_clearance:
                        visited[nxt.row][nxt.col] = True
                        continue
                    visited[nxt.row][nxt.col] = True
                    queue.append(nxt)

            size_score = min(1.0, math.log1p(len(component)) / math.log1p(component_reference))
            for cell in component:
                score[cell.row][cell.col] = size_score

    return score


def step_base_cost(dr: int, dc: int) -> float:
    return math.sqrt(2.0) if dr != 0 and dc != 0 else 1.0


def iter_neighbors(
    grid: list[list[bool]],
    cell: Cell,
    max_gap_cells: int,
) -> list[tuple[Cell, float, int]]:
    neighbors: list[tuple[Cell, float, int]] = []
    for dr, dc in DIRECTIONS:
        base = step_base_cost(dr, dc)
        nxt = Cell(cell.row + dr, cell.col + dc)
        if not in_bounds(grid, nxt):
            continue
        if grid[nxt.row][nxt.col]:
            neighbors.append((nxt, base, 0))
            continue

        gap_cells = 0
        probe = nxt
        while in_bounds(grid, probe) and not grid[probe.row][probe.col] and gap_cells < max_gap_cells:
            gap_cells += 1
            probe = Cell(probe.row + dr, probe.col + dc)

        if gap_cells > 0 and in_bounds(grid, probe) and grid[probe.row][probe.col]:
            neighbors.append((probe, base * (gap_cells + 1), gap_cells))

    return neighbors


def heuristic(a: Cell, b: Cell) -> float:
    return math.hypot(a.row - b.row, a.col - b.col)


def road_width_cost_factor(
    clearance_cells: int,
    auto_main_road_score: float,
    manual_main_road_score: float,
    major_road_bias: float,
    manual_layer_active: bool,
) -> float:
    clearance = max(1, clearance_cells)
    narrow_penalty = 1.0 + (major_road_bias * 1.8) / (clearance ** 1.7)
    width_discount_rate = 0.02 if manual_layer_active else 0.04
    auto_discount_rate = 0.12 if manual_layer_active else 0.42
    main_road_discount = min(clearance - 1, 6) * major_road_bias * width_discount_rate
    connected_main_discount = auto_main_road_score * major_road_bias * auto_discount_rate
    manual_main_discount = manual_main_road_score * major_road_bias * 0.48
    manual_missing_penalty = (
        (1.0 - manual_main_road_score) * major_road_bias * 0.28
        if manual_layer_active
        else 0.0
    )
    return max(
        1.0,
        narrow_penalty
        + manual_missing_penalty
        - main_road_discount
        - connected_main_discount
        - manual_main_discount,
    )


def manual_main_road_departure_penalty(
    current_manual_main_road_score: float,
    next_manual_main_road_score: float,
    base_move_cost: float,
    major_road_bias: float,
    manual_layer_active: bool,
) -> float:
    if not manual_layer_active or next_manual_main_road_score > 0.0:
        return 0.0

    off_main_step_penalty = base_move_cost * major_road_bias * 1.15
    leaving_main_penalty = major_road_bias * 4.0 if current_manual_main_road_score > 0.0 else 0.0
    return off_main_step_penalty + leaving_main_penalty


def astar_route(
    grid: list[list[bool]],
    start: Cell,
    goal: Cell,
    max_gap_cells: int,
    major_road_bias: float,
    gap_penalty: float,
    manual_main_road: list[list[bool]] | None = None,
) -> tuple[list[Cell], float, int]:
    clearance = build_clearance(grid)
    main_road_score = build_main_road_score(grid, clearance)
    manual_layer_active = manual_main_road is not None
    open_heap: list[tuple[float, float, int, Cell]] = []
    heapq.heappush(open_heap, (heuristic(start, goal), 0.0, 0, start))

    came_from: dict[Cell, Cell] = {}
    best_cost: dict[Cell, float] = {start: 0.0}
    gap_count: dict[Cell, int] = {start: 0}
    closed: set[Cell] = set()
    sequence = 1

    while open_heap:
        _, current_cost, _, current = heapq.heappop(open_heap)
        if current in closed:
            continue
        if current == goal:
            path = [current]
            while path[-1] in came_from:
                path.append(came_from[path[-1]])
            path.reverse()
            return path, current_cost, gap_count[current]

        closed.add(current)
        current_manual_score = (
            1.0 if manual_main_road and manual_main_road[current.row][current.col] else 0.0
        )
        for nxt, base_move_cost, gap_cells in iter_neighbors(grid, current, max_gap_cells):
            if nxt in closed:
                continue
            manual_score = 1.0 if manual_main_road and manual_main_road[nxt.row][nxt.col] else 0.0
            move_cost = base_move_cost * road_width_cost_factor(
                clearance[nxt.row][nxt.col],
                main_road_score[nxt.row][nxt.col],
                manual_score,
                major_road_bias,
                manual_layer_active,
            )
            move_cost += manual_main_road_departure_penalty(
                current_manual_score,
                manual_score,
                base_move_cost,
                major_road_bias,
                manual_layer_active,
            )
            if gap_cells > 0:
                move_cost *= gap_penalty

            candidate_cost = current_cost + move_cost
            if candidate_cost >= best_cost.get(nxt, math.inf):
                continue

            best_cost[nxt] = candidate_cost
            gap_count[nxt] = gap_count[current] + gap_cells
            came_from[nxt] = current
            sequence += 1
            priority = candidate_cost + heuristic(nxt, goal)
            heapq.heappush(open_heap, (priority, candidate_cost, sequence, nxt))

    raise ValueError("route not found")


def simplify_cells(path: list[Cell]) -> list[Cell]:
    if len(path) <= 2:
        return path

    simplified = [path[0]]
    previous_dr = path[1].row - path[0].row
    previous_dc = path[1].col - path[0].col
    if previous_dr != 0:
        previous_dr = 1 if previous_dr > 0 else -1
    if previous_dc != 0:
        previous_dc = 1 if previous_dc > 0 else -1

    for index in range(1, len(path) - 1):
        current = path[index]
        nxt = path[index + 1]
        dr = nxt.row - current.row
        dc = nxt.col - current.col
        if dr != 0:
            dr = 1 if dr > 0 else -1
        if dc != 0:
            dc = 1 if dc > 0 else -1
        if (dr, dc) != (previous_dr, previous_dc):
            simplified.append(current)
            previous_dr, previous_dc = dr, dc

    simplified.append(path[-1])
    return simplified


def pixel_points(path: list[Cell], cell_size: int) -> list[dict[str, float]]:
    return [
        {"x": round(cell_center(cell, cell_size)[0], 2), "y": round(cell_center(cell, cell_size)[1], 2)}
        for cell in path
    ]


def route_length_px(points: list[dict[str, float]]) -> float:
    total = 0.0
    for index in range(1, len(points)):
        total += math.hypot(
            points[index]["x"] - points[index - 1]["x"],
            points[index]["y"] - points[index - 1]["y"],
        )
    return total


def find_place(places: dict[str, Place], query: str) -> Place:
    if query in places:
        return places[query]

    lowered = query.lower()
    matches = [
        place
        for place in places.values()
        if lowered in place.id.lower() or lowered in place.name.lower()
    ]
    if len(matches) == 1:
        return matches[0]
    if matches:
        ids = ", ".join(place.id for place in matches[:12])
        raise ValueError(f"destination is ambiguous: {ids}")
    raise ValueError(f"destination not found: {query}")


def save_route_json(
    path: Path,
    start_input: tuple[float, float],
    start_cell: Cell,
    start_snap_distance: float,
    destination: Place,
    goal_cell: Cell,
    goal_snap_distance: float,
    route_cells: list[Cell],
    route_cost: float,
    virtual_gap_cells: int,
    cell_size: int,
) -> None:
    simplified = simplify_cells(route_cells)
    detailed_points = pixel_points(route_cells, cell_size)
    simplified_points = pixel_points(simplified, cell_size)
    start_x, start_y = cell_center(start_cell, cell_size)
    goal_x, goal_y = cell_center(goal_cell, cell_size)

    payload = {
        "start": {
            "input": {"x": start_input[0], "y": start_input[1]},
            "snapped": {
                "x": round(start_x, 2),
                "y": round(start_y, 2),
                "row": start_cell.row,
                "col": start_cell.col,
                "distancePx": round(start_snap_distance, 2),
            },
        },
        "destination": {
            "id": destination.id,
            "name": destination.name,
            "type": destination.type,
            "center": {"x": destination.center_x, "y": destination.center_y},
            "snapped": {
                "x": round(goal_x, 2),
                "y": round(goal_y, 2),
                "row": goal_cell.row,
                "col": goal_cell.col,
                "distancePx": round(goal_snap_distance, 2),
            },
        },
        "route": {
            "cellCount": len(route_cells),
            "simplifiedPointCount": len(simplified_points),
            "cost": round(route_cost, 3),
            "lengthPxApprox": round(route_length_px(detailed_points), 2),
            "virtualGapCells": virtual_gap_cells,
            "points": detailed_points,
            "simplifiedPoints": simplified_points,
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def save_route_preview(
    base_image_path: Path,
    output_path: Path,
    small_output_path: Path,
    route_cells: list[Cell],
    start_cell: Cell,
    goal_cell: Cell,
    cell_size: int,
) -> None:
    base = Image.open(base_image_path).convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    points = [cell_center(cell, cell_size) for cell in simplify_cells(route_cells)]

    if len(points) >= 2:
        draw.line(points, fill=(255, 255, 255, 235), width=24, joint="curve")
        draw.line(points, fill=(37, 99, 235, 245), width=14, joint="curve")

    for cell, color in [
        (start_cell, (14, 165, 233, 255)),
        (goal_cell, (34, 197, 94, 255)),
    ]:
        x, y = cell_center(cell, cell_size)
        radius = 24
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(255, 255, 255, 245))
        draw.ellipse((x - radius + 6, y - radius + 6, x + radius - 6, y + radius - 6), fill=color)

    preview = Image.alpha_composite(base, overlay).convert("RGB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output_path)

    small_width = 1100
    small_height = round(preview.height * small_width / preview.width)
    preview.resize((small_width, small_height), Image.Resampling.LANCZOS).save(small_output_path)


def list_destinations(places: dict[str, Place]) -> None:
    for place in sorted(places.values(), key=lambda item: item.id):
        print(f"{place.id}\t{place.type}\t{place.name}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Route on the campus road grid.")
    parser.add_argument("--start", type=parse_xy, help="start pixel coordinate, for example 710,2405")
    parser.add_argument("--dest", help="destination place id or unique substring, for example library")
    parser.add_argument("--grid", type=Path, default=DEFAULT_GRID)
    parser.add_argument("--main-road-grid", type=Path, default=DEFAULT_MAIN_ROAD_GRID)
    parser.add_argument("--svg", type=Path, default=DEFAULT_SVG)
    parser.add_argument("--out-json", type=Path, default=DEFAULT_ROUTE_JSON)
    parser.add_argument("--out-preview", type=Path, default=DEFAULT_ROUTE_PREVIEW)
    parser.add_argument("--out-preview-small", type=Path, default=DEFAULT_ROUTE_PREVIEW_SMALL)
    parser.add_argument("--max-snap-cells", type=int, default=24)
    parser.add_argument("--max-gap-cells", type=int, default=0)
    parser.add_argument("--major-road-bias", type=float, default=1.35)
    parser.add_argument("--gap-penalty", type=float, default=8.0)
    parser.add_argument("--list-destinations", action="store_true")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    project_dir = project_dir_from_script()
    grid_path = resolve_project_path(project_dir, args.grid)
    main_road_grid_path = resolve_project_path(project_dir, args.main_road_grid)
    svg_path = resolve_project_path(project_dir, args.svg)
    out_json = resolve_project_path(project_dir, args.out_json)
    out_preview = resolve_project_path(project_dir, args.out_preview)
    out_preview_small = resolve_project_path(project_dir, args.out_preview_small)

    grid, grid_payload = load_grid(grid_path)
    reachable_grid = build_largest_road_component(grid)
    manual_main_road = load_optional_main_road_grid(main_road_grid_path, grid)
    places = load_places(svg_path)

    if args.list_destinations:
        list_destinations(places)
        return

    if args.start is None or not args.dest:
        parser.error("--start and --dest are required unless --list-destinations is used")

    cell_size = int(grid_payload["cellSize"])
    destination = find_place(places, args.dest)
    start_cell, start_snap_distance = snap_to_road(
        grid,
        args.start[0],
        args.start[1],
        cell_size,
        args.max_snap_cells,
        reachable_grid,
    )
    goal_cell, goal_snap_distance = snap_to_road(
        grid,
        destination.center_x,
        destination.center_y,
        cell_size,
        args.max_snap_cells,
        reachable_grid,
    )

    route_cells, route_cost, virtual_gap_cells = astar_route(
        grid,
        start_cell,
        goal_cell,
        args.max_gap_cells,
        args.major_road_bias,
        args.gap_penalty,
        manual_main_road,
    )

    save_route_json(
        out_json,
        args.start,
        start_cell,
        start_snap_distance,
        destination,
        goal_cell,
        goal_snap_distance,
        route_cells,
        route_cost,
        virtual_gap_cells,
        cell_size,
    )
    save_route_preview(
        find_base_image(project_dir),
        out_preview,
        out_preview_small,
        route_cells,
        start_cell,
        goal_cell,
        cell_size,
    )

    print(f"Destination: {destination.id} ({destination.type})")
    print(
        "Start snapped: "
        f"row={start_cell.row}, col={start_cell.col}, distance={start_snap_distance:.1f}px"
    )
    print(
        "Goal snapped: "
        f"row={goal_cell.row}, col={goal_cell.col}, distance={goal_snap_distance:.1f}px"
    )
    print(f"Route cells: {len(route_cells)}")
    print(f"Virtual gap cells crossed: {virtual_gap_cells}")
    if manual_main_road is not None:
        manual_route_cells = sum(1 for cell in route_cells if manual_main_road[cell.row][cell.col])
        print(f"Manual main road cells on route: {manual_route_cells}")
    print(f"Saved: {out_json}")
    print(f"Saved: {out_preview}")
    print(f"Saved: {out_preview_small}")


if __name__ == "__main__":
    main()
