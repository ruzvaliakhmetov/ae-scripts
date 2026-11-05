(function relinkDuplicateImagesFolders() {
    var project = app.project;

    if (!project) {
        alert("No project is open.");
        return;
    }

    // Select the folder whose footage items should be kept.
    var selection = project.selection;
    var masterFolder = null;

    for (var i = 0; i < selection.length; i++) {
        if (selection[i] instanceof FolderItem) {
            masterFolder = selection[i];
            break;
        }
    }

    if (!masterFolder) {
        alert("Select the images folder you want to KEEP.");
        return;
    }

    function isInsideFolder(item, folder) {
        var parent = item.parentFolder;

        while (parent && parent !== project.rootFolder) {
            if (parent === folder) {
                return true;
            }
            parent = parent.parentFolder;
        }

        return false;
    }

    function getRelativePath(item, rootFolder) {
        var parts = [item.name];
        var parent = item.parentFolder;

        while (parent && parent !== rootFolder) {
            parts.unshift(parent.name);
            parent = parent.parentFolder;
        }

        return parts.join("/").toLowerCase();
    }

    // Identical file bytes alone are not enough if AE interprets them differently.
    function sameInterpretation(a, b) {
        if (a.width !== b.width ||
            a.height !== b.height ||
            a.pixelAspect !== b.pixelAspect) {
            return false;
        }

        var sourceA = a.mainSource;
        var sourceB = b.mainSource;

        if (sourceA.hasAlpha !== sourceB.hasAlpha) {
            return false;
        }

        if (!sourceA.hasAlpha) {
            return true;
        }

        if (sourceA.alphaMode !== sourceB.alphaMode) {
            return false;
        }

        if (sourceA.alphaMode === AlphaMode.IGNORE) {
            return true;
        }

        if (sourceA.invertAlpha !== sourceB.invertAlpha) {
            return false;
        }

        if (sourceA.alphaMode === AlphaMode.PREMULTIPLIED) {
            var colorA = sourceA.premulColor;
            var colorB = sourceB.premulColor;
            for (var c = 0; c < 3; c++) {
                if (colorA[c] !== colorB[c]) {
                    return false;
                }
            }
        }

        return true;
    }

    // Compare bytes in chunks so even large images don't fill up memory.
    // Status: "equal", "different", or "unreadable".
    function compareFiles(fileA, fileB) {
        if (!fileA || !fileB || !fileA.exists || !fileB.exists) {
            return "unreadable";
        }

        if (fileA.fsName === fileB.fsName) {
            return "equal";
        }

        if (fileA.length !== fileB.length) {
            return "different";
        }

        var a = new File(fileA.fsName);
        var b = new File(fileB.fsName);
        var aOpened = false;
        var bOpened = false;

        try {
            aOpened = a.open("r");
            if (!aOpened) {
                return "unreadable";
            }

            bOpened = b.open("r");
            if (!bOpened) {
                return "unreadable";
            }

            // open() can detect an encoding and skip a BOM. Reset to byte zero.
            a.encoding = "BINARY";
            b.encoding = "BINARY";
            if (!a.seek(0, 0) || !b.seek(0, 0)) {
                return "unreadable";
            }

            var remaining = fileA.length;
            var chunkSize = 65536;

            while (remaining > 0) {
                var count = Math.min(chunkSize, remaining);
                var partA = a.read(count);
                var partB = b.read(count);

                if (partA.length !== count || partB.length !== count ||
                    a.error || b.error) {
                    return "unreadable";
                }

                if (partA !== partB) {
                    return "different";
                }

                remaining -= count;
            }

            return "equal";
        } catch (error) {
            return "unreadable";
        } finally {
            if (aOpened) {
                a.close();
            }
            if (bOpened) {
                b.close();
            }
        }
    }

    function checkFootage(duplicate, master) {
        if (!duplicate.file || !master.file ||
            !duplicate.mainSource.isStill || !master.mainSource.isStill ||
            duplicate.useProxy || master.useProxy) {
            // Do not compare just the first frame of a sequence or movie.
            return "unsupported";
        }

        var comparison = compareFiles(duplicate.file, master.file);
        if (comparison !== "equal") {
            return comparison;
        }

        return sameInterpretation(duplicate, master)
            ? "equal" : "interpretation";
    }

    var masterItems = {};
    var ambiguousKeys = {};

    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);

        if (item instanceof FootageItem && isInsideFolder(item, masterFolder)) {
            var key = getRelativePath(item, masterFolder);
            if (masterItems.hasOwnProperty(key)) {
                ambiguousKeys[key] = true;
            } else {
                masterItems[key] = item;
            }
        }
    }

    var duplicateFolders = [];

    for (var i = 1; i <= project.numItems; i++) {
        var folder = project.item(i);

        if (folder instanceof FolderItem &&
            folder !== masterFolder && folder.name === masterFolder.name) {
            duplicateFolders.push(folder);
        }
    }

    if (duplicateFolders.length === 0) {
        alert('No other folders named "' + masterFolder.name + '" were found.');
        return;
    }

    var replacements = {};
    var counts = {
        matched: 0,
        unmatched: 0,
        different: 0,
        unreadable: 0,
        interpretation: 0,
        unsupported: 0,
        ambiguous: 0
    };
    var skippedExamples = [];

    function recordSkip(itemName, reason) {
        counts[reason]++;
        if (skippedExamples.length < 10) {
            skippedExamples.push("- " + itemName + " (" + reason + ")");
        }
    }

    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);

        if (!(item instanceof FootageItem)) {
            continue;
        }

        for (var f = 0; f < duplicateFolders.length; f++) {
            if (!isInsideFolder(item, duplicateFolders[f])) {
                continue;
            }

            var key = getRelativePath(item, duplicateFolders[f]);

            if (ambiguousKeys[key]) {
                recordSkip(item.name, "ambiguous");
            } else if (!masterItems.hasOwnProperty(key)) {
                recordSkip(item.name, "unmatched");
            } else {
                var master = masterItems[key];
                var result = checkFootage(item, master);

                if (result === "equal") {
                    replacements["item_" + item.id] = master;
                    counts.matched++;
                } else {
                    recordSkip(item.name, result);
                }
            }

            break;
        }
    }

    // Only the replacements are part of the undo group; file checks are read-only.
    var replacedLayers = 0;
    var failedLayers = 0;
    app.beginUndoGroup("Relink identical duplicate images");
    try {
        for (var i = 1; i <= project.numItems; i++) {
            var comp = project.item(i);
            if (!(comp instanceof CompItem)) {
                continue;
            }

            for (var l = 1; l <= comp.numLayers; l++) {
                var layer = comp.layer(l);
                if (!(layer instanceof AVLayer) || !layer.source) {
                    continue;
                }

                var replacement = replacements["item_" + layer.source.id];
                if (replacement) {
                    try {
                        layer.replaceSource(replacement, true);
                        replacedLayers++;
                    } catch (error) {
                        failedLayers++;
                    }
                }
            }
        }
    } finally {
        app.endUndoGroup();
    }

    var message =
        "Done!\n\n" +
        "Master folder: " + masterFolder.name + "\n" +
        "Duplicate folders found: " + duplicateFolders.length + "\n" +
        "Identical footage items: " + counts.matched + "\n" +
        "Layer sources replaced: " + replacedLayers + "\n" +
        "Layer replacements failed: " + failedLayers + "\n\n" +
        "Skipped footage items:\n" +
        "- Different file bytes: " + counts.different + "\n" +
        "- Different AE interpretation: " + counts.interpretation + "\n" +
        "- Missing / unreadable files: " + counts.unreadable + "\n" +
        "- Sequences, movies or proxies: " + counts.unsupported + "\n" +
        "- No matching filename: " + counts.unmatched + "\n" +
        "- Ambiguous master path: " + counts.ambiguous;

    if (skippedExamples.length > 0) {
        message += "\n\nExamples:\n" + skippedExamples.join("\n");
    }

    message += "\n\nDuplicate folders were NOT deleted.";
    alert(message);
})();
