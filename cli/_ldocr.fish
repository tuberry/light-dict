#!/bin/fish
# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

set word word\'s web
gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell/Extensions/LightDict \
    --method org.gnome.Shell.Extensions.LightDict.Run swift "$word" "" \
    # --method org.gnome.Shell.Extensions.LightDict.OCR -- "-m area -s swift" \
    # --method org.gnome.Shell.Extensions.LightDict.Run display word 词 [] \
    &>/dev/null
