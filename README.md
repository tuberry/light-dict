# Light Dict

Lightweight extension for on-the-fly manipulation to primary selections, especially optimized for Dictionary lookups.

>L, you know what? The Shinigami only eats apples. —— *Light Yagami*\
[![license]](/LICENSE.md)

![ld](https://user-images.githubusercontent.com/17917040/91119018-d33a1900-e6c4-11ea-9bf0-b1c1a742cfeb.gif)

## Installation

### Manual

The latest and supported version should only work on the most current stable version of GNOME Shell.

```bash
git clone --recurse-submodules https://github.com/tuberry/light-dict.git && cd light-dict
meson setup build && meson install -C build
# meson setup build -Dtarget=system && meson install -C build # system-wide, default --prefix=/usr/local
```

For older versions, it's recommended to install via:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Features

### Command

#### Bash

Scripts run within `bash -c`:

* use envar `$LDWORD` to get the captured text (by primary selection or OCR);
* use envar `$LDAPPID` to get the focused app (most likely where the text from);
* enable `Await result` to show a spinner when running (eye candy for time-consuming commands);

#### JS

Scripts run within scoped JS `eval()` to provide DE related functions:

* `LDWORD`: the captured text;
* `LDAPPID`: the focused app;
* `open('uri')`: open uri with default app;
* `copy(LDWORD)`: copy `LDWORD` to clipboard;
* `search(LDWORD)`: search `LDWORD`in Overview;
* `key('super+a')`: simulate keyboard input;

And some native JS functions like `LDWORD.toUpperCase()`.

### DBus

For the [DBus] usage, see [_ldocr.fish](/cli/_ldocr.fish) as a sample reference.

#### Methods

```bash
gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict
```

#### Arguments

##### OCR

* args: `a string` (temporary arguments for OCR)

##### Run

* type: `'^swift(:.+)?$'` | `'popup'` | `'display'` (fallback) | `'auto'` (follow the trigger)
* text: `a string` | `''` (for primary selection)
* info: `a string` (for the `'display'` type) | `''` (for the other types)
* area: `[x, y, width, height]` (the source area) | `[]` (default to the cursor)

### OCR

* OCR here is subject to factors such as fonts, colors, and backgrounds, which says any unexpected results are expected, but usually the simpler the scenes the better the results.

#### Dependencies

* [python-opencv]
* [python-pytesseract]

 ```bash
yay -S python-opencv python-pytesseract # use the package manager of your distro
```

![ldpref](https://github.com/user-attachments/assets/c2edd859-75a1-4f94-b15e-94c26f6c6bd5)

#### Screencast

https://user-images.githubusercontent.com/17917040/137623193-9a21117b-733e-4e1b-95d2-ac32f865af26.mp4

## Notes

* This extension doesn't offer any additional icons or dictionaries.
* If you need English-Chinese offline dictionaries, try [dict-ecdict] or [dict-cedict].
* If you need to customize appearances of some [widgets](/res/style/stylesheet.scss), try [user-theme-x].

## Contributions

Any contribution is welcome.

### Ideas

For any question or idea, feel free to open an issue or PR in the repo.

### Translations

To update the po file from sources:

```bash
bash ./cli/update-po.sh [your_lang_code] # like zh_CN, default to $LANG
```

### Developments

To install GJS TypeScript type [definitions](https://www.npmjs.com/package/@girs/gnome-shell):

```bash
npm install @girs/gnome-shell --save-dev
```

## Acknowledgements

* [youdaodict]: the idea of popup
* [swift-selection-search]: the stylesheet of iconbar
* [capture2text]: the idea of bubble OCR (dialog OCR here)

[python-opencv]:https://opencv.org/
[dict-cedict]:https://github.com/tuberry/dict-cedict
[dict-ecdict]:https://github.com/tuberry/dict-ecdict
[DBus]:https://www.freedesktop.org/wiki/Software/dbus/
[user-theme-x]:https://github.com/tuberry/user-theme-x
[youdaodict]:https://github.com/HalfdogStudio/youdaodict
[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3+-green.svg
[swift-selection-search]:https://github.com/CanisLupus/swift-selection-search
[python-pytesseract]:https://github.com/madmaze/pytesseract
[capture2text]:https://capture2text.sourceforge.net/
