// Escritura del logo con chispa de luz en la punta (estilo "write-on" de lujo).
// 1) El trazo se dibuja con Trim Paths (suave, sin lineal).
// 2) Una segunda capa "<capa> SPARK" lleva un tramo corto y brillante que viaja en la punta del trazo.
// 3) El relleno aparece suavemente cuando termina el dibujo.
// Funciona con formas sueltas en la raiz o dentro de grupos. Se puede volver a ejecutar (limpia lo anterior).
// Uso: abre la composicion y ejecuta: Archivo > Scripts > Ejecutar archivo de script...  (Ctrl/Cmd+Z deshace todo)
(function () {
    // ---------- AJUSTES ----------
    var COMP_NAME   = "Comp 1_SPARK"; // null = composicion activa
    var LAYER_NAME  = "Capa 1";
    var DRAW_START  = 0.3;   // s: empieza a escribirse
    var DRAW_TIME   = 1.8;   // s: duracion de la escritura
    var INK_W       = 2.5;   // px: grosor del trazo que "escribe" (fino)
    var SPARK_W     = 5;     // px: grosor de la chispa
    var SPARK_LEN   = 5;     // % del trazo que mide la chispa
    var SPARK_COLOR = [1, 0.93, 0.80]; // blanco calido
    var FILL_FADE   = 0.7;   // s: fade del relleno al terminar
    var EASE_OUT    = 45;    // influencia al arrancar
    var EASE_IN     = 70;    // influencia al frenar
    // -----------------------------

    var PATHS = { "ADBE Vector Shape - Group": 1, "ADBE Vector Shape - Rect": 1, "ADBE Vector Shape - Ellipse": 1, "ADBE Vector Shape - Star": 1 };

    function findComp(name) {
        if (!name) return (app.project.activeItem instanceof CompItem) ? app.project.activeItem : null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }
    // Devuelve todos los contenedores (raiz o grupos) que tienen formas (paths)
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
    function clearTrim(vecs) {
        for (var i = vecs.numProperties; i >= 1; i--) {
            var p = vecs.property(i);
            if (p.matchName === "ADBE Vector Filter - Trim") p.remove();
            else if (p.name === "SPARK_INK") p.remove();
        }
    }
    function addTrim(vecs) {
        var trim = vecs.addProperty("ADBE Vector Filter - Trim");
        trim.moveTo(lastPathIndex(vecs) + 1); // justo debajo de las formas, antes del trazo/relleno
        return vecs.property("ADBE Vector Filter - Trim"); // moveTo invalida la referencia: se vuelve a buscar
    }
    function ease(prop, outInf, inInf, n) {
        var lo = new KeyframeEase(0, 0.1);
        prop.setTemporalEaseAtKey(1, [lo], [new KeyframeEase(0, outInf)]);
        prop.setTemporalEaseAtKey(n || 2, [new KeyframeEase(0, inInf)], [lo]);
    }

    var comp = findComp(COMP_NAME);
    if (!comp) { alert("No encontre la composicion: " + COMP_NAME); return; }
    var layer = comp.layer(LAYER_NAME);
    if (!layer || !(layer instanceof ShapeLayer)) { alert("'" + LAYER_NAME + "' no es una capa de forma."); return; }

    app.beginUndoGroup("Escritura con chispa");
    try {
        // limpiar ejecuciones anteriores
        var sparkName = LAYER_NAME + " SPARK";
        for (var li = comp.numLayers; li >= 1; li--) if (comp.layer(li).name === sparkName) comp.layer(li).remove();

        var root = layer.property("ADBE Root Vectors Group");
        var units = [];
        collectUnits(root, units);
        if (!units.length) { alert("No encontre formas (paths) en '" + LAYER_NAME + "'."); return; }
        for (var c = 0; c < units.length; c++) clearTrim(units[c]);

        var tEnd = DRAW_START + DRAW_TIME;
        var info = [];
        // ---- capa principal: el trazo se escribe y el relleno aparece despues ----
        for (var u = 0; u < units.length; u++) {
            var vecs = units[u];
            var stroke = vecs.property("ADBE Vector Graphic - Stroke");
            var fill = vecs.property("ADBE Vector Graphic - Fill");
            var created = false;
            if (!stroke) {
                stroke = vecs.addProperty("ADBE Vector Graphic - Stroke");
                stroke.name = "SPARK_INK";
                var col = fill ? fill.property("ADBE Vector Fill Color").value : [1, 1, 1];
                stroke.property("ADBE Vector Stroke Color").setValue(col);
                stroke.property("ADBE Vector Stroke Width").setValue(INK_W);
                stroke.property("ADBE Vector Stroke Line Cap").setValue(2);
                stroke.property("ADBE Vector Stroke Line Join").setValue(2);
                created = true;
            }
            var trim = addTrim(vecs);
            fill = vecs.property("ADBE Vector Graphic - Fill"); // el indice cambio al mover el trim
            var e = trim.property("ADBE Vector Trim End");
            e.setValueAtTime(DRAW_START, 0);
            e.setValueAtTime(tEnd, 100);
            ease(e, EASE_OUT, EASE_IN);
            if (fill) {
                var fo = fill.property("ADBE Vector Fill Opacity");
                while (fo.numKeys > 0) fo.removeKey(1);
                fo.setValueAtTime(DRAW_START + DRAW_TIME * 0.75, 0);
                fo.setValueAtTime(tEnd + FILL_FADE, 100);
                ease(fo, 55, 70);
            }
            info.push((vecs.parentProperty ? vecs.parentProperty.name : "raiz") + (fill ? " [relleno]" : "") + (created ? " [trazo creado]" : " [trazo propio]"));
        }

        // ---- capa de chispa: duplicado con solo un tramo corto y brillante ----
        var spark = layer.duplicate();
        spark.name = sparkName;
        spark.moveBefore(layer);
        spark = comp.layer(sparkName); // referencia fresca tras mover la capa
        var sroot = spark.property("ADBE Root Vectors Group");
        var sunits = [];
        collectUnits(sroot, sunits);
        for (var s = 0; s < sunits.length; s++) {
            var sv = sunits[s];
            var sfill = sv.property("ADBE Vector Graphic - Fill");
            if (sfill) sfill.remove();
            var sst = sv.property("ADBE Vector Graphic - Stroke");
            if (!sst) sst = sv.addProperty("ADBE Vector Graphic - Stroke");
            sst.property("ADBE Vector Stroke Color").setValue(SPARK_COLOR);
            sst.property("ADBE Vector Stroke Width").setValue(SPARK_W);
            sst.property("ADBE Vector Stroke Line Cap").setValue(1); // plano: no deja punto con longitud cero
            var st = sv.property("ADBE Vector Filter - Trim");
            if (st) {
                st.property("ADBE Vector Trim Start").expression =
                    'Math.max(0, thisProperty.propertyGroup(1).property("ADBE Vector Trim End") - ' + SPARK_LEN + ');';
            }
        }
        var op = spark.property("ADBE Transform Group").property("ADBE Opacity");
        op.setValueAtTime(0, 0);
        op.setValueAtTime(DRAW_START, 0);
        op.setValueAtTime(DRAW_START + 0.05, 100);
        op.setValueAtTime(tEnd, 100);
        op.setValueAtTime(tEnd + 0.35, 0);
        spark.blendingMode = BlendingMode.ADD;
    } finally {
        app.endUndoGroup();
    }
    alert("Listo en '" + comp.name + "'.\nUnidades con formas: " + units.length + "\n" + info.join("\n"));
})();
