// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

export const Result = {SHOW: 1 << 0, COPY: 1 << 1, AWAIT: 1 << 2, SELECT: 1 << 3, COMMIT: 1 << 4};

export const Key = {
    APPS:  'app-list',
    APP:   'list-type',
    DOCR:  'dwell-ocr',
    OCR:   'enable-ocr',
    TFLT:  'text-filter',
    LCMD:  'left-command',
    PSV:   'passive-mode',
    HEAD:  'enable-title',
    OCRS:  'ocr-work-mode',
    PGSZ:  'icon-pagesize',
    RCMD:  'right-command',
    SCMD:  'swift-command',
    SPLC:  'enable-splice',
    TRG:   'trigger-style',
    OCRP:  'ocr-parameters',
    PCMDS: 'popup-commands',
    SCMDS: 'swift-commands',
    TIP:   'enable-tooltip',
    TRAY:  'enable-systray',
    WAIT:  'autohide-timeout',
    KEYS:  'light-dict-ocr-shortcut',
};
