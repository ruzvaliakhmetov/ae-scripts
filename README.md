# After Effects Scripts

A small collection of standalone JSX utilities for Adobe After Effects, with an optional dockable launcher.

## Setup

1. Copy `ScriptUI/ScriptShelf.jsx` to After Effects' `Scripts/ScriptUI Panels` folder (on macOS: `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`).
2. Restart After Effects and open **Window → ScriptShelf**.
3. Click **Folder…** and select this repository's `scripts` folder. It can live anywhere on your computer.

The panel remembers the folder and provides search, refresh and scrolling. Individual scripts also work without the panel: use **File → Scripts → Run Script File…** to run any `.jsx` file.

## Scripts

| Script | What it does |
| --- | --- |
| `CompSizeAnchor.jsx` | Resizes the active composition with a nine-point anchor, like Photoshop's Canvas Size. |
| `RelinkIdenticalFootage.jsx` | Relinks matching still images in same-named project folders to a selected master folder, after checking file bytes and AE interpretation. It does **not** check duplicates inside one folder or delete files/folders. |
| `ReplaceAndFit.jsx` | Replaces a selected footage layer with a file you choose; recalculates animated Scale and Anchor Point to retain the framing while preserving Position. Defaults to *cover*; change `FIT_MODE` to `"contain"` in the script if needed. |
| `ScaleDownEntireAEProject.jsx` | Scales all compositions to 50%, adjusting nested layers and related spatial properties. Save a backup before running. |
| `Two_Row_Image_Grid_With_Captions_v2.jsx` | Arranges 1–20 selected still images in a precomp (two rows for multiple images), with captions from filenames. Replaces their transforms/keyframes; requires AE 24.0+. |

## Panel configuration

`scripts/ScriptShelf.json` is optional. It sets the order, titles and descriptions of the panel buttons:

```json
[
  {
    "Headline": "Replace footage",
    "Description": "Replace and fit a selected footage layer",
    "JSX": "ReplaceAndFit.jsx"
  }
]
```

`JSX` is a path relative to the `scripts` folder (subfolders are supported). **Only listed scripts appear** while the JSON file is present; the image-grid script is currently not listed. To show all scripts automatically by filename instead, remove or rename `ScriptShelf.json`, then click **Refresh**.

No extra dependencies are needed for the launcher.
