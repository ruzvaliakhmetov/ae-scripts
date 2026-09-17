(function canvasSizeWithAnchor() {
    if (!app.project || !(app.project.activeItem instanceof CompItem)) {
        alert("Open or select a composition first.");
        return;
    }

    var comp = app.project.activeItem;
    var oldW = comp.width;
    var oldH = comp.height;

    // ------------------------------------------------------------
    // UI
    // ------------------------------------------------------------

    var win = new Window("dialog", "Canvas Size");
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = 12;
    win.margins = 16;

    var currentText = win.add(
        "statictext",
        undefined,
        "Current Size: " + oldW + " × " + oldH + " px"
    );

    var sizePanel = win.add("panel", undefined, "New Size");
    sizePanel.orientation = "column";
    sizePanel.alignChildren = ["fill", "top"];
    sizePanel.margins = 12;

    var widthGroup = sizePanel.add("group");
    widthGroup.orientation = "row";
    widthGroup.add("statictext", undefined, "Width");
    var widthEdit = widthGroup.add("edittext", undefined, String(oldW));
    widthEdit.characters = 9;
    widthGroup.add("statictext", undefined, "px");

    var heightGroup = sizePanel.add("group");
    heightGroup.orientation = "row";
    heightGroup.add("statictext", undefined, "Height");
    var heightEdit = heightGroup.add("edittext", undefined, String(oldH));
    heightEdit.characters = 9;
    heightGroup.add("statictext", undefined, "px");

    var relativeCheck = sizePanel.add(
        "checkbox",
        undefined,
        "Relative to current dimensions"
    );
    relativeCheck.value = false;

    relativeCheck.onClick = function () {
        if (relativeCheck.value) {
            widthEdit.text = "0";
            heightEdit.text = "0";
        } else {
            widthEdit.text = String(oldW);
            heightEdit.text = String(oldH);
        }
    };

    var anchorPanel = win.add("panel", undefined, "Anchor");
    anchorPanel.orientation = "column";
    anchorPanel.alignChildren = ["center", "top"];
    anchorPanel.margins = 12;

    var anchors = [
        { name: "Top Left",     x: 0.0, y: 0.0, symbol: "↖" },
        { name: "Top",          x: 0.5, y: 0.0, symbol: "↑" },
        { name: "Top Right",    x: 1.0, y: 0.0, symbol: "↗" },
        { name: "Left",         x: 0.0, y: 0.5, symbol: "←" },
        { name: "Center",       x: 0.5, y: 0.5, symbol: "•" },
        { name: "Right",        x: 1.0, y: 0.5, symbol: "→" },
        { name: "Bottom Left",  x: 0.0, y: 1.0, symbol: "↙" },
        { name: "Bottom",       x: 0.5, y: 1.0, symbol: "↓" },
        { name: "Bottom Right", x: 1.0, y: 1.0, symbol: "↘" }
    ];

    var anchorButtons = [];
    var selectedAnchor = 4; // Center

    function makeAnchorRow(indices) {
        var row = anchorPanel.add("group");
        row.orientation = "row";
        row.spacing = 5;

        for (var i = 0; i < indices.length; i++) {
            var idx = indices[i];
            var b = row.add("button", undefined, anchors[idx].symbol);
            b.preferredSize = [46, 34];
            b.anchorIndex = idx;

            b.onClick = function () {
                selectedAnchor = this.anchorIndex;
                updateAnchorUI();
            };

            anchorButtons[idx] = b;
        }
    }

    makeAnchorRow([0, 1, 2]);
    makeAnchorRow([3, 4, 5]);
    makeAnchorRow([6, 7, 8]);

    var anchorLabel = anchorPanel.add(
        "statictext",
        undefined,
        "Anchor: Center"
    );

    function updateAnchorUI() {
        for (var i = 0; i < anchorButtons.length; i++) {
            if (anchorButtons[i]) {
                // The selected button is disabled to give it a pressed/selected look.
                anchorButtons[i].enabled = (i !== selectedAnchor);
            }
        }

        anchorLabel.text = "Anchor: " + anchors[selectedAnchor].name;
    }

    updateAnchorUI();

    var buttons = win.add("group");
    buttons.orientation = "row";
    buttons.alignment = "right";

    var cancelButton = buttons.add("button", undefined, "Cancel", { name: "cancel" });
    var okButton = buttons.add("button", undefined, "OK", { name: "ok" });

    var resultW = oldW;
    var resultH = oldH;

    okButton.onClick = function () {
        var w = parseFloat(widthEdit.text);
        var h = parseFloat(heightEdit.text);

        if (isNaN(w) || isNaN(h)) {
            alert("Width and height must be numbers.");
            return;
        }

        if (relativeCheck.value) {
            resultW = oldW + w;
            resultH = oldH + h;
        } else {
            resultW = w;
            resultH = h;
        }

        resultW = Math.round(resultW);
        resultH = Math.round(resultH);

        // After Effects composition dimensions must be positive integers.
        if (resultW < 1 || resultH < 1) {
            alert("The resulting width and height must be at least 1 px.");
            return;
        }

        win.close(1);
    };

    cancelButton.onClick = function () {
        win.close(0);
    };

    win.center();

    if (win.show() !== 1) {
        return;
    }

    // ------------------------------------------------------------
    // Position shifting helpers
    // ------------------------------------------------------------

    function shiftScalarProperty(prop, delta, sampleTime) {
        if (!prop || Math.abs(delta) < 0.000001) {
            return;
        }

        if (prop.numKeys > 0) {
            for (var k = 1; k <= prop.numKeys; k++) {
                prop.setValueAtKey(k, prop.keyValue(k) + delta);
            }
        } else {
            // true = pre-expression value, so expressions are not baked.
            var v = prop.valueAtTime(sampleTime, true);
            prop.setValue(v + delta);
        }
    }

    function shiftPositionProperty(pos, dx, dy, sampleTime) {
        if (!pos) {
            return;
        }

        if (pos.dimensionsSeparated) {
            shiftScalarProperty(pos.getSeparationFollower(0), dx, sampleTime);
            shiftScalarProperty(pos.getSeparationFollower(1), dy, sampleTime);
            return;
        }

        if (pos.numKeys > 0) {
            for (var k = 1; k <= pos.numKeys; k++) {
                var kv = pos.keyValue(k);
                kv[0] += dx;
                kv[1] += dy;
                pos.setValueAtKey(k, kv);
            }
        } else {
            // true = pre-expression value, so expressions are not baked.
            var v = pos.valueAtTime(sampleTime, true);
            v[0] += dx;
            v[1] += dy;
            pos.setValue(v);
        }
    }

    function shiftTopLevelLayers(targetComp, dx, dy) {
        var expressionCount = 0;

        for (var i = 1; i <= targetComp.numLayers; i++) {
            var layer = targetComp.layer(i);

            // Children move together with their parent.
            // Moving them too would apply the offset twice.
            if (layer.parent !== null) {
                continue;
            }

            var transform = layer.property("ADBE Transform Group");
            if (!transform) {
                continue;
            }

            var pos = transform.property("ADBE Position");
            if (!pos) {
                continue;
            }

            if (pos.expressionEnabled) {
                expressionCount++;
            }

            var wasLocked = layer.locked;

            try {
                if (wasLocked) {
                    layer.locked = false;
                }

                shiftPositionProperty(pos, dx, dy, targetComp.time);
            } catch (err) {
                // Leave unusual/non-editable layers untouched rather than aborting
                // the whole canvas resize.
            }

            try {
                if (wasLocked) {
                    layer.locked = true;
                }
            } catch (restoreErr) {}
        }

        return expressionCount;
    }

    // ------------------------------------------------------------
    // Resize
    // ------------------------------------------------------------

    var anchor = anchors[selectedAnchor];

    /*
        Photoshop-style canvas anchor:

        LEFT / TOP       => content offset 0
        CENTER           => half of the size difference
        RIGHT / BOTTOM   => full size difference

        Example:
        1920 -> 1080, right anchor:
        dx = 1080 - 1920 = -840
    */
    var dx = (resultW - oldW) * anchor.x;
    var dy = (resultH - oldH) * anchor.y;

    app.beginUndoGroup("Canvas Size");

    // Shift while the comp still has its original dimensions. This makes
    // pre-expression sampling more predictable for expressions that refer
    // to thisComp.width / thisComp.height.
    var expressionCount = shiftTopLevelLayers(comp, dx, dy);

    comp.width = resultW;
    comp.height = resultH;

    app.endUndoGroup();

    var message =
        "Canvas resized:\n" +
        oldW + " × " + oldH + "  →  " +
        resultW + " × " + resultH + "\n\n" +
        "Anchor: " + anchor.name;

    if (expressionCount > 0) {
        message +=
            "\n\nNote: " + expressionCount +
            " top-level layer(s) have Position expressions. " +
            "If an expression completely ignores the property's own value, " +
            "that layer may need manual adjustment.";
    }

    alert(message);
})();
