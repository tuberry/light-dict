#!/bin/fish
#by tuberry

set ldocr '/tmp/ldword_ocr'

## Screenshot $ldocr
set shot (gdbus call --session \
   --dest org.gnome.Shell \
   --object-path /org/gnome/Shell/Screenshot \
   --method org.gnome.Shell.Screenshot.SelectArea) # "(x, y, w, h)"
set area (string split ' ' (string replace -ra [^0-9\ ] '' $shot)) # "(x, y, w, h)" => (x, y, w, h)
gdbus call --session \
   --dest org.gnome.Shell \
   --object-path /org/gnome/Shell/Screenshot \
   --method org.gnome.Shell.Screenshot.ScreenshotArea $area[1] $area[2] $area[3] $area[4] false "'$ldocr.png'" \
   &> /dev/null # "(success, filename_used)" > /dev/null

## OCR $ldocr to $word
tesseract -l eng --dpi 96 $ldocr.png $ldocr
# test -e $ldocr.txt; and set word (string join '\r' (cat $ldocr.txt))
set words (cat $ldocr.txt)
for i in (seq (count $words))
   test -z $words[$i]
   and set words[$i] '\r'
   or set words[$i] $words[$i]' '
end
set word (string join '' $words)

## RunAt word
test -n "$word"; and gdbus call --session \
   --dest org.gnome.Shell \
   --object-path /org/gnome/Shell/Extensions/LightDict \
   --method org.gnome.Shell.Extensions.LightDict.RunAt 0 '["'$word'", ""]' $area[1] $area[2] $area[3] $area[4] \
   # &> /dev/null # "()" > /dev/null

# delete tmp files
test -e $ldocr.png; and rm $ldocr.png
test -e $ldocr.txt; and rm $ldocr.txt
