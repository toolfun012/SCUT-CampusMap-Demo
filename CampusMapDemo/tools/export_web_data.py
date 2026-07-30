from __future__ import annotations

import json
from pathlib import Path

from route_on_grid import load_places


MANUAL_ACCESS_POINTS = {
    # The west dormitory cluster has dense building footprints. Navigating to
    # building centers can snap to a farther road, so use nearby entrance paths.
    "c1": {"x": 840.0, "y": 2264.0},
    "c2": {"x": 600.0, "y": 2008.0},
    "c3": {"x": 872.0, "y": 1912.0},
    "d1": {"x": 872.0, "y": 2344.0},
    "d2": {"x": 1000.0, "y": 2088.0},
    "d3": {"x": 1000.0, "y": 2008.0},
    "d4": {"x": 1032.0, "y": 1848.0},
}


def main() -> None:
    project_dir = Path(__file__).resolve().parents[1]
    grid_path = project_dir / "data" / "road_grid_16.json"
    main_road_grid_path = project_dir / "data" / "main_road_weight_grid_16.json"
    svg_path = project_dir / "visual_check" / "campus_map_annotation_overlay.svg"
    web_output_path = project_dir / "web" / "campus_data.js"
    miniprogram_output_path = project_dir / "miniprogram" / "utils" / "campus-data.js"

    grid_payload = json.loads(grid_path.read_text(encoding="utf-8"))
    main_road_grid_payload = (
        json.loads(main_road_grid_path.read_text(encoding="utf-8"))
        if main_road_grid_path.exists()
        else None
    )
    places = []
    for place in sorted(load_places(svg_path).values(), key=lambda item: item.id):
        payload = {
            "id": place.id,
            "name": place.name,
            "type": place.type,
            "center": {"x": place.center_x, "y": place.center_y},
            "polygons": place.polygons,
        }
        if place.id in MANUAL_ACCESS_POINTS:
            payload["access"] = MANUAL_ACCESS_POINTS[place.id]
        places.append(payload)

    content = "\n".join(
        [
            "// Generated from data/road_grid_16.json, optional data/main_road_weight_grid_16.json,",
            "// and visual_check/campus_map_annotation_overlay.svg.",
            "// Re-run tools/export_web_data.py after changing the road grid, main road weights, or place annotations.",
            f"window.CAMPUS_ROAD_GRID = {json.dumps(grid_payload, ensure_ascii=False, separators=(',', ':'))};",
            f"window.CAMPUS_MAIN_ROAD_GRID = {json.dumps(main_road_grid_payload, ensure_ascii=False, separators=(',', ':'))};",
            f"window.CAMPUS_PLACES = {json.dumps(places, ensure_ascii=False, separators=(',', ':'))};",
            "",
        ]
    )
    web_output_path.write_text(content, encoding="utf-8")
    miniprogram_output_path.write_text(
        f"const window = {{}};\n{content}\nmodule.exports = {{\n"
        "  roadGrid: window.CAMPUS_ROAD_GRID,\n"
        "  mainRoadGrid: window.CAMPUS_MAIN_ROAD_GRID,\n"
        "  places: window.CAMPUS_PLACES,\n"
        "};\n",
        encoding="utf-8",
    )
    print(f"Saved: {web_output_path}")
    print(f"Saved: {miniprogram_output_path}")
    print(f"Places: {len(places)}")


if __name__ == "__main__":
    main()
