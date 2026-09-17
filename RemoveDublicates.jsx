(function relinkDuplicateImagesFolders() {
    app.beginUndoGroup("Relink duplicate images");

    var project = app.project;

    if (!project) {
        alert("No project is open.");
        return;
    }

    // ------------------------------------------------------------
    // Find selected master folder
    // ------------------------------------------------------------

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

    // ------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------

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

    // ------------------------------------------------------------
    // Collect master footage
    // ------------------------------------------------------------

    var masterItems = {};

    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);

        if (
            item instanceof FootageItem &&
            isInsideFolder(item, masterFolder)
        ) {
            var key = getRelativePath(item, masterFolder);
            masterItems[key] = item;
        }
    }

    // ------------------------------------------------------------
    // Find other folders with same name
    // ------------------------------------------------------------

    var duplicateFolders = [];

    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);

        if (
            item instanceof FolderItem &&
            item !== masterFolder &&
            item.name === masterFolder.name
        ) {
            duplicateFolders.push(item);
        }
    }

    if (duplicateFolders.length === 0) {
        alert(
            'No other folders named "' +
            masterFolder.name +
            '" were found.'
        );
        return;
    }

    // ------------------------------------------------------------
    // Build duplicate -> master replacement map
    // ------------------------------------------------------------

    var replacements = {};
    var unmatched = [];

    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);

        if (!(item instanceof FootageItem)) {
            continue;
        }

        for (var f = 0; f < duplicateFolders.length; f++) {
            var duplicateFolder = duplicateFolders[f];

            if (isInsideFolder(item, duplicateFolder)) {
                var key = getRelativePath(item, duplicateFolder);

                if (masterItems[key]) {
                    replacements["item_" + item.id] = masterItems[key];
                } else {
                    unmatched.push(item.name);
                }

                break;
            }
        }
    }

    // ------------------------------------------------------------
    // Replace sources in ALL compositions
    // ------------------------------------------------------------

    var replacedLayers = 0;

    for (var i = 1; i <= project.numItems; i++) {
        var comp = project.item(i);

        if (!(comp instanceof CompItem)) {
            continue;
        }

        for (var l = 1; l <= comp.numLayers; l++) {
            var layer = comp.layer(l);

            if (!(layer instanceof AVLayer)) {
                continue;
            }

            var source = layer.source;

            if (!source) {
                continue;
            }

            var replacement = replacements["item_" + source.id];

            if (replacement) {
                layer.replaceSource(replacement, true);
                replacedLayers++;
            }
        }
    }

    app.endUndoGroup();

    var message =
        "Done!\n\n" +
        "Master folder:\n" +
        masterFolder.name +
        "\n\n" +
        "Duplicate folders found: " +
        duplicateFolders.length +
        "\n" +
        "Layer sources replaced: " +
        replacedLayers;

    if (unmatched.length > 0) {
        message +=
            "\n\nCould not find master versions for " +
            unmatched.length +
            " item(s).\n" +
            "Duplicate folders were NOT deleted.";
    }

    alert(message);
})();