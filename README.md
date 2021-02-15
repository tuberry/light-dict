# Light Dict

Lightweight extension for instant action to primary selection, especially optimized for Dictionary lookup.

>L, you know what? The Shinigami only eats apples. —— *Light Yagami*<br>
[![license]](/LICENSE)
<br>

![ld](https://user-images.githubusercontent.com/17917040/91119018-d33a1900-e6c4-11ea-9bf0-b1c1a742cfeb.gif)

## Installation
[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

Or manually:

```
git clone https://github.com/tuberry/light-dict.git
cd light-dict && make install
```

## Features

The inspiration comes from two lovely extensions in Firefox, [SSS](https://github.com/CanisLupus/swift-selection-search) and [youdaodict](https://github.com/HalfdogStudio/youdaodict).
If you have any other questions about the usage, feel free to open an issue for discussion.

1. Scroll on iconbar to flip page;
2. Scroll on systray to toggle mode;
3. Click on the menu to add/remove current `wmclass`;
4. [DBus](https://www.freedesktop.org/wiki/Software/dbus/) is also available (eg. [OCR](/ldocr.sh) to translate):

```
# Swift
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.Swift "" # primary selection
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.Swift "'word'" # 'word'
# Popup
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.Popup "" # primary selection
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.Popup "'word'" # 'word'
# Toggle
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.Toggle
```

## Acknowledgements

* [youdaodict](https://github.com/HalfdogStudio/youdaodict): idea of popup;
* [swift-selection-search](https://github.com/CanisLupus/swift-selection-search): stylesheet of iconbar;
* [gsconnect](https://github.com/andyholmes/gnome-shell-extension-gsconnect): fake keyboard input;

## Note

1. This extension doesn't offer any icons or dictionary resources though it's named Light Dict. If you need English-Chinese offline dictionary, try [dict-ecdict](https://github.com/tuberry/dict-ecdict) or [dict-cedict](https://github.com/tuberry/dict-cedict).
2. If you need to customize the appearance of some widgets, try [user-theme-x].

## Breaking Changes

Some settings keys had ben deprecated. You could:

1. `dconf dump /org/gnome/shell/extensions/light-dict/ > conf.txt`;
2. edit the `conf.txt` according to the [schema](https://github.com/tuberry/light-dict/commit/5818afd651190be4bb441cae49bcacfc895623fe#diff-0f322fface52cc1e68c32d98ff3990a08e100bff4fc56ac230f6db9e4093c9f3) changes;
3. `dconf load /org/gnome/shell/extensions/light-dict/ < conf.txt`;
4. change The DBus interface in the [script](/ldocr.sh) if it's used;

[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[user-theme-x]:https://github.com/tuberry/user-theme-x
