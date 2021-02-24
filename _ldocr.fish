#!/bin/fish
#by tuberry

set ldocr '/tmp/ldword_ocr.png'

## Screenshot $ldocr
set areastr (gdbus call --session \
--dest org.gnome.Shell \
--object-path /org/gnome/Shell/Screenshot \
--method org.gnome.Shell.Screenshot.SelectArea) # "(x, y, w, h)"
set -l area (string split ' ' (string replace -ra [^0-9\ ] '' $areastr)) # "(x, y, w, h)" => (x, y, w, h)
gdbus call --session \
--dest org.gnome.Shell \
--object-path /org/gnome/Shell/Screenshot \
--method org.gnome.Shell.Screenshot.ScreenshotArea $area[1] $area[2] $area[3] $area[4] false "'$ldocr'" \
&> /dev/null # "(success, filename_used)" > /dev/null

## OCR $ldocr to $word
test -e $ldocr; and set word (tesseract -l eng --dpi 96 $ldocr stdout | sed '/^\s*$/d' | sed ':b;$!{N;bb};s/\n/ /g')
test -e $ldocr; and rm $ldocr #delete tmp picture

## SwiftR word
test -n "$word"; and gdbus call --session \
   --dest org.gnome.Shell \
   --object-path /org/gnome/Shell/Extensions/LightDict \
   --method org.gnome.Shell.Extensions.LightDict.SwiftR $area[1] $area[2] $area[3] $area[4] "$word" \
   &> /dev/null # "()" > /dev/null
