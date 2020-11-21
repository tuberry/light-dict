# Light Dict
Lightweight extension for instant action to primary selection, especially optimized for Dictionary look-up.

>L, you know what? The Shinigami only eat apples. —— *Light Yagami*<br>
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
Scroll on icon bar to PageDown/PageUp. If you have any other questions about the usage, feel free to open an issue for discussion.

[DBus](https://www.freedesktop.org/wiki/Software/dbus/) is also available here in case of some needs (eg. [OCR](/ldocr.sh) to translate).
```
# LookUp
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.LookUp "" # primary selection
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.LookUp "'word'" # 'word'

# ShowBar
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.ShowBar "" # primary selection
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.ShowBar "'word'" # 'word'
```

## Acknowledgements
* [youdaodict](https://github.com/HalfdogStudio/youdaodict): idea of popup;
* [swift-selection-search](https://github.com/CanisLupus/swift-selection-search): stylesheet of iconbar;
* [gsconnect](https://github.com/andyholmes/gnome-shell-extension-gsconnect): fake keyboard input;

## Note
1. This extension doesn't offer any icons or dictionary resources though it's named Light Dict. If you need English-Chinese offline dictionary, try [dict-ecdict](https://github.com/tuberry/dict-ecdict) or [dict-cedict](https://github.com/tuberry/dict-cedict).
2. If you need to customize the appearance of some widgets, try [User Themes X].

[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[User Themes X]:https://github.com/tuberry/user-theme-x
