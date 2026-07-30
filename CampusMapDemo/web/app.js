const MAP_WIDTH = 3629;
const MAP_HEIGHT = 4161;
const MAX_SNAP_CELLS = 24;
const MAX_GAP_CELLS = 0;
const MAJOR_ROAD_BIAS = 1.35;
const GAP_PENALTY = 8.0;
const MAIN_ROAD_MIN_CLEARANCE = 2;
const MAIN_ROAD_COMPONENT_REFERENCE = 420;
const TOUR_MAX_WAYPOINTS = 32;
const OPEN_GATE_IDS = [
  "east_1_gate",
  "west_2_gate",
  "north_1_gate",
  "north_gate",
  "east_gate",
  "south_gate",
  "west_gate",
];
const TOUR_DORM_PASS_IDS = new Set([
  "c1",
  "c8",
  "c14",
  "d1",
  "d4",
  "e1",
  "graduate_dorm_phase_1",
]);
const TOUR_KEY_BUILDING_IDS = new Set([
  "library",
  "concert_hall",
  "academic_auditorium",
  "international_hotel",
  "a1",
  "a3",
  "a5",
  "b1",
  "b4",
  "b8",
  "b11",
  "b12",
]);
const TOUR_TYPE_WEIGHTS = {
  landscape: 10,
  square: 8,
  bridge: 8,
  sports: 6,
  dining: 6,
  service: 5,
  building: 4,
  gate: 3,
  dormitory: 2,
};

const state = {
  grid: [],
  gridWidth: 0,
  gridHeight: 0,
  cellSize: 16,
  clearance: [],
  mainRoadScore: [],
  manualMainRoad: null,
  reachableRoad: null,
  places: [],
  placesById: new Map(),
  current: null,
  destination: null,
  pendingStart: null,
  pendingGoal: null,
  route: [],
  recommendation: null,
  ready: false,
  view: {
    scale: 1,
    fitScale: 1,
    minScale: 0.1,
    maxScale: 4,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    moved: false,
    suppressClick: false,
    lastMouse: null,
    fitted: false,
  },
};

const elements = {
  startX: document.querySelector("#startX"),
  startY: document.querySelector("#startY"),
  goalX: document.querySelector("#goalX"),
  goalY: document.querySelector("#goalY"),
  destinationInput: document.querySelector("#destinationInput"),
  placeOptions: document.querySelector("#placeOptions"),
  setStartButton: document.querySelector("#setStartButton"),
  setDestinationButton: document.querySelector("#setDestinationButton"),
  setGoalPointButton: document.querySelector("#setGoalPointButton"),
  routeButton: document.querySelector("#routeButton"),
  clearButton: document.querySelector("#clearButton"),
  resetSelectionButton: document.querySelector("#resetSelectionButton"),
  exitRouteButton: document.querySelector("#exitRouteButton"),
  statusText: document.querySelector("#statusText"),
  startSnapText: document.querySelector("#startSnapText"),
  goalSnapText: document.querySelector("#goalSnapText"),
  routeSummaryText: document.querySelector("#routeSummaryText"),
  recommendationSummaryText: document.querySelector("#recommendationSummaryText"),
  recommendationStopsText: document.querySelector("#recommendationStopsText"),
  hoverPosition: document.querySelector("#hoverPosition"),
  baseMap: document.querySelector("#baseMap"),
  canvas: document.querySelector("#routeCanvas"),
  mapFrame: document.querySelector("#mapFrame"),
  mapLayer: document.querySelector("#mapLayer"),
  zoomText: document.querySelector("#zoomText"),
  fitMapButton: document.querySelector("#fitMapButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
};

const ctx = elements.canvas.getContext("2d");

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return first;
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].priority <= this.items[index].priority) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  sinkDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }

  get length() {
    return this.items.length;
  }
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setClickTarget(target) {
  const radio = document.querySelector(`input[name="clickTarget"][value="${target}"]`);
  if (radio) radio.checked = true;
}

function parsePointString(value) {
  return value.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x, y };
  });
}

function polygonAreaAndCentroid(points) {
  if (points.length < 3) {
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { area: 0, x: sum.x / Math.max(1, points.length), y: sum.y / Math.max(1, points.length) };
  }

  let twiceArea = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  points.forEach((current, index) => {
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    cxAcc += (current.x + next.x) * cross;
    cyAcc += (current.y + next.y) * cross;
  });

  if (Math.abs(twiceArea) < 1e-6) {
    const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
    return { area: 0, x: sum.x / points.length, y: sum.y / points.length };
  }

  return {
    area: Math.abs(twiceArea / 2),
    x: cxAcc / (3 * twiceArea),
    y: cyAcc / (3 * twiceArea),
  };
}

function centroidFromPolygons(polygons) {
  let totalArea = 0;
  let xAcc = 0;
  let yAcc = 0;
  const fallback = [];

  polygons.forEach((polygon) => {
    const centroid = polygonAreaAndCentroid(polygon);
    if (centroid.area > 0) {
      totalArea += centroid.area;
      xAcc += centroid.x * centroid.area;
      yAcc += centroid.y * centroid.area;
    }
    fallback.push(...polygon);
  });

  if (totalArea > 0) return { x: xAcc / totalArea, y: yAcc / totalArea };
  const sum = fallback.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / Math.max(1, fallback.length), y: sum.y / Math.max(1, fallback.length) };
}

function applyGridPayload(gridPayload) {
  state.cellSize = gridPayload.cellSize;
  state.grid = gridPayload.rows.map((row) => [...row].map((cell) => cell === "1"));
  state.gridHeight = state.grid.length;
  state.gridWidth = state.grid[0].length;
  state.clearance = buildClearance();
  state.mainRoadScore = buildMainRoadScore();
  state.reachableRoad = buildReachableRoadMask();
  state.manualMainRoad = null;
}

function applyMainRoadGridPayload(mainRoadPayload) {
  if (!mainRoadPayload || !Array.isArray(mainRoadPayload.rows)) {
    state.manualMainRoad = null;
    return;
  }

  if (
    mainRoadPayload.rows.length !== state.gridHeight ||
    mainRoadPayload.rows.some((row) => row.length !== state.gridWidth)
  ) {
    console.warn("main road grid shape does not match road grid");
    state.manualMainRoad = null;
    return;
  }

  const manualMainRoad = new Uint8Array(state.gridWidth * state.gridHeight);
  mainRoadPayload.rows.forEach((rowText, row) => {
    [...rowText].forEach((cell, col) => {
      if (cell === "1" && state.grid[row][col]) {
        manualMainRoad[row * state.gridWidth + col] = 1;
      }
    });
  });
  state.manualMainRoad = manualMainRoad;
}

function applyPlaces(places) {
  state.places = places
    .map((place) => ({
      ...place,
      center: {
        x: Number(place.center.x),
        y: Number(place.center.y),
      },
      access: place.access
        ? {
            x: Number(place.access.x),
            y: Number(place.access.y),
          }
        : null,
      polygons: place.polygons || [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  state.placesById = new Map(state.places.map((place) => [place.id, place]));
  elements.placeOptions.innerHTML = state.places
    .map((place) => `<option value="${place.id}" label="${place.name.replace(/"/g, "'")}"></option>`)
    .join("");
}

function parsePlaces(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const groups = [...doc.querySelectorAll("g[data-type]")];
  const places = groups
    .filter((group) => group.dataset.type !== "road")
    .map((group) => {
      const polygons = [...group.querySelectorAll("polygon")]
        .map((polygon) => polygon.getAttribute("points"))
        .filter(Boolean)
        .map(parsePointString);
      const circle = group.querySelector("circle.center");
      const fallbackCenter = centroidFromPolygons(polygons);
      return {
        id: group.id,
        name: group.dataset.name || group.id,
        type: group.dataset.type || "place",
        center: {
          x: circle ? Number(circle.getAttribute("cx")) : fallbackCenter.x,
          y: circle ? Number(circle.getAttribute("cy")) : fallbackCenter.y,
        },
        polygons,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  applyPlaces(places);
}

async function loadData() {
  if (window.CAMPUS_ROAD_GRID && window.CAMPUS_PLACES) {
    applyGridPayload(window.CAMPUS_ROAD_GRID);
    if (window.CAMPUS_MAIN_ROAD_GRID) applyMainRoadGridPayload(window.CAMPUS_MAIN_ROAD_GRID);
    applyPlaces(window.CAMPUS_PLACES);
    state.ready = true;
    setStatus(`已加载 ${state.places.length} 个地点和 ${state.gridWidth}x${state.gridHeight} 路网。`);
    return;
  }

  const [gridResponse, svgResponse, mainRoadResponse] = await Promise.all([
    fetch("../data/road_grid_16.json"),
    fetch("../visual_check/campus_map_annotation_overlay.svg"),
    fetch("../data/main_road_weight_grid_16.json").catch(() => null),
  ]);

  if (!gridResponse.ok) throw new Error("无法读取 road_grid_16.json");
  if (!svgResponse.ok) throw new Error("无法读取 campus_map_annotation_overlay.svg");

  const gridPayload = await gridResponse.json();
  const svgText = await svgResponse.text();
  const mainRoadPayload = mainRoadResponse?.ok ? await mainRoadResponse.json() : null;

  applyGridPayload(gridPayload);
  if (mainRoadPayload) applyMainRoadGridPayload(mainRoadPayload);
  parsePlaces(svgText);
  state.ready = true;
  setStatus(`已加载 ${state.places.length} 个地点和 ${state.gridWidth}x${state.gridHeight} 路网。`);
}

function resizeCanvas() {
  elements.canvas.width = MAP_WIDTH;
  elements.canvas.height = MAP_HEIGHT;
  elements.mapLayer.style.width = `${MAP_WIDTH}px`;
  elements.mapLayer.style.height = `${MAP_HEIGHT}px`;
  if (!state.view.fitted) {
    fitMapToFrame();
  } else {
    updateMapTransform();
  }
  drawOverlay();
}

function updateMapTransform() {
  const { offsetX, offsetY, scale, fitScale } = state.view;
  elements.mapLayer.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  if (elements.zoomText) {
    const percent = Math.round((scale / Math.max(fitScale, 0.0001)) * 100);
    elements.zoomText.textContent = `${percent}%`;
  }
}

function fitMapToFrame() {
  const rect = elements.mapFrame.getBoundingClientRect();
  const padding = 24;
  const availableWidth = Math.max(1, rect.width - padding * 2);
  const availableHeight = Math.max(1, rect.height - padding * 2);
  const fitScale = Math.min(availableWidth / MAP_WIDTH, availableHeight / MAP_HEIGHT);
  state.view.fitScale = fitScale;
  state.view.minScale = Math.max(0.04, fitScale * 0.45);
  state.view.maxScale = Math.max(2.8, fitScale * 22);
  state.view.scale = fitScale;
  state.view.offsetX = (rect.width - MAP_WIDTH * fitScale) / 2;
  state.view.offsetY = (rect.height - MAP_HEIGHT * fitScale) / 2;
  state.view.fitted = true;
  updateMapTransform();
}

function screenToMap(clientX, clientY) {
  const rect = elements.mapFrame.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.view.offsetX) / state.view.scale,
    y: (clientY - rect.top - state.view.offsetY) / state.view.scale,
  };
}

function zoomAt(clientX, clientY, factor) {
  const rect = elements.mapFrame.getBoundingClientRect();
  const frameX = clientX - rect.left;
  const frameY = clientY - rect.top;
  const before = screenToMap(clientX, clientY);
  state.view.scale = Math.max(
    state.view.minScale,
    Math.min(state.view.maxScale, state.view.scale * factor),
  );
  state.view.offsetX = frameX - before.x * state.view.scale;
  state.view.offsetY = frameY - before.y * state.view.scale;
  updateMapTransform();
}

function gridIndex(row, col) {
  return row * state.gridWidth + col;
}

function cellFromIndex(index) {
  return {
    row: Math.floor(index / state.gridWidth),
    col: index % state.gridWidth,
  };
}

function inBounds(row, col) {
  return row >= 0 && row < state.gridHeight && col >= 0 && col < state.gridWidth;
}

function isRoad(row, col) {
  return inBounds(row, col) && state.grid[row][col];
}

function pixelToCell(x, y) {
  return {
    row: Math.min(Math.max(Math.floor(y / state.cellSize), 0), state.gridHeight - 1),
    col: Math.min(Math.max(Math.floor(x / state.cellSize), 0), state.gridWidth - 1),
  };
}

function cellCenter(cell) {
  return {
    x: (cell.col + 0.5) * state.cellSize,
    y: (cell.row + 0.5) * state.cellSize,
  };
}

function buildReachableRoadMask() {
  const size = state.gridWidth * state.gridHeight;
  const visited = new Uint8Array(size);
  const largest = [];
  const queue = [];
  const component = [];
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  for (let row = 0; row < state.gridHeight; row += 1) {
    for (let col = 0; col < state.gridWidth; col += 1) {
      const startIndex = gridIndex(row, col);
      if (visited[startIndex]) continue;
      visited[startIndex] = 1;
      if (!isRoad(row, col)) continue;

      queue.length = 0;
      component.length = 0;
      queue.push(startIndex);
      let head = 0;

      while (head < queue.length) {
        const index = queue[head];
        head += 1;
        component.push(index);
        const cell = cellFromIndex(index);

        dirs.forEach(([dr, dc]) => {
          const nr = cell.row + dr;
          const nc = cell.col + dc;
          if (!inBounds(nr, nc)) return;
          const nextIndex = gridIndex(nr, nc);
          if (visited[nextIndex]) return;
          visited[nextIndex] = 1;
          if (isRoad(nr, nc)) queue.push(nextIndex);
        });
      }

      if (component.length > largest.length) {
        largest.length = 0;
        largest.push(...component);
      }
    }
  }

  const reachable = new Uint8Array(size);
  largest.forEach((index) => {
    reachable[index] = 1;
  });
  return reachable;
}

function snapToRoad(x, y, maxSnapCells = MAX_SNAP_CELLS) {
  const origin = pixelToCell(x, y);
  let best = null;

  for (let radius = 0; radius <= maxSnapCells; radius += 1) {
    const rowMin = Math.max(0, origin.row - radius);
    const rowMax = Math.min(state.gridHeight - 1, origin.row + radius);
    const colMin = Math.max(0, origin.col - radius);
    const colMax = Math.min(state.gridWidth - 1, origin.col + radius);

    for (let row = rowMin; row <= rowMax; row += 1) {
      for (let col = colMin; col <= colMax; col += 1) {
        if (radius > 0 && Math.abs(row - origin.row) !== radius && Math.abs(col - origin.col) !== radius) continue;
        const index = gridIndex(row, col);
        if (!state.grid[row][col] || (state.reachableRoad && !state.reachableRoad[index])) continue;
        const center = cellCenter({ row, col });
        const distance = Math.hypot(center.x - x, center.y - y);
        if (!best || distance < best.distance) {
          best = { row, col, distance, x: center.x, y: center.y };
        }
      }
    }
    if (best) return best;
  }

  throw new Error(`附近 ${maxSnapCells * state.cellSize}px 内没有可走道路`);
}

function buildClearance() {
  const size = state.gridWidth * state.gridHeight;
  const clearance = new Int16Array(size);
  const queue = [];
  let head = 0;
  clearance.fill(32767);

  for (let row = 0; row < state.gridHeight; row += 1) {
    for (let col = 0; col < state.gridWidth; col += 1) {
      if (!state.grid[row][col]) {
        const index = gridIndex(row, col);
        clearance[index] = 0;
        queue.push(index);
      }
    }
  }

  while (head < queue.length) {
    const index = queue[head];
    head += 1;
    const { row, col } = cellFromIndex(index);
    const nextValue = clearance[index] + 1;
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
      const nr = row + dr;
      const nc = col + dc;
      if (!inBounds(nr, nc)) return;
      const nextIndex = gridIndex(nr, nc);
      if (nextValue < clearance[nextIndex]) {
        clearance[nextIndex] = nextValue;
        queue.push(nextIndex);
      }
    });
  }

  return clearance;
}

function buildMainRoadScore() {
  const size = state.gridWidth * state.gridHeight;
  const visited = new Uint8Array(size);
  const score = new Float32Array(size);
  const queue = [];
  const component = [];
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  for (let row = 0; row < state.gridHeight; row += 1) {
    for (let col = 0; col < state.gridWidth; col += 1) {
      const startIndex = gridIndex(row, col);
      if (visited[startIndex]) continue;
      if (!isRoad(row, col) || state.clearance[startIndex] < MAIN_ROAD_MIN_CLEARANCE) {
        visited[startIndex] = 1;
        continue;
      }

      queue.length = 0;
      component.length = 0;
      queue.push(startIndex);
      visited[startIndex] = 1;
      let head = 0;

      while (head < queue.length) {
        const index = queue[head];
        head += 1;
        component.push(index);
        const cell = cellFromIndex(index);

        dirs.forEach(([dr, dc]) => {
          const nr = cell.row + dr;
          const nc = cell.col + dc;
          if (!inBounds(nr, nc)) return;
          const nextIndex = gridIndex(nr, nc);
          if (visited[nextIndex]) return;
          if (!isRoad(nr, nc) || state.clearance[nextIndex] < MAIN_ROAD_MIN_CLEARANCE) {
            visited[nextIndex] = 1;
            return;
          }
          visited[nextIndex] = 1;
          queue.push(nextIndex);
        });
      }

      const sizeScore = Math.min(1, Math.log1p(component.length) / Math.log1p(MAIN_ROAD_COMPONENT_REFERENCE));
      component.forEach((index) => {
        score[index] = sizeScore;
      });
    }
  }

  return score;
}

function stepBaseCost(dr, dc) {
  return dr !== 0 && dc !== 0 ? Math.SQRT2 : 1;
}

function iterNeighbors(index) {
  const { row, col } = cellFromIndex(index);
  const result = [];
  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];

  dirs.forEach(([dr, dc]) => {
    let nr = row + dr;
    let nc = col + dc;
    if (!inBounds(nr, nc)) return;
    if (isRoad(nr, nc)) {
      result.push({ index: gridIndex(nr, nc), baseCost: stepBaseCost(dr, dc), gapCells: 0 });
      return;
    }

    let gapCells = 0;
    while (inBounds(nr, nc) && !isRoad(nr, nc) && gapCells < MAX_GAP_CELLS) {
      gapCells += 1;
      nr += dr;
      nc += dc;
    }

    if (gapCells > 0 && inBounds(nr, nc) && isRoad(nr, nc)) {
      result.push({
        index: gridIndex(nr, nc),
        baseCost: stepBaseCost(dr, dc) * (gapCells + 1),
        gapCells,
      });
    }
  });

  return result;
}

function heuristic(aIndex, bIndex) {
  const a = cellFromIndex(aIndex);
  const b = cellFromIndex(bIndex);
  return Math.hypot(a.row - b.row, a.col - b.col);
}

function roadWidthCostFactor(clearanceCells, autoMainRoadScore, manualMainRoadScore = 0) {
  const clearance = Math.max(1, clearanceCells);
  const narrowPenalty = 1 + (MAJOR_ROAD_BIAS * 1.8) / (clearance ** 1.7);
  const hasManualLayer = Boolean(state.manualMainRoad);
  const widthDiscountRate = hasManualLayer ? 0.02 : 0.04;
  const autoDiscountRate = hasManualLayer ? 0.12 : 0.42;
  const mainRoadDiscount = Math.min(clearance - 1, 6) * MAJOR_ROAD_BIAS * widthDiscountRate;
  const connectedMainDiscount = autoMainRoadScore * MAJOR_ROAD_BIAS * autoDiscountRate;
  const manualMainDiscount = manualMainRoadScore * MAJOR_ROAD_BIAS * 0.48;
  const manualMissingPenalty = hasManualLayer ? (1 - manualMainRoadScore) * MAJOR_ROAD_BIAS * 0.28 : 0;
  return Math.max(
    1,
    narrowPenalty + manualMissingPenalty - mainRoadDiscount - connectedMainDiscount - manualMainDiscount,
  );
}

function manualMainRoadDeparturePenalty(currentManualMainRoadScore, nextManualMainRoadScore, baseMoveCost) {
  if (!state.manualMainRoad || nextManualMainRoadScore > 0) return 0;
  const offMainStepPenalty = baseMoveCost * MAJOR_ROAD_BIAS * 1.15;
  const leavingMainPenalty = currentManualMainRoadScore > 0 ? MAJOR_ROAD_BIAS * 4 : 0;
  return offMainStepPenalty + leavingMainPenalty;
}

function findRoute(startCell, goalCell) {
  const startIndex = gridIndex(startCell.row, startCell.col);
  const goalIndex = gridIndex(goalCell.row, goalCell.col);
  const size = state.gridWidth * state.gridHeight;
  const bestCost = new Float64Array(size);
  const cameFrom = new Int32Array(size);
  const closed = new Uint8Array(size);
  const gapCount = new Int32Array(size);
  const heap = new MinHeap();

  bestCost.fill(Number.POSITIVE_INFINITY);
  cameFrom.fill(-1);
  bestCost[startIndex] = 0;
  heap.push({ priority: heuristic(startIndex, goalIndex), cost: 0, index: startIndex });

  while (heap.length > 0) {
    const current = heap.pop();
    if (closed[current.index]) continue;
    if (current.index === goalIndex) {
      const path = [];
      let cursor = current.index;
      while (cursor !== -1) {
        path.push(cellFromIndex(cursor));
        cursor = cameFrom[cursor];
      }
      path.reverse();
      return { path, cost: current.cost, virtualGapCells: gapCount[current.index] };
    }

    closed[current.index] = 1;
    const currentManualMainRoadScore = state.manualMainRoad ? state.manualMainRoad[current.index] : 0;
    iterNeighbors(current.index).forEach((neighbor) => {
      if (closed[neighbor.index]) return;
      const manualMainRoadScore = state.manualMainRoad ? state.manualMainRoad[neighbor.index] : 0;
      let moveCost = neighbor.baseCost * roadWidthCostFactor(
        state.clearance[neighbor.index],
        state.mainRoadScore[neighbor.index],
        manualMainRoadScore,
      );
      moveCost += manualMainRoadDeparturePenalty(
        currentManualMainRoadScore,
        manualMainRoadScore,
        neighbor.baseCost,
      );
      if (neighbor.gapCells > 0) moveCost *= GAP_PENALTY;

      const candidateCost = current.cost + moveCost;
      if (candidateCost >= bestCost[neighbor.index]) return;

      bestCost[neighbor.index] = candidateCost;
      gapCount[neighbor.index] = gapCount[current.index] + neighbor.gapCells;
      cameFrom[neighbor.index] = current.index;
      heap.push({
        priority: candidateCost + heuristic(neighbor.index, goalIndex),
        cost: candidateCost,
        index: neighbor.index,
      });
    });
  }

  throw new Error("没有找到可行路线");
}

function simplifyPath(path) {
  if (path.length <= 2) return path;
  const simplified = [path[0]];
  let previous = direction(path[0], path[1]);

  for (let index = 1; index < path.length - 1; index += 1) {
    const currentDirection = direction(path[index], path[index + 1]);
    if (currentDirection.row !== previous.row || currentDirection.col !== previous.col) {
      simplified.push(path[index]);
      previous = currentDirection;
    }
  }
  simplified.push(path[path.length - 1]);
  return simplified;
}

function direction(a, b) {
  return {
    row: Math.sign(b.row - a.row),
    col: Math.sign(b.col - a.col),
  };
}

function routeLength(path) {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = cellCenter(path[index - 1]);
    const current = cellCenter(path[index]);
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return total;
}

function pointKey(x, y) {
  return `${Number(x).toFixed(2)},${Number(y).toFixed(2)}`;
}

function splitPlaceName(name) {
  const parts = String(name || "").split("/").map((part) => part.trim()).filter(Boolean);
  return {
    primary: parts[0] || "",
    secondary: parts.slice(1).join(" / "),
  };
}

function placeAnchor(place) {
  return place.access || place.center;
}

function findPlace(query) {
  const value = query.trim();
  if (!value) throw new Error("请输入目的地");
  if (state.placesById.has(value)) return state.placesById.get(value);

  const lowered = value.toLowerCase();
  const matches = state.places.filter((place) => (
    place.id.toLowerCase().includes(lowered) || place.name.toLowerCase().includes(lowered)
  ));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`目的地不唯一：${matches.slice(0, 8).map((place) => place.id).join(", ")}`);
  throw new Error("没有找到这个目的地");
}

function mapEventToPixel(event) {
  const point = screenToMap(event.clientX, event.clientY);
  return {
    x: Math.min(Math.max(point.x, 0), MAP_WIDTH),
    y: Math.min(Math.max(point.y, 0), MAP_HEIGHT),
  };
}

function setCurrentFromInputs() {
  ensureReady();
  const x = Number(elements.startX.value);
  const y = Number(elements.startY.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("当前起点坐标不完整");

  const snapped = snapToRoad(x, y);
  state.current = { input: { x, y }, snapped };
  state.pendingStart = null;
  state.route = [];
  elements.routeSummaryText.textContent = "-";
  elements.startSnapText.textContent = `(${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})，偏移 ${snapped.distance.toFixed(1)}px`;
  setClickTarget("goal");
  setStatus("当前起点已吸附到路网。下一次点击地图会填入终点坐标。");
  drawOverlay();
}

function setDestinationFromInput() {
  ensureReady();
  const place = findPlace(elements.destinationInput.value);
  const anchor = place.access || place.center;
  const snappedGoal = snapToRoad(anchor.x, anchor.y);
  state.destination = {
    source: "place",
    place,
    snapped: snappedGoal,
    inputValue: elements.destinationInput.value.trim(),
  };
  state.pendingGoal = null;
  state.route = [];
  elements.goalSnapText.textContent = `${place.id} -> (${snappedGoal.x.toFixed(0)}, ${snappedGoal.y.toFixed(0)})，偏移 ${snappedGoal.distance.toFixed(1)}px`;
  elements.routeSummaryText.textContent = "-";
  setStatus("目的地已标记。");
  drawOverlay();
}

function setGoalPointFromInputs() {
  ensureReady();
  const x = Number(elements.goalX.value);
  const y = Number(elements.goalY.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("终点坐标不完整");

  const snappedGoal = snapToRoad(x, y);
  state.destination = {
    source: "point",
    input: { x, y },
    key: pointKey(x, y),
    snapped: snappedGoal,
  };
  state.pendingGoal = null;
  state.route = [];
  elements.destinationInput.value = "";
  elements.goalSnapText.textContent = `自定义终点 -> (${snappedGoal.x.toFixed(0)}, ${snappedGoal.y.toFixed(0)})，偏移 ${snappedGoal.distance.toFixed(1)}px`;
  elements.routeSummaryText.textContent = "-";
  setStatus("坐标终点已标记。");
  drawOverlay();
}

function routeToDestination() {
  ensureReady();
  if (state.pendingStart || !state.current) {
    throw new Error("请先点击“确认当前起点”。");
  }
  if (state.pendingGoal || !state.destination) {
    throw new Error("请先确定目的地或坐标终点。");
  }
  if (state.destination.source === "place" && state.destination.inputValue !== elements.destinationInput.value.trim()) {
    throw new Error("目的地文字已改变，请重新点击“确定地点目的地”。");
  }
  if (state.destination.source === "point") {
    const x = Number(elements.goalX.value);
    const y = Number(elements.goalY.value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || pointKey(x, y) !== state.destination.key) {
      throw new Error("终点坐标已改变，请重新点击“确定坐标终点”。");
    }
  }

  const result = findRoute(state.current.snapped, state.destination.snapped);
  state.route = result.path;
  state.recommendation = null;

  elements.routeSummaryText.textContent = `${result.path.length} 个网格点，约 ${routeLength(result.path).toFixed(0)}px，跨 ${result.virtualGapCells} 个假断点`;
  setStatus("路线已生成。");
  drawOverlay();
}

function getRouteStart() {
  if (state.current) {
    return {
      source: "已确认起点",
      input: state.current.input,
      snapped: state.current.snapped,
    };
  }

  const x = Number(elements.startX.value);
  const y = Number(elements.startY.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("请先填写并确认当前起点。");
  }

  return {
    source: "起点输入",
    input: { x, y },
    snapped: snapToRoad(x, y),
  };
}

function tourZone(point) {
  const col = Math.min(3, Math.max(0, Math.floor(point.x / (MAP_WIDTH / 4))));
  const row = Math.min(3, Math.max(0, Math.floor(point.y / (MAP_HEIGHT / 4))));
  return `${row}-${col}`;
}

function tourCandidateWeight(place) {
  if (place.type === "dormitory" && !TOUR_DORM_PASS_IDS.has(place.id)) return 0;
  if (place.type === "gate" && !OPEN_GATE_IDS.includes(place.id)) return 0;
  if (place.type === "building" && !TOUR_KEY_BUILDING_IDS.has(place.id)) return 0;
  const base = TOUR_TYPE_WEIGHTS[place.type] || 0;
  if (!base) return 0;
  if (TOUR_KEY_BUILDING_IDS.has(place.id)) return base + 4;
  if (TOUR_DORM_PASS_IDS.has(place.id)) return base + 1;
  return base;
}

function buildTourCandidates(start) {
  return state.places
    .map((place) => {
      const weight = tourCandidateWeight(place);
      if (weight <= 0) return null;
      const anchor = placeAnchor(place);
      const snapped = snapToRoad(anchor.x, anchor.y);
      if (snapped.row === start.row && snapped.col === start.col) return null;
      return {
        place,
        snapped,
        weight,
        zone: tourZone(snapped),
      };
    })
    .filter(Boolean);
}

function selectTourStops(start) {
  const remaining = buildTourCandidates(start);
  const selected = [];
  const visitedZones = new Set();
  let cursor = start;

  while (selected.length < TOUR_MAX_WAYPOINTS && remaining.length > 0) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    remaining.forEach((candidate, index) => {
      const distance = Math.max(80, Math.hypot(candidate.snapped.x - cursor.x, candidate.snapped.y - cursor.y));
      const zoneBoost = visitedZones.has(candidate.zone) ? 1 : 1.45;
      const typeBoost = candidate.place.type === "landscape" || candidate.place.type === "square" ? 1.2 : 1;
      const score = (candidate.weight * zoneBoost * typeBoost) / Math.pow(distance / 700 + 1, 0.85);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex < 0) break;
    const next = remaining.splice(bestIndex, 1)[0];
    selected.push(next);
    visitedZones.add(next.zone);
    cursor = next.snapped;
  }

  return selected;
}

function buildCompositeRoute(start, stops) {
  let cursor = start;
  const path = [];
  const includedStops = [];
  let skipped = 0;
  let virtualGapCells = 0;

  stops.forEach((stop) => {
    try {
      const segment = findRoute(cursor, stop.snapped);
      if (segment.path.length > 0) {
        path.push(...(path.length > 0 ? segment.path.slice(1) : segment.path));
      }
      cursor = stop.snapped;
      includedStops.push(stop);
      virtualGapCells += segment.virtualGapCells || 0;
    } catch (error) {
      skipped += 1;
    }
  });

  if (path.length < 2 || includedStops.length === 0) {
    throw new Error("推荐路线暂时无法生成，请换一个当前位置再试。");
  }

  return { path, stops: includedStops, skipped, virtualGapCells };
}

function formatStopNames(stops, limit = 12) {
  const names = stops.map((stop) => splitPlaceName(stop.place.name).primary || stop.place.id);
  const visible = names.slice(0, limit).join(" → ");
  return names.length > limit ? `${visible} → 等 ${names.length} 处` : visible;
}

function planTourRoute() {
  ensureReady();
  const start = getRouteStart();
  const stops = selectTourStops(start.snapped);
  const result = buildCompositeRoute(start.snapped, stops);
  const length = routeLength(result.path);

  state.route = result.path;
  state.recommendation = {
    type: "tour",
    start: start.snapped,
    stops: result.stops,
  };
  elements.recommendationSummaryText.textContent = `智能观光路线：从${start.source}出发，途经 ${result.stops.length} 处，约 ${length.toFixed(0)}px${result.skipped ? `，跳过 ${result.skipped} 处不可达点` : ""}`;
  elements.recommendationStopsText.textContent = formatStopNames(result.stops);
  setStatus("已生成智能观光路线，按景点权重和区域覆盖选择途经点。");
  drawOverlay();
}

function planNearestExitRoute() {
  ensureReady();
  const start = getRouteStart();
  let best = null;

  OPEN_GATE_IDS.forEach((id) => {
    const place = state.placesById.get(id);
    if (!place) return;
    try {
      const anchor = placeAnchor(place);
      const snapped = snapToRoad(anchor.x, anchor.y);
      const result = findRoute(start.snapped, snapped);
      const length = routeLength(result.path);
      if (!best || length < best.length) {
        best = { place, snapped, path: result.path, length, virtualGapCells: result.virtualGapCells || 0 };
      }
    } catch (error) {
      // Ignore unreachable gates and keep evaluating the remaining open gates.
    }
  });

  if (!best) throw new Error("没有找到可用开放校门路线。");

  state.route = best.path;
  state.recommendation = {
    type: "exit",
    start: start.snapped,
    stops: [{ place: best.place, snapped: best.snapped }],
  };
  elements.recommendationSummaryText.textContent = `最近离开路线：${splitPlaceName(best.place.name).primary || best.place.id}，约 ${best.length.toFixed(0)}px`;
  elements.recommendationStopsText.textContent = `开放校门白名单：${OPEN_GATE_IDS.map((id) => {
    const gate = state.placesById.get(id);
    return gate ? (splitPlaceName(gate.name).primary || gate.id) : id;
  }).join("、")}`;
  setStatus("已生成到最近开放校门的路线。");
  drawOverlay();
}

function ensureReady() {
  if (!state.ready) throw new Error("地图数据还没有加载完成");
}

function drawOverlay() {
  ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  if (state.route.length >= 2) {
    const points = simplifyPath(state.route).map(cellCenter);
    const rawPoints = state.route.map(cellCenter);
    const routeColors = getRouteColors();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
    ctx.lineWidth = state.recommendation ? 22 : 24;
    ctx.stroke();
    ctx.lineWidth = state.recommendation ? 11 : 13;
    drawColoredRouteSegments(rawPoints, state.route, routeColors);
  }

  if (state.recommendation && state.route.length >= 2) {
    drawRecommendationMarkers();
  }
  if (state.current) {
    drawMarker(state.current.snapped.x, state.current.snapped.y, "#0ea5e9");
    drawMarkerLabel(state.current.snapped.x, state.current.snapped.y, "起点", "#0ea5e9");
  }
  if (state.pendingStart) {
    drawPendingMarker(state.pendingStart.x, state.pendingStart.y, "#0ea5e9");
  }
  if (state.destination) {
    drawMarker(state.destination.snapped.x, state.destination.snapped.y, "#ef4444");
    const label = state.destination.source === "place"
      ? splitPlaceName(state.destination.place.name).primary || "终点"
      : "终点";
    drawMarkerLabel(state.destination.snapped.x, state.destination.snapped.y, label, "#dc2626");
  }
  if (state.pendingGoal) {
    drawPendingMarker(state.pendingGoal.x, state.pendingGoal.y, "#ef4444");
  }
}

function getRouteColors() {
  if (!state.recommendation) {
    return [
      "rgba(37, 99, 235, 0.96)",
      "rgba(168, 85, 247, 0.96)",
      "rgba(245, 158, 11, 0.96)",
    ];
  }
  if (state.recommendation.type === "exit") {
    return [
      "rgba(22, 163, 74, 0.96)",
      "rgba(37, 99, 235, 0.96)",
      "rgba(168, 85, 247, 0.96)",
    ];
  }
  return [
    "rgba(245, 158, 11, 0.96)",
    "rgba(14, 165, 233, 0.96)",
    "rgba(168, 85, 247, 0.96)",
    "rgba(22, 163, 74, 0.96)",
  ];
}

function drawColoredRouteSegments(points, cells, colors) {
  if (!points || points.length < 2) return;
  const edgeVisits = {};
  let activeColor = null;
  let activeEnd = null;

  const flush = () => {
    if (activeEnd) {
      ctx.strokeStyle = activeColor;
      ctx.stroke();
      activeEnd = null;
    }
  };

  for (let index = 1; index < points.length; index += 1) {
    const color = colors[edgeVisitColorIndex(cells[index - 1], cells[index], edgeVisits, colors.length)];
    if (color !== activeColor) {
      flush();
      ctx.beginPath();
      ctx.moveTo(points[index - 1].x, points[index - 1].y);
      activeColor = color;
    }
    ctx.lineTo(points[index].x, points[index].y);
    activeEnd = points[index];
  }
  flush();
}

function edgeVisitColorIndex(a, b, visits, colorCount) {
  const first = `${a.row},${a.col}`;
  const second = `${b.row},${b.col}`;
  const key = first < second ? `${first}|${second}` : `${second}|${first}`;
  const visit = visits[key] || 0;
  visits[key] = visit + 1;
  return visit % colorCount;
}

function drawRouteArrows(points, color) {
  if (!points || points.length < 2) return;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength < 96) continue;
    drawRouteArrow(
      (previous.x + current.x) / 2,
      (previous.y + current.y) / 2,
      Math.atan2(dy, dx),
      color,
    );
  }
}

function drawRouteArrow(x, y, angle, color) {
  const size = state.recommendation ? 30 : 27;
  const halfWidth = size * 0.46;
  const tailX = x - Math.cos(angle) * size * 0.72;
  const tailY = y - Math.sin(angle) * size * 0.72;
  const tipX = x + Math.cos(angle) * size * 0.74;
  const tipY = y + Math.sin(angle) * size * 0.74;
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tailX + perpX * halfWidth, tailY + perpY * halfWidth);
  ctx.lineTo(tailX - perpX * halfWidth, tailY - perpY * halfWidth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

function drawRecommendationMarkers() {
  const color = state.recommendation.type === "exit" ? "#16a34a" : "#f59e0b";
  (state.recommendation.stops || []).forEach((stop, index) => {
    const isLast = index === state.recommendation.stops.length - 1;
    const label = state.recommendation.type === "tour" && !isLast ? String(index + 1) : "";
    drawMarker(stop.snapped.x, stop.snapped.y, isLast ? "#22c55e" : color, 23, 13, isLast ? 1 : 0.88, label);
    if (isLast && state.recommendation.type === "exit") {
      const gateName = splitPlaceName(stop.place.name).primary || stop.place.id;
      drawMarkerLabel(stop.snapped.x, stop.snapped.y, gateName, "#16a34a");
    }
  });
}

function drawMarker(x, y, color, radius = 28, innerRadius = 19, alpha = 1, label = "") {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  if (label) {
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x, y + 0.5);
  }
  ctx.restore();
}

function drawMarkerLabel(x, y, text, color) {
  const fontSize = 12;
  const paddingX = 6;
  const paddingY = 4;
  const offsetX = 12;
  const offsetY = 20;
  const textX = x + offsetX;
  const textY = y - offsetY;

  ctx.save();
  ctx.font = `600 ${fontSize}px sans-serif`;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = fontSize + paddingY * 2;
  const top = textY - height;
  const left = textX;
  roundRectPath(ctx, left, top, width, height, 6);
  ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.82)";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, left + paddingX, top + height / 2 + 0.5);
  ctx.restore();
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawPendingMarker(x, y, color) {
  drawMarker(x, y, color, 24, 14, 0.78);
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function clearAll() {
  state.current = null;
  state.destination = null;
  state.pendingStart = null;
  state.pendingGoal = null;
  state.route = [];
  state.recommendation = null;
  elements.startSnapText.textContent = "-";
  elements.goalSnapText.textContent = "-";
  elements.routeSummaryText.textContent = "-";
  elements.recommendationSummaryText.textContent = "-";
  elements.recommendationStopsText.textContent = "-";
  setStatus(state.ready ? "已清除。" : "正在加载地图数据...");
  drawOverlay();
}

function handleAction(action) {
  try {
    action();
  } catch (error) {
    setStatus(error.message);
  }
}

elements.setStartButton.addEventListener("click", () => handleAction(setCurrentFromInputs));
elements.setDestinationButton.addEventListener("click", () => handleAction(setDestinationFromInput));
elements.setGoalPointButton.addEventListener("click", () => handleAction(setGoalPointFromInputs));
elements.routeButton.addEventListener("click", () => handleAction(routeToDestination));
elements.exitRouteButton.addEventListener("click", () => handleAction(planNearestExitRoute));
elements.clearButton.addEventListener("click", clearAll);
elements.resetSelectionButton.addEventListener("click", clearAll);
elements.destinationInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAction(setDestinationFromInput);
});
elements.startX.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAction(setCurrentFromInputs);
});
elements.startY.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAction(setCurrentFromInputs);
});
elements.goalX.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAction(setGoalPointFromInputs);
});
elements.goalY.addEventListener("keydown", (event) => {
  if (event.key === "Enter") handleAction(setGoalPointFromInputs);
});
elements.startX.addEventListener("input", () => {
  state.current = null;
  state.route = [];
  drawOverlay();
});
elements.startY.addEventListener("input", () => {
  state.current = null;
  state.route = [];
  drawOverlay();
});
elements.goalX.addEventListener("input", () => {
  if (state.destination?.source === "point") state.destination = null;
  state.route = [];
  drawOverlay();
});
elements.goalY.addEventListener("input", () => {
  if (state.destination?.source === "point") state.destination = null;
  state.route = [];
  drawOverlay();
});
elements.canvas.addEventListener("mousedown", (event) => {
  if (event.button !== 0) return;
  const rect = elements.mapFrame.getBoundingClientRect();
  state.view.dragging = true;
  state.view.moved = false;
  state.view.lastMouse = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  elements.mapLayer.classList.add("is-dragging");
  event.preventDefault();
});

window.addEventListener("mousemove", (event) => {
  const point = mapEventToPixel(event);
  elements.hoverPosition.textContent = `x: ${point.x.toFixed(0)}, y: ${point.y.toFixed(0)}`;

  if (!state.view.dragging || !state.view.lastMouse) return;
  const rect = elements.mapFrame.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const dx = x - state.view.lastMouse.x;
  const dy = y - state.view.lastMouse.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) state.view.moved = true;
  state.view.offsetX += dx;
  state.view.offsetY += dy;
  state.view.lastMouse = { x, y };
  updateMapTransform();
});

window.addEventListener("mouseup", () => {
  if (!state.view.dragging) return;
  state.view.dragging = false;
  state.view.lastMouse = null;
  elements.mapLayer.classList.remove("is-dragging");
  if (state.view.moved) state.view.suppressClick = true;
});

elements.canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 0.87);
}, { passive: false });

elements.canvas.addEventListener("click", (event) => {
  if (state.view.suppressClick) {
    state.view.suppressClick = false;
    return;
  }
  const point = mapEventToPixel(event);
  const target = document.querySelector('input[name="clickTarget"]:checked')?.value || "start";
  if (target === "goal") {
    elements.goalX.value = point.x.toFixed(0);
    elements.goalY.value = point.y.toFixed(0);
    elements.destinationInput.value = "";
    state.destination = null;
    state.pendingGoal = point;
    state.route = [];
    setStatus("终点坐标已填入，点击“确定坐标终点”后吸附到路网。");
  } else {
    elements.startX.value = point.x.toFixed(0);
    elements.startY.value = point.y.toFixed(0);
    state.current = null;
    state.pendingStart = point;
    state.route = [];
    setStatus("起点坐标已填入，点击“确认当前起点”后吸附到路网。");
  }
  drawOverlay();
});
elements.fitMapButton.addEventListener("click", fitMapToFrame);
elements.zoomInButton.addEventListener("click", () => {
  const rect = elements.mapFrame.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
});
elements.zoomOutButton.addEventListener("click", () => {
  const rect = elements.mapFrame.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.84);
});
elements.baseMap.addEventListener("load", resizeCanvas);
if (elements.baseMap.complete) {
  resizeCanvas();
}
window.addEventListener("resize", () => {
  if (!state.view.fitted) return;
  fitMapToFrame();
});

loadData().catch((error) => {
  setStatus(`地图数据加载失败：${error.message}`);
});
