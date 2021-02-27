# Light Dict

Lightweight extension for instant action to primary selection, especially optimized for Dictionary lookup.

>L, you know what? The Shinigami only eats apples. —— *Light Yagami*<br>
[![license]](/LICENSE)
<br>

![ld](https://user-images.githubusercontent.com/17917040/91119018-d33a1900-e6c4-11ea-9bf0-b1c1a742cfeb.gif)

## Installation

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

Or manually:

```bash
git clone https://github.com/tuberry/light-dict.git
cd light-dict && make install
```

## Features

Inspired by two lovely web extensions, [swift-selection-search] and [youdaodict].

1. Scroll on iconbar to flip page;
2. Scroll on systray to toggle mode;
3. Click on the menu to add/remove current app;
4. [DBus] interface (eg. [OCR](/_ldocr.fish) to translate):

```bash
# see the methods
gdbus introspect --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict
```

## Acknowledgements

* [youdaodict]: idea of popup;
* [swift-selection-search]: stylesheet of iconbar;
* [gsconnect]: fake keyboard input;

## Note

1. This extension doesn't offer any icon or dictionary resources.
2. If you need English-Chinese offline dictionary, try [dict-ecdict] or [dict-cedict].
3. If you need to customize the appearance of some widgets, try [user-theme-x].

[dict-cedict]:https://github.com/tuberry/dict-cedict
[dict-ecdict]:https://github.com/tuberry/dict-ecdict
[DBus]:https://www.freedesktop.org/wiki/Software/dbus/
[user-theme-x]:https://github.com/tuberry/user-theme-x
[youdaodict]:https://github.com/HalfdogStudio/youdaodict
[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[gsconnect]:https://github.com/andyholmes/gnome-shell-extension-gsconnect
[swift-selection-search]:https://github.com/CanisLupus/swift-selection-search
