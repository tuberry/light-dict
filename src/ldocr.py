#!/usr/bin/env python
# by tuberry

import re
import cv2
import numpy
import string
import gettext
import colorsys
import argparse
import pytesseract
from pathlib import Path
from gi.repository import Gio, GLib # type: ignore
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
    gs_dbus_call(*rt.param, '', '/Extensions/LightDict', '.Extensions.LightDict') # type: ignore

def locale():
    dm = 'gnome-shell-extension-light-dict'
    lc = Path(__file__).absolute().parent / 'locale'
    gettext.bindtextdomain(dm, lc if lc.exists() else None)
    gettext.textdomain(dm)

def parser():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument('-h', '--help',   help=_('show this help message and exit'), action='help')
    ap.add_argument('-m', '--mode',   help=_('specify work mode: [%(choices)s] (default: %(default)s)'), default='word', choices=['word', 'paragraph', 'area', 'line'])
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

def bincount_img(img):
    # Ref: https://stackoverflow.com/a/50900143 ;; detect if image bgcolor is dark or not
    cs = numpy.ravel_multi_index(img.reshape(-1, img.shape[-1]).T, (256, 256, 256))
    bg = numpy.unravel_index(numpy.bincount(cs).argmax(), (256, 256, 256))
    return colorsys.rgb_to_hls(*map(lambda x: x.astype(int) / 255, bg))[1] < 0.5

def read_img(filename, trim=False):
    im = cv2.imread(filename)
    if trim:
        # ISSUE: https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/3143
        mk = cv2.imread(filename, cv2.IMREAD_UNCHANGED)
        eg = next((x for x in range(min(*mk.shape[:2])) if mk[x][x][3] == 255), 0)
        im = im[eg: im.shape[0] - eg, eg: im.shape[1] - eg]
    return cv2.bitwise_not(im) if bincount_img(im) else im

def pt_in_rect(p, r): return p[0] > r[0] and p[0] < r[0] + r[2] and p[1] > r[1] and p[1] < r[1] + r[3]

def pt_rect_dis(p, r): return sum([max(a - b, 0, b - a - c) ** 2 for (b, a, c) in zip(p, r[0:2], r[2:4])])

def find_rect(rs, p): return min(filter(lambda x: pt_in_rect(p, x), rs), key=lambda x: x[4], default=None) \
    or min(rs, key=lambda x: pt_rect_dis(p, x), default=None)

def crop_img(img, point, line, blur=False):
    # Ref: https://stackoverflow.com/a/57262099
    kn = (6, 3) if line else (9, 7)
    ar = img.shape[0] * img.shape[1]
    gr = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    br = cv2.GaussianBlur(gr, (5, 3), cv2.BORDER_DEFAULT) if blur else gr
    tr = cv2.threshold(br, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    dl = cv2.dilate(tr, cv2.getStructuringElement(cv2.MORPH_RECT, kn), iterations=3)
    cs = cv2.findContours(dl, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0]
    rs = list(filter(lambda x: x[4] > 0.002 and x[4] < 0.95, [x + (x[2] * x[3] / ar,) for x in map(cv2.boundingRect, cs)]))
    if DEBUG:
        # cv2.drawContours(img, cs, -1, (40, 240, 80), 2)
        for x in rs: cv2.rectangle(img, (x[0], x[1]), (x[0] + x[2], x[1] + x[3]), (40, 240, 80), 2)
        cv2.circle(img, point, 20, (240, 80, 40))
        show_img(img)
    return find_rect(rs, point)

def scale_img(image, rect=None, factor=2):
    im = image if rect is None else image[rect[1]: rect[1] + rect[3], rect[0]: rect[0] + rect[2]]
    return im if factor == 1 else cv2.resize(im, None, fx=factor, fy=factor, interpolation=cv2.INTER_LINEAR)

def show_img(image, title='img'):
    cv2.imshow(title, image)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

# ISSUE: https://github.com/tesseract-ocr/tesseract/issues/991
def typeset_str(para): return re.sub(r'\n+', '\r', re.sub(r'([^\n\.\?!; ] *)\n', r'\g<1> ', para)).replace('|', 'I').strip(string.whitespace + '“”‘’')

def detect_cjk(lang): return 2 if any([x in lang for x in ['chi', 'jpn', 'kor']]) else 1

def ocr_word(lang, sz=(250, 50)):
    pt, sc = gs_dbus_call('Get', ('(as)', (['pointer', 'display'],)), '', '/Extensions/LightDict', '.Extensions.LightDict')[0]
    w, h = [min(a, b - a, c) for (a, b, c) in zip(pt, sc, sz)]
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

def ocr_auto(lang, line=False):
    pt, fw = gs_dbus_call('Get', ('(as)', (['pointer', 'focused'],)), '', '/Extensions/LightDict', '.Extensions.LightDict')[0]
    pt = [a - b for (a, b) in zip(pt, fw)]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotWindow', ('(bbbs)', (False, False, False, f.name)))
        # ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*fw, False, f.name)))
        if not ok: return Result(error=fn)
        im = read_img(fn, trim=True)
        rc = crop_img(im, pt, line)
        return Result(text=typeset_str(pytesseract.image_to_string(scale_img(im, rc, detect_cjk(lang)), lang=lang)) or None,
                      area=(rc[0] + fw[0], rc[1] + fw[1], rc[2], rc[3])) if rc else Result(error=_('OCR preprocess failed. (~_~)'))

def exe_mode(args):
    try: 
        rt = (lambda m: m[0](*m[1]))({
            'word': (ocr_word, (args.lang,)),
            'area': (ocr_area, (args.lang,)),
            'paragraph': (ocr_auto, (args.lang,)),
            'line': (ocr_auto, (args.lang, True)),
            }[args.mode])
        rt.set_style(args.style, args.name)
        rt.set_quiet(args.quiet)
        return rt
    except Exception as e:
        return Result(error=str(e)) if DEBUG is True else Result(cancel=True)

if __name__ == '__main__':
    main()
