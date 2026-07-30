function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeControlPoints(points) {
  return (points || [])
    .map((point) => ({
      id: String(point.id || ""),
      lng: Number(point.lng),
      lat: Number(point.lat),
      x: Number(point.x),
      y: Number(point.y)
    }))
    .filter((point) => (
      isFiniteNumber(point.lng) &&
      isFiniteNumber(point.lat) &&
      isFiniteNumber(point.x) &&
      isFiniteNumber(point.y)
    ));
}

function solve3x3(matrix, vector) {
  const rows = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }

    if (Math.abs(rows[pivot][col]) < 1e-12) {
      throw new Error("标定点无法拟合，请检查是否共线或过于接近");
    }

    if (pivot !== col) {
      const tmp = rows[col];
      rows[col] = rows[pivot];
      rows[pivot] = tmp;
    }

    const divisor = rows[col][col];
    for (let item = col; item < 4; item += 1) rows[col][item] /= divisor;

    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let item = col; item < 4; item += 1) {
        rows[row][item] -= factor * rows[col][item];
      }
    }
  }

  return [rows[0][3], rows[1][3], rows[2][3]];
}

function fitAffine(points, targetKey, origin) {
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  const atb = [0, 0, 0];

  points.forEach((point) => {
    const values = [point.lng - origin.lng, point.lat - origin.lat, 1];
    const target = point[targetKey];
    for (let row = 0; row < 3; row += 1) {
      atb[row] += values[row] * target;
      for (let col = 0; col < 3; col += 1) {
        ata[row][col] += values[row] * values[col];
      }
    }
  });

  return solve3x3(ata, atb);
}

function createGeoProjector(rawPoints) {
  const points = normalizeControlPoints(rawPoints);
  if (points.length < 3) {
    return {
      ready: false,
      points,
      reason: "需要至少 3 个经纬度标定点"
    };
  }

  const origin = points.reduce(
    (acc, point) => ({
      lng: acc.lng + point.lng / points.length,
      lat: acc.lat + point.lat / points.length
    }),
    { lng: 0, lat: 0 }
  );

  try {
    const xCoefficients = fitAffine(points, "x", origin);
    const yCoefficients = fitAffine(points, "y", origin);
    return {
      ready: true,
      points,
      origin,
      project(lng, lat) {
        const values = [Number(lng) - origin.lng, Number(lat) - origin.lat, 1];
        return {
          x: xCoefficients[0] * values[0] + xCoefficients[1] * values[1] + xCoefficients[2],
          y: yCoefficients[0] * values[0] + yCoefficients[1] * values[1] + yCoefficients[2]
        };
      }
    };
  } catch (error) {
    return {
      ready: false,
      points,
      reason: error.message
    };
  }
}

module.exports = {
  createGeoProjector
};
