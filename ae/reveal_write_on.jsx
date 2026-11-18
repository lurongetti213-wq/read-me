// Escritura de logo con chispa: un trazo grueso recorre los contornos y sirve de MASCARA (track matte alfa)
// que revela la capa original sin tocarla; otra capa lleva la chispa brillante en la punta.
// No depende de como esten armados los rellenos del logo. Se puede volver a ejecutar (limpia lo anterior).
// Uso: Archivo > Scripts > Ejecutar archivo de script...   (Ctrl/Cmd+Z deshace todo)
(function () {
    // ---------- AJUSTES ----------
    var COMP_NAME   = "Comp 1_REVEAL"; // null = composicion activa
    var LAYER_NAME  = "Capa 1";
    var DRAW_START  = 0.3;   // s: empieza a escribirse
    var DRAW_TIME   = 2.0;   // s: lo que tarda cada contorno en escribirse
    var STAGGER     = 0.10;  // s: retraso entre contornos (cascada)
    var TARGET_END  = 100;   // % del contorno que recorre la escritura
    var MATTE_W     = 80;    // px: grosor de la mascara (debe cubrir el ancho del trazo del logo)
    var SPARK_W     = 11;    // px: grosor de la chispa
    var TRAIL       = 0.16;  // s: cuanto se retrasa la cola de la chispa respecto a su cabeza (largo de la estela)
    var SPARK_COLOR = [1, 0.93, 0.80]; // blanco calido
    var GLOW_RADIUS = 90;    // brillo de la chispa
    var GLOW_INT    = 5;
    var EASE_OUT    = 45;    // influencia al arrancar
    var EASE_IN     = 70;    // influencia al frenar
    // -----------------------------

    var PATHS = { "ADBE Vector Shape - Group": 1, "ADBE Vector Shape - Rect": 1, "ADBE Vector Shape - Ellipse": 1, "ADBE Vector Shape - Star": 1 };
    var STRIP = { "ADBE Vector Graphic - Fill": 1, "ADBE Vector Graphic - Stroke": 1, "ADBE Vector Graphic - G-Fill": 1, "ADBE Vector Graphic - G-Stroke": 1, "ADBE Vector Filter - Trim": 1 };
    var MATTE_NAME = "REVEAL MATTE", SPARK_NAME = "SPARK";

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
    function ease(prop) {
        var lo = new KeyframeEase(0, 0.1);
        prop.setTemporalEaseAtKey(1, [lo], [new KeyframeEase(0, EASE_OUT)]);
        prop.setTemporalEaseAtKey(2, [new KeyframeEase(0, EASE_IN)], [lo]);
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
            e.setValueAtTime(t1, TARGET_END);
            ease(e);
            if (isSpark) {
                // estela: el inicio del tramo sigue a la cabeza con un retraso fijo (TRAIL); al llegar se apaga en su cabeza
                var s = trim.property("ADBE Vector Trim Start");
                s.setValueAtTime(t0 + TRAIL, 0);
                s.setValueAtTime(t1 + TRAIL, TARGET_END);
                ease(s);
            }
        }
        return units.length;
    }

    var comp = findComp(COMP_NAME);
    if (!comp) { alert("No encontre la composicion: " + COMP_NAME); return; }
    var layer = comp.layer(LAYER_NAME);
    if (!layer || !(layer instanceof ShapeLayer)) { alert("'" + LAYER_NAME + "' no es una capa de forma."); return; }

    app.beginUndoGroup("Escritura con mascara y chispa");
    var nUnits = 0, aeVer = app.version;
    try {
        // limpiar ejecuciones anteriores
        for (var li = comp.numLayers; li >= 1; li--) {
            var nm = comp.layer(li).name;
            if (nm === MATTE_NAME || nm === SPARK_NAME) comp.layer(li).remove();
        }
        layer = comp.layer(LAYER_NAME);
        try { layer.trackMatteType = TrackMatteType.NO_TRACK_MATTE; } catch (e0) {}

        // 1) capa de chispa (duplicado del original)
        var spark = layer.duplicate();
        spark.name = SPARK_NAME;
        spark = comp.layer(SPARK_NAME);
        nUnits = toTrace(spark, SPARK_COLOR, SPARK_W, 1, true); // cap plano: sin punto a longitud cero
        var tEnd = DRAW_START + (nUnits - 1) * STAGGER + DRAW_TIME + TRAIL + 0.1; // despues del ultimo contorno
        var op = spark.property("ADBE Transform Group").property("ADBE Opacity");
        op.setValueAtTime(0, 0);
        op.setValueAtTime(DRAW_START, 0);
        op.setValueAtTime(DRAW_START + 0.05, 100);
        op.setValueAtTime(tEnd, 100);
        op.setValueAtTime(tEnd + 0.35, 0);
        spark.blendingMode = BlendingMode.ADD;
        try { // brillo (Glow) de la chispa; si falla, se puede anadir a mano
            var gl = spark.property("ADBE Effect Parade").addProperty("ADBE Glo2");
            gl.property("ADBE Glo2-0002").setValue(10);          // Threshold
            gl.property("ADBE Glo2-0003").setValue(GLOW_RADIUS); // Radius
            gl.property("ADBE Glo2-0004").setValue(GLOW_INT);    // Intensity
        } catch (eg) {}

        // 2) capa mascara (duplicado del original)
        layer = comp.layer(LAYER_NAME);
        var matte = layer.duplicate();
        matte.name = MATTE_NAME;
        matte = comp.layer(MATTE_NAME);
        toTrace(matte, [1, 1, 1], MATTE_W, 1, false);

        // 3) orden: SPARK arriba, luego MATTE, luego la capa original; la mascara revela la original
        layer = comp.layer(LAYER_NAME);
        matte.moveBefore(layer);
        matte = comp.layer(MATTE_NAME);
        layer = comp.layer(LAYER_NAME);
        if (typeof layer.setTrackMatte === "function") {
            layer.setTrackMatte(matte, TrackMatteType.ALPHA);
        } else {
            layer.trackMatteType = TrackMatteType.ALPHA; // AE antiguo: la mascara debe estar justo encima
        }
        try { matte.enabled = false; } catch (e1) {}
        spark = comp.layer(SPARK_NAME);
        spark.moveToBeginning();
    } finally {
        app.endUndoGroup();
    }
    alert("Listo en '" + comp.name + "' (AE " + aeVer + ").\nContornos con formas: " + nUnits + "\nCapas nuevas: " + SPARK_NAME + " y " + MATTE_NAME);
})();
