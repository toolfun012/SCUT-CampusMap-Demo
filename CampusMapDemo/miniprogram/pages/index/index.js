const campusData = require("../../utils/campus-data");
const { CampusRouter, MAP_WIDTH, MAP_HEIGHT } = require("../../utils/router");

const IMAGE_SRC = "/assets/campus_map.jpg";
const MIN_SCALE = 0.08;
const MAX_SCALE = 4.5;

function pointKey(x, y) {
  return `${Number(x).toFixed(2)},${Number(y).toFixed(2)}`;
}

function splitPlaceName(name) {
  const parts = String(name || "").split("/").map((part) => part.trim()).filter(Boolean);
  return {
    primary: parts[0] || "",
    secondary: parts.slice(1).join(" / ")
  };
}

function formatDestinationInput(place) {
  return `${place.id} / ${place.name}`;
}

function formatDestinationOption(place) {
  const name = splitPlaceName(place.name);
  const title = name.primary && name.primary !== place.id ? name.primary : place.id;
  const subtitle = [place.id, name.secondary].filter(Boolean).join(" / ");
  return {
    id: place.id,
    title,
    subtitle
  };
}

Page({
  data: {
    mapReady: false,
    statusText: "正在加载地图数据...",
    startX: "",
    startY: "",
    goalX: "",
    goalY: "",
    destinationInput: "",
    destinationOptions: [],
    showDestinationDropdown: false,
    clickTarget: "start",
    coordText: "x: -, y: -",
    zoomText: "100%",
    startSnapText: "-",
    goalSnapText: "-",
    routeSummaryText: "-"
  },

  onLoad() {
    this.router = new CampusRouter({
      roadGrid: campusData.roadGrid,
      mainRoadGrid: campusData.mainRoadGrid,
      places: campusData.places
    });
    this.current = null;
    this.destination = null;
    this.pendingStart = null;
    this.pendingGoal = null;
    this.route = [];
    this.selectedDestinationId = null;
    this.touchState = null;
    this.view = {
      scale: 1,
      fitScale: 1,
      minScale: MIN_SCALE,
      offsetX: 0,
      offsetY: 0
    };

    this.setData({
      destinationOptions: this.buildDestinationOptions(""),
      statusText: "地图数据已读取，正在准备画布..."
    });
  },

  buildDestinationOptions(keyword) {
    const raw = String(keyword || "").trim().toLowerCase();
    const compact = raw.replace(/\s+/g, "");
    return this.router.places
      .filter((place) => {
        if (!raw) return true;
        const haystack = `${place.id} ${place.name}`.toLowerCase();
        return haystack.includes(raw) || haystack.replace(/\s+/g, "").includes(compact);
      })
      .slice(0, 40)
      .map(formatDestinationOption);
  },

  onReady() {
    this.initCanvas();
  },

  initCanvas() {
    const query = wx.createSelectorQuery().in(this);
    query.select("#mapCanvas").fields({ node: true, size: true }).exec((result) => {
      const canvasInfo = result && result[0];
      if (!canvasInfo || !canvasInfo.node) {
        this.setData({ statusText: "画布初始化失败" });
        return;
      }

      const systemInfo = wx.getSystemInfoSync();
      this.dpr = systemInfo.pixelRatio || 1;
      this.canvas = canvasInfo.node;
      this.ctx = this.canvas.getContext("2d");
      this.canvasWidth = canvasInfo.width;
      this.canvasHeight = canvasInfo.height;
      this.canvas.width = Math.round(this.canvasWidth * this.dpr);
      this.canvas.height = Math.round(this.canvasHeight * this.dpr);
      this.ctx.scale(this.dpr, this.dpr);

      const image = this.canvas.createImage();
      image.onload = () => {
        this.mapImage = image;
        this.fitMap();
        this.setData({
          mapReady: true,
          statusText: "地图已加载，可以点选起点"
        });
        this.drawMap();
      };
      image.onerror = () => {
        this.setData({ statusText: "底图加载失败" });
      };
      image.src = IMAGE_SRC;
    });
  },

  fitMap() {
    if (!this.canvasWidth || !this.canvasHeight) return;
    const scale = Math.max(this.canvasWidth / MAP_WIDTH, this.canvasHeight / MAP_HEIGHT);
    this.view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    this.view.fitScale = this.view.scale;
    this.view.minScale = this.view.scale;
    this.view.offsetX = (this.canvasWidth - MAP_WIDTH * this.view.scale) / 2;
    this.view.offsetY = (this.canvasHeight - MAP_HEIGHT * this.view.scale) / 2;
    this.constrainView();
    this.updateZoomText();
    this.drawMap();
  },

  constrainView() {
    if (!this.canvasWidth || !this.canvasHeight || !Number.isFinite(this.view.scale)) return;
    const mapWidth = MAP_WIDTH * this.view.scale;
    const mapHeight = MAP_HEIGHT * this.view.scale;

    if (mapWidth <= this.canvasWidth) {
      this.view.offsetX = (this.canvasWidth - mapWidth) / 2;
    } else {
      this.view.offsetX = Math.min(0, Math.max(this.canvasWidth - mapWidth, this.view.offsetX));
    }

    if (mapHeight <= this.canvasHeight) {
      this.view.offsetY = (this.canvasHeight - mapHeight) / 2;
    } else {
      this.view.offsetY = Math.min(0, Math.max(this.canvasHeight - mapHeight, this.view.offsetY));
    }
  },

  updateZoomText() {
    const text = `${Math.round(this.view.scale * 100)}%`;
    if (this.data.zoomText !== text) {
      this.setData({ zoomText: text });
    }
  },

  zoomAt(screenX, screenY, factor) {
    if (!this.canvasWidth || !this.canvasHeight || !Number.isFinite(this.view.scale)) return;
    const before = this.screenToMap(screenX, screenY);
    const minScale = this.view.minScale || this.view.fitScale || MIN_SCALE;
    this.view.scale = Math.max(minScale, Math.min(MAX_SCALE, this.view.scale * factor));
    this.view.offsetX = screenX - before.x * this.view.scale;
    this.view.offsetY = screenY - before.y * this.view.scale;
    this.constrainView();
    this.updateZoomText();
    this.drawMap();
  },

  zoomIn() {
    this.zoomAt(this.canvasWidth / 2, this.canvasHeight / 2, 1.2);
  },

  zoomOut() {
    this.zoomAt(this.canvasWidth / 2, this.canvasHeight / 2, 0.84);
  },

  setClickMode(event) {
    const target = event.currentTarget.dataset.target;
    this.setData({ clickTarget: target });
  },

  onStartXInput(event) {
    this.current = null;
    this.pendingStart = null;
    this.route = [];
    this.setData({
      clickTarget: "start",
      startX: event.detail.value,
      startSnapText: "-",
      routeSummaryText: "-",
      statusText: "起点坐标已修改，请重新确定当前位置"
    });
    this.drawMap();
  },

  onStartYInput(event) {
    this.current = null;
    this.pendingStart = null;
    this.route = [];
    this.setData({
      clickTarget: "start",
      startY: event.detail.value,
      startSnapText: "-",
      routeSummaryText: "-",
      statusText: "起点坐标已修改，请重新确定当前位置"
    });
    this.drawMap();
  },

  onGoalXInput(event) {
    const patch = {
      goalX: event.detail.value,
      statusText: "终点坐标已修改，点击确定坐标终点后生效"
    };
    if (this.destination && this.destination.source === "point") {
      this.destination = null;
      this.route = [];
      patch.goalSnapText = "-";
      patch.routeSummaryText = "-";
    }
    this.setData(patch);
    this.drawMap();
  },

  onGoalYInput(event) {
    const patch = {
      goalY: event.detail.value,
      statusText: "终点坐标已修改，点击确定坐标终点后生效"
    };
    if (this.destination && this.destination.source === "point") {
      this.destination = null;
      this.route = [];
      patch.goalSnapText = "-";
      patch.routeSummaryText = "-";
    }
    this.setData(patch);
    this.drawMap();
  },

  onDestinationInput(event) {
    this.selectedDestinationId = null;
    const patch = {
      destinationInput: event.detail.value,
      destinationOptions: this.buildDestinationOptions(event.detail.value),
      showDestinationDropdown: true,
      statusText: "地点文字已修改，点击确定地点目的地后生效"
    };
    if (this.destination && this.destination.source === "place") {
      this.destination = null;
      this.route = [];
      patch.goalSnapText = "-";
      patch.routeSummaryText = "-";
    }
    this.setData(patch);
    this.drawMap();
  },

  onDestinationFocus() {
    this.setData({
      destinationOptions: this.buildDestinationOptions(this.data.destinationInput),
      showDestinationDropdown: true
    });
  },

  hideDestinationDropdown() {
    if (this.data.showDestinationDropdown) {
      this.setData({ showDestinationDropdown: false });
    }
  },

  keepDestinationDropdown() {
    // Used with catchtap to keep outside taps from closing the selector.
  },

  selectDestinationOption(event) {
    const id = event.currentTarget.dataset.id;
    const place = this.router.placesById[id];
    if (!place) return;
    this.selectedDestinationId = place.id;
    const patch = {
      destinationInput: formatDestinationInput(place),
      destinationOptions: this.buildDestinationOptions(formatDestinationInput(place)),
      showDestinationDropdown: false,
      statusText: "已选择地点，点击确定地点目的地后生效"
    };
    if (this.destination && this.destination.source === "place") {
      this.destination = null;
      this.route = [];
      patch.goalSnapText = "-";
      patch.routeSummaryText = "-";
    }
    this.setData(patch);
    this.drawMap();
  },

  confirmStart() {
    this.runAction(() => {
      const x = Number(this.data.startX);
      const y = Number(this.data.startY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("当前位置坐标不完整");

      const snapped = this.router.snapToRoad(x, y);
      this.current = { input: { x, y }, snapped };
      this.pendingStart = null;
      this.route = [];
      this.setData({
        clickTarget: "goal",
        startSnapText: `(${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})，偏移 ${snapped.distance.toFixed(1)}px`,
        routeSummaryText: "-",
        statusText: "当前位置已标记，下一次点击地图会填入终点坐标"
      });
      this.drawMap();
    });
  },

  confirmPlaceDestination() {
    this.runAction(() => {
      const place = this.selectedDestinationId
        ? this.router.placesById[this.selectedDestinationId]
        : this.router.findPlace(this.data.destinationInput);
      const snapped = this.router.snapToRoad(place.center.x, place.center.y);
      this.destination = {
        source: "place",
        place,
        snapped,
        inputValue: String(this.data.destinationInput || "").trim()
      };
      this.pendingGoal = null;
      this.route = [];
      this.setData({
        showDestinationDropdown: false,
        goalSnapText: `${place.id} -> (${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})，偏移 ${snapped.distance.toFixed(1)}px`,
        routeSummaryText: "-",
        statusText: "目的地已标记"
      });
      this.drawMap();
    });
  },

  confirmGoalPoint() {
    this.runAction(() => {
      const x = Number(this.data.goalX);
      const y = Number(this.data.goalY);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("终点坐标不完整");

      const snapped = this.router.snapToRoad(x, y);
      this.destination = {
        source: "point",
        input: { x, y },
        key: pointKey(x, y),
        snapped
      };
      this.pendingGoal = null;
      this.route = [];
      this.setData({
        goalSnapText: `自定义终点 -> (${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})，偏移 ${snapped.distance.toFixed(1)}px`,
        routeSummaryText: "-",
        statusText: "坐标终点已标记"
      });
      this.drawMap();
    });
  },

  planRoute() {
    this.runAction(() => {
      if (this.pendingStart || !this.current) {
        throw new Error("请先点击“确定当前位置”");
      }
      if (!this.destination) {
        throw new Error("请先确定目的地或坐标终点");
      }
      if (
        this.destination.source === "place" &&
        this.destination.inputValue !== String(this.data.destinationInput || "").trim()
      ) {
        throw new Error("目的地文字已改变，请重新确定地点目的地");
      }
      if (this.destination.source === "point") {
        const x = Number(this.data.goalX);
        const y = Number(this.data.goalY);
        if (this.pendingGoal) {
          throw new Error("终点坐标已改变，请先点击“确定坐标终点”");
        }
        if (!Number.isFinite(x) || !Number.isFinite(y) || pointKey(x, y) !== this.destination.key) {
          throw new Error("终点坐标已改变，请重新确定坐标终点");
        }
      }

      const result = this.router.findRoute(this.current.snapped, this.destination.snapped);
      this.route = result.path;
      this.setData({
        routeSummaryText: `${result.path.length} 个网格点，约 ${this.router.routeLength(result.path).toFixed(0)}px，跨 ${result.virtualGapCells} 个假断点`,
        statusText: "路线已生成"
      });
      this.drawMap();
    });
  },

  clearAll() {
    this.current = null;
    this.destination = null;
    this.pendingStart = null;
    this.pendingGoal = null;
    this.route = [];
    this.selectedDestinationId = null;
    this.setData({
      startX: "",
      startY: "",
      goalX: "",
      goalY: "",
      destinationInput: "",
      destinationOptions: this.buildDestinationOptions(""),
      showDestinationDropdown: false,
      clickTarget: "start",
      coordText: "x: -, y: -",
      startSnapText: "-",
      goalSnapText: "-",
      routeSummaryText: "-",
      statusText: this.data.mapReady ? "已清空" : "正在加载地图数据..."
    });
    this.drawMap();
  },

  runAction(action) {
    try {
      action();
    } catch (error) {
      this.setData({ statusText: error.message });
    }
  },

  getTouchPoint(touch) {
    return {
      x: Number.isFinite(touch.x) ? touch.x : touch.clientX,
      y: Number.isFinite(touch.y) ? touch.y : touch.clientY
    };
  },

  touchDistance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  },

  touchCenter(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  },

  onMapTouchStart(event) {
    const touches = Array.from(event.touches || []).map((touch) => this.getTouchPoint(touch));
    if (touches.length >= 2) {
      this.touchState = {
        mode: "pinch",
        lastDistance: this.touchDistance(touches[0], touches[1]),
        moved: true
      };
      return;
    }

    if (touches.length === 1) {
      this.touchState = {
        mode: "pan",
        start: touches[0],
        last: touches[0],
        moved: false,
        startedAt: Date.now()
      };
    }
  },

  onMapTouchMove(event) {
    if (!this.touchState) return;
    const touches = Array.from(event.touches || []).map((touch) => this.getTouchPoint(touch));

    if (touches.length >= 2) {
      const distance = this.touchDistance(touches[0], touches[1]);
      const center = this.touchCenter(touches[0], touches[1]);
      const lastDistance = Math.max(1, this.touchState.lastDistance || distance);
      this.touchState = {
        mode: "pinch",
        lastDistance: distance,
        moved: true
      };
      this.zoomAt(center.x, center.y, distance / lastDistance);
      return;
    }

    if (this.touchState.mode !== "pan" || touches.length !== 1) return;
    const point = touches[0];
    const dx = point.x - this.touchState.last.x;
    const dy = point.y - this.touchState.last.y;
    const totalDx = point.x - this.touchState.start.x;
    const totalDy = point.y - this.touchState.start.y;
    if (Math.abs(totalDx) + Math.abs(totalDy) > 6) this.touchState.moved = true;
    this.view.offsetX += dx;
    this.view.offsetY += dy;
    this.constrainView();
    this.touchState.last = point;
    this.drawMap();
  },

  onMapWheel(event) {
    const detail = event.detail || {};
    const deltaY = Number.isFinite(detail.deltaY) ? detail.deltaY : Number(event.deltaY || 0);
    if (!deltaY) return;
    const x = Number.isFinite(detail.x) ? detail.x : this.canvasWidth / 2;
    const y = Number.isFinite(detail.y) ? detail.y : this.canvasHeight / 2;
    this.zoomAt(x, y, deltaY < 0 ? 1.12 : 0.9);
  },

  onMapTouchEnd(event) {
    if (!this.touchState) return;
    const changed = event.changedTouches && event.changedTouches[0]
      ? this.getTouchPoint(event.changedTouches[0])
      : null;
    const touches = Array.from(event.touches || []).map((touch) => this.getTouchPoint(touch));

    if (touches.length === 1) {
      this.touchState = {
        mode: "pan",
        start: touches[0],
        last: touches[0],
        moved: true,
        startedAt: Date.now()
      };
      return;
    }

    const wasTap = this.touchState.mode === "pan" && !this.touchState.moved && changed;
    this.touchState = null;
    if (wasTap) this.handleMapTap(changed);
  },

  handleMapTap(screenPoint) {
    this.hideDestinationDropdown();
    const point = this.clampMapPoint(this.screenToMap(screenPoint.x, screenPoint.y));
    const xText = point.x.toFixed(0);
    const yText = point.y.toFixed(0);

    if (this.data.clickTarget === "goal") {
      const keepPlaceDestination = this.destination && this.destination.source === "place";
      if (!keepPlaceDestination) {
        this.destination = null;
        this.route = [];
      }
      this.pendingGoal = point;
      const patch = {
        goalX: xText,
        goalY: yText,
        coordText: `x: ${xText}, y: ${yText}`,
        statusText: "终点坐标已填入"
      };
      if (!keepPlaceDestination) {
        patch.goalSnapText = "-";
        patch.routeSummaryText = "-";
      }
      this.setData(patch);
    } else {
      this.current = null;
      this.pendingStart = point;
      this.route = [];
      this.setData({
        clickTarget: "start",
        startX: xText,
        startY: yText,
        coordText: `x: ${xText}, y: ${yText}`,
        startSnapText: "-",
        routeSummaryText: "-",
        statusText: "起点坐标已填入"
      });
    }

    this.drawMap();
  },

  screenToMap(screenX, screenY) {
    return {
      x: (screenX - this.view.offsetX) / this.view.scale,
      y: (screenY - this.view.offsetY) / this.view.scale
    };
  },

  clampMapPoint(point) {
    return {
      x: Math.min(Math.max(point.x, 0), MAP_WIDTH),
      y: Math.min(Math.max(point.y, 0), MAP_HEIGHT)
    };
  },

  drawMap() {
    if (!this.ctx || !this.mapImage) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    ctx.save();
    ctx.translate(this.view.offsetX, this.view.offsetY);
    ctx.scale(this.view.scale, this.view.scale);
    ctx.drawImage(this.mapImage, 0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.drawRoute(ctx);
    this.drawMarkers(ctx);
    ctx.restore();
  },

  drawRoute(ctx) {
    if (!this.route || this.route.length < 2) return;
    const points = this.router.simplifyPath(this.route).map((cell) => this.router.cellCenter(cell));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
    ctx.lineWidth = 14 / this.view.scale;
    ctx.stroke();
    ctx.strokeStyle = "rgba(37, 99, 235, 0.96)";
    ctx.lineWidth = 7 / this.view.scale;
    ctx.stroke();
  },

  drawMarkers(ctx) {
    if (this.current) {
      this.drawMarker(ctx, this.current.snapped.x, this.current.snapped.y, "#0ea5e9", 11, 7, 1);
    }
    if (this.pendingStart) {
      this.drawMarker(ctx, this.pendingStart.x, this.pendingStart.y, "#0ea5e9", 10, 5, 0.78, true);
    }
    if (this.destination) {
      this.drawMarker(ctx, this.destination.snapped.x, this.destination.snapped.y, "#22c55e", 11, 7, 1);
    }
    if (this.pendingGoal) {
      this.drawMarker(ctx, this.pendingGoal.x, this.pendingGoal.y, "#22c55e", 10, 5, 0.78, true);
    }
  },

  drawMarker(ctx, x, y, color, radius, innerRadius, alpha, pending) {
    const scale = this.view.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius / scale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, innerRadius / scale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (pending) {
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, (radius + 7) / scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
});
