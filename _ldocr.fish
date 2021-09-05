#!/bin/fish
#by tuberry

set word word
gdbus call --session \
   --dest org.gnome.Shell \
   --object-path /org/gnome/Shell/Extensions/LightDict \
   --method org.gnome.Shell.Extensions.LightDict.Run "swift" "'$word'" "" \
   &> /dev/null
