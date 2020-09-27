# Light Dict
Lightweight selection-popup extension of Gnome Shell with icon bar and tooltips-style panel, especially optimized for Dictionary.

>L, you know what? The Death eats apples only. —— *Light Yagami*<br>
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

The inspiration comes from two lovely extensions in Firefox, [SSS](https://github.com/CanisLupus/swift-selection-search) and [youdaodict](https://github.com/HalfdogStudio/youdaodict). If you have any questions about the usage, feel free to open an issue for discussion.

[DBus](https://www.freedesktop.org/wiki/Software/dbus/) is also available here in case of some needs (eg. [OCR](/ldocr.sh) to translate).
```
# LookUp
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.LookUp "" # primary selection
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.LookUp "'word'" # 'word'

# ShowBar
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.ShowBar "" # primary selection
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/LightDict --method org.gnome.Shell.Extensions.LightDict.ShowBar "'word'" # 'word'
```

<details>
<summary>ldocr.sh</summary>

```bash
#!/bin/bash
#by tuberry

LDWORDOCR="/tmp/ldword_ocr"

## Screenshot $LDWORDOCR.png
area=$(gdbus call --session \
	--dest org.gnome.Shell \
	--object-path /org/gnome/Shell/Screenshot \
	--method org.gnome.Shell.Screenshot.SelectArea) # "(x, y, w, h)"
area=(${area//[!0-9 ]/}) # "(x, y, w, h)" => (x, y, w, h)
gdbus call --session \
	--dest org.gnome.Shell \
	--object-path /org/gnome/Shell/Screenshot \
	--method org.gnome.Shell.Screenshot.ScreenshotArea ${area[0]} ${area[1]} ${area[2]} ${area[3]} false "'$LDWORDOCR.png'" \
	&> /dev/null # "(success, filename_used)" > /dev/null

## OCR $LDWORDOCR.png to $word
# mogrify -modulate 100,0 -resize 400% $LDWORDOCR.png # should increase detection rate (refer to: https://zhuanlan.zhihu.com/p/114917496)
tesseract $LDWORDOCR.png $LDWORDOCR &> /dev/null -l eng # need tesseract and its eng database
truncate -s -2 $LDWORDOCR.txt # delete \n and ^L at the end of $LDWORDOCR.txt
word=$(cat $LDWORDOCR.txt | tr '\n' ' ')
# rm $LDWORDOCR.png $LDWORDOCR.txt # delete tmp files

## LookUp $word
gdbus call --session \
	--dest org.gnome.Shell \
	--object-path /org/gnome/Shell/Extensions/LightDict \
	--method org.gnome.Shell.Extensions.LightDict.LookUp "$word" \
	&> /dev/null # "()" > /dev/null
```
</details>

## Acknowledgements
* [youdaodict](https://github.com/HalfdogStudio/youdaodict): idea of popup panel
* [swift-selection-search](https://github.com/CanisLupus/swift-selection-search): stylesheet of iconbar
* [clipboard-indicator](https://github.com/Tudmotu/gnome-shell-extension-clipboard-indicator): some UI widgets of prefs page
* [gsconnect](https://github.com/andyholmes/gnome-shell-extension-gsconnect): fake keyboard input

## Note
1. This extension doesn't offer any icons or dictionary resources though it's named Light Dict.
2. If you need to customize the appearance of some widgets, please try this extension - [User Themes X].

[EGO]:https://extensions.gnome.org/extension/2959/light-dict/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
[User Themes X]:https://github.com/tuberry/user-theme-x
