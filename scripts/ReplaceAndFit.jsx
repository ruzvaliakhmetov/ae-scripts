#target aftereffects

/*
 * Replace & Fit for Adobe After Effects (ExtendScript)
 *
 * Replace one footage layer from a file selected in the macOS/Windows file
 * picker, importing the new footage automatically into the AE project.
 * Existing Position animation is left untouched. Scale and Anchor Point
 * (including their keyframes) are recalculated to preserve the framing
 * of the old source.
 *
 * Workflow:
 *   1. Select one target layer in the Timeline.
 *   2. Run this script.
 *   3. Choose the new video/image file in the system file picker.
 *
 * The results are baked into ordinary layer properties. The recipient
 * of the .aep file does not need this script installed.
 */

(function replaceAndFit() {
    // "cover" crops surplus image edges; "contain" shows the entire source.
    // Change this setting if your replacement workflow needs the other mode.
    var FIT_MODE = "cover";

    function selectedTargetLayer() {
        var current = app.project.activeItem;
        if (current instanceof CompItem && current.selectedLayers.length === 1) {
            return current.selectedLayers[0];
        }
        throw new Error("Select exactly one target layer in the active composition's Timeline.");
    }

    function cloneArray(value) {
        var out = [];
        for (var i = 0; i < value.length; i++) out.push(value[i]);
        return out;
    }

    function snapshot(prop) {
        var result = { keys: [], staticValue: null };
        if (prop.numKeys === 0) {
            result.staticValue = cloneArray(prop.value);
            return result;
        }

        for (var k = 1; k <= prop.numKeys; k++) {
            var key = {
                value: cloneArray(prop.keyValue(k)),
                inEase: prop.keyInTemporalEase(k),
                outEase: prop.keyOutTemporalEase(k),
                temporalAuto: prop.keyTemporalAutoBezier(k),
                temporalContinuous: prop.keyTemporalContinuous(k),
                spatial: prop.isSpatial,
                spatialAuto: false,
                spatialContinuous: false,
                inTangent: null,
                outTangent: null
            };
            if (prop.isSpatial) {
                key.spatialAuto = prop.keySpatialAutoBezier(k);
                key.spatialContinuous = prop.keySpatialContinuous(k);
                key.inTangent = cloneArray(prop.keyInSpatialTangent(k));
                key.outTangent = cloneArray(prop.keyOutSpatialTangent(k));
            }
            result.keys.push(key);
        }
        return result;
    }

    function scaledEase(eases, xFactor, zFactor) {
        var adjusted = [];
        for (var i = 0; i < eases.length; i++) {
            var factor = (i === 2) ? zFactor : xFactor;
            adjusted.push(new KeyframeEase(eases[i].speed * factor, eases[i].influence));
        }
        return adjusted;
    }

    function scaledTangent(tangent, xyFactor) {
        var adjusted = cloneArray(tangent);
        adjusted[0] *= xyFactor;
        adjusted[1] *= xyFactor;
        return adjusted;
    }

    function applySnapshot(prop, data, transformValue, xyDerivative, zDerivative) {
        if (data.keys.length === 0) {
            prop.setValue(transformValue(data.staticValue));
            return;
        }

        // Set existing key values: this does not insert/delete/move keyframes.
        for (var k = 1; k <= data.keys.length; k++) {
            prop.setValueAtKey(k, transformValue(data.keys[k - 1].value));
        }

        // Scale manual motion-path handles and temporal easing speeds too.
        // This matters for preserving non-linear zooms between keyframes.
        for (var n = 1; n <= data.keys.length; n++) {
            var key = data.keys[n - 1];
            if (key.spatial && !key.spatialAuto) {
                try {
                    prop.setSpatialTangentsAtKey(n,
                        scaledTangent(key.inTangent, xyDerivative),
                        scaledTangent(key.outTangent, xyDerivative));
                    prop.setSpatialContinuousAtKey(n, key.spatialContinuous);
                } catch (ignoredSpatial) {
                    // Not all AE property types expose editable spatial handles.
                }
            }
            if (!key.temporalAuto) {
                try {
                    prop.setTemporalEaseAtKey(n,
                        scaledEase(key.inEase, xyDerivative, zDerivative),
                        scaledEase(key.outEase, xyDerivative, zDerivative));
                    prop.setTemporalContinuousAtKey(n, key.temporalContinuous);
                } catch (ignoredTemporal) {
                    // HOLD keys or non-editable tangents do not need an ease update.
                }
            }
        }
    }

    function replaceLayer(layer, newSource, cover) {
        if (!(layer instanceof AVLayer) || !layer.hasVideo || layer.nullLayer || layer.adjustmentLayer) {
            throw new Error("The target must be a normal video/image layer.");
        }
        if (!(layer.source instanceof FootageItem || layer.source instanceof CompItem)) {
            throw new Error("The target has no replaceable source.");
        }
        var oldSource = layer.source;
        if (oldSource === newSource) {
            throw new Error("The selected source is already on the target layer.");
        }
        var oldW = oldSource.width;
        var oldH = oldSource.height;
        var newW = newSource.width;
        var newH = newSource.height;
        if (!oldW || !oldH || !newW || !newH) {
            throw new Error("Both sources must have non-zero frame dimensions.");
        }

        var transform = layer.property("ADBE Transform Group");
        var scale = transform.property("ADBE Scale");
        var anchor = transform.property("ADBE Anchor Point");
        if (scale.expressionEnabled || anchor.expressionEnabled) {
            throw new Error("Scale or Anchor Point uses an expression. Disable it before replacing.");
        }

        // Pixel aspect ratios are accounted for when comparing frame widths.
        var oldPAR = oldSource.pixelAspect || 1;
        var newPAR = newSource.pixelAspect || 1;
        var byWidth = (oldW * oldPAR) / (newW * newPAR);
        var byHeight = oldH / newH;
        var factor = cover ? Math.max(byWidth, byHeight) : Math.min(byWidth, byHeight);
        if (!(factor > 0) || !isFinite(factor)) {
            throw new Error("Could not calculate a valid fit factor.");
        }

        var oldAnchor = snapshot(anchor);
        var oldScale = snapshot(scale);
        var oldCenter = [oldW / 2, oldH / 2];
        var newCenter = [newW / 2, newH / 2];

        // Mapping the centre of the new footage to the former image centre:
        // A_new = C_new + (A_old - C_old) / factor.
        // Hence Position (including every keyframe) stays exactly untouched.
        function newAnchorValue(v) {
            var out = cloneArray(v);
            out[0] = newCenter[0] + (v[0] - oldCenter[0]) / factor;
            out[1] = newCenter[1] + (v[1] - oldCenter[1]) / factor;
            return out;
        }

        function newScaleValue(v) {
            var out = cloneArray(v);
            out[0] = v[0] * factor;
            out[1] = v[1] * factor;
            // On 3D layers the source is still a flat plane. Keep Z scale.
            return out;
        }

        layer.replaceSource(newSource, false);
        applySnapshot(anchor, oldAnchor, newAnchorValue, 1 / factor, 1);
        applySnapshot(scale, oldScale, newScaleValue, factor, 1);

        var maskGroup = layer.property("ADBE Mask Parade");
        var warning = (maskGroup && maskGroup.numProperties > 0)
            ? " Check masks: they use source-pixel coordinates." : "";
        return "Replaced: " + oldSource.name + " → " + newSource.name +
            " (" + Math.round(factor * 10000) / 100 + "% of old Scale)." + warning;
    }

    function main() {
        // Capture the selection before opening a modal picker, which can
        // change the focused After Effects panel.
        var layer = selectedTargetLayer();
        if (!(layer instanceof AVLayer) || !layer.hasVideo || layer.nullLayer || layer.adjustmentLayer) {
            throw new Error("Select a normal video/image layer.");
        }

        var chosen = File.openDialog("Choose replacement footage");
        if (!chosen) return; // Cancel: leave the project completely unchanged.

        app.beginUndoGroup("Replace & Fit");
        try {
            var importOptions = new ImportOptions(chosen);
            if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
                importOptions.importAs = ImportAsType.FOOTAGE;
            }
            var newSource = app.project.importFile(importOptions);
            replaceLayer(layer, newSource, FIT_MODE === "cover");
        } finally {
            app.endUndoGroup();
        }
    }

    try {
        main();
    } catch (err) {
        alert("Replace & Fit: " + err.message);
    }
})(this);
