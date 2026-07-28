const MAP_WIDTH = 3629;
const MAP_HEIGHT = 4161;
const MAX_SNAP_CELLS = 24;
const MAX_GAP_CELLS = 0;
const MAJOR_ROAD_BIAS = 1.35;
const GAP_PENALTY = 8.0;
const MAIN_ROAD_MIN_CLEARANCE = 2;
const MAIN_ROAD_COMPONENT_REFERENCE = 420;

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
  ready: false,
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
  statusText: document.querySelector("#statusText"),
  startSnapText: document.querySelector("#startSnapText"),
  goalSnapText: document.querySelector("#goalSnapText"),
  routeSummaryText: document.querySelector("#routeSummaryText"),
  hoverPosition: document.querySelector("#hoverPosition"),
  baseMap: document.querySelector("#baseMap"),
  canvas: document.querySelector("#routeCanvas"),
  mapLayer: document.querySelector("#mapLayer"),
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
  drawOverlay();
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
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: Math.min(Math.max((event.clientX - rect.left) * (MAP_WIDTH / rect.width), 0), MAP_WIDTH),
    y: Math.min(Math.max((event.clientY - rect.top) * (MAP_HEIGHT / rect.height), 0), MAP_HEIGHT),
  };
}

function setCurrentFromInputs() {
  ensureReady();
  const x = Number(elements.startX.value);
  const y = Number(elements.startY.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("当前位置坐标不完整");

  const snapped = snapToRoad(x, y);
  state.current = { input: { x, y }, snapped };
  state.pendingStart = null;
  state.route = [];
  elements.routeSummaryText.textContent = "-";
  elements.startSnapText.textContent = `(${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})，偏移 ${snapped.distance.toFixed(1)}px`;
  setClickTarget("goal");
  setStatus("当前位置已标记。下一次点击地图会填入终点坐标。");
  drawOverlay();
}

function setDestinationFromInput() {
  ensureReady();
  const place = findPlace(elements.destinationInput.value);
  const snappedGoal = snapToRoad(place.center.x, place.center.y);
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
    throw new Error("请先点击“确定当前位置”。");
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

  elements.routeSummaryText.textContent = `${result.path.length} 个网格点，约 ${routeLength(result.path).toFixed(0)}px，跨 ${result.virtualGapCells} 个假断点`;
  setStatus("路线已生成。");
  drawOverlay();
}

function ensureReady() {
  if (!state.ready) throw new Error("地图数据还没有加载完成");
}

function drawOverlay() {
  ctx.clearRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

  if (state.route.length >= 2) {
    const points = simplifyPath(state.route).map(cellCenter);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
    ctx.lineWidth = 24;
    ctx.stroke();
    ctx.strokeStyle = "rgba(37, 99, 235, 0.96)";
    ctx.lineWidth = 13;
    ctx.stroke();
  }

  if (state.current) {
    drawMarker(state.current.snapped.x, state.current.snapped.y, "#0ea5e9");
  }
  if (state.pendingStart) {
    drawPendingMarker(state.pendingStart.x, state.pendingStart.y, "#0ea5e9");
  }
  if (state.destination) {
    drawMarker(state.destination.snapped.x, state.destination.snapped.y, "#22c55e");
  }
  if (state.pendingGoal) {
    drawPendingMarker(state.pendingGoal.x, state.pendingGoal.y, "#22c55e");
  }
}

function drawMarker(x, y, color, radius = 28, innerRadius = 19, alpha = 1) {
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
  ctx.restore();
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
  elements.startSnapText.textContent = "-";
  elements.goalSnapText.textContent = "-";
  elements.routeSummaryText.textContent = "-";
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
elements.canvas.addEventListener("mousemove", (event) => {
  const point = mapEventToPixel(event);
  elements.hoverPosition.textContent = `x: ${point.x.toFixed(0)}, y: ${point.y.toFixed(0)}`;
});
elements.canvas.addEventListener("click", (event) => {
  const point = mapEventToPixel(event);
  const target = document.querySelector('input[name="clickTarget"]:checked')?.value || "start";
  if (target === "goal") {
    elements.goalX.value = point.x.toFixed(0);
    elements.goalY.value = point.y.toFixed(0);
    elements.destinationInput.value = "";
    state.destination = null;
    state.pendingGoal = point;
    state.route = [];
    setStatus("终点坐标已填入，点击“确定坐标终点”后生效。");
  } else {
    elements.startX.value = point.x.toFixed(0);
    elements.startY.value = point.y.toFixed(0);
    state.current = null;
    state.pendingStart = point;
    state.route = [];
    setStatus("起点坐标已填入，点击“确定当前位置”后生效。");
  }
  drawOverlay();
});
elements.baseMap.addEventListener("load", resizeCanvas);
if (elements.baseMap.complete) {
  resizeCanvas();
}

loadData().catch((error) => {
  setStatus(`地图数据加载失败：${error.message}`);
});
