#!/bin/bash
# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

word=word

gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell/Extensions/LightDict \
    --method org.gnome.Shell.Extensions.LightDict.Run swift "$word" "" [] \
    # --method org.gnome.Shell.Extensions.LightDict.Run print word 词 [] \
    # --method org.gnome.Shell.Extensions.LightDict.OCR -- "-m area -s swift" \
    # &>/dev/null
