// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

export const Result = {SHOW: 1 << 0, COPY: 1 << 1, AWAIT: 1 << 2, SELECT: 1 << 3, COMMIT: 1 << 4};

export const Key = {
    TAP:  'tap-ocr',
    APPS: 'app-list',
    MODE: 'ocr-mode',
    DWLL: 'dwell-ocr',
    OCR:  'enable-ocr',
    FLTR: 'text-filter',
    HEAD: 'enable-title',
    LCMD: 'left-command',
    PSV:  'passive-mode',
    APP:  'app-list-type',
    JOIN: 'enable-splice',
    RCMD: 'right-command',
    TRG:  'trigger-style',
    PAGE: 'icon-page-size',
    PCMD: 'popup-commands',
    PRMS: 'ocr-parameters',
    SCMD: 'swift-commands',
    TIP:  'enable-tooltip',
    TRAY: 'enable-systray',
    TIME: 'autohide-timeout',
    SIDX: 'swift-command-index',
    KEYS: 'light-dict-ocr-shortcut',
};
