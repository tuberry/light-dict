#!/usr/bin/env python3
# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later
# type: ignore

import re
import cv2
import gettext
import argparse
import importlib
import numpy as np
import pytesseract
from pathlib import Path
from gi.repository import Gio, GLib
from tempfile import NamedTemporaryFile

SCALE = 2
DEBUG = False
CONFIG = r'-c preserve_interword_spaces=1' # HACK: workaround for https://github.com/tesseract-ocr/tesseract/issues/991 & fixed in tessdata_fast (Debian/Feodra)
TMPDIR = f'{GLib.get_user_runtime_dir()}/gnome-shell'

_ = gettext.gettext

class Result:
    def __init__(self, text=None, area=None, error=None, cancel=None):
        self.text, self.area, self.error, self.cancel = text and text.strip(), area, error, cancel

    def toss(self, args):
        if not (self.text or self.error): self.error = _('OCR process failed. (-_-;)')
        if self.cancel or args.quiet and self.error: raise SystemExit(125)
        if args.flash and self.area: gs_dbus_call('FlashArea', ('(iiii)', (*self.area,)))
        style = 'print' if self.error else args.style + ':' + args.name if args.name else args.style
        param = ('(sssai)', (style, self.text or '', self.error or '', [] if args.pointer else self.area or []))
        gs_dbus_call('Run', param, '', '/Extensions/LightDict', '.Extensions.LightDict')

def main():
    locale()
    args = None
    ap = parser()
    try:
        args = ap.parse_args()
        ret = (ocr_word if args.mode == 'word' else ocr_area if args.mode == 'area' else ocr_auto)(args)
    except GLib.Error as e:
        if e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED): ret = Result(cancel=True)
        else: raise
    except Exception as e:
        ret = Result(error=_('OCR preprocess failed. (~_~)') if 'NoneType' in str(e) else str(e))
        if DEBUG: ret = Result(error=importlib.import_module('traceback').format_exc().rstrip()) # importtime ~ 23ms
    ret.toss(args or ap.parse_args([]))

def locale():
    domain = 'gnome-shell-extension-light-dict'
    locale = Path(__file__).absolute().parent / 'locale'
    gettext.bindtextdomain(domain, locale if locale.exists() else None)
    gettext.textdomain(domain)

def parser():
    ret = argparse.ArgumentParser(add_help=False, exit_on_error=False)
    ret.add_argument('-h', '--help',    help=_('show this help message and exit'), action='help')
    ret.add_argument('-m', '--mode',    help=_('specify OCR mode: [%(choices)s] (default: %(default)s)'), default='word', choices=['word', 'paragraph', 'area', 'line', 'dialog'])
    ret.add_argument('-s', '--style',   help=_('specify trigger style: [%(choices)s] (default: %(default)s)'), default='auto', choices=['auto', 'swift', 'popup'])
    ret.add_argument('-l', '--lang',    help=_('specify language(s) used by Tesseract OCR (default: %(default)s)'), default='eng')
    ret.add_argument('-n', '--name',    help=_('specify swift style name'), action='store', default='')
    ret.add_argument('-p', '--pointer', help=_('invoke around the pointer'), action=argparse.BooleanOptionalAction)
    ret.add_argument('-f', '--flash',   help=_('flash on the detected area'), action=argparse.BooleanOptionalAction)
    ret.add_argument('-q', '--quiet',   help=_('suppress error messages'), action=argparse.BooleanOptionalAction)
    return ret

def gs_dbus_call(method_name, parameters, name='.Screenshot', object_path='/Screenshot', interface_name='.Screenshot'):
    proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None, 'org.gnome.Shell' + name,
                                           '/org/gnome/Shell' + object_path, 'org.gnome.Shell' + interface_name, None)
    return proxy.call_sync(method_name, parameters and GLib.Variant(*parameters), Gio.DBusCallFlags.NONE, -1, None).unpack()

def find_bin(bins, point, key=lambda x: x[4]):
    return min(bins, key=lambda x: (sum(max(a - b, 0, b - a - c) ** 2 for a, b, c in zip(x[0:2], point, x[2:4])), key(x)), default=None)

def read_img(path, point=None):
    img = cv2.imread(path) # Ref: https://stackoverflow.com/a/50900494
    bgr = img[*point[::-1]] if point else cv2.kmeans(np.array(img.reshape((-1, 3)), np.float32), 1, None, None, 5, None)[2][0]
    return ~img if cv2.cvtColor(np.array([[bgr]], np.uint8), cv2.COLOR_BGR2GRAY)[0, 0] < 128 else img

def dilate_img(img, core):
    binary = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    return cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, core), iterations=3)

def retouch_img(img, rect=None):
    if rect: img = img[rect[1]: rect[1] + rect[3], rect[0]: rect[0] + rect[2]]
    return cv2.cvtColor(cv2.resize(img, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC), cv2.COLOR_BGR2RGB)

def debug_img(img, bins = [], point = None, title='LdOCR'):
    if __debug__: return
    for x in bins: cv2.rectangle(img, x[0:2], np.add(x[0:2], x[2:4]), (40, 240, 80), 2)
    cv2.circle(img, point, 20, (240, 80, 40))
    cv2.namedWindow(title, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(title, 1000, 800)
    cv2.imshow(title, img)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

def ocr_auto(args):
    ptr, zoom, geom = gs_dbus_call('Get', None, '', '/Extensions/LightDict', '.Extensions.LightDict')
    ptr = tuple(round(x * zoom) for x in ptr)
    with NamedTemporaryFile(suffix='.png', dir=TMPDIR) as f:
        path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*geom, False, f.name)))[1]
        img  = read_img(path, args.mode == 'dialog' and ptr)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        core = (6, 3) if args.mode == 'line' else (9, 7) if args.mode == 'paragraph' else (9, 9)
        if args.mode == 'dialog':
            mask = cv2.floodFill(dilate_img(gray, core), np.zeros(np.add(gray.shape, 2), np.uint8), ptr, 0, flags=cv2.FLOODFILL_MASK_ONLY | 0xff04)[2]
            gray |= cv2.floodFill(np.zeros(gray.shape, np.uint8), mask, (0, 0), 255)[1] | mask[1:-1, 1:-1]
        form = cv2.findContours(dilate_img(gray, core), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]
        bins = [x for x in [y + (y[2] * y[3],) for y in map(cv2.boundingRect, form)] if 0.002 < x[4] / gray.size < 0.95]
        if DEBUG: debug_img(img, bins, ptr) # cv2.drawContours(img, form, -1, (40, 240, 80), 2)
        rect = find_bin(bins, ptr)[:-1]
        return Result(text=pytesseract.image_to_string(retouch_img(img, rect), lang=args.lang, config=CONFIG),
                      area=tuple(np.round(np.array(rect) / zoom + (geom[:2] + (0, 0)))))

def ocr_word(args):
    ptr, zoom, geom = gs_dbus_call('Get', None, '', '/Extensions/LightDict', '.Extensions.LightDict')
    size = np.array([min(a, b - a, c) for a, b, c in zip(ptr, geom[2:], (256, 64))])
    if (size < 5).any(): return Result(error=_('Too marginal. (>_<)'))
    area = np.concat([ptr - size + geom[:2], size * 2])
    with NamedTemporaryFile(suffix='.png', dir=TMPDIR) as f:
        path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))[1]
        data = pytesseract.image_to_data(retouch_img(read_img(path)), output_type=pytesseract.Output.DICT, lang=args.lang, config=CONFIG)
        bins = [tuple([data[x][i] for x in ('left', 'top', 'width', 'height')] + [y]) for i, y in enumerate(data['text']) if any(c.isalpha() for c in y)]
        if DEBUG: debug_img(cv2.cvtColor(retouch_img(read_img(path)), cv2.COLOR_RGB2BGR), bins, np.round(size * SCALE * zoom).astype(int))
        *rect, text = find_bin(bins, size * SCALE * zoom, lambda x: -len(x[4]))
        rect = np.divide(rect, SCALE * zoom)
        spot = np.clip((size[0] - rect[0]) / rect[2], 0, 1) * len(text)
        word = min(re.finditer(r'[^\W\d_]+', text), key=lambda x: max(x.start() - spot, 0, spot - x.end() + 1), default=None)
        init, last = np.array(word.span()) * rect[2] / len(text)
        return Result(text=word.group(), area=tuple(np.round(rect + (area[0] + init, area[1], last - init - rect[2], 5))))

def ocr_area(args):
    area = gs_dbus_call('SelectArea', None)
    with NamedTemporaryFile(suffix='.png', dir=TMPDIR) as f:
        path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))[1]
        return Result(text=pytesseract.image_to_string(retouch_img(read_img(path)), lang=args.lang, config=CONFIG), area=area)

if __name__ == '__main__':
    main()
