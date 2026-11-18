// Trim Path fino y fluido para una capa de forma (shape layer).
// Dibuja el trazo (End 0 -> 100), opcionalmente aparece el relleno, mantiene y lo "borra" (Start 0 -> 100).
// Uso: abre la composicion, Archivo > Scripts > Ejecutar archivo de script... y elige este archivo.
// Todo queda en un solo grupo de deshacer (Ctrl/Cmd+Z lo revierte).
(function () {
    // ---------- AJUSTES ----------
    var COMP_NAME   = "Comp 1_TRIM";  // composicion a modificar (null = la activa)
    var LAYER_NAME  = "Capa 1";       // capa de forma
    var DRAW_START  = 0.3;            // s: empieza a dibujarse
    var DRAW_TIME   = 1.6;            // s: duracion del dibujo
    var STAGGER     = 0.08;           // s: retraso entre grupos de forma (efecto en cascada)
    var EXIT        = true;           // borrar el trazo al final
    var EXIT_START  = 14.6;           // s: empieza a borrarse
    var EXIT_TIME   = 1.2;            // s: duracion del borrado
    var STROKE_W    = 3;              // px: grosor fino (null = no tocar el grosor)
    var FILL_FADE   = true;           // el relleno aparece al terminar de dibujarse
    var FILL_TIME   = 0.7;            // s: duracion del fade del relleno
    var EASE_OUT    = 75;             // influencia de salida (suavidad al arrancar)
    var EASE_IN     = 88;             // influencia de llegada (suavidad al frenar)
    // -----------------------------

    function findComp(name) {
        if (!name) return (app.project.activeItem instanceof CompItem) ? app.project.activeItem : null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }
    function collectGroups(propGroup, out) {
        for (var i = 1; i <= propGroup.numProperties; i++) {
            var p = propGroup.property(i);
            if (p.matchName === "ADBE Vector Group") {
                out.push(p);
                collectGroups(p.property("ADBE Vectors Group"), out);
            }
        }
    }
    function easeKeys(prop, outInf, inInf) {
        var lo = new KeyframeEase(0, 0.1);
        prop.setTemporalEaseAtKey(1, [lo], [new KeyframeEase(0, outInf)]);
        prop.setTemporalEaseAtKey(2, [new KeyframeEase(0, inInf)], [lo]);
    }

    var comp = findComp(COMP_NAME);
    if (!comp) { alert("No encontre la composicion: " + COMP_NAME); return; }
    var layer = comp.layer(LAYER_NAME);
    if (!layer || !(layer instanceof ShapeLayer)) { alert("'" + LAYER_NAME + "' no es una capa de forma (shape layer)."); return; }

    var groups = [];
    collectGroups(layer.property("ADBE Root Vectors Group"), groups);
    // Solo grupos que tengan trazo o relleno (ignora grupos contenedores vacios)
    var targets = [];
    for (var g = 0; g < groups.length; g++) {
        var c = groups[g].property("ADBE Vectors Group");
        if (c.property("ADBE Vector Graphic - Stroke") || c.property("ADBE Vector Graphic - Fill")) targets.push(groups[g]);
    }
    if (!targets.length) { alert("La capa no tiene trazos ni rellenos."); return; }

    app.beginUndoGroup("Trim Path fino");
    try {
        for (var t = 0; t < targets.length; t++) {
            var contents = targets[t].property("ADBE Vectors Group");
            var t0 = DRAW_START + t * STAGGER;

            var trim = contents.property("ADBE Vector Filter - Trim");
            if (!trim) trim = contents.addProperty("ADBE Vector Filter - Trim");
            var s = trim.property("ADBE Vector Trim Start");
            var e = trim.property("ADBE Vector Trim End");
            while (e.numKeys > 0) e.removeKey(1);
            while (s.numKeys > 0) s.removeKey(1);
            s.setValue(0); e.setValue(0);

            e.setValueAtTime(t0, 0);
            e.setValueAtTime(t0 + DRAW_TIME, 100);
            easeKeys(e, EASE_OUT, EASE_IN);

            if (EXIT) {
                var x0 = EXIT_START + t * STAGGER;
                s.setValueAtTime(x0, 0);
                s.setValueAtTime(x0 + EXIT_TIME, 100);
                easeKeys(s, EASE_OUT, EASE_IN);
            }

            var stroke = contents.property("ADBE Vector Graphic - Stroke");
            if (stroke) {
                if (STROKE_W !== null) stroke.property("ADBE Vector Stroke Width").setValue(STROKE_W);
                stroke.property("ADBE Vector Stroke Line Cap").setValue(2);  // redondeado
                stroke.property("ADBE Vector Stroke Line Join").setValue(2); // redondeado
            }
            var fill = contents.property("ADBE Vector Graphic - Fill");
            if (fill && FILL_FADE) {
                var fo = fill.property("ADBE Vector Fill Opacity");
                while (fo.numKeys > 0) fo.removeKey(1);
                fo.setValueAtTime(t0 + DRAW_TIME * 0.7, 0);
                fo.setValueAtTime(t0 + DRAW_TIME * 0.7 + FILL_TIME, 100);
                easeKeys(fo, 60, 70);
                if (EXIT) {
                    var xf = EXIT_START + t * STAGGER;
                    fo.setValueAtTime(xf, 100);
                    fo.setValueAtTime(xf + EXIT_TIME * 0.5, 0);
                }
            }
        }
        layer.motionBlur = true;
        comp.motionBlur = true;
    } finally {
        app.endUndoGroup();
    }
    alert("Listo: trim path aplicado a " + targets.length + " grupo(s) de '" + LAYER_NAME + "' en '" + comp.name + "'.");
})();
