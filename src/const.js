// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

export const Result = {SHOW: 1 << 0, COPY: 1 << 1, WAIT: 1 << 2, SELECT: 1 << 3, COMMIT: 1 << 4};

export const Field = {
    APPS:  'app-list',
    DOCR:  'dwell-ocr',
    KEY:   'short-ocr',
    APP:   'list-type',
    OCR:   'enable-ocr',
    HDTT:  'hide-title',
    TFLT:  'text-filter',
    LCMD:  'left-command',
    PSV:   'passive-mode',
    TSTP:  'enable-strip',
    OCRS:  'ocr-work-mode',
    PGSZ:  'icon-pagesize',
    RCMD:  'right-command',
    SCMD:  'swift-command',
    TRG:   'trigger-style',
    OCRP:  'ocr-parameters',
    PCMDS: 'popup-commands',
    SCMDS: 'swift-commands',
    STRY:  'enable-systray',
    TIP:   'enable-tooltip',
    ATHD:  'autohide-timeout',
    KEYS:  'light-dict-ocr-shortcut',
};
