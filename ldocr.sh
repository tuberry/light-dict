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
