#!/usr/bin/env python
# by tuberry
# type: ignore

import re
import cv2
import string
import gettext
import argparse
import numpy as np
import pytesseract
from pathlib import Path
from gi.repository import Gio, GLib
from tempfile import NamedTemporaryFile

DEBUG = False
_ = gettext.gettext

class Result:
    def __init__(self, text=None, area=None, error=None, cancel=None):
        self.text, self.area, self.error, self.cancel, self.style = text, area, error, cancel, 'swift'

    def set_style(self, style, name):
        self.style = style + ':' + name if name else style

    def set_quiet(self, quiet):
        if quiet and self.is_error: self.cancel = True

    @property
    def is_error(self):
        return self.error or self.text is None

    @property
    def param(self):
        style, text, info = ['display', '', self.error or _('OCR process failed. (-_-;)')] if self.is_error else [self.style, self.text, '']
        return ('RunAt', ('(sssiiii)', (style, text, info, *self.area))) if self.area else ('Run', ('(sss)', (style, text, info)))

def main():
    locale()
    ag = parser()
    rt = exe_mode(ag)
    if rt.cancel: exit(125)
    if ag.flash and rt.area: gs_dbus_call('FlashArea', ('(iiii)', (*rt.area,)))
    if ag.cursor: rt.area = None
    # ISSUE: https://gitlab.gnome.org/GNOME/mutter/-/issues/207
    gs_dbus_call(*rt.param, '', '/Extensions/LightDict', '.Extensions.LightDict')

def locale():
    dm = 'gnome-shell-extension-light-dict'
    lc = Path(__file__).absolute().parent / 'locale'
    gettext.bindtextdomain(dm, lc if lc.exists() else None)
    gettext.textdomain(dm)

def parser():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('-h', '--help',   help=_('show this help message and exit'), action='help')
    ap.add_argument('-m', '--mode',   help=_('specify work mode: [%(choices)s] (default: %(default)s)'), default='word', choices=['word', 'paragraph', 'area', 'line', 'dialog'])
    ap.add_argument('-s', '--style',  help=_('specify LD trigger style: [%(choices)s] (default: %(default)s)'), default='auto', choices=['auto', 'swift', 'popup'])
    ap.add_argument('-l', '--lang',   help=_('specify language(s) used by Tesseract OCR (default: %(default)s)'), default='eng')
    ap.add_argument('-n', '--name',   help=_('specify LD swift style name'), action='store', default='')
    ap.add_argument('-c', '--cursor', help=_('invoke LD around the cursor'), action=argparse.BooleanOptionalAction)
    ap.add_argument('-f', '--flash',  help=_('flash on the detected area'), action=argparse.BooleanOptionalAction)
    ap.add_argument('-q', '--quiet',  help=_('suppress error messages'), action=argparse.BooleanOptionalAction)
    return ap.parse_args()

def gs_dbus_call(method_name, parameters, name='.Screenshot', object_path='/Screenshot', interface_name='.Screenshot'):
    px = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None, 'org.gnome.Shell' + name,
                                           '/org/gnome/Shell' + object_path, 'org.gnome.Shell' + interface_name, None)
    return px.call_sync(method_name, parameters and GLib.Variant(*parameters), Gio.DBusCallFlags.NONE, -1, None).unpack()

# ISSUE: https://github.com/tesseract-ocr/tesseract/issues/991
def typeset_str(para): return ' '.join(re.sub(r'([^\n\.\?!; ] *)\n', r'\g<1> ', para).splitlines()).replace('|', 'I').strip(string.whitespace + '“”‘’')

def detect_cjk(lang): return 2 if any([x in lang for x in ['chi', 'jpn', 'kor']]) else 1

def pt_in_rect(p, r): return p[0] > r[0] and p[0] < r[0] + r[2] and p[1] > r[1] and p[1] < r[1] + r[3]

def pt_rect_dis(p, r): return sum([max(a - b, 0, b - a - c) ** 2 for (a, b, c) in zip(r[0:2], p, r[2:4])])

def find_rect(rs, p): return min(filter(lambda x: pt_in_rect(p, x), rs), key=lambda x: x[4], default=None) \
    or min(rs, key=lambda x: pt_rect_dis(p, x), default=None)

def bincount_img(img, point):
    if point is not None: return np.amax(img[*reversed(point)]) < 128
    # Ref: https://stackoverflow.com/a/50900143 ;; detect if image bgcolor is dark or not
    cs = np.ravel_multi_index(img.reshape(-1, img.shape[-1]).T, (256, 256, 256))
    return np.amax(np.unravel_index(np.bincount(cs).argmax(), (256, 256, 256))) < 128 # v in hsv

def read_img(filename, trim=False, point=None):
    im = cv2.imread(filename)
    if trim:
        # ISSUE: https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/3143
        mk = cv2.imread(filename, cv2.IMREAD_UNCHANGED)
        eg = next((x for x in range(min(*mk.shape[:2])) if mk[x][x][3] == 255), 0)
        if eg > 0: im = im[eg:-eg, eg:-eg]
    return cv2.bitwise_not(im) if bincount_img(im, point) else im

def dilate_img(image, kernel): # <- grey img
    tr = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    return cv2.dilate(tr, cv2.getStructuringElement(cv2.MORPH_RECT, kernel), iterations=3)

def dialog_img(filename, point):
    img = cv2.cvtColor(read_img(filename, True, point), cv2.COLOR_RGB2GRAY)
    h, w = img.shape
    dl = dilate_img(img, (3, 3))
    m1 = cv2.floodFill(dl, np.zeros((h + 2, w + 2), np.uint8), point, 0, flags=cv2.FLOODFILL_MASK_ONLY | (255 << 8) | 8)[2]
    m2 = cv2.floodFill(np.zeros((h, w), np.uint8), m1, (0, 0), 255)[1]
    return cv2.bitwise_or(img, cv2.bitwise_or(m2, m1[1:-1, 1:-1]))

def show_img(image, title='img'):
    cv2.imshow(title, image)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

def debug_img(image, rects, point):
    for x in rects: cv2.rectangle(image, (x[0], x[1]), (x[0] + x[2], x[1] + x[3]), (40, 240, 80), 2)
    cv2.circle(image, point, 20, (240, 80, 40))
    show_img(image, 'debug')

def crop_img(image, point, kernel):
    # Ref: https://stackoverflow.com/a/57262099
    if len(image.shape) > 2: image = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    ar = image.shape[0] * image.shape[1]
    dl = dilate_img(image, kernel)
    cs = cv2.findContours(dl, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]
    rs = list(filter(lambda x: x[4] > 0.002 and x[4] < 0.95, [x + (x[2] * x[3] / ar,) for x in map(cv2.boundingRect, cs)]))
    if DEBUG: debug_img(image, rs, point) # cv2.drawContours(img, cs, -1, (40, 240, 80), 2)
    return find_rect(rs, point)

def scale_img(image, rect=None, factor=2):
    im = image if rect is None else image[rect[1]: rect[1] + rect[3], rect[0]: rect[0] + rect[2]]
    return im if factor == 1 else cv2.resize(im, None, fx=factor, fy=factor, interpolation=cv2.INTER_LINEAR)

def ocr_auto(lang, mode='paragraph'):
    pt, fw = gs_dbus_call('Get', ('(as)', (['pointer', 'focused'],)), '', '/Extensions/LightDict', '.Extensions.LightDict')[0]
    pt = [a - b for (a, b) in zip(pt, fw)]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotWindow', ('(bbbs)', (False, False, False, f.name)))
        # ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*fw, False, f.name)))
        if not ok: return Result(error=fn)
        kn = (6, 3) if mode == 'line' else (9, 7) if mode == 'paragraph' else (9, 9)
        im = dialog_img(fn, pt) if mode == 'dialog' else read_img(fn, True)
        rc = crop_img(im, pt, kn)
        return Result(text=typeset_str(pytesseract.image_to_string(scale_img(im, rc, detect_cjk(lang)), lang=lang)) or None,
                      area=(rc[0] + fw[0], rc[1] + fw[1], rc[2], rc[3])) if rc else Result(error=_('OCR preprocess failed. (~_~)'))

def ocr_word(lang, size=(250, 50)):
    pt, sc = gs_dbus_call('Get', ('(as)', (['pointer', 'display'],)), '', '/Extensions/LightDict', '.Extensions.LightDict')[0]
    w, h = [min(a, b - a, c) for (a, b, c) in zip(pt, sc, size)]
    if w < 5 or h < 5: return Result(error=_('Too marginal. (>_<)'))
    ar = [pt[0] - w, pt[1] - h, w * 2, h * 2]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*ar, False, f.name)))
        if not ok: return Result(error=fn)
        dt = pytesseract.image_to_data(read_img(fn), output_type=pytesseract.Output.DICT, lang=lang)
        bx = [[dt[x][i] for x in ['left', 'top', 'width', 'height', 'text']] for i, x in enumerate(dt['text']) if x]
        rc = find_rect(bx, (w, h))
        return Result(text=rc[-1].strip(string.punctuation + '“”‘’，。').strip() or None,
                      area=(rc[0] + ar[0], rc[1] + ar[1], rc[2], rc[3] + 5)) if rc else Result(error=_('OCR process failed. (-_-;)'))

def ocr_area(lang):
    ar = gs_dbus_call('SelectArea', None)
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*ar, False, f.name)))
        return Result(text=typeset_str(pytesseract.image_to_string(scale_img(read_img(fn), factor=detect_cjk(lang)), lang=lang)) or None,
                      area=ar) if ok else Result(error=fn)

def exe_mode(args):
    try: 
        rt = (lambda m: m[0](*m[1]))({
            'word': (ocr_word, (args.lang,)),
            'area': (ocr_area, (args.lang,)),
            'paragraph': (ocr_auto, (args.lang,)),
            'line': (ocr_auto, (args.lang, 'line')),
            'dialog': (ocr_auto, (args.lang, 'dialog')),
            }[args.mode])
        rt.set_style(args.style, args.name)
        rt.set_quiet(args.quiet)
        return rt if not DEBUG else Result(cancel=True)
    except Exception as e:
        return Result(error=str(e))# if DEBUG else Result(cancel=True)

if __name__ == '__main__':
    main()
