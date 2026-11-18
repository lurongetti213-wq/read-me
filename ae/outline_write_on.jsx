// Escritura del TRAZADO del logo con chispa: una linea fina dibuja solo el contorno,
// una estela brillante (SPARK) viaja en la punta y, al terminar, el logo original aparece con un fade.
// No usa mascaras (sin cortes raros) y no depende de como esten armados los rellenos.
// Se puede volver a ejecutar (limpia lo anterior).  Uso: Archivo > Scripts > Ejecutar archivo de script...
(function () {
    // ---------- AJUSTES ----------
    var COMP_NAME   = "Comp 1_LINE"; // null = composicion activa
    var LAYER_NAME  = "Capa 1";
    var DRAW_START  = 0.3;   // s: empieza a dibujarse el trazado
    var DRAW_TIME   = 2.0;   // s: lo que tarda cada contorno en dibujarse
    var STAGGER     = 0.10;  // s: retraso entre contornos (cascada)
    var LINE_W      = 3;     // px: grosor de la linea fina del trazado
    var LINE_COLOR  = [1, 0.97, 0.92];
    var SPARK_W     = 9;     // px: grosor de la chispa
    var TRAIL       = 0.16;  // s: largo de la estela de la chispa
    var SPARK_COLOR = [1, 0.93, 0.80];
    var GLOW_RADIUS = 90;
    var GLOW_INT    = 5;
    var FILL_LEAD   = 0.5;   // s antes de terminar el trazado empieza a aparecer el logo
    var FILL_FADE   = 0.9;   // s: duracion del fade del logo
    var EASE_OUT    = 45;    // influencia al arrancar
    var EASE_IN     = 70;    // influencia al frenar
    // -----------------------------

    var PATHS = { "ADBE Vector Shape - Group": 1, "ADBE Vector Shape - Rect": 1, "ADBE Vector Shape - Ellipse": 1, "ADBE Vector Shape - Star": 1 };
    var STRIP = { "ADBE Vector Graphic - Fill": 1, "ADBE Vector Graphic - Stroke": 1, "ADBE Vector Graphic - G-Fill": 1, "ADBE Vector Graphic - G-Stroke": 1, "ADBE Vector Filter - Trim": 1 };
    var OUTLINE_NAME = "OUTLINE", SPARK_NAME = "SPARK", OLD_MATTE = "REVEAL MATTE";

    function findComp(name) {
        if (!name) return (app.project.activeItem instanceof CompItem) ? app.project.activeItem : null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }
    function collectUnits(vecs, out) {
        var hasPath = false;
        for (var i = 1; i <= vecs.numProperties; i++) {
            var p = vecs.property(i);
            if (PATHS[p.matchName]) hasPath = true;
            else if (p.matchName === "ADBE Vector Group") collectUnits(p.property("ADBE Vectors Group"), out);
        }
        if (hasPath) out.push(vecs);
    }
    function lastPathIndex(vecs) {
        var idx = 0;
        for (var i = 1; i <= vecs.numProperties; i++) if (PATHS[vecs.property(i).matchName]) idx = i;
        return idx;
    }
    function ease(prop, outInf, inInf) {
        var lo = new KeyframeEase(0, 0.1);
        prop.setTemporalEaseAtKey(1, [lo], [new KeyframeEase(0, outInf)]);
        prop.setTemporalEaseAtKey(2, [new KeyframeEase(0, inInf)], [lo]);
    }
    // Deja cada contenedor solo con sus formas + un trazo propio + trim animado
    function toTrace(lyr, color, width, cap, isSpark) {
        var units = [];
        collectUnits(lyr.property("ADBE Root Vectors Group"), units);
        for (var u = 0; u < units.length; u++) {
            var vecs = units[u];
            for (var i = vecs.numProperties; i >= 1; i--) if (STRIP[vecs.property(i).matchName]) vecs.property(i).remove();
            var st = vecs.addProperty("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(color);
            st.property("ADBE Vector Stroke Width").setValue(width);
            st.property("ADBE Vector Stroke Line Cap").setValue(cap);
            st.property("ADBE Vector Stroke Line Join").setValue(2);
            var trim = vecs.addProperty("ADBE Vector Filter - Trim");
            trim.moveTo(lastPathIndex(vecs) + 1);
            trim = vecs.property("ADBE Vector Filter - Trim"); // moveTo invalida la referencia
            var t0 = DRAW_START + u * STAGGER, t1 = t0 + DRAW_TIME;
            var e = trim.property("ADBE Vector Trim End");
            e.setValueAtTime(t0, 0);
            e.setValueAtTime(t1, 100);
            ease(e, EASE_OUT, EASE_IN);
            if (isSpark) {
                // estela: el inicio del tramo sigue a la cabeza con un retraso fijo; al llegar se apaga en su cabeza
                var s = trim.property("ADBE Vector Trim Start");
                s.setValueAtTime(t0 + TRAIL, 0);
                s.setValueAtTime(t1 + TRAIL, 100);
                ease(s, EASE_OUT, EASE_IN);
            }
        }
        return units.length;
    }

    var comp = findComp(COMP_NAME);
    if (!comp) { alert("No encontre la composicion: " + COMP_NAME); return; }
    var layer = comp.layer(LAYER_NAME);
    if (!layer || !(layer instanceof ShapeLayer)) { alert("'" + LAYER_NAME + "' no es una capa de forma."); return; }

    app.beginUndoGroup("Escritura del trazado con chispa");
    var nUnits = 0, aeVer = app.version;
    try {
        // limpiar ejecuciones anteriores (incluida la version con mascara)
        for (var li = comp.numLayers; li >= 1; li--) {
            var nm = comp.layer(li).name;
            if (nm === OUTLINE_NAME || nm === SPARK_NAME || nm === OLD_MATTE) comp.layer(li).remove();
        }
        layer = comp.layer(LAYER_NAME);
        try { layer.trackMatteType = TrackMatteType.NO_TRACK_MATTE; } catch (e0) {}
        var lop = layer.property("ADBE Transform Group").property("ADBE Opacity");
        while (lop.numKeys > 0) lop.removeKey(1);
        lop.setValue(100);

        // 1) capa SPARK (duplicado del original)
        var spark = layer.duplicate();
        spark.name = SPARK_NAME;
        spark = comp.layer(SPARK_NAME);
        nUnits = toTrace(spark, SPARK_COLOR, SPARK_W, 1, true); // cap plano: sin punto a longitud cero
        var tDrawEnd = DRAW_START + (nUnits - 1) * STAGGER + DRAW_TIME; // termina el ultimo contorno
        var sop = spark.property("ADBE Transform Group").property("ADBE Opacity");
        sop.setValueAtTime(0, 0);
        sop.setValueAtTime(DRAW_START, 0);
        sop.setValueAtTime(DRAW_START + 0.05, 100);
        sop.setValueAtTime(tDrawEnd + TRAIL, 100);
        sop.setValueAtTime(tDrawEnd + TRAIL + 0.15, 0);
        spark.blendingMode = BlendingMode.ADD;
        try {
            var gl = spark.property("ADBE Effect Parade").addProperty("ADBE Glo2");
            gl.property("ADBE Glo2-0002").setValue(10);          // Threshold
            gl.property("ADBE Glo2-0003").setValue(GLOW_RADIUS); // Radius
            gl.property("ADBE Glo2-0004").setValue(GLOW_INT);    // Intensity
        } catch (eg) {}

        // 2) capa OUTLINE: linea fina que dibuja solo el trazado
        layer = comp.layer(LAYER_NAME);
        var line = layer.duplicate();
        line.name = OUTLINE_NAME;
        line = comp.layer(OUTLINE_NAME);
        toTrace(line, LINE_COLOR, LINE_W, 2, false);
        var tFill = tDrawEnd - FILL_LEAD;
        var oop = line.property("ADBE Transform Group").property("ADBE Opacity");
        oop.setValueAtTime(tFill, 100);
        oop.setValueAtTime(tFill + FILL_FADE, 0); // la linea se funde cuando entra el logo

        // 3) el logo original aparece con un fade cuando el trazado esta casi completo
        layer = comp.layer(LAYER_NAME);
        lop = layer.property("ADBE Transform Group").property("ADBE Opacity");
        lop.setValueAtTime(tFill, 0);
        lop.setValueAtTime(tFill + FILL_FADE, 100);
        ease(lop, 40, 70);

        // 4) orden: SPARK arriba, luego OUTLINE, luego el logo original
        layer = comp.layer(LAYER_NAME);
        line.moveBefore(layer);
        spark = comp.layer(SPARK_NAME);
        spark.moveToBeginning();
    } finally {
        app.endUndoGroup();
    }
    alert("Listo en '" + comp.name + "' (AE " + aeVer + ").\nContornos con formas: " + nUnits + "\nCapas nuevas: " + SPARK_NAME + " y " + OUTLINE_NAME);
})();
