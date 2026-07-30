const MAP_WIDTH = 3629;
const MAP_HEIGHT = 4161;
const MAX_SNAP_CELLS = 24;
const MAX_GAP_CELLS = 0;
const MAJOR_ROAD_BIAS = 1.35;
const GAP_PENALTY = 8.0;
const MAIN_ROAD_MIN_CLEARANCE = 2;
const MAIN_ROAD_COMPONENT_REFERENCE = 420;

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
      const tmp = this.items[parent];
      this.items[parent] = this.items[index];
      this.items[index] = tmp;
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
      const tmp = this.items[smallest];
      this.items[smallest] = this.items[index];
      this.items[index] = tmp;
      index = smallest;
    }
  }

  get length() {
    return this.items.length;
  }
}

class CampusRouter {
  constructor(options) {
    const roadGrid = options.roadGrid;
    this.cellSize = roadGrid.cellSize;
    this.grid = roadGrid.rows.map((row) => Array.from(row).map((cell) => cell === "1"));
    this.gridHeight = this.grid.length;
    this.gridWidth = this.grid[0].length;
    this.places = (options.places || [])
      .map((place) => ({
        id: String(place.id),
        name: String(place.name || place.id),
        type: String(place.type || "place"),
        center: {
          x: Number(place.center.x),
          y: Number(place.center.y)
        },
        access: place.access ? {
          x: Number(place.access.x),
          y: Number(place.access.y)
        } : null,
        polygons: place.polygons || []
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    this.placesById = {};
    this.places.forEach((place) => {
      this.placesById[place.id] = place;
    });
    this.clearance = this.buildClearance();
    this.mainRoadScore = this.buildMainRoadScore();
    this.reachableRoad = this.buildReachableRoadMask();
    this.manualMainRoad = this.buildManualMainRoad(options.mainRoadGrid);
  }

  gridIndex(row, col) {
    return row * this.gridWidth + col;
  }

  cellFromIndex(index) {
    return {
      row: Math.floor(index / this.gridWidth),
      col: index % this.gridWidth
    };
  }

  inBounds(row, col) {
    return row >= 0 && row < this.gridHeight && col >= 0 && col < this.gridWidth;
  }

  isRoad(row, col) {
    return this.inBounds(row, col) && this.grid[row][col];
  }

  pixelToCell(x, y) {
    return {
      row: Math.min(Math.max(Math.floor(y / this.cellSize), 0), this.gridHeight - 1),
      col: Math.min(Math.max(Math.floor(x / this.cellSize), 0), this.gridWidth - 1)
    };
  }

  cellCenter(cell) {
    return {
      x: (cell.col + 0.5) * this.cellSize,
      y: (cell.row + 0.5) * this.cellSize
    };
  }

  buildManualMainRoad(payload) {
    if (!payload || !Array.isArray(payload.rows)) return null;
    if (
      payload.rows.length !== this.gridHeight ||
      payload.rows.some((row) => row.length !== this.gridWidth)
    ) {
      return null;
    }

    const manualMainRoad = new Uint8Array(this.gridWidth * this.gridHeight);
    payload.rows.forEach((rowText, row) => {
      Array.from(rowText).forEach((cell, col) => {
        if (cell === "1" && this.grid[row][col]) {
          manualMainRoad[row * this.gridWidth + col] = 1;
        }
      });
    });
    return manualMainRoad;
  }

  buildReachableRoadMask() {
    const size = this.gridWidth * this.gridHeight;
    const visited = new Uint8Array(size);
    const largest = [];
    const queue = [];
    const component = [];
    const dirs = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1], [0, 1],
      [1, -1], [1, 0], [1, 1]
    ];

    for (let row = 0; row < this.gridHeight; row += 1) {
      for (let col = 0; col < this.gridWidth; col += 1) {
        const startIndex = this.gridIndex(row, col);
        if (visited[startIndex]) continue;
        visited[startIndex] = 1;
        if (!this.isRoad(row, col)) continue;

        queue.length = 0;
        component.length = 0;
        queue.push(startIndex);
        let head = 0;

        while (head < queue.length) {
          const index = queue[head];
          head += 1;
          component.push(index);
          const cell = this.cellFromIndex(index);

          dirs.forEach(([dr, dc]) => {
            const nr = cell.row + dr;
            const nc = cell.col + dc;
            if (!this.inBounds(nr, nc)) return;
            const nextIndex = this.gridIndex(nr, nc);
            if (visited[nextIndex]) return;
            visited[nextIndex] = 1;
            if (this.isRoad(nr, nc)) queue.push(nextIndex);
          });
        }

        if (component.length > largest.length) {
          largest.length = 0;
          largest.push.apply(largest, component);
        }
      }
    }

    const reachable = new Uint8Array(size);
    largest.forEach((index) => {
      reachable[index] = 1;
    });
    return reachable;
  }

  snapToRoad(x, y, maxSnapCells = MAX_SNAP_CELLS) {
    const origin = this.pixelToCell(x, y);
    let best = null;

    for (let radius = 0; radius <= maxSnapCells; radius += 1) {
      const rowMin = Math.max(0, origin.row - radius);
      const rowMax = Math.min(this.gridHeight - 1, origin.row + radius);
      const colMin = Math.max(0, origin.col - radius);
      const colMax = Math.min(this.gridWidth - 1, origin.col + radius);

      for (let row = rowMin; row <= rowMax; row += 1) {
        for (let col = colMin; col <= colMax; col += 1) {
          if (radius > 0 && Math.abs(row - origin.row) !== radius && Math.abs(col - origin.col) !== radius) {
            continue;
          }
          const index = this.gridIndex(row, col);
          if (!this.grid[row][col] || (this.reachableRoad && !this.reachableRoad[index])) continue;
          const center = this.cellCenter({ row, col });
          const distance = Math.hypot(center.x - x, center.y - y);
          if (!best || distance < best.distance) {
            best = { row, col, distance, x: center.x, y: center.y };
          }
        }
      }
      if (best) return best;
    }

    throw new Error(`附近 ${maxSnapCells * this.cellSize}px 内没有可走道路`);
  }

  buildClearance() {
    const size = this.gridWidth * this.gridHeight;
    const clearance = new Int16Array(size);
    const queue = [];
    let head = 0;
    clearance.fill(32767);

    for (let row = 0; row < this.gridHeight; row += 1) {
      for (let col = 0; col < this.gridWidth; col += 1) {
        if (!this.grid[row][col]) {
          const index = this.gridIndex(row, col);
          clearance[index] = 0;
          queue.push(index);
        }
      }
    }

    while (head < queue.length) {
      const index = queue[head];
      head += 1;
      const cell = this.cellFromIndex(index);
      const nextValue = clearance[index] + 1;
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
        const nr = cell.row + dr;
        const nc = cell.col + dc;
        if (!this.inBounds(nr, nc)) return;
        const nextIndex = this.gridIndex(nr, nc);
        if (nextValue < clearance[nextIndex]) {
          clearance[nextIndex] = nextValue;
          queue.push(nextIndex);
        }
      });
    }

    return clearance;
  }

  buildMainRoadScore() {
    const size = this.gridWidth * this.gridHeight;
    const visited = new Uint8Array(size);
    const score = new Float32Array(size);
    const queue = [];
    const component = [];
    const dirs = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1], [0, 1],
      [1, -1], [1, 0], [1, 1]
    ];

    for (let row = 0; row < this.gridHeight; row += 1) {
      for (let col = 0; col < this.gridWidth; col += 1) {
        const startIndex = this.gridIndex(row, col);
        if (visited[startIndex]) continue;
        if (!this.isRoad(row, col) || this.clearance[startIndex] < MAIN_ROAD_MIN_CLEARANCE) {
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
          const cell = this.cellFromIndex(index);

          dirs.forEach(([dr, dc]) => {
            const nr = cell.row + dr;
            const nc = cell.col + dc;
            if (!this.inBounds(nr, nc)) return;
            const nextIndex = this.gridIndex(nr, nc);
            if (visited[nextIndex]) return;
            if (!this.isRoad(nr, nc) || this.clearance[nextIndex] < MAIN_ROAD_MIN_CLEARANCE) {
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

  stepBaseCost(dr, dc) {
    return dr !== 0 && dc !== 0 ? Math.SQRT2 : 1;
  }

  iterNeighbors(index) {
    const cell = this.cellFromIndex(index);
    const result = [];
    const dirs = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1], [0, 1],
      [1, -1], [1, 0], [1, 1]
    ];

    dirs.forEach(([dr, dc]) => {
      let nr = cell.row + dr;
      let nc = cell.col + dc;
      if (!this.inBounds(nr, nc)) return;
      if (this.isRoad(nr, nc)) {
        result.push({ index: this.gridIndex(nr, nc), baseCost: this.stepBaseCost(dr, dc), gapCells: 0 });
        return;
      }

      let gapCells = 0;
      while (this.inBounds(nr, nc) && !this.isRoad(nr, nc) && gapCells < MAX_GAP_CELLS) {
        gapCells += 1;
        nr += dr;
        nc += dc;
      }

      if (gapCells > 0 && this.inBounds(nr, nc) && this.isRoad(nr, nc)) {
        result.push({
          index: this.gridIndex(nr, nc),
          baseCost: this.stepBaseCost(dr, dc) * (gapCells + 1),
          gapCells
        });
      }
    });

    return result;
  }

  heuristic(aIndex, bIndex) {
    const a = this.cellFromIndex(aIndex);
    const b = this.cellFromIndex(bIndex);
    return Math.hypot(a.row - b.row, a.col - b.col);
  }

  roadWidthCostFactor(clearanceCells, autoMainRoadScore, manualMainRoadScore = 0) {
    const clearance = Math.max(1, clearanceCells);
    const narrowPenalty = 1 + (MAJOR_ROAD_BIAS * 1.8) / (clearance ** 1.7);
    const hasManualLayer = Boolean(this.manualMainRoad);
    const widthDiscountRate = hasManualLayer ? 0.02 : 0.04;
    const autoDiscountRate = hasManualLayer ? 0.12 : 0.42;
    const mainRoadDiscount = Math.min(clearance - 1, 6) * MAJOR_ROAD_BIAS * widthDiscountRate;
    const connectedMainDiscount = autoMainRoadScore * MAJOR_ROAD_BIAS * autoDiscountRate;
    const manualMainDiscount = manualMainRoadScore * MAJOR_ROAD_BIAS * 0.48;
    const manualMissingPenalty = hasManualLayer ? (1 - manualMainRoadScore) * MAJOR_ROAD_BIAS * 0.28 : 0;
    return Math.max(
      1,
      narrowPenalty + manualMissingPenalty - mainRoadDiscount - connectedMainDiscount - manualMainDiscount
    );
  }

  manualMainRoadDeparturePenalty(currentManualMainRoadScore, nextManualMainRoadScore, baseMoveCost) {
    if (!this.manualMainRoad || nextManualMainRoadScore > 0) return 0;
    const offMainStepPenalty = baseMoveCost * MAJOR_ROAD_BIAS * 1.15;
    const leavingMainPenalty = currentManualMainRoadScore > 0 ? MAJOR_ROAD_BIAS * 4 : 0;
    return offMainStepPenalty + leavingMainPenalty;
  }

  findRoute(startCell, goalCell) {
    const startIndex = this.gridIndex(startCell.row, startCell.col);
    const goalIndex = this.gridIndex(goalCell.row, goalCell.col);
    const size = this.gridWidth * this.gridHeight;
    const bestCost = new Float64Array(size);
    const cameFrom = new Int32Array(size);
    const closed = new Uint8Array(size);
    const gapCount = new Int32Array(size);
    const heap = new MinHeap();

    bestCost.fill(Number.POSITIVE_INFINITY);
    cameFrom.fill(-1);
    bestCost[startIndex] = 0;
    heap.push({ priority: this.heuristic(startIndex, goalIndex), cost: 0, index: startIndex });

    while (heap.length > 0) {
      const current = heap.pop();
      if (closed[current.index]) continue;
      if (current.index === goalIndex) {
        const path = [];
        let cursor = current.index;
        while (cursor !== -1) {
          path.push(this.cellFromIndex(cursor));
          cursor = cameFrom[cursor];
        }
        path.reverse();
        return { path, cost: current.cost, virtualGapCells: gapCount[current.index] };
      }

      closed[current.index] = 1;
      const currentManualMainRoadScore = this.manualMainRoad ? this.manualMainRoad[current.index] : 0;
      this.iterNeighbors(current.index).forEach((neighbor) => {
        if (closed[neighbor.index]) return;
        const manualMainRoadScore = this.manualMainRoad ? this.manualMainRoad[neighbor.index] : 0;
        let moveCost = neighbor.baseCost * this.roadWidthCostFactor(
          this.clearance[neighbor.index],
          this.mainRoadScore[neighbor.index],
          manualMainRoadScore
        );
        moveCost += this.manualMainRoadDeparturePenalty(
          currentManualMainRoadScore,
          manualMainRoadScore,
          neighbor.baseCost
        );
        if (neighbor.gapCells > 0) moveCost *= GAP_PENALTY;

        const candidateCost = current.cost + moveCost;
        if (candidateCost >= bestCost[neighbor.index]) return;

        bestCost[neighbor.index] = candidateCost;
        gapCount[neighbor.index] = gapCount[current.index] + neighbor.gapCells;
        cameFrom[neighbor.index] = current.index;
        heap.push({
          priority: candidateCost + this.heuristic(neighbor.index, goalIndex),
          cost: candidateCost,
          index: neighbor.index
        });
      });
    }

    throw new Error("没有找到可行路线");
  }

  simplifyPath(path) {
    if (path.length <= 2) return path;
    const simplified = [path[0]];
    let previous = this.direction(path[0], path[1]);

    for (let index = 1; index < path.length - 1; index += 1) {
      const currentDirection = this.direction(path[index], path[index + 1]);
      if (currentDirection.row !== previous.row || currentDirection.col !== previous.col) {
        simplified.push(path[index]);
        previous = currentDirection;
      }
    }
    simplified.push(path[path.length - 1]);
    return simplified;
  }

  direction(a, b) {
    return {
      row: Math.sign(b.row - a.row),
      col: Math.sign(b.col - a.col)
    };
  }

  routeLength(path) {
    let total = 0;
    for (let index = 1; index < path.length; index += 1) {
      const previous = this.cellCenter(path[index - 1]);
      const current = this.cellCenter(path[index]);
      total += Math.hypot(current.x - previous.x, current.y - previous.y);
    }
    return total;
  }

  findPlace(query) {
    const value = String(query || "").trim();
    if (!value) throw new Error("请输入目的地");
    if (this.placesById[value]) return this.placesById[value];

    const lowered = value.toLowerCase();
    const matches = this.places.filter((place) => (
      place.id.toLowerCase().includes(lowered) || place.name.toLowerCase().includes(lowered)
    ));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`目的地不唯一：${matches.slice(0, 8).map((place) => place.id).join(", ")}`);
    }
    throw new Error("没有找到这个目的地");
  }

  placePickerLabels() {
    return this.places.map((place) => `${place.id}  ${place.name}`);
  }
}

module.exports = {
  CampusRouter,
  MAP_WIDTH,
  MAP_HEIGHT
};
