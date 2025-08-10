<!--
SPDX-FileCopyrightText: tuberry
SPDX-License-Identifier: CC-BY-SA-4.0
-->
# Light Dict

GNOME Shell extension to manipulate primary selections on the fly, typically used as Lightweight Dictionaries.

>L, you know what? The Shinigami only eats apples. —— *Light Yagami*\
[![license]](/LICENSE.md)

![ld](https://user-images.githubusercontent.com/17917040/91119018-d33a1900-e6c4-11ea-9bf0-b1c1a742cfeb.gif)

## Installation

### Manual

The latest and supported version should only work on the [current stable version](https://release.gnome.org/calendar/#branches) of GNOME Shell.

```bash
git clone https://github.com/tuberry/light-dict.git && cd light-dict
meson setup build && meson install -C build
# meson setup build -Dtarget=system && meson install -C build # system-wide, default --prefix=/usr/local
```

For older versions, it's recommended to install via:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
          --method org.gnome.Shell.Extensions.InstallRemoteExtension 'light-dict@tuberry.github.io'
```

It's quite the same as installing from:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Features

### DBus

For the [DBus] usage, refer to [_ldocr.sh](/cli/_ldocr.sh).

#### Methods

```bash
gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict
```

* The `Get` method is private for the built-in OCR [script](/src/ldocr.py).

#### Arguments

##### OCR

* args: `a string` (temporary OCR arguments)

##### Run

* type: `'auto'` (follow the trigger) | `'^swift(:.+)?$'` | `'popup'` | `'print'` (directly show the following `text` & `info`)
* text: `a string` | `''` (for primary selection)
* info: `a string` (for the `'print'` type) | `''` (for the other types)
* area: `[]` (default to the cursor) | `[x, y, width, height]` (the source area)

### OCR

OCR here is subject to factors such as fonts, colors, and backgrounds, which says any unexpected results are expected, but usually the simpler the scenes the better the results.

#### Dependencies

* [opencv-python]
* [pytesseract]

#### Screencast

<https://user-images.githubusercontent.com/17917040/137623193-9a21117b-733e-4e1b-95d2-ac32f865af26.mp4>

## Notes

* By lightweight, I mean that it doesn't come with any dictionary sources. :)
* For English-Chinese offline dictionaries, try [dict-ecdict] or [dict-cedict].
* To customize appearances of some [widgets](/res/style/stylesheet.scss), try [user-theme-x].

## Contributions

Feel free to open an issue or PR in the repo for any question or idea.

### Translations

To initialize or update the po file from sources:

```bash
bash ./cli/update-po.sh [your_lang_code] # like zh_CN, default to $LANG
```

### Developments

To install GJS TypeScript type [definitions](https://www.npmjs.com/package/@girs/gnome-shell):

```bash
npm install @girs/gnome-shell --save-dev
```

## Acknowledgements

* [youdaodict]: the idea of panel
* [swift-selection-search]: the stylesheet of popup
* [capture2text]: the idea of bubble OCR (dialog OCR here)

[opencv-python]:https://github.com/opencv/opencv-python
[dict-cedict]:https://github.com/tuberry/dict-cedict
[dict-ecdict]:https://github.com/tuberry/dict-ecdict
[DBus]:https://www.freedesktop.org/wiki/Software/dbus/
[user-theme-x]:https://github.com/tuberry/user-theme-x
[youdaodict]:https://github.com/HalfdogStudio/youdaodict
[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3+-green.svg
[swift-selection-search]:https://github.com/CanisLupus/swift-selection-search
[pytesseract]:https://github.com/madmaze/pytesseract
[capture2text]:https://capture2text.sourceforge.net/
