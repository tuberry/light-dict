#!/usr/bin/env python
# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later
# type: ignore

import re
import cv2
import gettext
import argparse
import colorsys
import numpy as np
import pytesseract
from pathlib import Path
from gi.repository import Gio, GLib
from tempfile import NamedTemporaryFile

SCALE = 2
DEBUG = False
CONFIG = r'-c preserve_interword_spaces=1' # HACK: workaround for https://github.com/tesseract-ocr/tesseract/issues/991

_ = gettext.gettext

class Result:
    def __init__(self, text=None, area=None, error=None, cancel=None):
        self.text, self.area, self.error, self.cancel, self.style = text, area, error, cancel, 'swift'

    def setup(self, args):
        self.style = args.style + ':' + args.name if args.name else args.style
        if args.quiet and self.erroneous: self.cancel = True
        return self

    @property
    def erroneous(self):
        return self.error or self.text is None

    @property
    def param(self):
        style, text, info = ['print', '', self.error or _('OCR process failed. (-_-;)')] if self.erroneous else [self.style, self.text, '']
        return ('Run', ('(sssai)', (style, text.strip(), info, self.area or [])))

def main():
    locale()
    arg = parser()
    ret = exe_mode(arg)
    if ret.cancel: exit(125)
    if arg.flash and ret.area: gs_dbus_call('FlashArea', ('(iiii)', (*ret.area,)))
    if arg.pointer: ret.area = None
    gs_dbus_call(*ret.param, '', '/Extensions/LightDict', '.Extensions.LightDict')

def locale():
    domain = 'gnome-shell-extension-light-dict'
    locale = Path(__file__).absolute().parent / 'locale'
    gettext.bindtextdomain(domain, locale if locale.exists() else None)
    gettext.textdomain(domain)

def parser():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('-h', '--help',    help=_('show this help message and exit'), action='help')
    ap.add_argument('-m', '--mode',    help=_('specify OCR mode: [%(choices)s] (default: %(default)s)'), default='word', choices=['word', 'paragraph', 'area', 'line', 'dialog'])
    ap.add_argument('-s', '--style',   help=_('specify trigger style: [%(choices)s] (default: %(default)s)'), default='auto', choices=['auto', 'swift', 'popup'])
    ap.add_argument('-l', '--lang',    help=_('specify language(s) used by Tesseract OCR (default: %(default)s)'), default='eng')
    ap.add_argument('-n', '--name',    help=_('specify swift style name'), action='store', default='')
    ap.add_argument('-p', '--pointer', help=_('invoke around the pointer'), action=argparse.BooleanOptionalAction)
    ap.add_argument('-f', '--flash',   help=_('flash on the detected area'), action=argparse.BooleanOptionalAction)
    ap.add_argument('-q', '--quiet',   help=_('suppress error messages'), action=argparse.BooleanOptionalAction)
    return ap.parse_args()

def gs_dbus_call(method_name, parameters, name='.Screenshot', object_path='/Screenshot', interface_name='.Screenshot'):
    return (Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None, 'org.gnome.Shell' + name,
                                           '/org/gnome/Shell' + object_path, 'org.gnome.Shell' + interface_name, None)
            .call_sync(method_name, parameters and GLib.Variant(*parameters), Gio.DBusCallFlags.NONE, -1, None).unpack())

def find_rect(rs, p):
    return min(rs, key=lambda r: (sum([max(a - b, 0, b - a - c) ** 2 for (a, b, c) in zip(r[0:2], p, r[2:4])]), r[4]), default=None)

def bincount_img(img, point):
    bgcolor = None # Ref: https://stackoverflow.com/a/50900143 ; detect if image bgcolor is dark or not
    if point:
        bgcolor = img[*reversed(point)] # for dialog
    else:
        colors = np.ravel_multi_index(img.reshape(-1, img.shape[-1]).T, (256, 256, 256))
        bgcolor = np.unravel_index(np.bincount(colors).argmax(), (256, 256, 256))
    return colorsys.rgb_to_hls(*[x / 255 for x in bgcolor])[1] < 0.5

def read_img(filename, point=None, trim=False):
    img = cv2.imread(filename)
    if trim: # HACK: workaround for https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/3143
        mock = cv2.imread(filename, cv2.IMREAD_UNCHANGED)
        edge = next((x for x in range(min(*mock.shape[:2])) if mock[x][x][3] == 255), 0)
        if edge > 0: img = img[edge:-edge, edge:-edge]
    return cv2.bitwise_not(img) if bincount_img(img, point) else img

def dilate_img(image, kernel): # <- grey img
    binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    return cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, kernel), iterations=3)

def dialog_img(filename, point):
    img = cv2.cvtColor(read_img(filename, point), cv2.COLOR_RGB2GRAY)
    h, w = img.shape
    dilate = dilate_img(img, (3, 3))
    mask1 = cv2.floodFill(dilate, np.zeros((h + 2, w + 2), np.uint8), point, 0, flags=cv2.FLOODFILL_MASK_ONLY | (255 << 8) | 8)[2]
    mask2 = cv2.floodFill(np.zeros((h, w), np.uint8), mask1, (0, 0), 255)[1]
    return cv2.bitwise_or(img, cv2.bitwise_or(mask2, mask1[1:-1, 1:-1]))

def debug_img(image, rects, point, title='img'):
    for x in rects: cv2.rectangle(image, (x[0], x[1]), (x[0] + x[2], x[1] + x[3]), (40, 240, 80), 2)
    cv2.circle(image, point, 20, (240, 80, 40))
    cv2.namedWindow(title, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(title, 1000, 800)
    cv2.imshow(title, image)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

def crop_img(image, point, kernel):
    # Ref: https://stackoverflow.com/a/57262099
    if len(image.shape) > 2: image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    area = image.shape[0] * image.shape[1]
    dilate = dilate_img(image, kernel)
    contours = cv2.findContours(dilate, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]
    rects = [x for x in [y + (y[2] * y[3] / area,) for y in map(cv2.boundingRect, contours)] if 0.002 < x[4] < 0.95]
    if DEBUG: debug_img(image, rects, point) # cv2.drawContours(image, contours, -1, (40, 240, 80), 2)
    return find_rect(rects, point)

def scale_img(image, rect=None):
    return cv2.resize(image[rect[1]: rect[1] + rect[3], rect[0]: rect[0] + rect[2]] if rect else image,
                      None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_LINEAR)

def ocr_auto(lang, mode='paragraph'):
    ptr, = gs_dbus_call('Get', ('(as)', (['pointer'],)), '', '/Extensions/LightDict', '.Extensions.LightDict')[0]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, path = gs_dbus_call('Screenshot', ('(bbs)', (False, False, f.name)))
        # ok, path = gs_dbus_call('ScreenshotWindow', ('(bbbs)', (False, False, False, f.name)))
        if not ok: return Result(error=path)
        kernel = (6, 3) if mode == 'line' else (9, 7) if mode == 'paragraph' else (9, 9)
        image = dialog_img(path, ptr) if mode == 'dialog' else read_img(path)
        crop = crop_img(image, ptr, kernel)
        return Result(text=pytesseract.image_to_string(scale_img(image, crop), lang=lang, config=CONFIG) or None,
                      area=crop[:4]) if crop else Result(error=_('OCR preprocess failed. (~_~)'))

def ocr_word(lang, size=(250, 50)):
    ptr, display = gs_dbus_call('Get', ('(as)', (['pointer', 'display'],)), '', '/Extensions/LightDict', '.Extensions.LightDict')[0]
    w, h = [min(a, b - a, c) for (a, b, c) in zip(ptr, display, size)]
    if w < 5 or h < 5: return Result(error=_('Too marginal. (>_<)'))
    area = [ptr[0] - w, ptr[1] - h, w * 2, h * 2]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))
        if not ok: return Result(error=path)
        data = pytesseract.image_to_data(scale_img(read_img(path)), output_type=pytesseract.Output.DICT, lang=lang, config=CONFIG)
        bins = [[data[x][i] for x in ['left', 'top', 'width', 'height', 'text']] for i, x in enumerate(data['text']) if x]
        if DEBUG: debug_img(scale_img(read_img(path)), bins, (w * SCALE, h * SCALE))
        rect = find_rect(bins, (w * SCALE, h * SCALE))
        if not rect: return Result()
        for i in range(4): rect[i] = round(rect[i] / SCALE)
        site = round(min(max((w - rect[0]) / rect[2], 0), 1) * len(rect[-1]))
        word = min(re.finditer(r'[^\W\d_]+', rect[-1]), key=lambda m: max(m.start() - site, 0, site - m.end() + 1), default=None)
        if not word: return Result()
        start, end = [round(rect[2] * x / len(rect[-1])) for x in word.span()]
        return Result(text=word.group(), area=(rect[0] + area[0] + start, rect[1] + area[1], end - start, rect[3] + 5))

def ocr_area(lang):
    area = gs_dbus_call('SelectArea', None)
    with NamedTemporaryFile(suffix='.png') as f:
        ok, path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))
        return Result(text=pytesseract.image_to_string(scale_img(read_img(path)), lang=lang, config=CONFIG) or None,
                      area=area) if ok else Result(error=path)

def exe_mode(args):
    try:
        mode = args.mode
        return (ocr_word(args.lang) if mode == 'word' else
                ocr_area(args.lang) if mode == 'area' else
                ocr_auto(args.lang, mode)).setup(args)
    except GLib.Error as e:
        if e.matches(Gio.io_error_quark(), Gio.IOErrorEnum.CANCELLED): return Result(cancel=True)
        else: raise
    except Exception as e:
        return Result(error=str(e))

if __name__ == '__main__':
    main()
