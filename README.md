# Light Dict
Lightweight selection-popup extension of Gnome Shell with icon bar and tooltips-style panel, especially optimized for Dictionary.

>L, you know what? The Death eats apples only. —— *Light Yagami*<br>
[![license]](/LICENSE)

<br>

## Installation
[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

Or manually:
```
git clone git@github.com:tuberry/light-dict.git
cp -r ./light-dict/light-dict@tuberry.github.io ~/.local/share/gnome-shell/extensions/
```

## Features

The inspiration comes from two lovely extensions in Firefox, [SSS](https://github.com/CanisLupus/swift-selection-search) and [youdaodict](https://github.com/HalfdogStudio/youdaodict).

![ld](https://user-images.githubusercontent.com/17917040/91119018-d33a1900-e6c4-11ea-9bf0-b1c1a742cfeb.gif)

[DBus](https://www.freedesktop.org/wiki/Software/dbus/) is also available here in case of some needs (eg. OCR to translate).
```shell
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.LookUp "word" # look up 'word'
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.LookUp "" # look up primary selection
```

## Acknowledgements
* [youdaodict](https://github.com/HalfdogStudio/youdaodict): idea of popup panel
* [swift-selection-search](https://github.com/CanisLupus/swift-selection-search): stylesheet of iconbar
* [clipboard-indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator): some UI widgets of prefs page
* [gsconnect](https://github.com/andyholmes/gnome-shell-extension-gsconnect): fake keyboard input

## Note
1. This extension doesn't offer any icons or dictionary resources though it's named Light Dict.
2. If you have any questions about the usage, feel free to open an issue for discussion.
3. If you need to customize the appearance of some widgets, please try this extension - [User Themes X].

[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[User Themes X]:https://github.com/tuberry/user-theme-x
