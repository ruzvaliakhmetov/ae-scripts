/*
 * Script Shelf for Adobe After Effects
 * A small dockable launcher for your existing .jsx/.jsxbin/.js scripts.
 *
 * Install: place this file in After Effects/Scripts/ScriptUI Panels,
 * restart After Effects, then open Window > ScriptShelf.
 * Choose your scripts folder on first use.
 * Optional: put ScriptShelf.json at the root of that folder to define cards.
 * Without JSON, the launcher displays the original filename buttons.
 * Long lists scroll by dragging the scrollbar thumb or the list itself.
 */

(function scriptShelf(thisObj) {
    var SETTINGS_SECTION = "RuzScriptShelf";
    var FOLDER_KEY = "scriptsFolder";
    var MANIFEST_NAME = "ScriptShelf.json";
    var MAX_DEPTH = 8;
    var MAX_SCRIPTS = 300;

    // Layout constants. The list area is positioned by hand (see fitLayout),
    // so these must match the margins/spacing given to the panel.
    var PANEL_MARGIN = 10;
    var PANEL_SPACING = 7;
    var ROW_GAP = 3;
    var DRAG_THRESHOLD = 4;

    // Set to true to show the last mouse events in the status line.
    // Useful when the mouse misbehaves in a particular AE version.
    var DEBUG_EVENTS = false;

    // The scrollbar is drawn by the list itself: the native ScriptUI
    // scrollbar in After Effects moves its thumb in coarse steps.
    var SCROLLBAR_WIDTH = 14;   // hit strip at the right edge of the list
    var SCROLLBAR_GAP = 4;      // space between the cards and that strip
    var THUMB_WIDTH = 6;
    var THUMB_MIN_HEIGHT = 24;
    var PAGE_OVERLAP = 24;      // a track click pages by the view height minus this
    var CARD_BASE_HEIGHT = 48;
    var DESCRIPTION_LINE_HEIGHT = 14;
    var MAX_DESCRIPTION_LINES = 3;

    var COLORS = {
        well: [0.11, 0.11, 0.11, 1],
        row: [0.21, 0.21, 0.21, 1],
        rowHover: [0.28, 0.28, 0.28, 1],
        border: [0.39, 0.39, 0.39, 1],
        text: [0.96, 0.96, 0.96, 1],
        textMissing: [0.55, 0.55, 0.55, 1],
        description: [0.68, 0.68, 0.68, 1],
        heading: [0.62, 0.62, 0.62, 1],
        thumb: [0.40, 0.40, 0.40, 1],
        thumbActive: [0.62, 0.62, 0.62, 1]
    };

    var scriptsFolder = null;
    var scripts = [];
    var scanWarning = "";
    var manifestMode = false;

    // The list is plain data drawn by one custom control, not hundreds of
    // widgets. Each row: { kind: "script" | "text", y, height, item | text }.
    var rows = [];
    var contentHeight = 0;
    var scrollOffset = 0;
    var maxScroll = 0;
    var measuredListWidth = -1;
    var drawingStyles = null;

    // Mouse state for hover, click, drag-to-scroll and the scrollbar.
    var hoverIndex = -1;
    var pressIndex = -1;
    var drag = null;          // press on a card: click or grab the list
    var barPress = null;      // press on the scrollbar strip
    var barHover = false;

    function readSavedFolder() {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, FOLDER_KEY)) {
                var folder = new Folder(app.settings.getSetting(SETTINGS_SECTION, FOLDER_KEY));
                if (folder.exists) return folder;
            }
        } catch (e) {
            // The launcher can still work without saved preferences.
        }
        return null;
    }

    function saveFolder(folder) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, FOLDER_KEY, folder.fsName);
        } catch (e) {
            // Not fatal: the folder can be selected again next time.
        }
    }

    function readableName(name) {
        try { return decodeURI(name); } catch (e) { return name; }
    }

    function compareText(a, b) {
        a = a.toLowerCase();
        b = b.toLowerCase();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    // ExtendScript does not consistently provide JSON.parse().
    // This small strict JSON parser avoids eval() and external dependencies.
    function parseJson(source) {
        var pos = 0;
        if (source.charCodeAt(0) === 65279) source = source.substring(1);

        function error(message) {
            throw new Error(message + " at character " + (pos + 1));
        }

        function skipWhite() {
            while (pos < source.length && /\s/.test(source.charAt(pos))) pos++;
        }

        function readString() {
            var output = "";
            if (source.charAt(pos++) !== '"') error("Expected string");

            while (pos < source.length) {
                var ch = source.charAt(pos++);
                if (ch === '"') return output;
                if (ch === "\\") {
                    if (pos >= source.length) error("Unfinished escape");
                    var escaped = source.charAt(pos++);
                    var replacements = {
                        '"': '"', "\\": "\\", "/": "/", "b": "\b",
                        "f": "\f", "n": "\n", "r": "\r", "t": "\t"
                    };
                    if (escaped === "u") {
                        var hex = source.substr(pos, 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) error("Invalid Unicode escape");
                        output += String.fromCharCode(parseInt(hex, 16));
                        pos += 4;
                    } else if (replacements.hasOwnProperty(escaped)) {
                        output += replacements[escaped];
                    } else {
                        error("Invalid string escape");
                    }
                } else {
                    if (ch.charCodeAt(0) < 32) error("Control character in string");
                    output += ch;
                }
            }
            error("Unterminated string");
        }

        function readValue() {
            skipWhite();
            var ch = source.charAt(pos);
            var value, key;

            if (ch === '"') return readString();

            if (ch === "[") {
                pos++;
                var array = [];
                skipWhite();
                if (source.charAt(pos) === "]") { pos++; return array; }
                while (true) {
                    array.push(readValue());
                    skipWhite();
                    ch = source.charAt(pos++);
                    if (ch === "]") return array;
                    if (ch !== ",") error("Expected comma or ]");
                }
            }

            if (ch === "{") {
                pos++;
                var object = {};
                skipWhite();
                if (source.charAt(pos) === "}") { pos++; return object; }
                while (true) {
                    skipWhite();
                    if (source.charAt(pos) !== '"') error("Expected object key");
                    key = readString();
                    skipWhite();
                    if (source.charAt(pos++) !== ":") error("Expected colon");
                    value = readValue();
                    if (key === "__proto__" || key === "constructor") error("Reserved object key");
                    object[key] = value;
                    skipWhite();
                    ch = source.charAt(pos++);
                    if (ch === "}") return object;
                    if (ch !== ",") error("Expected comma or }");
                }
            }

            var rest = source.substring(pos);
            if (rest.substr(0, 4) === "true") { pos += 4; return true; }
            if (rest.substr(0, 5) === "false") { pos += 5; return false; }
            if (rest.substr(0, 4) === "null") { pos += 4; return null; }

            var number = rest.match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
            if (number) {
                pos += number[0].length;
                return Number(number[0]);
            }

            error("Unexpected value");
        }

        var result = readValue();
        skipWhite();
        if (pos !== source.length) error("Unexpected trailing content");
        return result;
    }

    function readManifest(folder) {
        var manifestFile = new File(folder.fsName + "/" + MANIFEST_NAME);
        if (!manifestFile.exists) return false;
        manifestMode = true;

        manifestFile.encoding = "UTF-8";
        if (!manifestFile.open("r")) throw new Error("Cannot open " + MANIFEST_NAME);

        var source;
        try {
            source = manifestFile.read();
        } finally {
            manifestFile.close();
        }

        var entries = parseJson(source);
        if (entries && entries.Scripts instanceof Array) entries = entries.Scripts;
        if (!(entries instanceof Array)) {
            throw new Error("JSON must contain an array of scripts");
        }

        for (var i = 0; i < entries.length && i < MAX_SCRIPTS; i++) {
            var item = entries[i];
            if (!item || typeof item !== "object" || typeof item.JSX !== "string") {
                throw new Error("Entry " + (i + 1) + " needs a JSX filename");
            }

            // Only paths relative to the chosen folder are accepted.
            var relative = item.JSX.replace(/\\/g, "/");
            if (/^(\/|[A-Za-z]:)/.test(relative)) {
                throw new Error("Use a relative JSX path in entry " + (i + 1));
            }
            var components = relative.split("/");
            var safeComponents = [];
            for (var j = 0; j < components.length; j++) {
                if (components[j] === ".") continue;
                if (!components[j] || components[j] === "..") {
                    throw new Error("Invalid JSX path in entry " + (i + 1));
                }
                safeComponents.push(components[j]);
            }
            if (!/\.(jsx|jsxbin|js)$/i.test(relative)) {
                throw new Error("Not a JSX/JS script in entry " + (i + 1));
            }

            var scriptFile = new File(folder.fsName + "/" + safeComponents.join("/"));
            var filename = safeComponents[safeComponents.length - 1];
            scripts.push({
                file: scriptFile,
                title: typeof item.Headline === "string" && item.Headline
                    ? item.Headline : filename.replace(/\.(jsx|jsxbin|js)$/i, ""),
                description: typeof item.Description === "string" ? item.Description : "",
                group: "",
                missing: !scriptFile.exists
            });
        }

        if (entries.length > MAX_SCRIPTS) {
            scanWarning = "Only the first " + MAX_SCRIPTS + " entries are shown.";
        }
        return true;
    }

    function scanFolder(folder, relativePath, depth, selfPath) {
        if (depth > MAX_DEPTH || scripts.length >= MAX_SCRIPTS) return;

        var entries;
        try {
            entries = folder.getFiles();
        } catch (e) {
            scanWarning = "Some folders could not be read.";
            return;
        }

        for (var i = 0; i < entries.length; i++) {
            if (scripts.length >= MAX_SCRIPTS) {
                scanWarning = "Only the first " + MAX_SCRIPTS + " scripts are shown.";
                return;
            }

            var entry = entries[i];
            var name = readableName(entry.name);
            if (name.charAt(0) === ".") continue;

            if (entry instanceof Folder) {
                // Avoid following aliases that can cause directory loops.
                if (!entry.alias) {
                    scanFolder(entry, relativePath ? relativePath + "/" + name : name,
                               depth + 1, selfPath);
                }
            } else if (entry instanceof File && /\.(jsx|jsxbin|js)$/i.test(name)) {
                if (entry.fsName === selfPath) continue;
                scripts.push({
                    file: entry,
                    title: name.replace(/\.(jsx|jsxbin|js)$/i, ""),
                    description: "",
                    group: relativePath
                });
            }
        }
    }

    function refreshScripts() {
        scripts = [];
        scanWarning = "";
        manifestMode = false;

        if (scriptsFolder && scriptsFolder.exists) {
            try {
                if (!readManifest(scriptsFolder)) {
                    var selfPath = "";
                    try { selfPath = new File($.fileName).fsName; } catch (e) {}
                    scanFolder(scriptsFolder, "", 0, selfPath);
                }
            } catch (e) {
                scripts = [];
                scanWarning = MANIFEST_NAME + ": " + e.message;
            }
        }

        // JSON order is intentional; filename mode stays alphabetic.
        if (!manifestMode) {
            scripts.sort(function (a, b) {
                var groupOrder = compareText(a.group, b.group);
                return groupOrder !== 0 ? groupOrder : compareText(a.title, b.title);
            });
        }
        renderScripts();
    }

    function runScript(file) {
        if (!file.exists) {
            alert("Script not found:\n" + file.fsName + "\n\nClick Refresh to update the list.");
            return;
        }

        try {
            $.evalFile(file);
        } catch (e) {
            var message = "Could not run " + readableName(file.name) + ":\n\n" + e.toString();
            if (e.line) message += "\nLine: " + e.line;
            alert(message);
        }
    }

    var win = (thisObj instanceof Panel)
        ? thisObj
        : new Window("palette", "Script Shelf", undefined, { resizeable: true });

    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing = PANEL_SPACING;
    win.margins = PANEL_MARGIN;
    win.minimumSize = [230, 125];

    var toolbar = win.add("group");
    toolbar.orientation = "row";
    toolbar.alignment = ["fill", "top"];
    toolbar.spacing = 6;

    var chooseButton = toolbar.add("button", undefined, "Folder...");
    var refreshButton = toolbar.add("button", undefined, "Refresh");
    var folderLabel = win.add("statictext", undefined, "No folder selected", { truncate: "middle" });
    folderLabel.alignment = ["fill", "top"];

    var searchBox = win.add("edittext", undefined, "");
    searchBox.alignment = ["fill", "top"];
    searchBox.helpTip = "Filter scripts by name or folder";

    // Scrollable list.
    // ScriptUI has no scrolling container, so the whole list, scrollbar
    // included, is a single custom-drawn control that paints only the rows
    // currently in view. listArea gets its place from the layout manager and
    // the list fills it (see fitLayout); the explicit preferredSize keeps it
    // from asking for the height of all rows.
    var listArea = win.add("group");
    listArea.alignment = ["fill", "fill"];
    listArea.margins = 0;
    listArea.preferredSize = [300, 320];
    listArea.minimumSize = [120, 40];

    // customView, not customButton: in After Effects a customButton gets no
    // mousemove while the button is held and never gets mouseup (only
    // mousedown and onClick), so nothing can be dragged on it. A customView
    // gets mousedown, mousemove while held (even slightly past its edges)
    // and mouseup. Measured with MouseEventTest.jsx.
    var list = listArea.add("customView", [0, 0, 100, 100]);

    var statusLabel = win.add("statictext", undefined, "");
    statusLabel.alignment = ["fill", "bottom"];

    var fonts = (function () {
        try {
            var family = ScriptUI.applicationFonts.dialog.name;
            return {
                title: ScriptUI.newFont(family, ScriptUI.FontStyle.BOLD, 12),
                description: ScriptUI.newFont(family, ScriptUI.FontStyle.REGULAR, 10),
                chevron: ScriptUI.newFont(family, ScriptUI.FontStyle.REGULAR, 22),
                row: ScriptUI.newFont(family, ScriptUI.FontStyle.REGULAR, 12),
                heading: ScriptUI.newFont(family, ScriptUI.FontStyle.REGULAR, 11)
            };
        } catch (e) {
            var font = list.graphics.font;
            return { title: font, description: font, chevron: font, row: font, heading: font };
        }
    })();

    // ---- Row model ----------------------------------------------------------

    function clearRows() {
        rows = [];
        contentHeight = 0;
        measuredListWidth = -1;
        hoverIndex = -1;
        pressIndex = -1;
        drag = null;
        barPress = null;
    }

    function addRow(row) {
        row.y = rows.length ? contentHeight + ROW_GAP : 0;
        contentHeight = row.y + row.height;
        rows.push(row);
    }

    function addTextRow(text) {
        addRow({ kind: "text", text: text, height: 20 });
    }

    function addScriptRow(item) {
        addRow({
            kind: "script",
            item: item,
            height: manifestMode ? CARD_BASE_HEIGHT : 27
        });
    }

    function isClickable(index) {
        return index >= 0 && index < rows.length &&
            rows[index].kind === "script" && !rows[index].item.missing;
    }

    // Row under a y coordinate in list space (gaps return -1).
    function rowIndexAt(y) {
        var lo = 0, hi = rows.length - 1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (y < rows[mid].y) hi = mid - 1;
            else if (y >= rows[mid].y + rows[mid].height) lo = mid + 1;
            else return mid;
        }
        return -1;
    }

    // First row whose bottom edge is below the top of the view.
    function firstVisibleRow(offset) {
        var lo = 0, hi = rows.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (rows[mid].y + rows[mid].height <= offset) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    // ---- Drawing --------------------------------------------------------------

    // Longest prefix that fits, found by bisection rather than one
    // measureString call per character.
    function fitText(text, graphics, font, maxWidth) {
        if (!text || maxWidth < 25) return "";
        try {
            if (graphics.measureString(text, font).width <= maxWidth) return text;
            var lo = 0, hi = text.length - 1;
            while (lo < hi) {
                var mid = Math.ceil((lo + hi) / 2);
                if (graphics.measureString(text.substring(0, mid) + "…", font).width <= maxWidth) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            return text.substring(0, lo) + "…";
        } catch (e) {
            return text;
        }
    }

    // Wrap text by measured glyph widths, not by a fixed character count.
    // The final line gets an ellipsis when the description is longer than
    // the three lines available in the card.
    function wrapDescription(text, graphics, maxWidth) {
        var lines = [];
        var remaining = text.replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
        if (!remaining || maxWidth < 25) return lines;

        for (var line = 0; line < MAX_DESCRIPTION_LINES && remaining; line++) {
            try {
                if (graphics.measureString(remaining, fonts.description).width <= maxWidth) {
                    lines.push(remaining);
                    break;
                }

                if (line === MAX_DESCRIPTION_LINES - 1) {
                    lines.push(fitText(remaining, graphics, fonts.description, maxWidth));
                    break;
                }

                // Largest fitting prefix; prefer a word boundary if present.
                var lo = 1, hi = remaining.length;
                while (lo < hi) {
                    var mid = Math.ceil((lo + hi) / 2);
                    if (graphics.measureString(remaining.substring(0, mid), fonts.description).width <= maxWidth) {
                        lo = mid;
                    } else {
                        hi = mid - 1;
                    }
                }
                var splitAt = remaining.lastIndexOf(" ", lo);
                if (splitAt < 1) splitAt = lo;
                lines.push(remaining.substring(0, splitAt));
                remaining = remaining.substring(splitAt).replace(/^\s+/, "");
            } catch (e) {
                lines.push(fitText(remaining, graphics, fonts.description, maxWidth));
                break;
            }
        }
        return lines;
    }

    // Truncated strings are cached per row until the list width changes.
    function prepareText(row, graphics, maxWidth) {
        if (row.fitWidth === maxWidth) return;
        row.fitWidth = maxWidth;
        if (row.kind === "text") {
            row.fitTitle = fitText(row.text, graphics, fonts.heading, maxWidth);
            row.descriptionLines = [];
        } else {
            row.fitTitle = fitText(row.item.title, graphics,
                manifestMode ? fonts.title : fonts.row, maxWidth);
            row.descriptionLines = manifestMode && row.item.description
                ? wrapDescription(row.item.description, graphics, maxWidth) : [];
        }
    }

    // All JSON cards share one height, determined by the longest wrapped
    // description at the current panel width. Called only on width changes.
    function measureRowsForWidth(listWidth) {
        if (measuredListWidth === listWidth) return;

        var textWidth = Math.max(25, listWidth - (manifestMode ? 53 : 20));
        var maxLines = 0;
        for (var i = 0; i < rows.length; i++) {
            prepareText(rows[i], list.graphics, textWidth);
            if (manifestMode && rows[i].kind === "script") {
                maxLines = Math.max(maxLines, rows[i].descriptionLines.length);
            }
        }

        var sharedCardHeight = CARD_BASE_HEIGHT + maxLines * DESCRIPTION_LINE_HEIGHT;
        var bottom = 0;
        for (var j = 0; j < rows.length; j++) {
            var row = rows[j];
            if (row.kind === "script") row.height = manifestMode ? sharedCardHeight : 27;
            row.y = j ? bottom + ROW_GAP : 0;
            bottom = row.y + row.height;
        }
        contentHeight = bottom;
        measuredListWidth = listWidth;
    }

    // Graphic resources are immutable. Reuse them across drag frames instead
    // of creating 8 new native pens and brushes on every mousemove.
    function getDrawingStyles(g) {
        if (drawingStyles && drawingStyles.graphics === g) return drawingStyles;
        var solid = g.BrushType.SOLID_COLOR;
        var line = g.PenType.SOLID_COLOR;
        drawingStyles = {
            graphics: g,
            wellBrush: g.newBrush(solid, COLORS.well),
            rowBrush: g.newBrush(solid, COLORS.row),
            hoverBrush: g.newBrush(solid, COLORS.rowHover),
            borderPen: g.newPen(line, COLORS.border, 1),
            textPen: g.newPen(line, COLORS.text, 1),
            missingPen: g.newPen(line, COLORS.textMissing, 1),
            descriptionPen: g.newPen(line, COLORS.description, 1),
            headingPen: g.newPen(line, COLORS.heading, 1),
            thumbBrush: g.newBrush(solid, COLORS.thumb),
            thumbActiveBrush: g.newBrush(solid, COLORS.thumbActive)
        };
        return drawingStyles;
    }

    // Rounded bar from a rectangle and two circles, each filled separately
    // so overlapping sub-paths can't punch holes.
    function fillPill(g, brush, x, y, w, h) {
        if (h < w) h = w;
        g.newPath();
        g.rectPath(x, y + w / 2, w, h - w);
        g.fillPath(brush);
        g.newPath();
        g.ellipsePath(x, y, w, w);
        g.fillPath(brush);
        g.newPath();
        g.ellipsePath(x, y + h - w, w, w);
        g.fillPath(brush);
    }

    list.onDraw = function () {
        if (!this.size) return;
        var g = this.graphics;
        var fullWidth = this.size[0];
        var height = this.size[1];
        if (fullWidth <= 0 || height <= 0) return;

        var styles = getDrawingStyles(g);
        // Cards stop short of the scrollbar strip; the well spans everything.
        var width = cardsWidth(fullWidth);

        g.newPath();
        g.rectPath(0, 0, fullWidth, height);
        g.fillPath(styles.wellBrush);

        for (var i = firstVisibleRow(scrollOffset); i < rows.length; i++) {
            var row = rows[i];
            var top = row.y - scrollOffset;
            if (top >= height) break;

            if (row.kind === "text") {
                g.drawString(row.fitTitle, styles.headingPen, 2, top + 3, fonts.heading);
                continue;
            }

            var item = row.item;
            g.newPath();
            g.rectPath(0, top, width - 1, row.height - 1);
            g.fillPath(i === hoverIndex ? styles.hoverBrush : styles.rowBrush);
            g.strokePath(styles.borderPen);

            var titlePen = item.missing ? styles.missingPen : styles.textPen;
            if (manifestMode) {
                g.drawString(row.fitTitle, titlePen, 12,
                    top + (item.description ? 11 : 15), fonts.title);
                for (var d = 0; d < row.descriptionLines.length; d++) {
                    g.drawString(row.descriptionLines[d], styles.descriptionPen,
                        12, top + 32 + d * DESCRIPTION_LINE_HEIGHT, fonts.description);
                }
                g.drawString("›", titlePen, width - 25,
                    top + (item.description ? 17 : 10), fonts.chevron);
            } else {
                g.drawString(row.fitTitle, titlePen, 10, top + 6, fonts.row);
            }
        }

        if (maxScroll > 0) {
            var thumb = thumbGeometry(height);
            var active = barHover || (barPress && barPress.onThumb);
            fillPill(g, active ? styles.thumbActiveBrush : styles.thumbBrush,
                fullWidth - SCROLLBAR_WIDTH + (SCROLLBAR_WIDTH - THUMB_WIDTH) / 2,
                thumb.top + 1, THUMB_WIDTH, thumb.height - 2);
        }
    };

    function redrawList() {
        try { list.notify("onDraw"); } catch (e) {}
    }

    // ---- Scrolling ------------------------------------------------------------

    function clampScroll(value) {
        return Math.max(0, Math.min(Math.round(value), maxScroll));
    }

    function setScroll(value) {
        var next = clampScroll(value);
        if (next === scrollOffset) return;
        scrollOffset = next;
        redrawList();
    }

    // Width left for the cards; the scrollbar strip exists only on overflow.
    function cardsWidth(fullWidth) {
        return maxScroll > 0
            ? Math.max(1, fullWidth - SCROLLBAR_WIDTH - SCROLLBAR_GAP) : fullWidth;
    }

    function isOnScrollbar(x) {
        return maxScroll > 0 && !!list.size && x >= cardsWidth(list.size[0]);
    }

    // Thumb size is proportional to how much of the list is visible.
    function thumbGeometry(height) {
        var thumbHeight = Math.round(height * height / Math.max(contentHeight, 1));
        thumbHeight = Math.min(height, Math.max(THUMB_MIN_HEIGHT, thumbHeight));
        var travel = height - thumbHeight;
        return {
            top: (maxScroll > 0 && travel > 0) ? Math.round(travel * scrollOffset / maxScroll) : 0,
            height: thumbHeight,
            travel: travel
        };
    }

    function offsetForThumbTop(thumbTop, geometry) {
        if (geometry.travel <= 0) return 0;
        return thumbTop / geometry.travel * maxScroll;
    }

    // A click on the track pages toward the click, like a native scrollbar.
    function pageToward(y) {
        var height = list.size[1];
        var thumb = thumbGeometry(height);
        var page = Math.max(ROW_GAP, height - PAGE_OVERLAP);
        if (y < thumb.top) setScroll(scrollOffset - page);
        else if (y >= thumb.top + thumb.height) setScroll(scrollOffset + page);
    }

    // ---- Mouse: hover, click, drag-to-scroll, scrollbar ---------------------
    //
    // The list is a customView, which in After Effects reports mousedown,
    // mousemove while the button is held (also slightly past its edges) and
    // mouseup. A gesture starts on mousedown and ends on mouseup or on the
    // next mousedown; mouseout only clears hover. Actions happen on release.

    var eventLog = [];

    function logEvent(name, e) {
        if (!DEBUG_EVENTS) return;
        var entry = name;
        if (e && typeof e.clientY === "number") {
            entry += " " + Math.round(e.clientX) + "," + Math.round(e.clientY);
        }
        // Collapse runs of moves so the line stays readable.
        if (name === "move" && eventLog.length && eventLog[eventLog.length - 1].indexOf("move") === 0) {
            eventLog[eventLog.length - 1] = entry;
        } else {
            eventLog.push(entry);
        }
        if (eventLog.length > 6) eventLog.shift();
        statusLabel.text = eventLog.join(" · ");
    }

    var tipIndex = -1;

    function setHover(index) {
        // Tooltip for any script row (missing files included), set only on change.
        var tip = (index >= 0 && index < rows.length && rows[index].kind === "script") ? index : -1;
        if (tip !== tipIndex) {
            tipIndex = tip;
            list.helpTip = tip < 0 ? "" : rows[tip].item.file.fsName +
                (rows[tip].item.missing ? " (file not found)" : "");
        }

        if (!isClickable(index)) index = -1;
        if (index === hoverIndex) return;
        hoverIndex = index;
        redrawList();
    }

    function setBarHover(on) {
        if (on === barHover) return false;
        barHover = on;
        return true;
    }

    list.addEventListener("mousedown", function (e) {
        logEvent("down", e);
        drag = null;
        barPress = null;
        pressIndex = -1;

        if (isOnScrollbar(e.clientX)) {
            var thumb = thumbGeometry(list.size[1]);
            barPress = {
                onThumb: e.clientY >= thumb.top && e.clientY < thumb.top + thumb.height,
                grab: e.clientY - thumb.top,
                y: e.clientY
            };
            return;
        }

        pressIndex = rowIndexAt(e.clientY + scrollOffset);
        drag = { y: e.clientY, offset: scrollOffset, moved: false };
    });

    list.addEventListener("mousemove", function (e) {
        if (barPress || drag) logEvent("move", e);
        if (barPress) {
            // The thumb follows the cursor pixel for pixel. A press on the
            // track waits for release and pages then.
            if (barPress.onThumb) {
                var before = scrollOffset;
                setScroll(offsetForThumbTop(e.clientY - barPress.grab, thumbGeometry(list.size[1])));
                if (scrollOffset === before && !barPress.shown) redrawList();
                barPress.shown = true;
            }
            return;
        }
        if (drag) {
            // Grab the list and drag it, like the Hand tool.
            var dy = e.clientY - drag.y;
            if (!drag.moved && Math.abs(dy) >= DRAG_THRESHOLD) drag.moved = true;
            if (drag.moved) {
                if (hoverIndex !== -1) setHover(-1);
                setScroll(drag.offset - dy);
            }
            return;
        }

        var onBar = isOnScrollbar(e.clientX);
        var barChanged = setBarHover(onBar);
        var hoverBefore = hoverIndex;
        setHover(onBar ? -1 : rowIndexAt(e.clientY + scrollOffset));
        if (barChanged && hoverIndex === hoverBefore) redrawList();
    });

    // Runs on mouseup: pages for a track click, runs the script for a click
    // that started and ended on the same card without dragging.
    function finishPress(clientY) {
        if (barPress) {
            var press = barPress;
            barPress = null;
            if (!press.onThumb) pageToward(press.y);
            redrawList();
            return;
        }

        var index = pressIndex;
        var wasDrag = !!(drag && drag.moved);
        pressIndex = -1;
        drag = null;
        if (wasDrag || !isClickable(index)) return;
        if (typeof clientY === "number" && rowIndexAt(clientY + scrollOffset) !== index) return;
        runScript(rows[index].item.file);
    }

    list.addEventListener("mouseup", function (e) {
        logEvent("up", e);
        finishPress(e.clientY);

        // Released outside the list: drop the hover that mouseout skipped.
        var size = list.size;
        if (size && (e.clientX < 0 || e.clientY < 0 || e.clientX >= size[0] || e.clientY >= size[1])) {
            var barChanged = setBarHover(false);
            var hoverBefore = hoverIndex;
            setHover(-1);
            if (barChanged && hoverIndex === hoverBefore) redrawList();
        }
    });

    list.addEventListener("mouseout", function (e) {
        logEvent("out", e);
        // Hover only. A drag keeps going: moves and the final mouseup still
        // arrive when the cursor slips past the edge.
        if (barPress || drag) return;
        var barChanged = setBarHover(false);
        var hoverBefore = hoverIndex;
        setHover(-1);
        if (barChanged && hoverIndex === hoverBefore) redrawList();
    });

    // ---- Layout ---------------------------------------------------------------

    // Sizes the list and the scrollbar inside listArea.
    function updateScroll() {
        if (!listArea.size) return;
        var areaWidth = listArea.size[0];
        var areaHeight = listArea.size[1];

        // The scrollbar changes available text width, which can change the
        // number of wrapped lines. Measure once at full width, then again if
        // we actually need the scrollbar.
        measureRowsForWidth(Math.max(1, areaWidth));
        var needsBar = contentHeight > areaHeight;
        var listWidth = Math.max(1, needsBar
            ? areaWidth - SCROLLBAR_WIDTH - SCROLLBAR_GAP : areaWidth);
        if (needsBar) measureRowsForWidth(listWidth);
        maxScroll = Math.max(0, contentHeight - areaHeight);
        scrollOffset = clampScroll(scrollOffset);

        // The list control spans the whole area; the scrollbar strip is part
        // of its drawing (see cardsWidth).
        var fullWidth = Math.max(1, areaWidth);
        var fullHeight = Math.max(1, areaHeight);
        list.location = [0, 0];
        if (!list.size || list.size[0] !== fullWidth || list.size[1] !== fullHeight) {
            list.size = [fullWidth, fullHeight];
        }
        redrawList();
    }

    // Runs after the ScriptUI layout manager: stretches the list to the
    // space left between the search box and the status line, whatever
    // size the docked panel or the palette currently has.
    function fitLayout() {
        if (!win.size || !listArea.location) return;
        var width = Math.max(60, win.size[0] - PANEL_MARGIN * 2);
        var statusHeight = (statusLabel.size && statusLabel.size[1] > 0)
            ? statusLabel.size[1] : 18;
        var top = listArea.location[1];
        var height = Math.max(30,
            win.size[1] - top - PANEL_SPACING - statusHeight - PANEL_MARGIN);

        listArea.location = [PANEL_MARGIN, top];
        listArea.size = [width, height];
        statusLabel.location = [PANEL_MARGIN, top + height + PANEL_SPACING];
        statusLabel.size = [width, statusHeight];
        updateScroll();
    }

    // ---- Content --------------------------------------------------------------

    function renderScripts() {
        clearRows();
        scrollOffset = 0; // new list or new filter: back to the top
        tipIndex = -1;
        list.helpTip = "";

        if (!scriptsFolder || !scriptsFolder.exists) {
            folderLabel.text = "Choose a folder containing your scripts";
            folderLabel.helpTip = "";
            addTextRow("Click Folder... to begin.");
            statusLabel.text = "";
        } else {
            folderLabel.text = readableName(scriptsFolder.name);
            folderLabel.helpTip = scriptsFolder.fsName;

            var query = searchBox.text.toLowerCase();
            var visibleCount = 0;
            var lastGroup = null;

            for (var i = 0; i < scripts.length; i++) {
                var item = scripts[i];
                if (query && (item.title + " " + item.description + " " + item.group).toLowerCase().indexOf(query) < 0) {
                    continue;
                }

                if (!manifestMode && item.group !== lastGroup && item.group !== "") {
                    addTextRow(item.group);
                }
                lastGroup = item.group;
                addScriptRow(item);
                visibleCount++;
            }

            if (visibleCount === 0) {
                addTextRow(scanWarning ? "Check " + MANIFEST_NAME + " or folder permissions."
                    : scripts.length === 0 ? "No scripts found." : "No matching scripts.");
            }

            statusLabel.text = visibleCount + " / " + scripts.length + " scripts" +
                (manifestMode ? " (JSON)" : "");
            if (scanWarning) statusLabel.text += "  |  " + scanWarning;
        }

        // No controls were added or removed, so no full relayout is needed.
        updateScroll();
    }

    chooseButton.onClick = function () {
        var folder = Folder.selectDialog("Choose the folder containing your After Effects scripts");
        if (folder) {
            scriptsFolder = folder;
            saveFolder(folder);
            refreshScripts();
        }
    };

    refreshButton.onClick = refreshScripts;
    searchBox.onChanging = renderScripts;
    win.onResizing = win.onResize = function () {
        this.layout.resize();
        fitLayout();
    };

    scriptsFolder = readSavedFolder();
    refreshScripts();

    win.layout.layout(true);
    win.layout.resize();
    fitLayout();

    if (win instanceof Window) {
        // A palette lays itself out again when shown; re-fit afterwards.
        win.onShow = function () { fitLayout(); };
        win.center();
        win.show();
    }
})(this);
