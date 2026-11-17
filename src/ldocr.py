#!/usr/bin/env python3
# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

import gettext
import argparse
import numpy as np
import pytesseract # NOTE: ? port to https://github.com/sirfz/tesserocr cf. https://github.com/madmaze/pytesseract/issues/576
from PIL import Image, ImageOps
from gi.repository import Gio, GLib # pyright: ignore[reportMissingModuleSource] cf. https://github.com/pygobject/pygobject-stubs/issues/189
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
        ret = Result(error=_('OCR preprocess failed. (~_~)') if (s := str(e)).startswith('min()') else s)
        if DEBUG: ret = Result(error=__import__('traceback').format_exc().rstrip())
    ret.toss(args or ap.parse_args([]))

def locale():
    from pathlib import Path
    domain = 'gnome-shell-extension-light-dict'
    locale = Path(__file__).absolute().parent / 'locale'
    gettext.bindtextdomain(domain, locale if locale.exists() else None)
    gettext.textdomain(domain)

def parser():
    _ = globals()['_'] if __debug__ else lambda x: x
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
    return min(bins, key=lambda x: (sum(max(a - b, 0, b - a - c) ** 2 for a, b, c in zip(x[0:2], point, x[2:4])), key(x)))

def load_img(path, point = None):
    orig = Image.open(path).convert('RGB')
    gray = np.array(orig.convert('L'))
    return (ImageOps.invert(orig), ~gray) if (gray[*point[::-1]] if point else gray.mean()) < 128 else (orig, gray)

def read_img(img):
    img = load_img(img)[0] if isinstance(img, str) else img
    return img.resize((int(img.width * SCALE), int(img.height * SCALE)), Image.Resampling.BICUBIC)

def show_img(img, bins = [], point = None, title = 'LdOCR'):
    from PIL import ImageDraw
    pen = ImageDraw.Draw(img)
    for x, y, w, h, _a in bins: pen.rectangle((x, y, x + w, y + h), outline='lime', width=2)
    if (p := point) is not None: pen.ellipse((p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9), outline='purple', width=2)
    img.show(title)

def ocr_auto(args):
    ptr, zoom, geom = gs_dbus_call('Get', None, '', '/Extensions/LightDict', '.Extensions.LightDict')
    ptr = tuple(round(x * zoom) for x in ptr)
    with NamedTemporaryFile(suffix='.png', dir=TMPDIR) as f:
        path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*geom, False, f.name)))[1]
        orig, gray = load_img(path, args.mode == 'dialog' and ptr)
        core = (3, 7) if args.mode == 'line' else (7, 9) if args.mode == 'paragraph' else (9, 9) # (h, w)
        try:
            import cv2
            def dilate_cv(image, kernel):
                binary = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
                return cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_RECT, kernel[::-1]), iterations=3)
            if args.mode == 'dialog':
                mask = cv2.floodFill(dilate_cv(gray, core), np.zeros(np.add(gray.shape, 2), np.uint8), ptr, 0, flags=cv2.FLOODFILL_MASK_ONLY | 0xff04)[2]
                gray |= cv2.floodFill(np.zeros(gray.shape, np.uint8), mask, (0, 0), 255)[1] | mask[1:-1, 1:-1]
            form = cv2.findContours(dilate_cv(gray, core), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]
            bins = [x + (y,) for x in map(cv2.boundingRect, form) if 0.002 < (y := x[2] * x[3] / gray.size) < 0.95]
        except ImportError:
            from scipy import ndimage # ? slower than cv2
            def dilate_nd(image, kernel):
                hist = np.bincount(image.ravel(), minlength=256) / image.size # cf. https://en.wikipedia.org/wiki/Otsu%27s_method
                otsu = np.argmax(np.divide(((m := (hist * np.arange(256)).cumsum())[-1] * (w := hist.cumsum()) - m) ** 2, d := w * (1 - w), out=np.zeros_like(w, dtype=float), where=d != 0))
                return ndimage.binary_dilation((image <= otsu) * 255, structure=np.ones(kernel, dtype=bool), iterations=3)
            if args.mode == 'dialog':
                flood = lambda m, p: (x := ndimage.label(m == m[*p[::-1]])[0]) == x[*p[::-1]] # floodFill
                gray |= (flood(~(mask := flood(dilate_nd(gray, core), ptr)), (0, 0)) | mask).astype(np.uint8) * 255
            form = ndimage.find_objects(ndimage.label(dilate_nd(gray, core), structure=np.ones((3, 3), dtype=bool))[0]) # 3*3 = 8-neighborhood
            bins = [(x.start, y.start, w, h, a) for y, x in form if 0.002 < (a := (w := x.stop - x.start) * (h := y.stop - y.start) / gray.size) < 0.95]
        if DEBUG: show_img(orig, bins, ptr)
        rect = find_bin(bins, ptr)[:-1]
        return Result(text=pytesseract.image_to_string(read_img(orig.crop(((r := rect)[0], r[1], r[0] + r[2], r[1] + r[3]))), lang=args.lang, config=CONFIG),
                      area=tuple(np.round(np.array(rect) / zoom + (geom[:2] + (0, 0)))))

def ocr_word(args):
    import re
    ptr, zoom, geom = gs_dbus_call('Get', None, '', '/Extensions/LightDict', '.Extensions.LightDict')
    size = np.array([min(a, b - a, round(c * zoom)) for a, b, c in zip(ptr, geom[2:], (256, 64))])
    if (size < 5).any(): return Result(error=_('Too marginal. (>_<)'))
    area = np.concat([ptr - size + geom[:2], size * 2])
    with NamedTemporaryFile(suffix='.png', dir=TMPDIR) as f:
        path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))[1]
        data = pytesseract.image_to_data(read_img(path), output_type=pytesseract.Output.DICT, lang=args.lang, config=CONFIG)
        bins = [tuple(data[x][i] for x in ('left', 'top', 'width', 'height')) + (y,) for i, y in enumerate(data['text']) if any(c.isalpha() for c in y)]
        if DEBUG: show_img(read_img(path), bins, np.round(size * SCALE * zoom).astype(int))
        rect, text = np.divide((r := find_bin(bins, size * SCALE * zoom, lambda x: -len(x[4])))[:4], SCALE * zoom), r[4]
        spot = np.clip((size[0] - rect[0]) / rect[2], 0, 1) * len(text)
        word = min(re.finditer(r'[^\W\d_]+', text), key=lambda x: max(x.start() - spot, 0, spot - x.end() + 1))
        init, last = np.array(word.span()) * rect[2] / len(text)
        return Result(text=word.group(), area=tuple(np.round(rect + (area[0] + init, area[1], last - init - rect[2], 5))))

def ocr_area(args):
    area = gs_dbus_call('SelectArea', None)
    with NamedTemporaryFile(suffix='.png', dir=TMPDIR) as f:
        path = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))[1]
        return Result(text=pytesseract.image_to_string(read_img(path), lang=args.lang, config=CONFIG), area=area)

if __name__ == '__main__':
    main()
