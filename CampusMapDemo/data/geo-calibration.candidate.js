// GCJ-02 anchors for SCUT University Town campus.
// Coordinates are from AMap POIs and pixels are confirmed on the official map.
// Verify with more real-device samples before production use.
module.exports = {
  mapNorthOffset: 0,
  maxLocationAccuracyMeters: 100,
  controlPoints: [
    { id: "north_1_gate", lng: 113.40331200, lat: 23.05321800, x: 1232.0, y: 272.0 },
    { id: "north_gate", lng: 113.40715600, lat: 23.05389500, x: 2296.0, y: 97.0 },
    { id: "east_gate", lng: 113.40849200, lat: 23.04725500, x: 2588.0, y: 2094.0 },
    { id: "south_gate", lng: 113.40945700, lat: 23.04431100, x: 2994.0, y: 3013.0 },
    { id: "west_gate", lng: 113.40438900, lat: 23.04377000, x: 1515.0, y: 3140.0 },
    { id: "west_3_gate", lng: 113.40013700, lat: 23.04978300, x: 338.0, y: 1318.0 },
  ]
};
