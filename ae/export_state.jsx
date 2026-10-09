// Exporta el estado del proyecto abierto de After Effects a un JSON.
// Uso manual: Archivo > Scripts > Ejecutar archivo de script...
// Uso automatico: lo llama bridge/watcher.js (define $.global.AE_BRIDGE_OUT).
(function () {
    var MAX_KEYS = 50;      // keyframes maximos por propiedad
    var MAX_DEPTH = 12;     // profundidad maxima del arbol de propiedades

    function esc(s) {
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
            .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    }
    function ser(v) {
        if (v === null || v === undefined) return "null";
        var t = typeof v;
        if (t === "number") return isFinite(v) ? String(v) : "null";
        if (t === "boolean") return v ? "true" : "false";
        if (t === "string") return '"' + esc(v) + '"';
        if (v instanceof Array) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(ser(v[i]));
            return "[" + a.join(",") + "]";
        }
        var o = [];
        for (var k in v) if (v.hasOwnProperty(k)) o.push('"' + esc(k) + '":' + ser(v[k]));
        return "{" + o.join(",") + "}";
    }
    function safeValue(v) {
        // Valores no serializables (Shape, TextDocument...) se describen como texto
        if (v === null || v === undefined) return null;
        var t = typeof v;
        if (t === "number" || t === "boolean" || t === "string") return v;
        if (v instanceof Array) return v;
        try { if (v.text !== undefined) return { text: v.text }; } catch (e) {}
        return String(v);
    }
    function dumpProp(p, depth) {
        var o = { name: p.name, matchName: p.matchName };
        if (p.propertyType === PropertyType.PROPERTY) {
            try { o.value = safeValue(p.value); } catch (e) {}
            if (p.expression) { o.expression = p.expression; o.expressionEnabled = p.expressionEnabled; }
            o.numKeys = p.numKeys;
            if (p.numKeys > 0) {
                o.keys = [];
                for (var i = 1; i <= Math.min(p.numKeys, MAX_KEYS); i++) {
                    o.keys.push({ time: p.keyTime(i), value: safeValue(p.keyValue(i)) });
                }
            }
        } else if (depth < MAX_DEPTH) {
            o.props = [];
            for (var j = 1; j <= p.numProperties; j++) o.props.push(dumpProp(p.property(j), depth + 1));
        }
        return o;
    }
    function layerType(l) {
        if (l instanceof TextLayer) return "text";
        if (l instanceof ShapeLayer) return "shape";
        if (l instanceof CameraLayer) return "camera";
        if (l instanceof LightLayer) return "light";
        if (l instanceof AVLayer) return l.nullLayer ? "null" : "av";
        return "unknown";
    }
    function dumpLayer(l) {
        var o = {
            index: l.index, name: l.name, type: layerType(l), enabled: l.enabled,
            solo: l.solo, locked: l.locked, shy: l.shy, label: l.label,
            inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime,
            parent: l.parent ? l.parent.index : null
        };
        try { if (l.source) o.source = l.source.name; } catch (e) {}
        o.props = [];
        for (var i = 1; i <= l.numProperties; i++) o.props.push(dumpProp(l.property(i), 0));
        return o;
    }
    function dumpItem(it) {
        var o = { id: it.id, name: it.name, comment: it.comment, folder: it.parentFolder ? it.parentFolder.name : null };
        if (it instanceof CompItem) {
            o.type = "comp"; o.width = it.width; o.height = it.height;
            o.frameRate = it.frameRate; o.duration = it.duration; o.bgColor = it.bgColor;
            o.layers = [];
            for (var i = 1; i <= it.numLayers; i++) o.layers.push(dumpLayer(it.layer(i)));
        } else if (it instanceof FolderItem) {
            o.type = "folder";
        } else if (it instanceof FootageItem) {
            o.type = "footage"; o.width = it.width; o.height = it.height; o.duration = it.duration;
            try { if (it.file) o.file = it.file.fsName; } catch (e) {}
        } else { o.type = "unknown"; }
        return o;
    }

    var out = { exportedAt: new Date().toString(), aeVersion: app.version };
    var proj = app.project;
    out.project = { file: proj.file ? proj.file.fsName : null, numItems: proj.numItems };
    out.activeComp = (proj.activeItem instanceof CompItem) ? proj.activeItem.name : null;
    if (proj.activeItem instanceof CompItem) {
        var sel = [];
        for (var s = 0; s < proj.activeItem.selectedLayers.length; s++) sel.push(proj.activeItem.selectedLayers[s].index);
        out.selectedLayers = sel;
    }
    out.items = [];
    for (var i = 1; i <= proj.numItems; i++) out.items.push(dumpItem(proj.item(i)));

    var path = $.global.AE_BRIDGE_OUT || (Folder.desktop.fsName + "/ae-state.json");
    var f = new File(path);
    f.encoding = "UTF-8";
    f.open("w");
    f.write(ser(out));
    f.close();
    if (!$.global.AE_BRIDGE_OUT) alert("Estado exportado a:\n" + path);
})();
