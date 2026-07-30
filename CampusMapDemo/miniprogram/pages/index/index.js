const campusData = require("../../utils/campus-data");
const { CampusRouter, MAP_WIDTH, MAP_HEIGHT } = require("../../utils/router");
const geoCalibration = require("../../utils/geo-calibration");
const { createGeoProjector } = require("../../utils/geo-projector");

const IMAGE_SRC = "/assets/campus_map.jpg";
const MIN_SCALE = 0.08;
const MAX_SCALE = 4.5;
const TOUR_MAX_WAYPOINTS = 32;
const OPEN_GATE_IDS = [
  "east_1_gate",
  "west_2_gate",
  "north_1_gate",
  "north_gate",
  "east_gate",
  "south_gate",
  "west_gate"
];
const TOUR_DORM_PASS_IDS = new Set([
  "c1",
  "c8",
  "c14",
  "d1",
  "d4",
  "e1",
  "graduate_dorm_phase_1"
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
  "b12"
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
  dormitory: 2
};

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
    locating: false,
    locationStatusText: "未定位",
    locationStatusState: "idle",
    locationText: "未定位",
    startSnapText: "-",
    goalSnapText: "-",
    routeSummaryText: "-",
    recommendationSummaryText: "-",
    recommendationStopsText: "-"
  },

  onLoad() {
    this.router = new CampusRouter({
      roadGrid: campusData.roadGrid,
      mainRoadGrid: campusData.mainRoadGrid,
      places: campusData.places
    });
    this.geoProjector = createGeoProjector(geoCalibration.controlPoints);
    this.current = null;
    this.destination = null;
    this.pendingStart = null;
    this.pendingGoal = null;
    this.route = [];
    this.recommendation = null;
    this.userLocation = null;
    this.lastGeoLocation = null;
    this.heading = null;
    this.locationListener = (res) => this.handleLocationChange(res);
    this.compassListener = (res) => this.handleCompassChange(res);
    this.locationTimer = null;
    this.locationStarting = false;
    this.locationPermissionDenied = false;
    this.locationStarted = false;
    this.compassStarted = false;
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
    this.startUserLocation({ auto: true });
  },

  onUnload() {
    this.stopUserLocation({ silent: true });
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
          statusText: this.userLocation ? "地图已加载，定位点正在实时更新" : "地图已加载，可以点选起点"
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
    const baseScale = this.view.fitScale || this.view.scale || 1;
    const text = `${Math.round((this.view.scale / baseScale) * 100)}%`;
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

  startUserLocation(options = {}) {
    this.hideDestinationDropdown();
    const force = Boolean(options.force);
    if (typeof wx === "undefined" || (!force && (this.locationStarting || this.data.locating))) return;
    if (force) {
      this.stopUserLocation({ silent: true });
    }

    this.locationStarting = true;
    this.locationPermissionDenied = false;
    this.setData({
      locating: true,
      locationStatusText: "定位中",
      locationStatusState: "locating",
      locationText: this.geoProjector.ready ? "正在定位..." : `待标定：${this.geoProjector.reason}`,
      statusText: this.geoProjector.ready
        ? "正在请求定位权限..."
        : `定位可启动，但地图映射暂不可用：${this.geoProjector.reason}`
    });

    const beginTracking = () => {
      this.locationStarting = false;
      this.beginLocationTracking(options);
    };

    if (!wx.getSetting || !wx.authorize) {
      beginTracking();
      return;
    }

    wx.getSetting({
      success: (setting) => {
        const authSetting = setting.authSetting || {};
        if (authSetting["scope.userLocation"] === true) {
          beginTracking();
          return;
        }
        if (authSetting["scope.userLocation"] === false) {
          this.handleLocationPermissionFail({ errMsg: "用户未授权定位" });
          return;
        }
        wx.authorize({
          scope: "scope.userLocation",
          success: beginTracking,
          fail: (error) => this.handleLocationPermissionFail(error)
        });
      },
      fail: beginTracking
    });
  },

  beginLocationTracking() {
    this.startCompass();
    this.refreshUserLocation();

    if (wx.offLocationChange) wx.offLocationChange(this.locationListener);
    if (wx.onLocationChange) wx.onLocationChange(this.locationListener);

    if (wx.startLocationUpdate) {
      wx.startLocationUpdate({
        type: "gcj02",
        success: () => {
          this.locationStarted = true;
          this.stopLocationPolling();
          this.setData({
            locating: true,
            locationStatusText: "定位中",
            locationStatusState: "locating"
          });
        },
        fail: (error) => {
          this.locationStarted = false;
          this.startLocationPolling();
          this.setData({
            locating: true,
            locationStatusText: "定位中",
            locationStatusState: "locating",
            statusText: `持续定位未开启，已改为间隔定位：${error.errMsg || "权限不足"}`
          });
        }
      });
      return;
    }

    this.startLocationPolling();
  },

  refreshUserLocation() {
    if (typeof wx === "undefined" || !wx.getLocation) return;
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 4000,
      success: (res) => this.handleLocationChange(res),
      fail: (error) => this.handleLocationError(error)
    });
  },

  startLocationPolling() {
    this.stopLocationPolling();
    this.locationTimer = setInterval(() => this.refreshUserLocation(), 5000);
  },

  stopLocationPolling() {
    if (this.locationTimer) {
      clearInterval(this.locationTimer);
      this.locationTimer = null;
    }
  },

  handleLocationPermissionFail(error) {
    this.locationStarting = false;
    this.locationPermissionDenied = true;
    this.stopUserLocation({ silent: true });
    this.setData({
      locating: false,
      locationStatusText: "定位失败",
      locationStatusState: "failed",
      locationText: "未授权定位",
      statusText: `需要定位权限才能显示实时红点：${error.errMsg || "请在小程序设置中开启定位"}`
    });
  },

  handleLocationError(error) {
    const patch = {
      locationStatusText: "定位失败",
      locationStatusState: "failed",
      locationText: "定位失败"
    };
    if (!this.route || this.route.length < 2) {
      patch.statusText = `定位失败：${error.errMsg || "请检查定位权限"}`;
    }
    this.setData(patch);
  },

  stopUserLocation(options = {}) {
    if (typeof wx !== "undefined") {
      if (wx.offLocationChange) wx.offLocationChange(this.locationListener);
      if (wx.stopLocationUpdate) wx.stopLocationUpdate({});
      if (wx.offCompassChange) wx.offCompassChange(this.compassListener);
      if (wx.stopCompass) wx.stopCompass({});
    }
    this.stopLocationPolling();
    this.locationStarting = false;
    this.locationStarted = false;
    this.compassStarted = false;
    if (!options.silent) {
      this.setData({
        locating: false,
        locationStatusText: this.lastGeoLocation ? "已停止" : "未定位",
        locationStatusState: "idle",
        locationText: this.lastGeoLocation ? "定位已停止" : "未定位",
        statusText: "已停止定位"
      });
    }
  },

  startCompass() {
    if (typeof wx === "undefined") return;
    if (wx.offCompassChange) wx.offCompassChange(this.compassListener);
    if (wx.onCompassChange) wx.onCompassChange(this.compassListener);
    if (wx.startCompass) {
      wx.startCompass({
        success: () => {
          this.compassStarted = true;
        },
        fail: () => {
          this.compassStarted = false;
        }
      });
    }
  },

  applyGeoPixelCorrection(point) {
    const correction = geoCalibration.pixelCorrection || {};
    return {
      x: point.x + (Number(correction.x) || 0),
      y: point.y + (Number(correction.y) || 0)
    };
  },

  handleLocationChange(res) {
    const lng = Number(res.longitude);
    const lat = Number(res.latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    this.lastGeoLocation = res;
    const accuracy = Number(res.horizontalAccuracy || res.accuracy);

    if (!this.geoProjector.ready) {
      this.userLocation = null;
      const patch = {
        locating: false,
        locationStatusText: "定位失败",
        locationStatusState: "failed",
        locationText: `经纬度 ${lng.toFixed(6)}, ${lat.toFixed(6)}；未配置地图标定`,
      };
      if (!this.route || this.route.length < 2) {
        patch.statusText = `已获取定位，但无法映射到校园图：${this.geoProjector.reason}`;
      }
      this.setData(patch);
      this.drawMap();
      return;
    }

    const point = this.applyGeoPixelCorrection(this.geoProjector.project(lng, lat));
    const insideMap = point.x >= 0 && point.x <= MAP_WIDTH && point.y >= 0 && point.y <= MAP_HEIGHT;
    if (!insideMap) {
      this.userLocation = null;
      const patch = {
        locating: false,
        locationStatusText: "定位失败",
        locationStatusState: "failed",
        locationText: "当前位置超出地图范围"
      };
      if (!this.route || this.route.length < 2) {
        patch.statusText = "定位结果已获取，但投影点在地图外";
      }
      this.setData(patch);
      this.drawMap();
      return;
    }

    this.userLocation = {
      x: point.x,
      y: point.y,
      lng,
      lat,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      insideMap: true
    };

    const accuracyText = this.userLocation.accuracy ? `，精度约 ${this.userLocation.accuracy.toFixed(0)}m` : "";
    const patch = {
      locating: true,
      locationStatusText: "持续定位中",
      locationStatusState: "tracking",
      locationText: `(${this.userLocation.x.toFixed(0)}, ${this.userLocation.y.toFixed(0)})${accuracyText}`
    };
    if (!this.current && !this.pendingStart && this.data.clickTarget === "start") {
      patch.startX = point.x.toFixed(0);
      patch.startY = point.y.toFixed(0);
    }
    if (!this.route || this.route.length < 2) {
        patch.statusText = "定位点已实时更新，点击“确认当前起点”后吸附到路网";
    }
    this.setData(patch);
    this.drawMap();
  },

  handleCompassChange(res) {
    const direction = Number(res.direction);
    if (!Number.isFinite(direction)) return;
    this.heading = direction;
    this.drawMap();
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
      statusText: "起点坐标已修改，请重新确认当前起点"
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
      statusText: "起点坐标已修改，请重新确认当前起点"
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
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("当前起点坐标不完整");

      const snapped = this.router.snapToRoad(x, y);
      this.current = { input: { x, y }, snapped };
      this.pendingStart = null;
      this.route = [];
      this.setData({
        clickTarget: "goal",
        startSnapText: `(${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})，偏移 ${snapped.distance.toFixed(1)}px`,
        routeSummaryText: "-",
        statusText: "当前起点已吸附到路网，下一次点击地图会填入终点坐标"
      });
      this.drawMap();
    });
  },

  confirmPlaceDestination() {
    this.runAction(() => {
      const place = this.selectedDestinationId
        ? this.router.placesById[this.selectedDestinationId]
        : this.router.findPlace(this.data.destinationInput);
      const anchor = place.access || place.center;
      const snapped = this.router.snapToRoad(anchor.x, anchor.y);
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

  getRouteStart() {
    if (this.userLocation) {
      return {
        source: "定位点",
        input: { x: this.userLocation.x, y: this.userLocation.y },
        snapped: this.router.snapToRoad(this.userLocation.x, this.userLocation.y)
      };
    }
    if (this.current) {
      return {
        source: "已确认起点",
        input: this.current.input,
        snapped: this.current.snapped
      };
    }

    const x = Number(this.data.startX);
    const y = Number(this.data.startY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("请先定位，或填写并确认当前起点");
    }
    return {
      source: "起点输入",
      input: { x, y },
      snapped: this.router.snapToRoad(x, y)
    };
  },

  placeAnchor(place) {
    return place.access || place.center;
  },

  tourZone(point) {
    const col = Math.min(3, Math.max(0, Math.floor(point.x / (MAP_WIDTH / 4))));
    const row = Math.min(3, Math.max(0, Math.floor(point.y / (MAP_HEIGHT / 4))));
    return `${row}-${col}`;
  },

  tourCandidateWeight(place) {
    if (place.type === "dormitory" && !TOUR_DORM_PASS_IDS.has(place.id)) return 0;
    if (place.type === "gate" && !OPEN_GATE_IDS.includes(place.id)) return 0;
    if (place.type === "building" && !TOUR_KEY_BUILDING_IDS.has(place.id)) return 0;
    const base = TOUR_TYPE_WEIGHTS[place.type] || 0;
    if (!base) return 0;
    if (TOUR_KEY_BUILDING_IDS.has(place.id)) return base + 4;
    if (TOUR_DORM_PASS_IDS.has(place.id)) return base + 1;
    return base;
  },

  buildTourCandidates(start) {
    return this.router.places
      .map((place) => {
        const weight = this.tourCandidateWeight(place);
        if (weight <= 0) return null;
        const anchor = this.placeAnchor(place);
        const snapped = this.router.snapToRoad(anchor.x, anchor.y);
        if (snapped.row === start.row && snapped.col === start.col) return null;
        return {
          place,
          snapped,
          weight,
          zone: this.tourZone(snapped)
        };
      })
      .filter(Boolean);
  },

  selectTourStops(start) {
    const remaining = this.buildTourCandidates(start);
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
  },

  buildCompositeRoute(start, stops) {
    let cursor = start;
    const path = [];
    const includedStops = [];
    let skipped = 0;
    let virtualGapCells = 0;

    stops.forEach((stop) => {
      try {
        const segment = this.router.findRoute(cursor, stop.snapped);
        if (segment.path.length > 0) {
          const segmentPath = path.length > 0 ? segment.path.slice(1) : segment.path;
          path.push.apply(path, segmentPath);
        }
        cursor = stop.snapped;
        includedStops.push(stop);
        virtualGapCells += segment.virtualGapCells || 0;
      } catch (error) {
        skipped += 1;
      }
    });

    if (path.length < 2 || includedStops.length === 0) {
      throw new Error("推荐路线暂时无法生成，请换一个当前位置再试");
    }

    return { path, stops: includedStops, skipped, virtualGapCells };
  },

  formatStopNames(stops, limit = 12) {
    const names = stops.map((stop) => splitPlaceName(stop.place.name).primary || stop.place.id);
    const visible = names.slice(0, limit).join(" → ");
    return names.length > limit ? `${visible} → 等 ${names.length} 处` : visible;
  },

  planTourRoute() {
    this.runAction(() => {
      const start = this.getRouteStart();
      const stops = this.selectTourStops(start.snapped);
      const result = this.buildCompositeRoute(start.snapped, stops);
      const length = this.router.routeLength(result.path);

      this.route = result.path;
      this.recommendation = {
        type: "tour",
        start: start.snapped,
        stops: result.stops
      };
      this.setData({
        recommendationSummaryText: `智能观光路线：从${start.source}出发，途经 ${result.stops.length} 处，约 ${length.toFixed(0)}px${result.skipped ? `，跳过 ${result.skipped} 处不可达点` : ""}`,
        recommendationStopsText: this.formatStopNames(result.stops),
        statusText: "已生成智能观光路线，按景点权重和区域覆盖选择途经点"
      });
      this.drawMap();
    });
  },

  planNearestExitRoute() {
    this.runAction(() => {
      const start = this.getRouteStart();
      let best = null;

      OPEN_GATE_IDS.forEach((id) => {
        const place = this.router.placesById[id];
        if (!place) return;
        try {
          const anchor = this.placeAnchor(place);
          const snapped = this.router.snapToRoad(anchor.x, anchor.y);
          const result = this.router.findRoute(start.snapped, snapped);
          const length = this.router.routeLength(result.path);
          if (!best || length < best.length) {
            best = { place, snapped, path: result.path, length, virtualGapCells: result.virtualGapCells || 0 };
          }
        } catch (error) {
          // Ignore closed-off or temporarily unreachable candidates and keep testing other open gates.
        }
      });

      if (!best) throw new Error("没有找到可用开放校门路线");

      this.route = best.path;
      this.recommendation = {
        type: "exit",
        start: start.snapped,
        stops: [{ place: best.place, snapped: best.snapped }]
      };
      this.setData({
        recommendationSummaryText: `最近离开路线：${splitPlaceName(best.place.name).primary || best.place.id}，约 ${best.length.toFixed(0)}px`,
        recommendationStopsText: `开放校门白名单：${OPEN_GATE_IDS.map((id) => {
          const gate = this.router.placesById[id];
          return gate ? (splitPlaceName(gate.name).primary || gate.id) : id;
        }).join("、")}`,
        statusText: "已生成到最近开放校门的路线"
      });
      this.drawMap();
    });
  },

  planRoute() {
    this.runAction(() => {
      if (this.pendingStart || !this.current) {
        throw new Error("请先点击“确认当前起点”");
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
      this.recommendation = null;
      this.setData({
        routeSummaryText: `${result.path.length} 个网格点，约 ${this.router.routeLength(result.path).toFixed(0)}px，跨 ${result.virtualGapCells} 个假断点`,
        statusText: "路线已生成"
      });
      this.drawMap();
    });
  },

  resetAll() {
    this.stopUserLocation({ silent: true });
    this.userLocation = null;
    this.lastGeoLocation = null;
    this.heading = null;
    this.locationPermissionDenied = false;
    this.current = null;
    this.destination = null;
    this.pendingStart = null;
    this.pendingGoal = null;
    this.route = [];
    this.recommendation = null;
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
      recommendationSummaryText: "-",
      recommendationStopsText: "-",
      locating: true,
      locationStatusText: "定位中",
      locationStatusState: "locating",
      locationText: "正在重新定位...",
      statusText: this.data.mapReady
        ? "已重置，正在重新定位..."
        : "正在加载地图数据..."
    });
    if (this.mapImage) {
      this.fitMap();
    } else {
      this.drawMap();
    }
    this.startUserLocation({ auto: true, force: true });
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
        statusText: "终点坐标已填入，点击“确定坐标终点”后吸附到路网"
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
        statusText: "起点坐标已填入，点击“确认当前起点”后吸附到路网"
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
    this.drawUserLocation(ctx);
    this.drawMarkers(ctx);
    ctx.restore();
    this.drawCompass(ctx);
  },

  drawCompass(ctx) {
    if (!this.canvasWidth || !this.canvasHeight) return;
    const width = 38;
    const height = 58;
    const x = this.canvasWidth - width - 14;
    const y = 14;
    const centerX = x + width / 2;
    const dialY = y + 29;
    const dialRadius = 13;

    ctx.save();
    this.roundRectPath(ctx, x, y, width, height, width / 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.18)";
    ctx.stroke();

    ctx.font = "700 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#dc2626";
    ctx.fillText("N", centerX, y + 9);
    ctx.fillStyle = "#64748b";
    ctx.fillText("S", centerX, y + height - 9);

    ctx.beginPath();
    ctx.arc(centerX, dialY, dialRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(15, 23, 42, 0.28)";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX, dialY - 12);
    ctx.lineTo(centerX + 5, dialY);
    ctx.lineTo(centerX, dialY - 1);
    ctx.lineTo(centerX - 5, dialY);
    ctx.closePath();
    ctx.fillStyle = "#dc2626";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centerX, dialY + 12);
    ctx.lineTo(centerX + 5, dialY);
    ctx.lineTo(centerX, dialY + 1);
    ctx.lineTo(centerX - 5, dialY);
    ctx.closePath();
    ctx.fillStyle = "#64748b";
    ctx.fill();
    ctx.restore();
  },

  drawRoute(ctx) {
    if (!this.route || this.route.length < 2) return;
    const points = this.router.simplifyPath(this.route).map((cell) => this.router.cellCenter(cell));
    const rawPoints = this.route.map((cell) => this.router.cellCenter(cell));
    const routeColors = this.getRouteColors();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "rgba(255, 255, 255, 0.94)";
    ctx.lineWidth = (this.recommendation ? 12 : 14) / this.view.scale;
    ctx.stroke();
    ctx.lineWidth = (this.recommendation ? 6 : 7) / this.view.scale;
    this.drawColoredRouteSegments(ctx, rawPoints, this.route, routeColors);
  },

  getRouteColors() {
    if (!this.recommendation) {
      return [
        "rgba(37, 99, 235, 0.96)",
        "rgba(168, 85, 247, 0.96)",
        "rgba(245, 158, 11, 0.96)"
      ];
    }
    if (this.recommendation.type === "exit") {
      return [
        "rgba(22, 163, 74, 0.96)",
        "rgba(37, 99, 235, 0.96)",
        "rgba(168, 85, 247, 0.96)"
      ];
    }
    return [
      "rgba(245, 158, 11, 0.96)",
      "rgba(14, 165, 233, 0.96)",
      "rgba(168, 85, 247, 0.96)",
      "rgba(22, 163, 74, 0.96)"
    ];
  },

  drawColoredRouteSegments(ctx, points, cells, colors) {
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
      const color = colors[this.edgeVisitColorIndex(cells[index - 1], cells[index], edgeVisits, colors.length)];
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
  },

  edgeVisitColorIndex(a, b, visits, colorCount) {
    const first = `${a.row},${a.col}`;
    const second = `${b.row},${b.col}`;
    const key = first < second ? `${first}|${second}` : `${second}|${first}`;
    const visit = visits[key] || 0;
    visits[key] = visit + 1;
    return visit % colorCount;
  },

  drawRouteArrows(ctx, points, color) {
    if (!points || points.length < 2) return;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength < 96) continue;
      this.drawRouteArrow(
        ctx,
        (previous.x + current.x) / 2,
        (previous.y + current.y) / 2,
        Math.atan2(dy, dx),
        color
      );
    }
  },

  drawRouteArrow(ctx, x, y, angle, color) {
    const scale = this.view.scale;
    const size = (this.recommendation ? 16 : 14) / scale;
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
    ctx.lineWidth = 3 / scale;
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  },

  drawMarkers(ctx) {
    if (this.recommendation && this.route && this.route.length >= 2) {
      this.drawRecommendationMarkers(ctx);
    }
    if (this.current) {
      this.drawMarker(ctx, this.current.snapped.x, this.current.snapped.y, "#0ea5e9", 8, 5, 1);
      this.drawMarkerLabel(ctx, this.current.snapped.x, this.current.snapped.y, "起点", "#0ea5e9");
    }
    if (this.pendingStart) {
      this.drawMarker(ctx, this.pendingStart.x, this.pendingStart.y, "#0ea5e9", 7, 4, 0.78, true);
    }
    if (this.destination) {
      this.drawMarker(ctx, this.destination.snapped.x, this.destination.snapped.y, "#ef4444", 8, 5, 1);
      const label = this.destination.source === "place"
        ? splitPlaceName(this.destination.place.name).primary || "终点"
        : "终点";
      this.drawMarkerLabel(ctx, this.destination.snapped.x, this.destination.snapped.y, label, "#dc2626");
    }
    if (this.pendingGoal) {
      this.drawMarker(ctx, this.pendingGoal.x, this.pendingGoal.y, "#ef4444", 7, 4, 0.78, true);
    }
  },

  drawRecommendationMarkers(ctx) {
    const color = this.recommendation.type === "exit" ? "#16a34a" : "#f59e0b";
    (this.recommendation.stops || []).forEach((stop, index) => {
      const isLast = index === this.recommendation.stops.length - 1;
      const label = this.recommendation.type === "tour" && !isLast ? String(index + 1) : "";
      this.drawMarker(ctx, stop.snapped.x, stop.snapped.y, isLast ? "#22c55e" : color, label ? 8.5 : 7, label ? 7 : 4, isLast ? 1 : 0.88, false, label);
      if (isLast && this.recommendation.type === "exit") {
        const gateName = splitPlaceName(stop.place.name).primary || stop.place.id;
        this.drawMarkerLabel(ctx, stop.snapped.x, stop.snapped.y, gateName, "#16a34a");
      }
    });
  },

  drawMarkerLabel(ctx, x, y, text, color) {
    const scale = this.view.scale;
    const fontSize = 11 / scale;
    const paddingX = 5 / scale;
    const paddingY = 3 / scale;
    const offsetX = 10 / scale;
    const offsetY = 20 / scale;
    const textX = x + offsetX;
    const textY = y - offsetY;
    ctx.save();
    ctx.font = `600 ${fontSize}px sans-serif`;
    const width = ctx.measureText(text).width + paddingX * 2;
    const height = fontSize + paddingY * 2;
    const top = textY - height;
    const left = textX;
    this.roundRectPath(ctx, left, top, width, height, 5 / scale);
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.fill();
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.82)";
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, left + paddingX, top + height / 2 + 0.3 / scale);
    ctx.restore();
  },

  roundRectPath(ctx, x, y, width, height, radius) {
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
  },

  drawMarker(ctx, x, y, color, radius, innerRadius, alpha, pending, label) {
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
    if (label) {
      ctx.font = `700 ${10 / scale}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x, y + 0.3 / scale);
    }
    ctx.restore();
  },

  drawUserLocation(ctx) {
    if (!this.userLocation) return;

    const scale = this.view.scale;
    const outerRadius = 9 / scale;
    const innerRadius = 5 / scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.userLocation.x, this.userLocation.y, outerRadius * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
    ctx.fill();

    const heading = Number.isFinite(this.heading)
      ? this.heading - (Number(geoCalibration.mapNorthOffset) || 0)
      : null;

    if (heading !== null) {
      const angle = (heading * Math.PI) / 180;
      const dx = Math.sin(angle);
      const dy = -Math.cos(angle);
      const px = -dy;
      const py = dx;
      const tip = {
        x: this.userLocation.x + dx * outerRadius * 2.0,
        y: this.userLocation.y + dy * outerRadius * 2.0
      };
      const base = {
        x: this.userLocation.x - dx * outerRadius * 0.55,
        y: this.userLocation.y - dy * outerRadius * 0.55
      };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(base.x + px * outerRadius * 0.65, base.y + py * outerRadius * 0.65);
      ctx.lineTo(base.x - px * outerRadius * 0.65, base.y - py * outerRadius * 0.65);
      ctx.closePath();
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(this.userLocation.x, this.userLocation.y, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.userLocation.x, this.userLocation.y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = "#991b1b";
    ctx.stroke();
    ctx.restore();
  }
});
