#target illustrator
/*
NEURAL CURRENT — Gradient Halftone Generator v3
------------------------------------------------
1) Selecciona UN path o compound path con relleno degradado.
2) Ejecuta este script.
3) "Preview" crea una vista previa temporal. El degradado original se OCULTA
   mientras previsualizas para que veas solo los puntos.
4) Ajusta y vuelve a pulsar Preview (o activa "Live preview").
5) "Generate" crea el arte final editable.
   - Por defecto el degradado original queda OCULTO (no borrado). Puedes
     mostrarlo de nuevo desde el panel Capas.
Cancel elimina la preview y deja el original como estaba.

Novedades v3:
- Funciona con DEGRADADO LIBRE (Freeform): por defecto toma los colores tal
  como Illustrator los dibuja, así que respeta todos los puntos de color.
- Rangos mucho más amplios. Cada control tiene un campo numérico donde puedes
  escribir valores más allá del rango del slider.
- "Escala global" para agrandar/achicar todos los puntos a la vez (10%–400%+).
- "Contraste" (curva) para exagerar la diferencia entre puntos grandes y chicos.
- Modo de tamaño: por oscuridad, por posición en el degradado, invertido o uniforme.
- Fade real hacia el borde de la silueta (no del rectángulo delimitador).
- Retícula rotable (45° como el halftone clásico) y opción hexagonal.
- Los puntos del borde se achican para caber en lugar de desaparecer.
- Recuerda tus últimos ajustes.
*/

(function () {
    if (app.documents.length === 0) {
        alert("Abre un documento de Illustrator primero.");
        return;
    }

    var doc = app.activeDocument;
    if (!doc.selection || doc.selection.length !== 1) {
        alert("Selecciona exactamente UN path o compound path con degradado.");
        return;
    }

    var source = doc.selection[0];
    if (source.typename !== "PathItem" && source.typename !== "CompoundPathItem") {
        alert("Selecciona un Path o Compound Path con relleno degradado.");
        return;
    }

    // ------------------------------------------------------------------
    // Gradient
    // ------------------------------------------------------------------
    function getGradient(item) {
        try {
            if (item.typename === "PathItem" && item.filled && item.fillColor.typename === "GradientColor") return item.fillColor;
            if (item.typename === "CompoundPathItem" && item.pathItems.length && item.pathItems[0].filled &&
                item.pathItems[0].fillColor.typename === "GradientColor") return item.pathItems[0].fillColor;
        } catch (e) {}
        return null;
    }

    // May be null for fills the scripting API does not expose well (e.g. Freeform gradients).
    // That is fine: by default the script samples the rendered colors (see buildRaster).
    var gradientColor = getGradient(source);

    function rgbOf(c) {
        try {
            if (c.typename === "RGBColor") return [c.red, c.green, c.blue];
            if (c.typename === "CMYKColor") return [
                255 * (1 - c.cyan / 100) * (1 - c.black / 100),
                255 * (1 - c.magenta / 100) * (1 - c.black / 100),
                255 * (1 - c.yellow / 100) * (1 - c.black / 100)
            ];
            if (c.typename === "GrayColor") {
                var g = 255 * (1 - c.gray / 100); return [g, g, g];
            }
            if (c.typename === "SpotColor") return rgbOf(c.spot.color);
        } catch (e) {}
        return [30, 40, 180];
    }

    function rgbColor(a) {
        var c = new RGBColor();
        c.red = Math.max(0, Math.min(255, a[0]));
        c.green = Math.max(0, Math.min(255, a[1]));
        c.blue = Math.max(0, Math.min(255, a[2]));
        return c;
    }

    function mix(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    var stops = [];
    try {
        var gs = gradientColor.gradient.gradientStops;
        for (var si = 0; si < gs.length; si++) {
            stops.push({ pos: gs[si].rampPoint / 100, color: rgbOf(gs[si].color) });
        }
    } catch (e) {}
    if (stops.length < 2) stops = [
        { pos: 0, color: [30, 45, 190] },
        { pos: 1, color: [240, 70, 175] }
    ];
    stops.sort(function (a, b) { return a.pos - b.pos; });

    function sample(t) {
        t = clamp01(t);
        if (t <= stops[0].pos) return stops[0].color;
        for (var i = 0; i < stops.length - 1; i++) {
            if (t <= stops[i + 1].pos) {
                var span = stops[i + 1].pos - stops[i].pos;
                return mix(stops[i].color, stops[i + 1].color, span ? (t - stops[i].pos) / span : 0);
            }
        }
        return stops[stops.length - 1].color;
    }

    var gb = source.geometricBounds; // left, top, right, bottom
    var left = gb[0], top = gb[1], right = gb[2], bottom = gb[3];
    var width = right - left, height = top - bottom;
    if (width <= 0 || height <= 0) {
        alert("El objeto seleccionado no tiene área utilizable.");
        return;
    }
    var cx = left + width / 2, cy = bottom + height / 2;

    var isRadial = false;
    try { isRadial = gradientColor.gradient.type === GradientType.RADIAL; } catch (e) {}

    // Real gradient geometry (origin / angle / length) when Illustrator exposes it sensibly.
    var gInfo = { ok: false };
    try {
        var go = gradientColor.origin, gl = gradientColor.length, ga = gradientColor.angle;
        if (go && go.length === 2 && gl > 0 && !isNaN(ga)) {
            var marginX = width, marginY = height;
            if (go[0] > left - marginX && go[0] < right + marginX && go[1] < top + marginY && go[1] > bottom - marginY) {
                gInfo = { ok: true, ox: go[0], oy: go[1], len: gl, ca: Math.cos(ga * Math.PI / 180), sa: Math.sin(ga * Math.PI / 180) };
            }
        }
    } catch (e) {}

    // ------------------------------------------------------------------
    // Raster sampling: reads the colors exactly as Illustrator renders them.
    // Works with linear, radial, FREEFORM gradients, opacity, etc.
    // The object is duplicated into a temp document, exported as an
    // uncompressed TIFF and the pixels are read back.
    // ------------------------------------------------------------------
    var raster = null, rasterError = "";

    function stripStroke(item) {
        try {
            if (item.typename === "PathItem") item.stroked = false;
            else if (item.typename === "CompoundPathItem") {
                for (var i = 0; i < item.pathItems.length; i++) item.pathItems[i].stroked = false;
            }
        } catch (e) {}
    }

    function readBinary(f) {
        f.encoding = "BINARY";
        if (!f.open("r")) return null;
        var data = f.read();
        f.close();
        return data;
    }

    function parseTiff(s) {
        if (!s || s.length < 8) throw new Error("TIFF vacío");
        var le = s.charAt(0) === "I";
        function u8(o) { return s.charCodeAt(o) & 255; }
        function u16(o) { return le ? (u8(o) | (u8(o + 1) << 8)) : ((u8(o) << 8) | u8(o + 1)); }
        function u32(o) {
            return le ? (u8(o) + u8(o + 1) * 256 + u8(o + 2) * 65536 + u8(o + 3) * 16777216)
                      : (u8(o) * 16777216 + u8(o + 1) * 65536 + u8(o + 2) * 256 + u8(o + 3));
        }
        var ifd = u32(4), n = u16(ifd), tags = {};
        for (var i = 0; i < n; i++) {
            var e = ifd + 2 + i * 12;
            var tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
            var size = type === 3 ? 2 : (type === 4 ? 4 : 1);
            var base = (size * cnt <= 4) ? e + 8 : u32(e + 8);
            var vals = [];
            for (var j = 0; j < cnt && j < 100000; j++) {
                vals.push(type === 3 ? u16(base + j * 2) : (type === 4 ? u32(base + j * 4) : u8(base + j)));
            }
            tags[tag] = vals;
        }
        if (tags[259] && tags[259][0] !== 1) throw new Error("TIFF comprimido");
        if (tags[258] && tags[258][0] !== 8) throw new Error("TIFF no es de 8 bits");
        if (tags[284] && tags[284][0] !== 1) throw new Error("TIFF planar no soportado");
        var w = tags[256][0], h = tags[257][0];
        return {
            w: w, h: h,
            spp: tags[277] ? tags[277][0] : 1,
            rps: tags[278] ? tags[278][0] : h,
            offsets: tags[273],
            u8: u8
        };
    }

    function buildRaster() {
        var tmpDoc = null, base = "nc_halftone_" + new Date().getTime();
        try {
            tmpDoc = app.documents.add(DocumentColorSpace.RGB, 1000, 1000);
            var dup = source.duplicate(tmpDoc.layers[0], ElementPlacement.PLACEATEND);
            try { dup.hidden = false; } catch (e) {}
            stripStroke(dup);
            var k = 360 / Math.max(width, height) * 100; // ~360 px on the long side
            dup.resize(k, k, true, true, true, true, true, Transformation.CENTER);
            var ab = tmpDoc.artboards[0].artboardRect;
            dup.position = [ab[0], ab[1]];
            tmpDoc.artboards[0].artboardRect = dup.geometricBounds;

            var opt = new ExportOptionsTIFF();
            opt.resolution = 72;
            opt.imageColorSpace = ImageColorSpace.RGB;
            opt.lZWCompression = false;
            try { opt.antiAliasing = AntiAliasingMethod.ARTOPTIMIZED; } catch (e) {}
            try { opt.byteOrder = TIFFByteOrder.IBMPC; } catch (e) {}
            try { opt.embedICCProfile = false; } catch (e) {}
            try { opt.saveMultipleArtboards = true; opt.artboardRange = "1"; } catch (e) {}
            tmpDoc.exportFile(new File(Folder.temp + "/" + base + ".tif"), ExportType.TIFF, opt);
        } catch (e) {
            rasterError = String(e);
        }
        try { if (tmpDoc) tmpDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
        try { doc.activate(); } catch (e) {}

        // Illustrator may append an artboard suffix to the file name.
        var files = Folder.temp.getFiles(base + "*");
        if (!files || !files.length) {
            if (!rasterError) rasterError = "no se generó el archivo temporal";
            return;
        }
        try {
            raster = parseTiff(readBinary(files[0]));
        } catch (e2) {
            raster = null;
            rasterError = String(e2);
        }
        for (var i = 0; i < files.length; i++) { try { files[i].remove(); } catch (e3) {} }
    }

    function rasterColor(x, y) {
        var px = Math.floor((x - left) / width * raster.w);
        var py = Math.floor((top - y) / height * raster.h);
        if (px < 0) px = 0; else if (px >= raster.w) px = raster.w - 1;
        if (py < 0) py = 0; else if (py >= raster.h) py = raster.h - 1;
        var strip = Math.floor(py / raster.rps);
        var o = raster.offsets[strip] + ((py - strip * raster.rps) * raster.w + px) * raster.spp;
        if (raster.spp >= 3) return [raster.u8(o), raster.u8(o + 1), raster.u8(o + 2)];
        var g = raster.u8(o);
        return [g, g, g];
    }

    buildRaster();
    try { doc.selection = null; source.selected = true; } catch (e) {}

    if (!raster && !gradientColor) {
        alert("No se pudo leer el degradado de este objeto.\n" + rasterError);
        return;
    }

    // mapping: 0 Raster (what you see), 1 Auto geometry, 2 Horizontal, 3 Vertical, 4 Radial from center
    function gradientT(x, y, mapping, reverse) {
        var u = (x - left) / width, v = (top - y) / height, t;
        mapping = mapping - 1;
        if (mapping <= 0 && gInfo.ok) {
            if (isRadial) {
                var dx = x - gInfo.ox, dy = y - gInfo.oy;
                t = Math.sqrt(dx * dx + dy * dy) / gInfo.len;
            } else {
                t = ((x - gInfo.ox) * gInfo.ca + (y - gInfo.oy) * gInfo.sa) / gInfo.len;
            }
        } else if (mapping === 2) {
            t = v;
        } else if (mapping === 3 || (mapping <= 0 && isRadial)) {
            t = Math.sqrt(Math.pow((u - 0.5) * 2, 2) + Math.pow((v - 0.5) * 2, 2)) / 1.4142;
        } else {
            t = u;
        }
        t = clamp01(t);
        return reverse ? 1 - t : t;
    }

    // ------------------------------------------------------------------
    // Shape geometry
    // ------------------------------------------------------------------
    function sampledPolygon(pathItem, stepsPerSegment) {
        var pts = pathItem.pathPoints;
        var poly = [];
        if (!pts || pts.length < 2 || !pathItem.closed) return poly;
        for (var i = 0; i < pts.length; i++) {
            var a = pts[i];
            var b = pts[(i + 1) % pts.length];
            var p0 = a.anchor, p1 = a.rightDirection, p2 = b.leftDirection, p3 = b.anchor;
            for (var s = 0; s < stepsPerSegment; s++) {
                var t = s / stepsPerSegment, mt = 1 - t;
                poly.push([
                    mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
                    mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1]
                ]);
            }
        }
        return poly;
    }

    function getPolygons(item) {
        var result = [];
        if (item.typename === "PathItem") {
            var p = sampledPolygon(item, 12);
            if (p.length) result.push(p);
        } else {
            for (var k = 0; k < item.pathItems.length; k++) {
                var cp = sampledPolygon(item.pathItems[k], 12);
                if (cp.length) result.push(cp);
            }
        }
        return result;
    }

    var shapePolygons = getPolygons(source);
    if (!shapePolygons.length) {
        alert("El objeto seleccionado debe ser un path cerrado o compound path.");
        return;
    }

    function pointInPolygon(px, py, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi + 0.0000001) + xi)) inside = !inside;
        }
        return inside;
    }

    // Even-odd rule: handles compound paths with holes.
    function isInsideShape(px, py) {
        var inside = false;
        for (var pi = 0; pi < shapePolygons.length; pi++) {
            if (pointInPolygon(px, py, shapePolygons[pi])) inside = !inside;
        }
        return inside;
    }

    // Distance from a point to the nearest silhouette edge (all sub-paths).
    function edgeDistance(px, py) {
        var best = 1e18;
        for (var pi = 0; pi < shapePolygons.length; pi++) {
            var poly = shapePolygons[pi];
            for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                var ax = poly[j][0], ay = poly[j][1];
                var bx = poly[i][0] - ax, by = poly[i][1] - ay;
                var wx = px - ax, wy = py - ay;
                var l2 = bx * bx + by * by;
                var t = l2 > 0 ? (wx * bx + wy * by) / l2 : 0;
                if (t < 0) t = 0; else if (t > 1) t = 1;
                var dx = wx - t * bx, dy = wy - t * by;
                var d2 = dx * dx + dy * dy;
                if (d2 < best) best = d2;
            }
        }
        return Math.sqrt(best);
    }

    // Deepest point inside the shape (approx.) — used to scale the edge fade.
    var maxInner = 0;
    (function () {
        var n = 28;
        for (var iy = 0; iy <= n; iy++) {
            for (var ix = 0; ix <= n; ix++) {
                var x = left + width * ix / n, y = bottom + height * iy / n;
                if (!isInsideShape(x, y)) continue;
                var d = edgeDistance(x, y);
                if (d > maxInner) maxInner = d;
            }
        }
        if (maxInner <= 0) maxInner = Math.min(width, height) / 2;
    })();

    function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

    // ------------------------------------------------------------------
    // Source visibility (so you can see only the dots)
    // ------------------------------------------------------------------
    var sourceWasHidden = false;
    try { sourceWasHidden = source.hidden; } catch (e) {}
    function setSourceVisible(v) {
        try { source.hidden = !v; } catch (e) {}
    }
    function restoreSource() { setSourceVisible(!sourceWasHidden); }

    // ------------------------------------------------------------------
    // Artwork
    // ------------------------------------------------------------------
    var previewGroup = null;
    function removePreview() {
        if (previewGroup) {
            try { previewGroup.remove(); } catch (e) {}
            previewGroup = null;
        }
    }

    function estimateGridPoints(s) {
        // Only the part of the rotated grid that falls inside the bounding box is evaluated.
        var rowStep = s.hex ? s.spacing * 0.866 : s.spacing;
        return Math.round((width * height) / (s.spacing * rowStep));
    }

    function makeArtwork(groupName, s, maxDots) {
        var outer = source.layer.groupItems.add();
        outer.name = groupName;
        var dots = outer.groupItems.add();
        dots.name = "Editable halftone dots";

        var singleColor = null;
        if (s.colorMode === 1) singleColor = stops[0].color;
        else if (s.colorMode === 2) singleColor = stops[stops.length - 1].color;
        else if (s.colorMode === 3) singleColor = [0, 0, 0];

        var fadeDist = s.fade * maxInner;
        var th = s.gridAngle * Math.PI / 180, ca = Math.cos(th), sa = Math.sin(th);
        var R = Math.sqrt(width * width + height * height) / 2 + s.spacing;
        var rowStep = s.hex ? s.spacing * 0.8660254 : s.spacing;
        var count = 0, capped = false, row = 0;

        for (var b = -R; b <= R; b += rowStep, row++) {
            var off = (s.hex && (row % 2)) ? s.spacing / 2 : 0;
            for (var a = -R + off; a <= R; a += s.spacing) {
                var x = cx + a * ca - b * sa;
                var y = cy + a * sa + b * ca;
                if (x < left || x > right || y < bottom || y > top) continue;
                if (!isInsideShape(x, y)) continue;

                var t, col;
                if (s.mapping === 0 && raster) {
                    // Sampled pixel color. "Position" = darkness, so the start/end size modes still work.
                    col = rasterColor(x, y);
                    t = 1 - (0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]) / 255;
                    if (s.reverse) t = 1 - t;
                } else {
                    t = gradientT(x, y, s.mapping, s.reverse);
                    col = sample(t);
                }

                var lum = (0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]) / 255;
                var field;
                if (s.sizeMode === 0) field = 1 - lum;     // darker = bigger
                else if (s.sizeMode === 1) field = lum;    // lighter = bigger
                else if (s.sizeMode === 2) field = 1 - t;  // gradient start = bigger
                else if (s.sizeMode === 3) field = t;      // gradient end = bigger
                else if (s.sizeMode === 4) field = 1;      // uniform
                field = Math.pow(clamp01(field), s.contrast);

                var f = (1 - s.influence) + s.influence * field;

                var ed = edgeDistance(x, y);
                var edgeFactor = fadeDist > 0 ? smoothstep(ed / fadeDist) : 1;

                var diameter = (s.minD + (s.maxD - s.minD) * f) * edgeFactor;
                if (s.jitter > 0) diameter *= 1 + s.jitter * Math.sin(x * 0.037 + y * 0.021) * Math.cos(y * 0.031 - x * 0.013);
                diameter *= s.scale;

                if (s.clip && diameter > ed * 2) diameter = ed * 2; // shrink edge dots so they stay inside
                if (diameter < s.minVisible) continue;

                if (count >= maxDots) { capped = true; break; }

                var dot = dots.pathItems.ellipse(y + diameter / 2, x - diameter / 2, diameter, diameter);
                dot.stroked = false;
                dot.filled = true;
                dot.fillColor = rgbColor(singleColor || col);
                count++;
            }
            if (capped) break;
        }

        if (s.halos) {
            var halos = outer.groupItems.add();
            halos.name = "Halo accents";
            var centers = [[left + width * 0.50, bottom + height * 0.50], [left + width * 0.68, bottom + height * 0.62]];
            for (var ci = 0; ci < centers.length; ci++) {
                if (!isInsideShape(centers[ci][0], centers[ci][1])) continue;
                for (var r = 0; r < 5; r++) {
                    var d = Math.min(width, height) * (0.025 + r * 0.014);
                    var ring = halos.pathItems.ellipse(centers[ci][1] + d / 2, centers[ci][0] - d / 2, d, d);
                    ring.filled = false;
                    ring.stroked = true;
                    ring.strokeWidth = 0.35;
                    ring.strokeColor = rgbColor(ci === 0 ? [255, 105, 190] : [90, 85, 255]);
                    try { ring.opacity = 22 - r * 3; } catch (e) {}
                }
            }
        }

        try { outer.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (e) {}
        return { group: outer, count: count, capped: capped };
    }

    // ------------------------------------------------------------------
    // Settings persistence
    // ------------------------------------------------------------------
    var prefsFile = new File(Folder.userData + "/NeuralCurrentHalftone_v3.txt");
    var saved = {};
    try {
        if (prefsFile.exists && prefsFile.open("r")) {
            while (!prefsFile.eof) {
                var line = prefsFile.readln();
                var eq = line.indexOf("=");
                if (eq > 0) saved[line.substring(0, eq)] = line.substring(eq + 1);
            }
            prefsFile.close();
        }
    } catch (e) {}
    function pref(key, def) {
        if (saved[key] === undefined) return def;
        if (typeof def === "boolean") return saved[key] === "true";
        var n = parseFloat(saved[key]);
        return isNaN(n) ? def : n;
    }

    // ------------------------------------------------------------------
    // Dialog
    // ------------------------------------------------------------------
    var dlg = new Window("dialog", "NEURAL CURRENT — Gradient Halftone v3");
    dlg.orientation = "column";
    dlg.alignChildren = "fill";
    dlg.spacing = 8;
    dlg.margins = 14;

    var heading = dlg.add("statictext", undefined, "Convierte el degradado seleccionado en puntos vectoriales editables.");
    try { heading.graphics.font = ScriptUI.newFont(heading.graphics.font.name, "BOLD", 12); } catch (e) {}

    var columns = dlg.add("group");
    columns.orientation = "row";
    columns.alignChildren = "top";
    var colL = columns.add("group"); colL.orientation = "column"; colL.alignChildren = "fill";
    var colR = columns.add("group"); colR.orientation = "column"; colR.alignChildren = "fill";

    function makePanel(parent, title) {
        var p = parent.add("panel", undefined, title);
        p.orientation = "column";
        p.alignChildren = "fill";
        p.margins = [10, 14, 10, 8];
        p.spacing = 4;
        return p;
    }

    var liveCheck; // defined later
    var allControls = [];

    // slider + numeric field. The field accepts values beyond the slider range (hardMin..hardMax).
    function numControl(parent, key, label, sMin, sMax, def, hardMin, hardMax, decimals, suffix) {
        var value = pref(key, def);
        var row = parent.add("group");
        row.orientation = "row";
        row.alignChildren = "center";
        var lbl = row.add("statictext", undefined, label);
        lbl.preferredSize.width = 128;
        var sl = row.add("slider", undefined, Math.max(sMin, Math.min(sMax, value)), sMin, sMax);
        sl.preferredSize.width = 150;
        var et = row.add("edittext", undefined, "");
        et.characters = 6;
        row.add("statictext", undefined, suffix).preferredSize.width = 20;

        function fmt(v) {
            var m = Math.pow(10, decimals);
            return String(Math.round(v * m) / m);
        }
        et.text = fmt(value);

        sl.onChanging = function () {
            value = Math.round(sl.value * Math.pow(10, decimals)) / Math.pow(10, decimals);
            et.text = fmt(value);
        };
        sl.onChange = function () {
            sl.onChanging();
            if (liveCheck && liveCheck.value) runPreview();
        };
        et.onChange = function () {
            var n = parseFloat(String(et.text).replace(",", "."));
            if (isNaN(n)) n = value;
            n = Math.max(hardMin, Math.min(hardMax, n));
            value = n;
            et.text = fmt(value);
            sl.value = Math.max(sMin, Math.min(sMax, value));
            if (liveCheck && liveCheck.value) runPreview();
        };
        var ctrl = { key: key, get: function () { return value; } };
        allControls.push(ctrl);
        return ctrl;
    }

    function dropControl(parent, key, label, items, def) {
        var row = parent.add("group");
        row.orientation = "row";
        var lbl = row.add("statictext", undefined, label);
        lbl.preferredSize.width = 128;
        var dd = row.add("dropdownlist", undefined, items);
        dd.preferredSize.width = 200;
        var idx = Math.round(pref(key, def));
        if (idx < 0 || idx >= items.length) idx = def;
        dd.selection = idx;
        dd.onChange = function () { if (liveCheck && liveCheck.value) runPreview(); };
        var ctrl = { key: key, get: function () { return dd.selection ? dd.selection.index : def; } };
        allControls.push(ctrl);
        return ctrl;
    }

    function checkControl(parent, key, label, def) {
        var cb = parent.add("checkbox", undefined, label);
        cb.value = pref(key, def);
        cb.onClick = function () { if (liveCheck && liveCheck.value && cb !== liveCheck) runPreview(); };
        var ctrl = { key: key, get: function () { return cb.value; }, cb: cb };
        allControls.push(ctrl);
        return ctrl;
    }

    // --- Dot size
    var pSize = makePanel(colL, "Tamaño de puntos");
    var cMax = numControl(pSize, "maxD", "Diámetro máximo", 0.5, 60, 11, 0.05, 500, 1, "pt");
    var cMin = numControl(pSize, "minD", "Diámetro mínimo", 0, 30, 0, 0, 500, 1, "pt");
    var cScale = numControl(pSize, "scale", "Escala global", 10, 400, 100, 1, 2000, 0, "%");
    var cContrast = numControl(pSize, "contrast", "Contraste (curva)", 0.2, 5, 1, 0.05, 20, 2, "");
    var cInfluence = numControl(pSize, "influence", "Influencia degradado", 0, 100, 85, 0, 100, 0, "%");
    var cMinVis = numControl(pSize, "minVisible", "Ocultar menores a", 0, 3, 0.3, 0, 50, 2, "pt");
    var cSizeMode = dropControl(pSize, "sizeMode", "Tamaño según", [
        "Oscuridad del color (oscuro = grande)",
        "Claridad del color (claro = grande)",
        "Inicio del degradado = grande",
        "Final del degradado = grande",
        "Uniforme"
    ], 0);

    // --- Grid
    var pGrid = makePanel(colL, "Retícula");
    var cSpacing = numControl(pGrid, "spacing", "Separación", 1, 40, 8, 0.5, 300, 1, "pt");
    var cAngle = numControl(pGrid, "gridAngle", "Ángulo retícula", 0, 90, 45, -360, 360, 0, "°");
    var cJitter = numControl(pGrid, "jitter", "Variación orgánica", 0, 60, 10, 0, 100, 0, "%");
    var cHex = checkControl(pGrid, "hex", "Retícula hexagonal (filas alternadas)", false);

    // --- Shape / gradient
    var pShape = makePanel(colR, "Silueta y degradado");
    var cFade = numControl(pShape, "fade", "Fade hacia el borde", 0, 100, 45, 0, 100, 0, "%");
    var cClip = checkControl(pShape, "clip", "Achicar puntos del borde para que quepan", true);
    var cMapping = dropControl(pShape, "mapping2", "Mapeo del degradado", [
        "Colores tal como se ven (sirve para degradado libre)",
        "Geometría del degradado (lineal/radial)",
        "Horizontal (izq → der)",
        "Vertical (arriba → abajo)",
        "Radial desde el centro"
    ], 0);
    var cReverse = checkControl(pShape, "reverse", "Invertir degradado", false);
    if (!raster) {
        var note = pShape.add("statictext", undefined, "(No se pudieron leer los colores renderizados: se usará la geometría.)");
        note.preferredSize.width = 300;
    }

    // --- Appearance
    var pLook = makePanel(colR, "Apariencia");
    var cColorMode = dropControl(pLook, "colorMode", "Color de puntos", [
        "Muestreado del degradado",
        "Primer color del degradado",
        "Último color del degradado",
        "Negro"
    ], 0);
    var cHalos = checkControl(pLook, "halos", "Añadir halos vectoriales", false);
    var cHidePreview = checkControl(pLook, "hidePreview", "Ocultar degradado original en la preview", true);
    var cKeepSource = checkControl(pLook, "keepSource", "Dejar visible el degradado original al generar", false);
    liveCheck = checkControl(pLook, "live", "Live preview (actualiza al soltar un control)", false).cb;

    var status = dlg.add("statictext", undefined, "La preview es temporal. Generate crea el arte final.");
    status.characters = 80;

    var buttons = dlg.add("group");
    buttons.alignment = "right";
    var cancelBtn = buttons.add("button", undefined, "Cancel", { name: "cancel" });
    var previewBtn = buttons.add("button", undefined, "Preview");
    var generateBtn = buttons.add("button", undefined, "Generate", { name: "ok" });

    function currentSettings() {
        var minD = cMin.get(), maxD = cMax.get();
        if (minD > maxD) { var tmp = minD; minD = maxD; maxD = tmp; }
        return {
            spacing: Math.max(0.5, cSpacing.get()),
            maxD: maxD,
            minD: minD,
            scale: cScale.get() / 100,
            contrast: Math.max(0.05, cContrast.get()),
            influence: cInfluence.get() / 100,
            minVisible: cMinVis.get(),
            sizeMode: cSizeMode.get(),
            gridAngle: cAngle.get(),
            jitter: cJitter.get() / 100,
            hex: cHex.get(),
            fade: cFade.get() / 100,
            clip: cClip.get(),
            mapping: (cMapping.get() === 0 && !raster) ? 1 : cMapping.get(),
            reverse: cReverse.get(),
            colorMode: cColorMode.get(),
            halos: cHalos.get()
        };
    }

    function savePrefs() {
        try {
            if (prefsFile.open("w")) {
                for (var i = 0; i < allControls.length; i++) {
                    prefsFile.writeln(allControls[i].key + "=" + String(allControls[i].get()));
                }
                prefsFile.close();
            }
        } catch (e) {}
    }

    function confirmHeavy(s) {
        var est = estimateGridPoints(s);
        if (est > 120000) {
            return confirm("Esta configuración evalúa ~" + est + " posiciones y puede tardar bastante.\n¿Continuar?");
        }
        return true;
    }

    var busy = false;
    function runPreview() {
        if (busy) return;
        var s = currentSettings();
        if (!confirmHeavy(s)) return;
        busy = true;
        try {
            status.text = "Generando preview...";
            try { dlg.update(); } catch (e) {}
            removePreview();
            setSourceVisible(cHidePreview.get() ? false : !sourceWasHidden);
            var result = makeArtwork("TEMP PREVIEW — Neural Current", s, 12000);
            previewGroup = result.group;
            status.text = "Preview: " + result.count + " puntos" +
                (result.capped ? " (limitado a 12000 en preview; Generate no tiene este límite tan bajo)." : ".");
            app.redraw();
        } catch (err) {
            removePreview();
            restoreSource();
            alert("Error en preview:\n" + err);
        }
        busy = false;
    }

    previewBtn.onClick = runPreview;

    var finished = false;

    cancelBtn.onClick = function () {
        removePreview();
        restoreSource();
        app.redraw();
        finished = true;
        dlg.close(0);
    };

    generateBtn.onClick = function () {
        var s = currentSettings();
        if (!confirmHeavy(s)) return;
        try {
            removePreview();
            var result = makeArtwork("NEURAL CURRENT — Gradient Halftone", s, 150000);
            if (cKeepSource.get()) restoreSource(); else setSourceVisible(false);
            try { doc.selection = null; } catch (e) {}
            try { result.group.selected = true; } catch (e) {}
            savePrefs();
            app.redraw();
            finished = true;
            alert("¡Listo! Se crearon " + result.count + " puntos vectoriales editables." +
                (result.capped ? "\n(Se alcanzó el límite de 150000 puntos.)" : "") +
                (cKeepSource.get() ? "" : "\nEl degradado original quedó OCULTO (no borrado). Muéstralo desde el panel Capas."));
            dlg.close(1);
        } catch (err2) {
            removePreview();
            restoreSource();
            alert("Error al generar:\n" + err2);
        }
    };

    dlg.onClose = function () {
        // Window close button / Esc: clean up as Cancel.
        if (!finished) {
            removePreview();
            restoreSource();
        }
        return true;
    };

    dlg.show();
})();
