/*
    Scale Entire AE Project 50%
    ---------------------------
    Physically scales every composition in the current After Effects project
    to 50% of its pixel dimensions.

    Strategy:
    1. Each comp is scaled with the same temporary-parent technique used by
       Adobe's Scale Composition.jsx. This preserves parenting and motion paths
       much better than editing every Position/Scale value directly.
    2. Camera Zoom is scaled by the same factor.
    3. Every precomp layer's Scale is compensated afterwards, because its source
       comp has also been resized. Anchor Point is intentionally left alone: AE
       already adjusts it when source-comp dimensions change.
    4. Pixel-positioned composition guides are scaled too.

    Notes:
    - Save a copy of the project before running.
    - Expressions that explicitly return pixel coordinates/sizes may require
      manual checking. The script reports transform properties with expressions.
    - Some effects with pixel-based parameters (blur radius, stroke width,
      effect control points, etc.) may require manual adjustment.
    - Camera Depth of Field setups may require manual checking.
*/

(function scaleEntireProject50() {
    var SCRIPT_NAME = "Scale Entire Project 50% v2";
    var FACTOR = 0.5;
    var INV_FACTOR = 1.0 / FACTOR;

    if (!app.project) {
        alert("No After Effects project is open.", SCRIPT_NAME);
        return;
    }

    var comps = [];
    var i, j;

    for (i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i) instanceof CompItem) {
            comps.push(app.project.item(i));
        }
    }

    if (comps.length === 0) {
        alert("This project contains no compositions.", SCRIPT_NAME);
        return;
    }

    var tooSmall = [];
    for (i = 0; i < comps.length; i++) {
        var nw = Math.max(1, Math.round(comps[i].width * FACTOR));
        var nh = Math.max(1, Math.round(comps[i].height * FACTOR));
        if (nw < 1 || nh < 1 || nw > 30000 || nh > 30000) {
            tooSmall.push(comps[i].name);
        }
    }

    if (tooSmall.length > 0) {
        alert("Some compositions would end up outside After Effects' valid size range.\n\n" + tooSmall.join("\n"), SCRIPT_NAME);
        return;
    }

    var proceed = confirm(
        "Scale ALL " + comps.length + " compositions in this project to 50%?\n\n" +
        "Example: 2160 x 3840 -> 1080 x 1920\n\n" +
        "Save a copy of the project first. The whole operation is placed in one Undo group."
    );

    if (!proceed) {
        return;
    }

    var warningCount = 0;
    var warningSamples = [];

    function addWarning(text) {
        warningCount++;
        if (warningSamples.length < 20) {
            warningSamples.push(text);
        }
    }

    function multiplyValue(value, factor) {
        var result, k;
        if (value instanceof Array) {
            result = [];
            for (k = 0; k < value.length; k++) {
                result[k] = (typeof value[k] === "number") ? value[k] * factor : value[k];
            }
            return result;
        }
        if (typeof value === "number") {
            return value * factor;
        }
        return value;
    }

    function scaledEaseArray(eases, factor) {
        var out = [];
        var k;
        for (k = 0; k < eases.length; k++) {
            out.push(new KeyframeEase(eases[k].speed * factor, eases[k].influence));
        }
        return out;
    }

    function multiplyProperty(prop, factor, label) {
        if (!prop) {
            return;
        }

        var hasExpression = false;
        try {
            hasExpression = prop.expressionEnabled;
        } catch (ignoreExpressionRead) {}

        if (hasExpression) {
            addWarning(label + " has an enabled expression; check it manually.");
        }

        try {
            if (prop.numKeys > 0) {
                for (var k = 1; k <= prop.numKeys; k++) {
                    var inSpatial = null;
                    var outSpatial = null;
                    var inEase = null;
                    var outEase = null;

                    if (prop.isSpatial) {
                        try {
                            inSpatial = prop.keyInSpatialTangent(k);
                            outSpatial = prop.keyOutSpatialTangent(k);
                        } catch (ignoreSpatialRead) {}
                    }

                    try {
                        inEase = prop.keyInTemporalEase(k);
                        outEase = prop.keyOutTemporalEase(k);
                    } catch (ignoreEaseRead) {}

                    prop.setValueAtKey(k, multiplyValue(prop.keyValue(k), factor));

                    if (prop.isSpatial && inSpatial !== null && outSpatial !== null) {
                        try {
                            prop.setSpatialTangentsAtKey(
                                k,
                                multiplyValue(inSpatial, factor),
                                multiplyValue(outSpatial, factor)
                            );
                        } catch (ignoreSpatialWrite) {}
                    }

                    if (inEase !== null && outEase !== null) {
                        try {
                            prop.setTemporalEaseAtKey(
                                k,
                                scaledEaseArray(inEase, factor),
                                scaledEaseArray(outEase, factor)
                            );
                        } catch (ignoreEaseWrite) {}
                    }
                }
            } else {
                var baseValue;
                if (hasExpression && prop.valueAtTime) {
                    // Get the pre-expression value rather than the evaluated result.
                    baseValue = prop.valueAtTime(0, true);
                } else {
                    baseValue = prop.value;
                }
                prop.setValue(multiplyValue(baseValue, factor));
            }
        } catch (err) {
            addWarning(label + " could not be scaled: " + err.toString());
        }
    }

    function scaleCompGuides(comp, factor) {
        try {
            if (!comp.guides) {
                return;
            }

            // Copy positions first because setGuide mutates the guide collection.
            var guideData = [];
            var g;
            for (g = 0; g < comp.guides.length; g++) {
                guideData.push({
                    position: comp.guides[g].position,
                    positionType: comp.guides[g].positionType
                });
            }

            for (g = 0; g < guideData.length; g++) {
                // Pixel guides use positionType 0. Percentage guides should stay as-is.
                if (guideData[g].positionType === undefined || guideData[g].positionType === 0) {
                    comp.setGuide(guideData[g].position * factor, g);
                }
            }
        } catch (guideErr) {
            addWarning("Comp '" + comp.name + "': guides were not fully scaled (" + guideErr.toString() + ").");
        }
    }

    function scaleCameraZooms(comp, factor) {
        for (var li = 1; li <= comp.numLayers; li++) {
            var layer = comp.layer(li);
            if (layer.matchName === "ADBE Camera Layer") {
                var zoom = null;
                try {
                    zoom = layer.property("ADBE Camera Options Group").property("ADBE Camera Zoom");
                } catch (ignoreZoomLookup) {}

                if (zoom) {
                    multiplyProperty(zoom, factor, "Comp '" + comp.name + "' / camera '" + layer.name + "' / Zoom");
                }
            }
        }
    }

    function scaleOneCompLikeAdobe(comp, factor) {
        var originalLayers = [];
        var tempNull = null;
        var tempNullSource = null;
        var li;

        // Remember lock states and temporarily unlock everything.
        for (li = 1; li <= comp.numLayers; li++) {
            var existingLayer = comp.layer(li);
            originalLayers.push({ layer: existingLayer, locked: existingLayer.locked });
            if (existingLayer.locked) {
                existingLayer.locked = false;
            }
        }

        try {
            tempNull = comp.layers.addNull();
            tempNullSource = tempNull.source;
            tempNull.name = "__TEMP_PROJECT_SCALE_50__";
            tempNull.threeDLayer = true;

            var tr = tempNull.property("ADBE Transform Group");
            try {
                tr.property("ADBE Anchor Point").setValue([0, 0, 0]);
            } catch (ignoreAnchor) {}
            tr.property("ADBE Position").setValue([0, 0, 0]);

            // Parent only root layers. Existing parent/child relationships remain intact.
            for (li = 0; li < originalLayers.length; li++) {
                var rootCandidate = originalLayers[li].layer;
                if (rootCandidate.parent === null) {
                    rootCandidate.parent = tempNull;
                }
            }

            comp.width = Math.max(1, Math.round(comp.width * factor));
            comp.height = Math.max(1, Math.round(comp.height * factor));

            scaleCompGuides(comp, factor);
            scaleCameraZooms(comp, factor);

            var nullScale = tr.property("ADBE Scale").value;
            nullScale[0] *= factor;
            nullScale[1] *= factor;
            if (nullScale.length > 2) {
                nullScale[2] *= factor;
            }
            tr.property("ADBE Scale").setValue(nullScale);

            // Removing a parent in AE de-jumps the children, baking the parent's static
            // transform into the root layers while preserving their hierarchy.
            tempNull.remove();
            tempNull = null;

            // Remove the temporary null footage item too, if it is no longer used.
            if (tempNullSource) {
                try {
                    if (tempNullSource.usedIn.length === 0) {
                        tempNullSource.remove();
                    }
                } catch (ignoreNullSourceCleanup) {}
            }
        } finally {
            // If something failed before normal cleanup, remove the temp null if possible.
            if (tempNull) {
                try {
                    tempNull.remove();
                } catch (ignoreTempNullCleanup) {}
            }

            // Restore original lock states.
            for (li = 0; li < originalLayers.length; li++) {
                try {
                    originalLayers[li].layer.locked = originalLayers[li].locked;
                } catch (ignoreRelock) {}
            }
        }
    }

    function compensatePrecompLayers(comp, factor, invFactor) {
        for (var li = 1; li <= comp.numLayers; li++) {
            var layer = comp.layer(li);
            var sourceComp = null;

            try {
                if (layer.source && (layer.source instanceof CompItem)) {
                    sourceComp = layer.source;
                }
            } catch (ignoreSourceRead) {}

            if (!sourceComp) {
                continue;
            }

            var wasLocked = layer.locked;
            if (wasLocked) {
                layer.locked = false;
            }

            try {
                var transform = layer.property("ADBE Transform Group");
                var scale = transform.property("ADBE Scale");

                // IMPORTANT: do NOT scale the Anchor Point here.
                // After Effects already adjusts a precomp layer's source-space anchor
                // when the source composition dimensions change. Scaling it again
                // produces a +25% width/+25% height offset when resizing by 50%.
                //
                // The source comp itself has already become half-size. Undo only the
                // extra layer-level shrink so nesting contributes one 50% scale overall.
                multiplyProperty(
                    scale,
                    invFactor,
                    "Comp '" + comp.name + "' / precomp layer '" + layer.name + "' / Scale"
                );
            } finally {
                if (wasLocked) {
                    layer.locked = true;
                }
            }
        }
    }

    var fatalError = null;

    app.beginUndoGroup(SCRIPT_NAME);

    try {
        // Pass 1: resize every composition and scale its world-space contents.
        for (i = 0; i < comps.length; i++) {
            scaleOneCompLikeAdobe(comps[i], FACTOR);
        }

        // Pass 2: compensate layers whose sources are themselves resized comps.
        for (i = 0; i < comps.length; i++) {
            compensatePrecompLayers(comps[i], FACTOR, INV_FACTOR);
        }
    } catch (err) {
        fatalError = err;
    }

    app.endUndoGroup();

    if (fatalError) {
        alert(
            "The script stopped because of an error:\n\n" + fatalError.toString() +
            "\n\nUse Edit > Undo immediately to revert the whole operation.",
            SCRIPT_NAME
        );
        return;
    }

    var message = "Done. Scaled " + comps.length + " compositions to 50%.";

    if (warningCount > 0) {
        message += "\n\nThere are " + warningCount + " item(s) worth checking manually, mainly expressions or unusual properties.";
        message += "\n\nFirst warnings:\n- " + warningSamples.join("\n- ");
        if (warningCount > warningSamples.length) {
            message += "\n- ...and " + (warningCount - warningSamples.length) + " more.";
        }
    } else {
        message += "\n\nNo transform-expression warnings were detected.";
    }

    message += "\n\nFor a 2160 x 3840 master comp, the new size is 1080 x 1920.";

    alert(message, SCRIPT_NAME);
})();
