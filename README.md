# Light Dict

Lightweight extension for instant action to primary selection, especially optimized for Dictionary lookup.

>L, you know what? The Shinigami only eats apples. —— *Light Yagami*<br>
[![license]](/LICENSE)
<br>

![ld](https://user-images.githubusercontent.com/17917040/91119018-d33a1900-e6c4-11ea-9bf0-b1c1a742cfeb.gif)

## Installation

### Recommended

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

### Manual

The latest and supported version should only work on the the most current stable version of GNOME Shell.

```bash
git clone https://github.com/tuberry/light-dict.git && cd light-dict
make && make install
# make LANG=your_language_code mergepo # for translation
```

For older versions, it's necessary to switch the git tag before `make`:

```bash
# git tag # to see available versions
git checkout your_gnome_shell_version
```

## Features

### Basic

* Scroll on the iconbar to flip pages;
* Scroll on the systray to toggle triggers;
* Middle click on the panel to copy its content;

### DBus

For the [DBus] usage, see [_ldocr.fish](/_ldocr.fish) as a sample reference.

#### Methods

```bash
gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict
```

#### Arguments

* temp: `a string` (temporary parameters for OCR)
* type: `'^swift(:.+)?$'` | `'popup'` | `'display'` (fallback) | `'auto'` (follow the trigger)
* text: `a string` | `''` (for primary selection)
* info: `a string` (for the `'display'` type) | `''` (for the other types)

### OCR

#### Dependencies

* [python-opencv]
* [python-pytesseract]
* [python-googletrans]: (optional) specify the DEST (e.g. `-d zh-cn`) to enable

 ```bash
yay -S python-opencv python-pytesseract # use the package manager of your distro
```

#### Usage

Enable OCR and fill in parameters (click the button for details) as you wish:

![ocr](https://user-images.githubusercontent.com/17917040/130025814-1b847b34-0373-46a1-a65e-5546f1687ba5.png)

*Note* OCR here is subject to factors such as font, color, and background, which says any unexpected results are expected, but usually the simpler the scene the better the results.

#### Screencast

https://user-images.githubusercontent.com/17917040/130017649-ca978f47-7c63-4d31-8d32-99d78ecb8907.mp4

## Note


* This extension doesn't offer any additional icons or dictionaries.
* If you need English-Chinese offline dictionaries, try [dict-ecdict] or [dict-cedict].
* If you need to customize the appearance of some widgets, try [user-theme-x].

## Acknowledgements

* [youdaodict]: the idea of popup
* [gsconnect]: fake keyboard input
* [swift-selection-search]: the stylesheet of iconbar

[python-opencv]:https://opencv.org/
[dict-cedict]:https://github.com/tuberry/dict-cedict
[dict-ecdict]:https://github.com/tuberry/dict-ecdict
[DBus]:https://www.freedesktop.org/wiki/Software/dbus/
[user-theme-x]:https://github.com/tuberry/user-theme-x
[youdaodict]:https://github.com/HalfdogStudio/youdaodict
[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[gsconnect]:https://github.com/andyholmes/gnome-shell-extension-gsconnect
[swift-selection-search]:https://github.com/CanisLupus/swift-selection-search
[python-pytesseract]:https://github.com/madmaze/pytesseract
[python-googletrans]:https://github.com/ssut/py-googletrans
