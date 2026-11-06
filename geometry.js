(function () {
  'use strict';

  const EPS = 1e-7;
  const add = (a, b) => a.map((v, i) => v + b[i]);
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const mul = (a, k) => a.map(v => v * k);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const length = a => Math.sqrt(dot(a, a));
  const distance = (a, b) => length(sub(a, b));
  const normal = (a, b, c) => cross(sub(b, a), sub(c, a));
  const centroid = points => mul(points.reduce(add, [0, 0, 0]), 1 / points.length);

  function polygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(area) / 2;
  }

  function perimeter(points) {
    return points.reduce((sum, p, i) => sum + distance(p, points[(i + 1) % points.length]), 0);
  }

  function makeEdges(faces) {
    const map = new Map();
    faces.forEach((face, faceIndex) => {
      face.forEach((a, i) => {
        const b = face[(i + 1) % face.length];
        const key = [Math.min(a, b), Math.max(a, b)].join('-');
        if (!map.has(key)) map.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
        map.get(key).faces.push(faceIndex);
      });
    });
    return [...map.values()];
  }

  function getBounds(vertices) {
    if (!vertices.length) return { min: [0, 0, 0], max: [0, 0, 0] };
    return {
      min: [0, 1, 2].map(i => Math.min(...vertices.map(v => v[i]))),
      max: [0, 1, 2].map(i => Math.max(...vertices.map(v => v[i])))
    };
  }

  function finalize(vertices, faces, shape, smooth) {
    const cleanFaces = faces.filter(f => new Set(f).size >= 3);
    if (vertices.length && cleanFaces.length) {
      const center = centroid(vertices);
      cleanFaces.forEach(face => {
        const fc = centroid(face.map(i => vertices[i]));
        const n = normal(vertices[face[0]], vertices[face[1]], vertices[face[2]]);
        if (dot(n, sub(fc, center)) < 0) face.reverse();
      });
    }
    const edges = makeEdges(cleanFaces);
    if (smooth) {
      const smoothKeys = new Set(smooth.map(e => [Math.min(e[0], e[1]), Math.max(e[0], e[1])].join('-')));
      edges.forEach(e => { e.smooth = smoothKeys.has([e.a, e.b].join('-')); });
    }
    return { vertices, faces: cleanFaces, edges, shape, bounds: getBounds(vertices) };
  }

  function box(params) {
    const w = params.width, d = params.depth, h = params.height;
    const vertices = [
      [-w / 2, -d / 2, 0], [w / 2, -d / 2, 0], [w / 2, d / 2, 0], [-w / 2, d / 2, 0],
      [-w / 2, -d / 2, h], [w / 2, -d / 2, h], [w / 2, d / 2, h], [-w / 2, d / 2, h]
    ];
    return finalize(vertices, [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
      [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]
    ], 'box');
  }

  function prism(params) {
    const n = params.sides, r = params.radius, h = params.height;
    const vertices = [];
    for (let z of [0, h]) {
      for (let i = 0; i < n; i++) {
        const a = Math.PI / n + i * Math.PI * 2 / n;
        vertices.push([r * Math.cos(a), r * Math.sin(a), z]);
      }
    }
    const faces = [
      Array.from({ length: n }, (_, i) => n - 1 - i),
      Array.from({ length: n }, (_, i) => n + i)
    ];
    for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, (i + 1) % n + n, i + n]);
    return finalize(vertices, faces, 'prism');
  }

  function pyramid(params, cone) {
    const n = cone ? 48 : params.sides, r = params.radius, h = params.height;
    const vertices = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI / n + i * Math.PI * 2 / n;
      vertices.push([r * Math.cos(a), r * Math.sin(a), 0]);
    }
    vertices.push([0, 0, h]);
    const faces = [Array.from({ length: n }, (_, i) => n - 1 - i)];
    const smooth = [];
    for (let i = 0; i < n; i++) {
      faces.push([i, (i + 1) % n, n]);
      if (cone) smooth.push([i, n]);
    }
    return finalize(vertices, faces, cone ? 'cone' : 'pyramid', smooth);
  }

  function cylinder(params) {
    const n = 48, r = params.radius, h = params.height;
    const vertices = [];
    for (let z of [0, h]) {
      for (let i = 0; i < n; i++) {
        const a = i * Math.PI * 2 / n;
        vertices.push([r * Math.cos(a), r * Math.sin(a), z]);
      }
    }
    const faces = [
      Array.from({ length: n }, (_, i) => n - 1 - i),
      Array.from({ length: n }, (_, i) => n + i)
    ];
    const smooth = [];
    for (let i = 0; i < n; i++) {
      faces.push([i, (i + 1) % n, (i + 1) % n + n, i + n]);
      smooth.push([i, i + n]);
    }
    return finalize(vertices, faces, 'cylinder', smooth);
  }

  function custom(data) {
    const vertices = (data.vertices || []).map(v => v.map(Number));
    const faces = (data.faces || []).map(f => f.map(Number));
    if (faces.length) return finalize(vertices, faces, 'mesh');
    let edges = (data.edges || []).map(e => ({ a: e[0], b: e[1], faces: [] }));
    if (!edges.length && vertices.length > 1) {
      edges = vertices.slice(1).map((_, i) => ({ a: i, b: i + 1, faces: [] }));
      if (vertices.length > 2 && data.closed !== false) edges.push({ a: vertices.length - 1, b: 0, faces: [] });
    }
    return { vertices, faces: [], edges, shape: 'mesh', bounds: getBounds(vertices) };
  }

  function build(state) {
    if (state.shape === 'mesh' && state.mesh) return custom(state.mesh);
    if (state.shape === 'prism') return prism(state.params);
    if (state.shape === 'pyramid') return pyramid(state.params, false);
    if (state.shape === 'cylinder') return cylinder(state.params);
    if (state.shape === 'cone') return pyramid(state.params, true);
    return box(state.params);
  }

  function orthographic(point, view) {
    if (view === 'top') return [point[0], point[1]];
    if (view === 'left') return [point[1], -point[2]];
    return [point[0], -point[2]];
  }

  function faceNormals(mesh) {
    return mesh.faces.map(face => {
      if (face.length < 3) return [0, 0, 0];
      const n = normal(mesh.vertices[face[0]], mesh.vertices[face[1]], mesh.vertices[face[2]]);
      const l = length(n);
      return l > EPS ? mul(n, 1 / l) : [0, 0, 0];
    });
  }

  function visibility(mesh, view) {
    const normals = faceNormals(mesh);
    const axis = view === 'top' ? 2 : view === 'left' ? 0 : 1;
    const sign = view === 'top' ? 1 : -1;
    const faceVisible = normals.map(n => n[axis] * sign > EPS);
    return mesh.edges.map(edge => ({
      edge,
      visible: !mesh.faces.length || edge.faces.some(i => faceVisible[i]),
      silhouette: edge.faces.length === 1 || edge.faces.some(i => faceVisible[i]) && edge.faces.some(i => !faceVisible[i])
    }));
  }

  function section(mesh, axis, offset) {
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const points = [];
    const keys = new Set();
    mesh.edges.forEach(({ a, b }) => {
      const p = mesh.vertices[a], q = mesh.vertices[b];
      const da = p[ai] - offset, db = q[ai] - offset;
      if (Math.abs(da) < EPS && Math.abs(db) < EPS) return;
      if ((da > EPS && db > EPS) || (da < -EPS && db < -EPS)) return;
      const t = Math.abs(db - da) < EPS ? 0 : da / (da - db);
      const r = add(p, mul(sub(q, p), t));
      const key = r.map(v => Math.round(v * 1e6)).join(',');
      if (!keys.has(key)) { keys.add(key); points.push(r); }
    });
    if (points.length < 3) return [];
    const ui = ai === 0 ? 1 : 0;
    const vi = ai === 2 ? 1 : 2;
    const c = centroid(points);
    points.sort((a, b) => Math.atan2(a[vi] - c[vi], a[ui] - c[ui]) - Math.atan2(b[vi] - c[vi], b[ui] - c[ui]));
    return points;
  }

  function section2D(points, axis) {
    return points.map(p => axis === 'x' ? [p[1], -p[2]] : axis === 'y' ? [p[0], -p[2]] : [p[0], -p[1]]);
  }

  function clipFace(face, vertices, ai, offset, keep) {
    const out = [];
    const sign = keep === 'negative' ? -1 : 1;
    for (let i = 0; i < face.length; i++) {
      const a = vertices[face[i]], b = vertices[face[(i + 1) % face.length]];
      const da = (a[ai] - offset) * sign, db = (b[ai] - offset) * sign;
      const ina = da >= -EPS, inb = db >= -EPS;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = da / (da - db);
        out.push(add(a, mul(sub(b, a), t)));
      }
    }
    return out.filter((p, i) => i === 0 || distance(p, out[i - 1]) > EPS);
  }

  function clip(mesh, axis, offset, keep) {
    const ai = { x: 0, y: 1, z: 2 }[axis];
    const cap = section(mesh, axis, offset);
    if (cap.length < 3) return null;
    const vertices = [], faces = [];
    const keys = new Map();
    function index(p) {
      const key = p.map(v => Math.round(v * 1e6)).join(',');
      if (!keys.has(key)) { keys.set(key, vertices.length); vertices.push(p); }
      return keys.get(key);
    }
    mesh.faces.forEach(face => {
      const clipped = clipFace(face, mesh.vertices, ai, offset, keep);
      if (clipped.length >= 3) faces.push(clipped.map(index));
    });
    const capIndices = cap.map(index);
    const capNormal = normal(vertices[capIndices[0]], vertices[capIndices[1]], vertices[capIndices[2]]);
    const wanted = [0, 0, 0];
    wanted[ai] = keep === 'negative' ? 1 : -1;
    if (dot(capNormal, wanted) < 0) capIndices.reverse();
    faces.push(capIndices);
    return finalize(vertices, faces, mesh.shape, mesh.edges.filter(e => e.smooth).map(e => [e.a, e.b]));
  }

  function axon(point, type) {
    if (type === 'dimetric') {
      const ax = 7.1 * Math.PI / 180, ay = 41.4 * Math.PI / 180;
      return [
        -point[0] * Math.cos(ax) + point[1] * 0.5 * Math.cos(ay),
        point[0] * Math.sin(ax) + point[1] * 0.5 * Math.sin(ay) - point[2]
      ];
    }
    return [
      (point[1] - point[0]) * Math.sqrt(3) / 2,
      (point[0] + point[1]) / 2 - point[2]
    ];
  }

  function axonDepth(point, type) {
    return type === 'dimetric' ? point[0] + 2.645 * point[1] + point[2] : point[0] + point[1] + point[2];
  }

  function axonVisibility(mesh, type) {
    const normals = faceNormals(mesh);
    const view = type === 'dimetric' ? [1, 2.645, 1] : [1, 1, 1];
    const faceVisible = normals.map(n => dot(n, view) > EPS);
    return mesh.edges.map(edge => ({
      edge,
      visible: !mesh.faces.length || edge.faces.some(i => faceVisible[i]),
      silhouette: edge.faces.length === 1 || edge.faces.some(i => faceVisible[i]) && edge.faces.some(i => !faceVisible[i])
    }));
  }

  function metrics(mesh, cut) {
    const b = mesh.bounds;
    const result = {
      width: b.max[0] - b.min[0], depth: b.max[1] - b.min[1], height: b.max[2] - b.min[2],
      vertices: mesh.vertices.length, edges: mesh.edges.length
    };
    if (cut && cut.length >= 3) {
      const p2 = cut.map(p => p);
      result.sectionArea = polygonArea3D(p2);
      result.sectionPerimeter = perimeter(p2);
    }
    return result;
  }

  function polygonArea3D(points) {
    const n = points.reduce((acc, p, i) => add(acc, cross(p, points[(i + 1) % points.length])), [0, 0, 0]);
    return length(n) / 2;
  }

  window.Geometry = {
    build, orthographic, visibility, section, section2D, clip, axon, axonDepth,
    axonVisibility, metrics, polygonArea, perimeter, distance, getBounds, faceNormals
  };
})();
