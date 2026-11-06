(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const STORAGE_KEY = 'epur-project-v1';
  const SHAPE_NAMES = {
    box: 'Параллелепипед', prism: 'Призма шестигранная', pyramid: 'Пирамида четырёхгранная',
    cylinder: 'Цилиндр', cone: 'Конус', mesh: 'Импортированная модель'
  };
  const PARAMS = {
    box: { width: 80, depth: 60, height: 50 },
    prism: { radius: 40, height: 60, sides: 6 },
    pyramid: { radius: 45, height: 70, sides: 4 },
    cylinder: { radius: 35, height: 65 },
    cone: { radius: 40, height: 70 }
  };
  const PARAM_LABELS = { width: 'Длина X', depth: 'Глубина Y', height: 'Высота Z', radius: 'Радиус основания', sides: 'Число сторон' };
  const DEFAULT_STATE = {
    variant: '12', name: SHAPE_NAMES.prism, shape: 'prism', params: { ...PARAMS.prism },
    section: { axis: 'y', offset: 0 }, view: 'views', mode: 'final', step: 0,
    scale: 'auto', paper: 'A3', student: '', group: '', axonType: 'iso', zoom: 1,
    layers: { visible: true, hidden: true, construction: true, axes: true, dimensions: true, labels: true }
  };
  let state = loadState();
  let mesh, cutPoints, clippedMesh, playing = null, toastTimer;
  let currentSteps = [];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.params && saved.section) return normalizeState(saved);
    } catch (_) {}
    return clone(DEFAULT_STATE);
  }
  function normalizeState(data) {
    const next = clone(DEFAULT_STATE);
    next.variant = String(data.variant ?? '12').slice(0, 24);
    next.name = String(data.name ?? SHAPE_NAMES[data.shape] ?? 'Деталь').slice(0, 60);
    next.student = String(data.student ?? '').slice(0, 60);
    next.group = String(data.group ?? '').slice(0, 30);
    next.shape = [...Object.keys(PARAMS), 'mesh'].includes(data.shape) ? data.shape : 'prism';
    next.params = { ...(PARAMS[next.shape] || {}) };
    Object.keys(next.params).forEach(key => {
      const value = Number(data.params?.[key]);
      if (Number.isFinite(value)) next.params[key] = key === 'sides' ? Math.round(Math.max(3, Math.min(12, value))) : Math.max(1, Math.min(500, value));
    });
    if (next.shape === 'mesh') {
      if (!data.mesh || !Array.isArray(data.mesh.vertices) || !data.mesh.vertices.length) throw new Error('Для модели нужны вершины vertices.');
      next.mesh = {
        vertices: data.mesh.vertices.map(v => {
          if (!Array.isArray(v) || v.length !== 3 || v.some(n => !Number.isFinite(Number(n)))) throw new Error('Каждая вершина должна иметь три числовые координаты.');
          return v.map(Number);
        }),
        faces: Array.isArray(data.mesh.faces) ? data.mesh.faces : [],
        edges: Array.isArray(data.mesh.edges) ? data.mesh.edges : [],
        closed: data.mesh.closed
      };
      const count = next.mesh.vertices.length;
      next.mesh.faces.forEach(face => {
        if (!Array.isArray(face) || face.length < 3 || face.some(i => !Number.isInteger(i) || i < 0 || i >= count)) throw new Error('Грань содержит неверный индекс вершины.');
      });
      next.mesh.edges.forEach(edge => {
        if (!Array.isArray(edge) || edge.length !== 2 || edge.some(i => !Number.isInteger(i) || i < 0 || i >= count)) throw new Error('Ребро содержит неверный индекс вершины.');
      });
    }
    next.section.axis = ['x', 'y', 'z'].includes(data.section?.axis) ? data.section.axis : 'y';
    next.section.offset = Number.isFinite(Number(data.section?.offset)) ? Number(data.section.offset) : 0;
    next.paper = data.paper === 'A4' ? 'A4' : 'A3';
    next.scale = ['auto', '1', '0.5', '0.2', '2'].includes(String(data.scale)) ? String(data.scale) : 'auto';
    next.axonType = data.axonType === 'dimetric' ? 'dimetric' : 'iso';
    next.view = ['views', 'cut', 'section', 'axon', 'development'].includes(data.view) ? data.view : 'views';
    next.mode = data.mode === 'final' ? 'final' : 'steps';
    next.step = Math.max(0, Number(data.step) || 0);
    next.layers = { ...next.layers, ...(data.layers || {}) };
    return next;
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      $('#saveState').innerHTML = '<span></span>Сохранено на устройстве';
    } catch (_) {
      $('#saveState').textContent = 'Локальное сохранение недоступно';
    }
  }
  function fmt(value, digits = 1) {
    return Number(value).toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, '$1').replace('.', ',');
  }
  function esc(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function paper() { return state.paper === 'A4' ? { w: 297, h: 210 } : { w: 420, h: 297 }; }
  function scaleValue() {
    if (state.scale !== 'auto') return Number(state.scale);
    const b = mesh.bounds;
    const largest = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
    const room = state.paper === 'A4' ? 58 : 105;
    return [2, 1, .5, .2, .1].find(s => largest * s <= room) || .1;
  }
  function scaleText() {
    const s = scaleValue();
    return s === 2 ? '2:1' : s === 1 ? '1:1' : s === .5 ? '1:2' : s === .2 ? '1:5' : '1:10';
  }
  function planeName() {
    const axis = state.section.axis;
    return `${axis.toUpperCase()} = ${fmt(state.section.offset)} мм`;
  }

  function svgText(x, y, value, cls = 'sheet-note', anchor = 'start', extra = '') {
    return `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}" ${extra}>${esc(value)}</text>`;
  }
  function svgLine(a, b, cls = 'visible', extra = '') {
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${cls}" ${extra}/>`;
  }
  function pointsAttr(points) { return points.map(p => `${p[0]},${p[1]}`).join(' '); }
  function polygon(points, cls = 'visible', extra = '') { return `<polygon points="${pointsAttr(points)}" class="${cls}" ${extra}/>`; }
  function path(points, close = false, cls = 'visible', extra = '') {
    return `<path d="M${points.map(p => `${p[0]} ${p[1]}`).join(' L')}${close ? ' Z' : ''}" class="${cls}" ${extra}/>`;
  }
  function circle(center, r, cls = 'visible', extra = '') { return `<circle cx="${center[0]}" cy="${center[1]}" r="${r}" class="${cls}" ${extra}/>`; }

  function makeBuilder() {
    const groups = [];
    return {
      add(layer, step, content) { if (content) groups.push({ layer, step, content }); },
      render() {
        return groups.map(g => {
          const hidden = state.layers[g.layer] === false || (state.mode === 'steps' && g.step > state.step);
          const active = state.mode === 'steps' && g.step === state.step;
          return `<g data-layer="${g.layer}" data-step="${g.step}"${hidden ? ' style="display:none"' : ''}${active ? ' class="step-active"' : ''}>${g.content}</g>`;
        }).join('');
      }
    };
  }

  function defs() {
    return `<defs>
      <marker id="dim-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M7 1 1 4l6 3" fill="none" stroke="#27332f" stroke-width=".8"/></marker>
      <marker id="section-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 7 4 0 8Z" fill="#27332f"/></marker>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#53615b" stroke-width=".28"/></pattern>
      <pattern id="section-plane" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#df704b" fill-opacity=".08"/><path d="M0 5 5 0" stroke="#df704b" stroke-width=".2"/></pattern>
    </defs>`;
  }

  function frame(title) {
    const p = paper(), x = p.w - 190, y = p.h - 60;
    let s = `<rect width="${p.w}" height="${p.h}" class="paper-bg"/>`;
    s += `<rect x="20" y="5" width="${p.w - 25}" height="${p.h - 10}" class="sheet-frame"/>`;
    s += svgText(25, 17, 'ЭПЮР  /  ПРОЕКЦИОННОЕ ЧЕРЧЕНИЕ', 'sheet-kicker');
    s += svgText(p.w - 10, 17, `ВАРИАНТ ${state.variant}`, 'sheet-kicker', 'end');
    s += svgText(25, 27, title.toUpperCase(), 'sheet-title');
    s += svgText(p.w - 10, 27, `${state.paper}  ·  М ${scaleText()}`, 'sheet-note', 'end');
    s += `<rect x="${x}" y="${y}" width="185" height="55" class="title-block"/>`;
    [12, 28, 40].forEach(dy => { s += svgLine([x, y + dy], [x + 185, y + dy], 'title-line'); });
    [45, 80, 125, 155].forEach(dx => { s += svgLine([x + dx, y + 28], [x + dx, y + 55], 'title-line'); });
    s += svgLine([x + 125, y], [x + 125, y + 28], 'title-line');
    s += svgText(x + 4, y + 8, state.name, 'title-name');
    s += svgText(x + 4, y + 19, 'Учебный чертёж', 'title-small');
    s += svgText(x + 129, y + 8, `Вариант ${state.variant}`, 'title-value');
    s += svgText(x + 129, y + 19, `Масштаб ${scaleText()}`, 'title-small');
    s += svgText(x + 3, y + 35, 'Разраб.', 'title-small') + svgText(x + 48, y + 35, state.student || '—', 'title-value');
    s += svgText(x + 83, y + 35, 'Группа', 'title-small') + svgText(x + 128, y + 35, state.group || '—', 'title-value');
    s += svgText(x + 3, y + 47, 'Провер.', 'title-small') + svgText(x + 48, y + 47, '—', 'title-value');
    s += svgText(x + 83, y + 47, state.paper, 'title-value') + svgText(x + 128, y + 47, 'Лист 1', 'title-value');
    s += svgText(25, p.h - 10, 'Расчёт по исходной 3D-модели · размеры в миллиметрах', 'sheet-micro');
    return s;
  }

  function sheetSVG(title, builder, extraDefs = '') {
    const p = paper();
    return `<svg id="drawingSVG" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${p.w} ${p.h}" role="img" aria-label="${esc(title)}">
      <style>
        .paper-bg{fill:#fffefb}.sheet-frame{fill:none;stroke:#27332f;stroke-width:.7}.title-block{fill:none;stroke:#27332f;stroke-width:.65}.title-line{stroke:#27332f;stroke-width:.25}
        text{font-family:Manrope,Arial,sans-serif;fill:#27332f}.sheet-kicker{font-family:monospace;font-size:2.6px;letter-spacing:.25px;fill:#64706b}.sheet-title{font-size:5px;font-weight:600;letter-spacing:.3px}.sheet-note{font-size:3px;fill:#64706b}.sheet-micro{font-size:2.3px;fill:#77817c}.sheet-caption{font-size:3.4px;font-weight:600}.title-name{font-size:4px;font-weight:600}.title-small{font-size:2.5px;fill:#64706b}.title-value{font-size:3px}.point-label{font-size:2.6px;font-style:italic}.metric-label{font-size:3px;fill:#64706b}
        .visible{fill:none;stroke:#27332f;stroke-width:.65;stroke-linecap:round;stroke-linejoin:round}.hidden{fill:none;stroke:#6f7974;stroke-width:.3;stroke-dasharray:3 1.5}.construction{fill:none;stroke:#668797;stroke-width:.22;stroke-dasharray:4 1.5}.axis{fill:none;stroke:#435c53;stroke-width:.25;stroke-dasharray:7 1.5 1 1.5}.dimension{fill:none;stroke:#27332f;stroke-width:.25}.fold{fill:none;stroke:#668797;stroke-width:.25;stroke-dasharray:4 1.5}.cut-line{fill:none;stroke:#27332f;stroke-width:.8;stroke-dasharray:8 2 1 2}.hatch-area{fill:url(#hatch);stroke:none}.section-fill{fill:url(#hatch);stroke:#27332f;stroke-width:.7;stroke-linejoin:round}.plane-fill{fill:url(#section-plane);stroke:#df704b;stroke-width:.4;stroke-dasharray:4 2}.face{stroke:none}.dim-text{font-size:3.2px;fill:#27332f}.active-fill{fill:#df704b}.step-active .visible,.step-active .dimension,.step-active .cut-line{stroke:#df704b}.step-active .construction,.step-active .axis,.step-active .fold{stroke:#df704b}.step-active text{fill:#df704b}.step-active .section-fill{stroke:#df704b}.step-active .face{stroke:#df704b;stroke-width:.25}
      </style>${defs()}${extraDefs}${frame(title)}${builder.render()}</svg>`;
  }

  function transformPoint(point, origin, scale) { return [origin[0] + point[0] * scale, origin[1] + point[1] * scale]; }
  function projectedPoints(meshValue, view, origin, scale) {
    return meshValue.vertices.map(v => transformPoint(Geometry.orthographic(v, view), origin, scale));
  }
  function centeredOrigin(points, center, scale = 1) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return [center[0] - (Math.min(...xs) + Math.max(...xs)) / 2 * scale, center[1] - (Math.min(...ys) + Math.max(...ys)) / 2 * scale];
  }
  function dimensionH(builder, a, b, y, value, step = 5) {
    let s = svgLine([a[0], a[1]], [a[0], y + 2], 'dimension') + svgLine([b[0], b[1]], [b[0], y + 2], 'dimension');
    s += svgLine([a[0], y], [b[0], y], 'dimension', 'marker-start="url(#dim-arrow)" marker-end="url(#dim-arrow)"');
    s += svgText((a[0] + b[0]) / 2, y - 1.7, value, 'dim-text', 'middle');
    builder.add('dimensions', step, s);
  }
  function dimensionV(builder, a, b, x, value, step = 5) {
    let s = svgLine([a[0], a[1]], [x - 2, a[1]], 'dimension') + svgLine([b[0], b[1]], [x - 2, b[1]], 'dimension');
    s += svgLine([x, a[1]], [x, b[1]], 'dimension', 'marker-start="url(#dim-arrow)" marker-end="url(#dim-arrow)"');
    s += svgText(x - 1.8, (a[1] + b[1]) / 2, value, 'dim-text', 'middle', `transform="rotate(-90 ${x - 1.8} ${(a[1] + b[1]) / 2})"`);
    builder.add('dimensions', step, s);
  }
  function axesAt(builder, center, width, height, step = 1) {
    let s = svgLine([center[0] - width / 2, center[1]], [center[0] + width / 2, center[1]], 'axis');
    s += svgLine([center[0], center[1] - height / 2], [center[0], center[1] + height / 2], 'axis');
    builder.add('axes', step, s);
  }

  function drawMesh(builder, meshValue, view, origin, scale, step, labels = false) {
    const projected = projectedPoints(meshValue, view, origin, scale);
    const items = Geometry.visibility(meshValue, view);
    let hidden = '', visible = '';
    items.forEach(item => {
      const { edge } = item;
      const a3 = meshValue.vertices[edge.a], b3 = meshValue.vertices[edge.b];
      const smooth = edge.smooth || ((meshValue.shape === 'cylinder' || meshValue.shape === 'cone') && Math.abs(a3[2] - b3[2]) > 1e-6);
      if (smooth && (!item.visible || !item.silhouette)) return;
      const line = svgLine(projected[edge.a], projected[edge.b], item.visible ? 'visible' : 'hidden');
      if (item.visible) visible += line; else hidden += line;
    });
    builder.add('hidden', step, hidden);
    builder.add('visible', step, visible);
    if (labels && meshValue.vertices.length <= 16) {
      let text = '';
      projected.forEach((p, i) => { text += svgText(p[0] + 1.5, p[1] - 1.5, String.fromCharCode(65 + i), 'point-label'); });
      builder.add('labels', step, text);
    }
    return projected;
  }

  function drawPolygonHatch(builder, points2, origin, scale, step) {
    const pts = points2.map(p => transformPoint(p, origin, scale));
    builder.add('visible', step, polygon(pts, 'section-fill'));
    return pts;
  }

  function renderViews() {
    const b = makeBuilder(), p = paper(), s = scaleValue();
    const bounds = mesh.bounds;
    const w = bounds.max[0] - bounds.min[0], d = bounds.max[1] - bounds.min[1], h = bounds.max[2] - bounds.min[2];
    const front = [p.w * .27, p.h * .405], top = [p.w * .27, p.h * .62], left = [p.w * .69, p.h * .405];
    const pf = drawMesh(b, mesh, 'front', front, s, 2, true);
    const pt = drawMesh(b, mesh, 'top', top, s, 3, true);
    const pl = drawMesh(b, mesh, 'left', left, s, 4, true);
    axesAt(b, [front[0], front[1] - h * s / 2], w * s + 16, h * s + 14);
    axesAt(b, top, w * s + 16, d * s + 16);
    axesAt(b, [left[0], left[1] - h * s / 2], d * s + 16, h * s + 14);

    let links = '';
    const count = Math.min(mesh.vertices.length, 6);
    for (let i = 0; i < count; i++) {
      links += svgLine(pf[i], pt[i], 'construction') + svgLine(pf[i], pl[i], 'construction');
      const k = [left[0] + pt[i][1] - top[1], pt[i][1]];
      links += svgLine(pt[i], k, 'construction') + svgLine(k, [k[0], pl[i][1]], 'construction');
    }
    const kx = left[0], ky = top[1], kLength = d * s * .45 + 6;
    links += svgLine([kx - kLength, ky - kLength], [kx + kLength, ky + kLength], 'construction');
    links += svgText(kx + kLength + 2, ky + kLength + 2, 'k', 'point-label');
    b.add('construction', 4, links);

    b.add('labels', 2, svgText(front[0], front[1] + 9, 'Главный вид', 'sheet-caption', 'middle'));
    b.add('labels', 3, svgText(top[0], top[1] + d * s / 2 + 9, 'Вид сверху', 'sheet-caption', 'middle'));
    b.add('labels', 4, svgText(left[0], left[1] + 9, 'Вид слева', 'sheet-caption', 'middle'));
    dimensionH(b, [front[0] - w * s / 2, front[1]], [front[0] + w * s / 2, front[1]], front[1] + 16, fmt(w));
    dimensionV(b, [front[0] - w * s / 2, front[1]], [front[0] - w * s / 2, front[1] - h * s], front[0] - w * s / 2 - 12, fmt(h));
    dimensionV(b, [top[0] + w * s / 2, top[1] - d * s / 2], [top[0] + w * s / 2, top[1] + d * s / 2], top[0] + w * s / 2 + 12, fmt(d));
    return sheetSVG('Три ортогональных вида', b);
  }

  function sectionScheme(builder, origin, scale, step = 0) {
    const view = state.section.axis === 'z' ? 'front' : 'top';
    const projected = drawMesh(builder, mesh, view, origin, scale, step, false);
    const all = projected.map(p => p);
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const minX = Math.min(...xs) - 8, maxX = Math.max(...xs) + 8;
    const minY = Math.min(...ys) - 8, maxY = Math.max(...ys) + 8;
    let line;
    if (state.section.axis === 'x') {
      const x = origin[0] + state.section.offset * scale;
      line = [[x, minY], [x, maxY]];
    } else if (state.section.axis === 'y') {
      const y = origin[1] - state.section.offset * scale;
      line = [[minX, y], [maxX, y]];
    } else {
      const y = origin[1] - state.section.offset * scale;
      line = [[minX, y], [maxX, y]];
    }
    let s = svgLine(line[0], line[1], 'cut-line');
    s += svgLine([line[0][0], line[0][1] - 5], line[0], 'cut-line', 'marker-start="url(#section-arrow)"');
    s += svgLine([line[1][0], line[1][1] - 5], line[1], 'cut-line', 'marker-start="url(#section-arrow)"');
    s += svgText(line[0][0] - 2, line[0][1] - 5, 'А', 'sheet-caption', 'end');
    s += svgText(line[1][0] + 2, line[1][1] - 5, 'А', 'sheet-caption');
    builder.add('labels', step, s);
  }

  function sectionLayout(points2, center, maxW, maxH, preferredScale) {
    if (!points2.length) return { origin: center, scale: 1 };
    const xs = points2.map(p => p[0]), ys = points2.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1;
    const scale = Math.max(.05, Math.min(preferredScale, maxW / w, maxH / h));
    return { origin: centeredOrigin(points2, center, scale), scale };
  }

  function renderSection() {
    const b = makeBuilder(), p = paper();
    if (!cutPoints.length) return sheetSVG('Сечение А–А', b);
    const points2 = Geometry.section2D(cutPoints, state.section.axis);
    const schemeScale = scaleValue() * .55;
    sectionScheme(b, [p.w * .20, p.h * .42], schemeScale, 0);
    b.add('labels', 0, svgText(p.w * .20, p.h * .42 + 48, 'Положение плоскости', 'sheet-caption', 'middle'));
    const layout = sectionLayout(points2, [p.w * .61, p.h * .43], p.w * .42, p.h * .54, scaleValue() * 1.35);
    const pts = points2.map(v => transformPoint(v, layout.origin, layout.scale));
    let markers = '', labels = '';
    pts.forEach((v, i) => {
      markers += circle(v, .9, 'visible') + (i < 12 ? svgText(v[0] + 2, v[1] - 2, String(i + 1), 'point-label') : '');
      if (i) markers += svgLine(pts[i - 1], v, 'construction');
    });
    b.add('construction', 1, markers);
    b.add('visible', 2, polygon(pts, 'visible'));
    b.add('visible', 3, polygon(pts, 'hatch-area'));
    const center = [layout.origin[0], layout.origin[1]];
    axesAt(b, center, p.w * .35, p.h * .45, 1);
    b.add('labels', 2, svgText(center[0], Math.max(...pts.map(v => v[1])) + 13, 'А–А', 'sheet-title', 'middle'));
    b.add('labels', 2, svgText(center[0], Math.max(...pts.map(v => v[1])) + 20, 'Натуральная величина сечения', 'sheet-note', 'middle'));
    const xs = pts.map(v => v[0]), ys = pts.map(v => v[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const actual = Geometry.metrics(mesh, cutPoints);
    dimensionH(b, [minX, maxY], [maxX, maxY], maxY + 27, fmt((maxX - minX) / layout.scale), 4);
    dimensionV(b, [minX, minY], [minX, maxY], minX - 13, fmt((maxY - minY) / layout.scale), 4);
    b.add('labels', 4, svgText(p.w - 25, p.h - 72, `Площадь: ${fmt(actual.sectionArea, 1)} мм²`, 'metric-label', 'end'));
    return sheetSVG('Сечение А–А · натуральная величина', b);
  }

  function renderCut() {
    const b = makeBuilder(), p = paper();
    if (!clippedMesh || !cutPoints.length) return sheetSVG('Простой разрез А–А', b);
    const view = state.section.axis === 'x' ? 'left' : state.section.axis === 'z' ? 'top' : 'front';
    const all2 = clippedMesh.vertices.map(v => Geometry.orthographic(v, view));
    const layout = sectionLayout(all2, [p.w * .43, p.h * .43], p.w * .48, p.h * .55, scaleValue() * 1.15);
    sectionScheme(b, [p.w * .80, p.h * .32], scaleValue() * .45, 0);
    b.add('labels', 0, svgText(p.w * .80, p.h * .32 + 43, 'Секущая плоскость', 'sheet-caption', 'middle'));
    const removedOrigin = sectionLayout(all2, [p.w * .43, p.h * .43], p.w * .48, p.h * .55, scaleValue() * 1.15).origin;
    drawMesh(b, clippedMesh, view, removedOrigin, layout.scale, 1, false);
    const section2 = Geometry.section2D(cutPoints, state.section.axis);
    const sectionPts = section2.map(v => transformPoint(v, layout.origin, layout.scale));
    b.add('visible', 3, polygon(sectionPts, 'hatch-area'));
    b.add('visible', 4, polygon(sectionPts, 'visible'));
    const projected = projectedPoints(clippedMesh, view, layout.origin, layout.scale);
    const xs = projected.map(v => v[0]), ys = projected.map(v => v[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    axesAt(b, [(minX + maxX) / 2, (minY + maxY) / 2], maxX - minX + 16, maxY - minY + 16, 1);
    b.add('labels', 4, svgText((minX + maxX) / 2, maxY + 13, 'А–А', 'sheet-title', 'middle'));
    dimensionH(b, [minX, maxY], [maxX, maxY], maxY + 23, fmt((maxX - minX) / layout.scale), 5);
    dimensionV(b, [minX, minY], [minX, maxY], minX - 13, fmt((maxY - minY) / layout.scale), 5);
    b.add('labels', 5, svgText(p.w * .80, p.h * .32 + 52, planeName(), 'sheet-note', 'middle'));
    return sheetSVG('Простой разрез А–А', b);
  }

  function renderAxon() {
    const b = makeBuilder(), p = paper(), type = state.axonType;
    const raw = mesh.vertices.map(v => Geometry.axon(v, type));
    const layout = sectionLayout(raw, [p.w * .5, p.h * .43], p.w * .53, p.h * .54, scaleValue() * 1.05);
    const projected = raw.map(v => transformPoint(v, layout.origin, layout.scale));
    const normals = Geometry.faceNormals(mesh);
    const faceOrder = mesh.faces.map((face, i) => ({
      face, i, depth: face.reduce((sum, index) => sum + Geometry.axonDepth(mesh.vertices[index], type), 0) / face.length
    })).sort((a, b) => a.depth - b.depth);
    let faces = '';
    faceOrder.forEach(({ face, i }) => {
      const n = normals[i];
      const light = Math.max(0, Math.min(1, (n[0] * -.3 + n[1] * -.4 + n[2] * .85 + 1) / 2));
      const lum = Math.round(78 + light * 17);
      faces += polygon(face.map(index => projected[index]), 'face', `fill="hsl(145 9% ${lum}%)"`);
    });
    b.add('visible', 2, faces);
    const items = Geometry.axonVisibility(mesh, type);
    let hidden = '', visible = '', construction = '';
    items.forEach(item => {
      const { edge } = item;
      const a3 = mesh.vertices[edge.a], b3 = mesh.vertices[edge.b];
      const smooth = edge.smooth || ((mesh.shape === 'cylinder' || mesh.shape === 'cone') && Math.abs(a3[2] - b3[2]) > 1e-6);
      if (smooth && (!item.visible || !item.silhouette)) return;
      const line = svgLine(projected[edge.a], projected[edge.b], item.visible ? 'visible' : 'hidden');
      if (item.visible) visible += line; else hidden += line;
    });
    const baseCount = mesh.shape === 'pyramid' || mesh.shape === 'cone' ? mesh.vertices.length - 1 : mesh.vertices.length / 2;
    if (mesh.shape !== 'mesh' && Number.isInteger(baseCount)) {
      for (let i = 0; i < Math.min(baseCount, 12); i++) {
        const topIndex = mesh.shape === 'pyramid' || mesh.shape === 'cone' ? mesh.vertices.length - 1 : i + baseCount;
        construction += svgLine(projected[i], projected[topIndex], 'construction');
      }
    }
    b.add('construction', 1, construction);
    b.add('hidden', 3, hidden);
    b.add('visible', 3, visible);

    const modelOrigin = transformPoint(Geometry.axon([0, 0, 0], type), layout.origin, layout.scale);
    const axisLength = 25;
    let axes = '', axisLabels = '';
    [[axisLength, 0, 0], [0, axisLength, 0], [0, 0, axisLength]].forEach((v, i) => {
      const end = transformPoint(Geometry.axon(v, type), layout.origin, layout.scale);
      axes += svgLine(modelOrigin, end, 'axis');
      axisLabels += svgText(end[0] + (i === 2 ? 2 : 0), end[1] + (i === 2 ? -2 : 4), ['x', 'y', 'z'][i], 'point-label');
    });
    b.add('axes', 0, axes);
    b.add('labels', 0, axisLabels);
    const coefficient = type === 'iso' ? 'kₓ = kᵧ = k_z = 1' : 'kₓ = k_z = 1;  kᵧ = 0,5';
    b.add('labels', 4, svgText(p.w * .5, p.h - 73, type === 'iso' ? 'Прямоугольная изометрия' : 'Прямоугольная диметрия', 'sheet-caption', 'middle'));
    b.add('labels', 4, svgText(p.w * .5, p.h - 66, coefficient + ' · приведённые коэффициенты', 'sheet-note', 'middle'));
    return sheetSVG(type === 'iso' ? 'Прямоугольная изометрия' : 'Прямоугольная диметрия', b);
  }

  function rectangle(x, y, w, h) { return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; }
  function attachedBase(base, targetY, reverse) {
    const p = base[0], q = base[1];
    const length = Geometry.distance([p[0], p[1], 0], [q[0], q[1], 0]);
    const e = [(q[0] - p[0]) / length, (q[1] - p[1]) / length], n = [-e[1], e[0]];
    return base.map(v => {
      const r = [v[0] - p[0], v[1] - p[1]];
      const perpendicular = r[0] * n[0] + r[1] * n[1];
      return [r[0] * e[0] + r[1] * e[1], targetY + (reverse ? -perpendicular : perpendicular)];
    });
  }
  function makeNet() {
    const net = { outlines: [], folds: [], guides: [], circles: [], labels: [] };
    const p = state.params;
    if (state.shape === 'box') {
      const w = p.width, d = p.depth, h = p.height;
      net.outlines.push(rectangle(0, 0, w, h), rectangle(-d, 0, d, h), rectangle(w, 0, d, h), rectangle(w + d, 0, w, h), rectangle(0, -d, w, d), rectangle(0, h, w, d));
      [[[0, 0], [0, h]], [[w, 0], [w, h]], [[w + d, 0], [w + d, h]], [[0, 0], [w, 0]], [[0, h], [w, h]]].forEach(l => net.folds.push(l));
      net.labels.push({ p: [w / 2, h / 2], text: 'Фронтальная грань' }, { p: [w / 2, -d / 2], text: 'Верх' }, { p: [w / 2, h + d / 2], text: 'Основание' });
    } else if (state.shape === 'prism') {
      const n = p.sides, base = mesh.vertices.slice(0, n).map(v => [v[0], v[1]]);
      const sides = base.map((v, i) => Geometry.distance([v[0], v[1], 0], [base[(i + 1) % n][0], base[(i + 1) % n][1], 0]));
      const perimeter = sides.reduce((a, b) => a + b, 0), h = p.height;
      net.outlines.push(rectangle(0, 0, perimeter, h));
      let x = 0;
      sides.forEach((side, i) => { if (i) net.folds.push([[x, 0], [x, h]]); x += side; });
      net.outlines.push(attachedBase(base, 0, true), attachedBase(base, h, false));
      net.folds.push([[0, 0], [sides[0], 0]], [[0, h], [sides[0], h]]);
      net.labels.push({ p: [perimeter / 2, h / 2], text: `P = ${fmt(perimeter)} мм` });
    } else if (state.shape === 'pyramid') {
      const n = p.sides, apex = mesh.vertices[n], base = mesh.vertices.slice(0, n);
      const side = Geometry.distance(base[0], base[1]);
      const slant = Geometry.distance(apex, base[0]);
      const angle = Math.acos(Math.max(-1, Math.min(1, (2 * slant * slant - side * side) / (2 * slant * slant))));
      const start = -n * angle / 2;
      const arc = Array.from({ length: n + 1 }, (_, i) => [slant * Math.cos(start + i * angle), slant * Math.sin(start + i * angle)]);
      net.outlines.push([[0, 0], ...arc]);
      arc.slice(1, -1).forEach(v => net.folds.push([[0, 0], v]));
      net.labels.push({ p: [slant * .55, 0], text: `L = ${fmt(slant)} мм` });
    } else if (state.shape === 'cylinder') {
      const r = p.radius, h = p.height, length = 2 * Math.PI * r;
      net.outlines.push(rectangle(0, 0, length, h));
      for (let i = 1; i < 12; i++) net.guides.push([[length * i / 12, 0], [length * i / 12, h]]);
      net.circles.push({ c: [r, -r - 5], r }, { c: [r, h + r + 5], r });
      net.labels.push({ p: [length / 2, h / 2], text: `2πR = ${fmt(length)} мм` });
    } else if (state.shape === 'cone') {
      const r = p.radius, slant = Math.hypot(r, p.height), angle = 2 * Math.PI * r / slant;
      const count = Math.max(24, Math.ceil(angle * 12));
      const arc = Array.from({ length: count + 1 }, (_, i) => {
        const a = -angle / 2 + angle * i / count;
        return [slant * Math.cos(a), slant * Math.sin(a)];
      });
      net.outlines.push([[0, 0], ...arc]);
      for (let i = 4; i < count; i += 4) net.guides.push([[0, 0], arc[i]]);
      net.circles.push({ c: [slant + r + 5, 0], r });
      net.labels.push({ p: [slant * .48, 0], text: `L = ${fmt(slant)} мм` }, { p: [slant * .7, -slant * .45], text: `α = ${fmt(angle * 180 / Math.PI)}°` });
    }
    return net;
  }

  function renderDevelopment() {
    const b = makeBuilder(), p = paper(), net = makeNet();
    const all = [...net.outlines.flat(), ...net.folds.flat(), ...net.guides.flat(), ...net.circles.flatMap(c => [[c.c[0] - c.r, c.c[1] - c.r], [c.c[0] + c.r, c.c[1] + c.r]])];
    const layout = sectionLayout(all, [p.w * .49, p.h * .42], p.w * .67, p.h * .58, scaleValue());
    const transform = v => transformPoint(v, layout.origin, layout.scale);
    let guides = '';
    net.guides.forEach(line => { guides += svgLine(transform(line[0]), transform(line[1]), 'construction'); });
    b.add('construction', 0, guides);
    let outlines = '';
    net.outlines.forEach(poly => { outlines += path(poly.map(transform), true, 'visible'); });
    net.circles.forEach(c => { outlines += circle(transform(c.c), c.r * layout.scale, 'visible'); });
    b.add('visible', 1, outlines);
    let folds = '';
    net.folds.forEach(line => { folds += svgLine(transform(line[0]), transform(line[1]), 'fold'); });
    b.add('construction', 2, folds);
    let labels = svgText(p.w * .49, p.h - 70, 'Линии сгиба обозначены штрихпунктиром', 'sheet-note', 'middle');
    net.labels.forEach(item => { const at = transform(item.p); labels += svgText(at[0], at[1], item.text, 'sheet-note', 'middle'); });
    b.add('labels', 3, labels);
    const xs = all.map(v => v[0]), ys = all.map(v => v[1]);
    const min = transform([Math.min(...xs), Math.max(...ys)]), max = transform([Math.max(...xs), Math.min(...ys)]);
    dimensionH(b, [min[0], min[1]], [max[0], min[1]], Math.min(p.h - 78, min[1] + 15), fmt((Math.max(...xs) - Math.min(...xs))), 3);
    return sheetSVG('Развёртка поверхности · натуральные размеры', b);
  }

  function getSteps() {
    const b = mesh.bounds, h = b.max[2] - b.min[2], w = b.max[0] - b.min[0], d = b.max[1] - b.min[1];
    if (state.view === 'section') return [
      { kicker: 'Секущая плоскость', title: 'Задаём плоскость', text: `Проводим плоскость, перпендикулярную оси ${state.section.axis.toUpperCase()}, через отметку ${fmt(state.section.offset)} мм. На вспомогательном виде отмечаем её след и направление взгляда стрелками А–А.`, formula: planeName() },
      { kicker: 'Пересечение', title: 'Находим точки сечения', text: 'Каждое ребро, которое пересекает плоскость, даёт одну вершину искомой фигуры. Точка делит ребро пропорционально расстояниям от его концов до плоскости.', formula: `P = AB ∩ α;  найдено точек: ${cutPoints.length}` },
      { kicker: 'Контур', title: 'Соединяем вершины', text: 'Соединяем точки в порядке обхода граней. Получаем замкнутую плоскую фигуру; её контур выполняем сплошной основной линией.', formula: `Контур: ${cutPoints.length} вершин · замкнутый` },
      { kicker: 'Натуральная величина', title: 'Поворачиваем фигуру', text: 'Секущая плоскость параллельна выбранной плоскости изображения, поэтому фигура показана без искажения. Наносим штриховку тонкими линиями под 45°.', formula: `S = ${fmt(Geometry.metrics(mesh, cutPoints).sectionArea || 0)} мм²` },
      { kicker: 'Проверка', title: 'Наносим размеры', text: 'Габаритные размеры получены непосредственно из координат точек сечения. Вынесенное сечение содержит только фигуру в секущей плоскости, без рёбер за ней.', formula: `Периметр = ${fmt(Geometry.metrics(mesh, cutPoints).sectionPerimeter || 0)} мм` }
    ];
    if (state.view === 'cut') return [
      { kicker: 'Положение', title: 'Отмечаем разрез А–А', text: `На вспомогательном изображении проводим след плоскости ${planeName()}. Стрелки показывают направление проецирования оставшейся части.`, formula: `α ⊥ ${state.section.axis.toUpperCase()};  разрез простой` },
      { kicker: 'Мысленная операция', title: 'Удаляем переднюю часть', text: 'Часть модели между наблюдателем и секущей плоскостью мысленно отбрасываем. Оставшаяся часть сохраняет все свои рёбра и грани.', formula: 'Модель → оставшаяся часть + фигура сечения' },
      { kicker: 'Проецирование', title: 'Строим оставшуюся часть', text: 'Проецируем не только контур сечения, но и видимые элементы модели, расположенные за секущей плоскостью. Этим разрез отличается от отдельного сечения.', formula: `Осталось вершин: ${clippedMesh?.vertices.length || 0}` },
      { kicker: 'Материал', title: 'Штрихуем сечение', text: 'Заштриховываем только те участки, где плоскость пересекает материал. Используем сплошные тонкие линии под углом 45° к рамке листа.', formula: 'Штриховка: 45° · тонкая сплошная' },
      { kicker: 'Оформление', title: 'Обводим контур', text: 'Фигуру сечения и видимый контур за плоскостью обводим сплошной основной линией. Над изображением размещаем обозначение А–А.', formula: 'ГОСТ 2.303 · основная линия 0,7 мм' },
      { kicker: 'Завершение', title: 'Проверяем размеры', text: 'Сверяем габариты разреза с исходной моделью и наносим необходимые размеры. Размеры не дублируем на других изображениях.', formula: `${fmt(w)} × ${fmt(h)} мм` }
    ];
    if (state.view === 'axon') return [
      { kicker: 'Координатные оси', title: 'Строим аксонометрические оси', text: state.axonType === 'iso' ? 'Ось Z направляем вертикально, оси X и Y — под углами 30° к горизонтали. Углы между осями равны 120°.' : 'Ось Z направляем вертикально. Ось X строим под углом около 7°, ось Y — около 41° к горизонтали.', formula: state.axonType === 'iso' ? '∠XOY = ∠YOZ = ∠ZOX = 120°' : '7°10′  /  41°25′' },
      { kicker: 'Координаты', title: 'Переносим вершины', text: 'Координаты каждой вершины откладываем параллельно соответствующим аксонометрическим осям. Используем приведённые коэффициенты искажения.', formula: state.axonType === 'iso' ? 'kₓ = kᵧ = k_z = 1' : 'kₓ = k_z = 1;  kᵧ = 0,5' },
      { kicker: 'Поверхность', title: 'Строим грани модели', text: 'Соединяем вершины в порядке исходных граней. Грани сортируются по глубине, поэтому дальние поверхности не перекрывают ближние.', formula: `Граней: ${mesh.faces.length} · вершин: ${mesh.vertices.length}` },
      { kicker: 'Видимость', title: 'Определяем видимые рёбра', text: 'Направление взгляда задаёт видимые грани. Общие рёбра видимых граней обводим основной линией; невидимые можно скрыть через меню «Слои».', formula: 'n · v > 0 → грань видима' },
      { kicker: 'Проверка', title: 'Проверяем проекцию', text: 'Сверяем направления рёбер с осями и контрольные размеры. В изометрии окружности становятся эллипсами; многогранная аппроксимация сохраняет координаты окружности.', formula: state.axonType === 'iso' ? 'Эллипс: 1,22d × 0,71d' : 'Диметрия по ГОСТ 2.317' }
    ];
    if (state.view === 'development') return [
      { kicker: 'Исходная поверхность', title: 'Определяем натуральные размеры', text: 'Развёртка строится без искажения: используем настоящие длины рёбер, высоту тела и периметр основания. Вспомогательные линии делят кривую поверхность на участки.', formula: state.shape === 'cylinder' ? `L = 2πR = ${fmt(2 * Math.PI * state.params.radius)} мм` : state.shape === 'cone' ? `L = √(R² + h²) = ${fmt(Math.hypot(state.params.radius, state.params.height))} мм` : 'Все элементы — в натуральную величину' },
      { kicker: 'Раскрой', title: 'Раскладываем поверхность', text: state.shape === 'pyramid' || state.shape === 'cone' ? 'Откладываем последовательные элементы от общей вершины. Для конуса получаем сектор, угол которого пропорционален длине окружности основания.' : 'Последовательно откладываем стороны основания вдоль прямой и восстанавливаем высоту. Добавляем основания к боковой развёртке.', formula: state.shape === 'cone' ? `α = 360° · R/L = ${fmt(360 * state.params.radius / Math.hypot(state.params.radius, state.params.height))}°` : 'Соседние грани имеют общее ребро' },
      { kicker: 'Технология', title: 'Отмечаем линии сгиба', text: 'Общие рёбра граней проводим штрихпунктиром как линии сгиба. Внешний контур остаётся сплошной основной линией; вспомогательные образующие можно скрыть.', formula: 'Контур / сгиб / вспомогательная линия' },
      { kicker: 'Проверка', title: 'Сверяем длину развёртки', text: 'Длина развёрнутого контура основания должна равняться периметру или длине окружности основания. Габаритный размер подтверждает масштаб построения.', formula: 'Развёртка ↔ исходная поверхность' }
    ];
    return [
      { kicker: 'Исходные данные', title: 'Анализируем форму', text: `${state.name}: ${mesh.vertices.length} вершин и ${mesh.edges.length} рёбер. Все изображения ниже рассчитываются из одной пространственной модели, поэтому остаются согласованными.`, formula: `X: ${fmt(w)} · Y: ${fmt(d)} · Z: ${fmt(h)} мм` },
      { kicker: 'Компоновка', title: 'Размещаем оси и контуры', text: 'Выбираем главный вид и масштаб. Проводим осевые линии, намечаем габариты трёх изображений и оставляем место для размеров.', formula: `Лист ${state.paper} · масштаб ${scaleText()}` },
      { kicker: 'Фронтальная плоскость', title: 'Строим главный вид', text: 'Проецируем вершины на плоскость V. Координата X сохраняется, вертикальное положение определяется высотой Z. Видимые рёбра обводим основной линией.', formula: 'A(x, y, z) → A₂(x, z)' },
      { kicker: 'Горизонтальная плоскость', title: 'Строим вид сверху', text: 'Вид сверху размещаем под главным на одних вертикальных линиях связи. Координата X общая, глубина Y переносится без изменения.', formula: 'A(x, y, z) → A₁(x, y)' },
      { kicker: 'Профильная плоскость', title: 'Строим вид слева', text: 'Высоту Z переносим горизонтальными линиями из главного вида, а глубину Y — из вида сверху через постоянную прямую k под углом 45°.', formula: 'A(x, y, z) → A₃(y, z)' },
      { kicker: 'Оформление', title: 'Наносим размеры', text: 'Добавляем габаритные размеры и проверяем проекционную связь. Сплошные основные, штриховые и осевые линии можно включать независимо.', formula: `${fmt(w)} / ${fmt(d)} / ${fmt(h)} мм` }
    ];
  }

  function renderParameters() {
    const grid = $('#parameterGrid');
    grid.innerHTML = '';
    grid.classList.toggle('two-columns', state.shape === 'box');
    Object.keys(state.params).forEach(key => {
      const label = document.createElement('label');
      label.className = 'field';
      const unit = key === 'sides' ? '' : '<div class="input-unit"><input type="number" min="1" max="500" step="1"><em>мм</em></div>';
      label.innerHTML = `<span>${PARAM_LABELS[key]}</span>${key === 'sides' ? '<input type="number" min="3" max="12" step="1">' : unit}`;
      const input = label.querySelector('input');
      input.id = `param-${key}`;
      input.value = state.params[key];
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0) return;
        state.params[key] = key === 'sides' ? Math.round(Math.max(3, Math.min(12, value))) : Math.min(500, value);
        state.step = 0;
        renderAll();
      });
      grid.appendChild(label);
    });
    $('#shapeGrid').hidden = state.shape === 'mesh';
    grid.hidden = state.shape === 'mesh';
    $('#meshNote').hidden = state.shape !== 'mesh';
  }

  function syncForm() {
    $('#variant').value = state.variant;
    $('#partName').value = state.name;
    $('#student').value = state.student;
    $('#studentGroup').value = state.group;
    $('#paperFormat').value = state.paper;
    $('#drawingScale').value = state.scale;
    $('#axonType').value = state.axonType;
    $$('#layersMenu input').forEach(input => { input.checked = state.layers[input.dataset.layer] !== false; });
    renderParameters();
  }

  function updateControlState() {
    $$('#shapeGrid button').forEach(button => button.classList.toggle('active', button.dataset.shape === state.shape));
    $$('#sectionAxis button').forEach(button => button.classList.toggle('active', button.dataset.axis === state.section.axis));
    $$('#viewTabs button').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
    $$('#modeSwitch button').forEach(button => button.classList.toggle('active', button.dataset.mode === state.mode));
    const ai = { x: 0, y: 1, z: 2 }[state.section.axis];
    let min = mesh.bounds.min[ai], max = mesh.bounds.max[ai];
    if (max - min < .001) { min -= 1; max += 1; }
    state.section.offset = Math.max(min, Math.min(max, state.section.offset));
    const range = $('#sectionOffset');
    range.min = min; range.max = max; range.step = max - min < 20 ? .1 : 1; range.value = state.section.offset;
    $('#sectionOutput').textContent = `${fmt(state.section.offset)} мм`;
    const descriptions = {
      x: 'Плоскость перпендикулярна оси X. Часть модели перед наблюдением слева удаляется.',
      y: 'Плоскость перпендикулярна оси Y. Передняя часть модели мысленно удаляется.',
      z: 'Плоскость перпендикулярна оси Z. Нижняя часть при построении вида сверху удаляется.'
    };
    $('#sectionHint').textContent = descriptions[state.section.axis];
    $('#axonControl').hidden = state.view !== 'axon';
    const hints = { views: 'Главный вид · сверху · слева', cut: 'Простой разрез · штриховка 45°', section: 'Только фигура в секущей плоскости', axon: 'Приведённые коэффициенты искажения', development: 'Натуральные размеры поверхности' };
    $('#drawingHint').textContent = hints[state.view];
    $('#sheetPaper').style.width = `${state.zoom * 100}%`;
    $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function renderSheet() {
    const renderers = { views: renderViews, cut: renderCut, section: renderSection, axon: renderAxon, development: renderDevelopment };
    $('#sheetPaper').innerHTML = renderers[state.view]();
    const unavailable = (['cut', 'section'].includes(state.view) && !cutPoints.length) || (state.view === 'development' && state.shape === 'mesh');
    const overlay = $('#emptyOverlay');
    overlay.hidden = !unavailable;
    if (unavailable) {
      const custom = state.shape === 'mesh';
      overlay.innerHTML = custom && state.view === 'development'
        ? '<div><h3>Развёртка не рассчитана</h3><p>Для импортированного каркаса нельзя однозначно определить развёртываемую поверхность. Выберите параметрическое тело.</p></div>'
        : '<div><h3>Плоскость не пересекает тело</h3><p>Измените смещение или направление секущей плоскости в панели исходных данных. Сечение должно содержать не менее трёх точек.</p></div>';
    }
  }

  function renderLesson() {
    currentSteps = getSteps();
    state.step = Math.max(0, Math.min(currentSteps.length - 1, state.step));
    const step = currentSteps[state.step];
    $('#stepCounter').textContent = state.mode === 'final' ? 'Все операции показаны' : `Шаг ${state.step + 1} из ${currentSteps.length}`;
    const percent = state.mode === 'final' ? 100 : Math.round((state.step + 1) / currentSteps.length * 100);
    $('#stepPercent').textContent = `${percent}%`;
    $('#progressBar').style.width = `${percent}%`;
    $('#stepKicker').textContent = step.kicker;
    $('#stepTitle').textContent = step.title;
    $('#stepText').textContent = step.text;
    $('#stepFormula').textContent = step.formula;
    $('#previousStep').disabled = state.mode === 'final' || state.step === 0;
    $('#nextStep').disabled = state.mode === 'final' || state.step === currentSteps.length - 1;
    $('#playSteps').disabled = state.mode === 'final';
    $('#stepList').innerHTML = '';
    currentSteps.forEach((item, i) => {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button';
      button.className = state.mode === 'steps' && i === state.step ? 'active' : state.mode === 'final' || i < state.step ? 'done' : '';
      button.innerHTML = `<span>${String(i + 1).padStart(2, '0')}</span><span>${esc(item.title)}</span><span></span>`;
      button.addEventListener('click', () => { stopPlaying(); state.step = i; state.mode = 'steps'; renderAll(); });
      li.appendChild(button); $('#stepList').appendChild(li);
    });
  }

  function renderHeader() {
    const titles = { views: 'Три ортогональных вида', cut: 'Простой разрез А–А', section: 'Сечение в натуральную величину', axon: state.axonType === 'iso' ? 'Прямоугольная изометрия' : 'Прямоугольная диметрия', development: 'Развёртка поверхности' };
    $('#workspaceTitle').textContent = titles[state.view];
    $('#variantBreadcrumb').textContent = `Вариант ${state.variant}`;
    $('#sheetBadge').innerHTML = `${state.paper} <i></i> М ${scaleText()}`;
    $('#sheetDimensions').textContent = state.paper === 'A3' ? '420 × 297 мм' : '297 × 210 мм';
    const metrics = Geometry.metrics(mesh, cutPoints);
    $('#geometryStatus').textContent = `${mesh.vertices.length} вершин · ${mesh.edges.length} рёбер${metrics.sectionArea ? ` · S сечения ${fmt(metrics.sectionArea)} мм²` : ''}`;
    document.title = `${state.name} — Эпюр`;
  }

  function updateGeometry() {
    mesh = Geometry.build(state);
    cutPoints = mesh.faces.length ? Geometry.section(mesh, state.section.axis, state.section.offset) : [];
    clippedMesh = cutPoints.length ? Geometry.clip(mesh, state.section.axis, state.section.offset, state.section.axis === 'z' ? 'negative' : 'positive') : null;
  }
  function renderAll() {
    stopPlaying();
    updateGeometry();
    updateControlState();
    renderSheet();
    renderLesson();
    renderHeader();
    saveState();
  }

  function notify(message) {
    clearTimeout(toastTimer);
    $('#toast span').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
  }
  function stopPlaying() {
    if (playing) { clearInterval(playing); playing = null; }
    const use = $('#playSteps use');
    if (use) use.setAttribute('href', '#i-play');
  }
  function goToStep(index) {
    state.mode = 'steps'; state.step = Math.max(0, Math.min(currentSteps.length - 1, index));
    renderAll();
  }
  function togglePlaying() {
    if (playing) { stopPlaying(); return; }
    if (state.step >= currentSteps.length - 1) state.step = 0;
    $('#playSteps use').setAttribute('href', '#i-pause');
    renderSheet(); renderLesson();
    playing = setInterval(() => {
      if (state.step >= currentSteps.length - 1) { stopPlaying(); renderLesson(); return; }
      state.step++;
      updateControlState(); renderSheet(); renderLesson();
      $('#playSteps use').setAttribute('href', '#i-pause');
    }, 1500);
  }

  function fileStem() { return `Эпюр_вариант-${state.variant}_${state.view}`.replace(/[\\/:*?"<>|]/g, '-'); }
  function download(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function svgSource() {
    const previousMode = state.mode;
    state.mode = 'final';
    renderSheet();
    const svg = $('#drawingSVG').cloneNode(true), p = paper();
    state.mode = previousMode;
    renderSheet();
    svg.setAttribute('width', `${p.w}mm`); svg.setAttribute('height', `${p.h}mm`);
    svg.removeAttribute('id');
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
  }
  function exportSVG() {
    download(svgSource(), `${fileStem()}.svg`, 'image/svg+xml;charset=utf-8');
    notify('SVG-файл сохранён');
  }
  function exportPNG() {
    const p = paper(), blob = new Blob([svgSource()], { type: 'image/svg+xml;charset=utf-8' }), url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = p.w * 8; canvas.height = p.h * 8;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fffefb'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(result => {
        if (result) { download(result, `${fileStem()}.png`, 'image/png'); notify('PNG в высоком разрешении сохранён'); }
        else notify('Не удалось создать PNG');
      }, 'image/png');
    };
    image.onerror = () => { URL.revokeObjectURL(url); notify('Не удалось создать PNG'); };
    image.src = url;
  }
  function exportJSON(value = state, template = false) {
    const data = { format: 'epur-variant', version: 1, ...clone(value) };
    delete data.step; delete data.zoom; delete data.mode;
    if (template) { data.view = 'views'; data.name = SHAPE_NAMES.prism; }
    download(JSON.stringify(data, null, 2), template ? 'шаблон-варианта.json' : `${fileStem()}.json`, 'application/json;charset=utf-8');
    notify(template ? 'Шаблон варианта сохранён' : 'Исходные данные варианта сохранены');
  }
  function exportPDF() {
    const p = paper(), previousMode = state.mode;
    state.mode = 'final';
    renderSheet();
    let restored = false;
    const restoreSteps = () => {
      if (restored) return;
      restored = true; state.mode = previousMode; renderSheet();
    };
    window.addEventListener('afterprint', restoreSteps, { once: true });
    setTimeout(restoreSteps, 1000);
    let style = $('#dynamicPrintStyle');
    if (!style) { style = document.createElement('style'); style.id = 'dynamicPrintStyle'; document.head.appendChild(style); }
    style.textContent = `@media print{@page{size:${p.w}mm ${p.h}mm;margin:0}.sheet-paper{width:${p.w}mm!important}.sheet-paper>svg{width:${p.w}mm!important;height:${p.h}mm!important}}`;
    setTimeout(() => window.print(), 50);
  }

  function parseCSV(text) {
    const vertices = [];
    text.split(/\r?\n/).forEach(line => {
      const value = line.trim();
      if (!value || value.startsWith('#')) return;
      const parts = value.split(/[;,\t]/).map(v => v.trim());
      const numbers = parts.length >= 4 ? parts.slice(1, 4) : parts.slice(0, 3);
      if (numbers.length < 3 || numbers.some(n => !Number.isFinite(Number(n)))) {
        if (!vertices.length) return;
        throw new Error(`Не удалось прочитать строку CSV: «${line}»`);
      }
      vertices.push(numbers.map(Number));
    });
    if (!vertices.length) throw new Error('В CSV не найдено координат.');
    return { format: 'epur-variant', variant: 'CSV', name: 'Импортированный каркас', shape: 'mesh', params: {}, mesh: { vertices, faces: [], closed: vertices.length > 2 }, section: { axis: 'y', offset: 0 } };
  }
  function importText(text, extension) {
    try {
      const data = extension === 'csv' ? parseCSV(text) : JSON.parse(text);
      const next = normalizeState(data);
      next.view = 'views'; next.mode = 'steps'; next.step = 0; next.zoom = 1;
      state = next;
      syncForm(); renderAll();
      $('#importError').hidden = true;
      $('#importDialog').close();
      notify(`Вариант ${state.variant} импортирован`);
    } catch (error) {
      $('#importError').textContent = error instanceof SyntaxError ? 'JSON содержит синтаксическую ошибку. Проверьте запятые и кавычки.' : error.message;
      $('#importError').hidden = false;
    }
  }
  function readFile(file) {
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['json', 'csv'].includes(extension)) { $('#importError').textContent = 'Поддерживаются файлы JSON и CSV.'; $('#importError').hidden = false; return; }
    const reader = new FileReader();
    reader.onload = () => importText(String(reader.result), extension);
    reader.onerror = () => { $('#importError').textContent = 'Не удалось прочитать файл.'; $('#importError').hidden = false; };
    reader.readAsText(file, 'UTF-8');
  }

  function closeMenus() {
    $('#exportMenu').hidden = true; $('#layersMenu').hidden = true;
    $('#exportButton').setAttribute('aria-expanded', 'false'); $('#layersButton').setAttribute('aria-expanded', 'false');
  }
  function bindEvents() {
    $('#importButton').addEventListener('click', () => { closeMenus(); $('#importError').hidden = true; $('#importDialog').showModal(); });
    $('#fileInput').addEventListener('change', event => readFile(event.target.files[0]));
    const drop = $('#dropZone');
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', event => readFile(event.dataTransfer.files[0]));
    $('#downloadTemplate').addEventListener('click', () => exportJSON(DEFAULT_STATE, true));
    $('#exportButton').addEventListener('click', event => {
      event.stopPropagation();
      const open = $('#exportMenu').hidden; closeMenus(); $('#exportMenu').hidden = !open;
      $('#exportButton').setAttribute('aria-expanded', String(open));
    });
    $('#layersButton').addEventListener('click', event => {
      event.stopPropagation();
      const open = $('#layersMenu').hidden; closeMenus(); $('#layersMenu').hidden = !open;
      $('#layersButton').setAttribute('aria-expanded', String(open));
    });
    $('#exportMenu').addEventListener('click', event => {
      const button = event.target.closest('[data-export]'); if (!button) return;
      closeMenus();
      ({ svg: exportSVG, png: exportPNG, json: () => exportJSON(), pdf: exportPDF })[button.dataset.export]();
    });
    document.addEventListener('click', event => { if (!event.target.closest('.export-wrap') && !event.target.closest('.layer-control')) closeMenus(); });
    $$('#shapeGrid button').forEach(button => button.addEventListener('click', () => {
      const shape = button.dataset.shape;
      state.shape = shape; state.params = { ...PARAMS[shape] }; delete state.mesh;
      state.name = SHAPE_NAMES[shape]; state.section.offset = shape === 'box' || shape === 'prism' || shape === 'cylinder' || shape === 'cone' || shape === 'pyramid' ? 0 : state.section.offset;
      state.step = 0; $('#partName').value = state.name;
      renderParameters(); renderAll();
    }));
    $$('#viewTabs button').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.step = 0; renderAll(); }));
    $$('#modeSwitch button').forEach(button => button.addEventListener('click', () => { state.mode = button.dataset.mode; renderAll(); }));
    $$('#sectionAxis button').forEach(button => button.addEventListener('click', () => {
      state.section.axis = button.dataset.axis;
      const ai = { x: 0, y: 1, z: 2 }[state.section.axis];
      state.section.offset = state.section.axis === 'z' ? (mesh.bounds.min[2] + mesh.bounds.max[2]) / 2 : (mesh.bounds.min[ai] + mesh.bounds.max[ai]) / 2;
      state.step = 0; renderAll();
    }));
    $('#sectionOffset').addEventListener('input', event => { state.section.offset = Number(event.target.value); state.step = 0; renderAll(); });
    $('#previousStep').addEventListener('click', () => goToStep(state.step - 1));
    $('#nextStep').addEventListener('click', () => goToStep(state.step + 1));
    $('#playSteps').addEventListener('click', togglePlaying);
    $('#axonType').addEventListener('change', event => { state.axonType = event.target.value; state.step = 0; renderAll(); });
    $('#paperFormat').addEventListener('change', event => { state.paper = event.target.value; state.step = 0; renderAll(); });
    $('#drawingScale').addEventListener('change', event => { state.scale = event.target.value; renderAll(); });
    $('#variant').addEventListener('input', event => { state.variant = event.target.value; renderAll(); });
    $('#partName').addEventListener('input', event => { state.name = event.target.value; renderAll(); });
    $('#student').addEventListener('input', event => { state.student = event.target.value; renderAll(); });
    $('#studentGroup').addEventListener('input', event => { state.group = event.target.value; renderAll(); });
    $$('#layersMenu input').forEach(input => input.addEventListener('change', () => { state.layers[input.dataset.layer] = input.checked; renderSheet(); saveState(); }));
    $('#zoomIn').addEventListener('click', () => { state.zoom = Math.min(2, state.zoom + .25); updateControlState(); saveState(); });
    $('#zoomOut').addEventListener('click', () => { state.zoom = Math.max(.5, state.zoom - .25); updateControlState(); saveState(); });
    $('#zoomFit').addEventListener('click', () => { state.zoom = 1; updateControlState(); saveState(); });
    $('#mobileSettings').addEventListener('click', () => $('#controls').classList.toggle('mobile-open'));
    $('#resetButton').addEventListener('click', () => {
      if (!window.confirm('Заменить текущий вариант демонстрационным?')) return;
      state = clone(DEFAULT_STATE); syncForm(); renderAll(); notify('Демонстрационный вариант восстановлен');
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenus();
      if ($('#importDialog').open || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
      if (event.key === 'ArrowRight') goToStep(state.step + 1);
      if (event.key === 'ArrowLeft') goToStep(state.step - 1);
    });
  }

  syncForm();
  bindEvents();
  renderAll();
})();
