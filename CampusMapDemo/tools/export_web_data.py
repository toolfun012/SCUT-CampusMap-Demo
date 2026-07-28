from __future__ import annotations

import json
from pathlib import Path

from route_on_grid import load_places


def main() -> None:
    project_dir = Path(__file__).resolve().parents[1]
    grid_path = project_dir / "data" / "road_grid_16.json"
    main_road_grid_path = project_dir / "data" / "main_road_weight_grid_16.json"
    svg_path = project_dir / "visual_check" / "campus_map_annotation_overlay.svg"
    output_path = project_dir / "web" / "campus_data.js"

    grid_payload = json.loads(grid_path.read_text(encoding="utf-8"))
    main_road_grid_payload = (
        json.loads(main_road_grid_path.read_text(encoding="utf-8"))
        if main_road_grid_path.exists()
        else None
    )
    places = []
    for place in sorted(load_places(svg_path).values(), key=lambda item: item.id):
        places.append(
            {
                "id": place.id,
                "name": place.name,
                "type": place.type,
                "center": {"x": place.center_x, "y": place.center_y},
                "polygons": place.polygons,
            }
        )

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
    output_path.write_text(content, encoding="utf-8")
    print(f"Saved: {output_path}")
    print(f"Places: {len(places)}")


if __name__ == "__main__":
    main()
