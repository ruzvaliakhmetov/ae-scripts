/*
 Two-Row Image Grid With Captions v2 — After Effects ExtendScript

 Select 1–20 unparented, 2D still-image footage layers in the timeline.
 Run via File > Scripts > Run Script File...

 A new precomposition is created, with one image per cell: two rows for
 2–20 images, a single centered image for 1. Images retain proportions.
 Each image gets a caption based on its original footage filename: the final
 extension is removed, and underscores become spaces.

 Captions: black, 28 pt, center justified, Auto Leading, Metrics Kerning,
 Tracking 0, and text-layer Scale 100%. No automatic wrapping or shrinking.
 Long captions may overlap adjacent captions intentionally.

 Existing image layer transforms/keyframes are replaced. One AE undo group.
 Requires After Effects 24.0 or newer for Metrics Kerning scripting.
*/
(function twoRowImageGridWithCaptions() {
    var SETTINGS = {
        marginX: 0.05,      // composition-width fraction
        marginY: 0.05,      // composition-height fraction
        gapX: 0.02,         // fraction of composition width
        gapY: 0.025,        // fraction of composition height, between rows
        captionGapY: 0.012, // space between image and caption
        fontSize: 28,
        textColor: [0, 0, 0],
        minCellAspect: 0.55,
        maxCellAspect: 2.4,
        name: "Two-Row Image Grid + Captions"
    };

    function fail(message) {
        alert(SETTINGS.name + "\n\n" + message);
    }
    function clamp(value, low, high) {
        return Math.max(low, Math.min(high, value));
    }
    function distribute(n, r) {
        var counts = [];
        var base = Math.floor(n / r);
        var extra = n % r;
        for (var i = 0; i < r; i++) {
            counts.push(base + (i < extra ? 1 : 0));
        }
        return counts;
    }
    function setStatic(property, value) {
        if (!property) {
            throw new Error("Missing transform property.");
        }
        while (property.numKeys > 0) {
            property.removeKey(1);
        }
        if (property.canSetExpression && property.expressionEnabled) {
            property.expressionEnabled = false;
        }
        property.setValue(value);
    }
    function fileCaption(source) {
        var filename = source.name;
        try {
            if (source.file) {
                filename = source.file.displayName || source.file.name || filename;
            }
        } catch (ignored) {
            // Offline footage may not have a usable file object.
        }
        filename = String(filename);
        filename = filename.replace(/\.[^.]+$/, "");
        return filename.replace(/_/g, " ");
    }
    function styleCaption(textLayer, value) {
        var sourceText = textLayer.property("ADBE Text Properties")
                                  .property("ADBE Text Document");
        var doc = sourceText.value;
        doc.text = value;
        doc.fontSize = SETTINGS.fontSize;
        doc.justification = ParagraphJustification.CENTER_JUSTIFY;
        doc.applyFill = true;
        doc.fillColor = SETTINGS.textColor;
        doc.applyStroke = false;
        doc.tracking = 0;
        doc.autoLeading = true;
        // Do not set doc.kerning: doing that disables automatic kerning.
        doc.autoKernType = AutoKernType.METRIC_KERN;
        sourceText.setValue(doc);
    }

    var parent = app.project.activeItem;
    if (!(parent instanceof CompItem)) {
        fail("Open a composition and select image layers in the timeline.");
        return;
    }
    var selected = parent.selectedLayers;
    var n = selected.length;
    if (n < 1) {
        fail("Select at least one image layer.");
        return;
    }
    if (n > 20) {
        fail("Too many images (" + n + "). Maximum for now: 20.");
        return;
    }
    if (typeof AutoKernType === "undefined" ||
        typeof AutoKernType.METRIC_KERN === "undefined") {
        fail("Metrics Kerning scripting requires After Effects 24.0 or later.");
        return;
    }

    var i, j, layer;
    for (i = 0; i < n; i++) {
        layer = selected[i];
        if (!(layer instanceof AVLayer) || !layer.hasVideo ||
            !(layer.source instanceof FootageItem) ||
            !layer.source.mainSource.isStill ||
            layer.threeDLayer || layer.parent !== null ||
            layer.source.width < 1 || layer.source.height < 1) {
            fail("Select only unparented, 2D still-image footage layers.\n" +
                 "Unsupported: " + layer.name);
            return;
        }
    }

    // Store top-to-bottom image order before precomposing.
    selected.sort(function (a, b) { return a.index - b.index; });
    var W = parent.width;
    var H = parent.height;
    var rows = n === 1 ? 1 : 2;
    var counts = distribute(n, rows);
    var innerW = W * (1 - 2 * SETTINGS.marginX);
    var innerH = H * (1 - 2 * SETTINGS.marginY);
    var gapX = W * SETTINGS.gapX;
    var gapY = H * SETTINGS.gapY;
    var captionGap = H * SETTINGS.captionGapY;
    if (innerW <= 0 || innerH <= 0) {
        fail("Margins leave no usable area.");
        return;
    }

    var aspects = [], captions = [];
    for (i = 0; i < n; i++) {
        aspects.push(clamp(selected[i].source.width / selected[i].source.height,
                           SETTINGS.minCellAspect, SETTINGS.maxCellAspect));
        captions.push(fileCaption(selected[i].source));
    }

    // Horizontal size constraint, shared by all rows.
    var rowAspects = [], offset = 0;
    var widthBoundH = Number.POSITIVE_INFINITY;
    var row, sum;
    for (row = 0; row < rows; row++) {
        sum = 0;
        for (j = 0; j < counts[row]; j++) {
            sum += aspects[offset + j];
        }
        rowAspects.push(sum);
        widthBoundH = Math.min(widthBoundH,
            (innerW - (counts[row] - 1) * gapX) / sum);
        offset += counts[row];
    }
    if (widthBoundH <= 0) {
        fail("Images cannot fit horizontally with the current gaps.");
        return;
    }

    app.beginUndoGroup(SETTINGS.name);
    try {
        // Move selected layers to the beginning, preserving their relative order.
        for (i = n - 1; i >= 0; i--) {
            selected[i].moveToBeginning();
        }
        var indices = [];
        for (i = 1; i <= n; i++) {
            indices.push(i);
        }
        var precomp = parent.layers.precompose(indices, SETTINGS.name, true);
        if (!precomp || precomp.numLayers !== n) {
            throw new Error("Precomposition did not contain the expected image layers.");
        }

        // Keep image layer references, because adding captions shifts indices.
        var imageLayers = [];
        for (i = 1; i <= n; i++) {
            imageLayers.push(precomp.layer(i));
        }

        var textLayers = [], textRects = [];
        var rowCaptionHeights = [], totalCaptionH = 0, k = 0;
        for (row = 0; row < rows; row++) {
            var maxTextH = 0;
            for (j = 0; j < counts[row]; j++, k++) {
                var text = precomp.layers.addText(captions[k]);
                text.name = "Caption - " + captions[k];
                styleCaption(text, captions[k]);
                var rect = text.sourceRectAtTime(0, false);
                textLayers.push(text);
                textRects.push({
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height
                });
                maxTextH = Math.max(maxTextH, rect.height);
            }
            rowCaptionHeights.push(maxTextH);
            totalCaptionH += maxTextH;
        }

        // Make room vertically for 28 pt captions WITHOUT resizing any text.
        // Overlong titles may overlap horizontally; this is intentional.
        var cellH = Math.min(widthBoundH,
            (innerH - (rows - 1) * gapY - rows * captionGap - totalCaptionH) / rows);
        if (cellH <= 0) {
            throw new Error("Not enough vertical space for images and 28 pt captions.");
        }
        var totalH = rows * (cellH + captionGap) +
                     (rows - 1) * gapY + totalCaptionH;

        // Center each row horizontally, and the whole block vertically.
        var y = (H - totalH) / 2;
        k = 0;
        for (row = 0; row < rows; row++) {
            var rowWidth = rowAspects[row] * cellH + (counts[row] - 1) * gapX;
            var x = (W - rowWidth) / 2;
            var imageCenterY = y + cellH / 2;
            var captionTop = y + cellH + captionGap;

            for (var col = 0; col < counts[row]; col++, k++) {
                layer = imageLayers[k];
                var cellW = aspects[k] * cellH;
                var centerX = x + cellW / 2;
                var sourceW = layer.source.width;
                var sourceH = layer.source.height;
                var imageScale = 100 * Math.min(cellW / sourceW, cellH / sourceH);
                var transform = layer.property("ADBE Transform Group");
                setStatic(transform.property("ADBE Anchor Point"), [sourceW / 2, sourceH / 2]);
                setStatic(transform.property("ADBE Position"), [centerX, imageCenterY]);
                setStatic(transform.property("ADBE Scale"), [imageScale, imageScale]);
                setStatic(transform.property("ADBE Rotate Z"), 0);

                var captionTransform = textLayers[k].property("ADBE Transform Group");
                var textRect = textRects[k];
                setStatic(captionTransform.property("ADBE Anchor Point"),
                    [textRect.left + textRect.width / 2, textRect.top]);
                setStatic(captionTransform.property("ADBE Position"), [centerX, captionTop]);
                setStatic(captionTransform.property("ADBE Scale"), [100, 100]);
                // Match each image's visibility interval.
                textLayers[k].inPoint = layer.inPoint;
                textLayers[k].outPoint = layer.outPoint;
                x += cellW + gapX;
            }
            y += cellH + captionGap + rowCaptionHeights[row] + gapY;
        }

        precomp.openInViewer();
    } catch (e) {
        fail("Could not finish layout:\n" + e.toString() +
             "\n\nUse Edit > Undo if necessary.");
    } finally {
        app.endUndoGroup();
    }
})();
