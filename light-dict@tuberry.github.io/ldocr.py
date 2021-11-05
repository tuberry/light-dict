#!/usr/bin/env python
# by tuberry

import re
import cv2
import string
import colorsys
import argparse
import pytesseract
import numpy as np
from gi.repository import Gio, GLib
from tempfile import NamedTemporaryFile

DEBUG = False

def main():
    args = parser()
    result = exe_mode(args)
    if result.cancel: return
    if args.flash and result.area: gs_dbus_call('FlashArea', ('(iiii)', (*result.area,)))
    if args.cursor: result.area = None
    if args.dest: result.tran_text(args.dest)
    # FIXME: better shortcut needs progress of https://gitlab.gnome.org/GNOME/mutter/-/issues/207
    gs_dbus_call(*result.param, '', '/Extensions/LightDict', '.Extensions.LightDict')

def parser():
    ap = argparse.ArgumentParser()
    ap.add_argument('-m', '--mode', default='word', choices = ['word', 'paragraph', 'area', 'line'],
                help='specify the work mode: [%(choices)s] (default: %(default)s)')
    ap.add_argument('-s', '--style', default='auto', choices = ['auto', 'swift', 'popup'],
                help='specify the LD style: [%(choices)s] (default: %(default)s)')
    ap.add_argument('-l', '--lang', default='eng',
                help='specify language(s) used by Tesseract OCR (default: %(default)s)')
    ap.add_argument('-d', '--dest', default='',
                help='specify the dest language used by py-googletrans (default: %(default)s)')
    ap.add_argument('-n', '--name', default='',
                help='specify the LD swift style name (default: %(default)s)')
    ap.add_argument('-c', '--cursor', default=False, action=argparse.BooleanOptionalAction,
                help='invoke the LD around the cursor')
    ap.add_argument('-f', '--flash', default=False, action=argparse.BooleanOptionalAction,
                help='flash the detected area')
    ap.add_argument('-v', '--verbose', default=True, action=argparse.BooleanOptionalAction,
                help='report error messages')
    return ap.parse_args()

class Result:
    def __init__(self, text=None, area=None, error=None, cancel=None):
        self.text, self.area, self.error, self.cancel = text, area, error, cancel
        self.tran, self.style = None, 'swift'

    def set_style(self, style, name):
        self.style = style + ':' + name if name else style

    def tran_text(self, dest):
        if not self.text: return
        try:
            from googletrans import Translator
            try:
                self.tran = Translator(http2=True).translate(self.text, dest=dest).text
                self.error = 'googletrans/http2 is available'
            except ImportError:
                self.tran = Translator(http2=False).translate(self.text, dest=dest).text
        except:
            self.error = 'python-googletrans is missing'
        finally:
            self.style = 'display'

    def set_verbose(self, verbose):
        if not verbose and self.is_error: self.cancel = True

    @property
    def is_error(self):
        return self.error or self.text is None

    @property
    def param(self):
        style, text, info = ['display', 'ERROR', self.error or ''] if self.is_error else [self.style, self.text, self.tran or '']
        return ('RunAt', ('(sssiiii)', (style, text, info, *self.area))) if self.area else ('Run', ('(sss)', (style, text, info)))

def gs_dbus_call(method_name, parameters, name='.Screenshot', object_path='/Screenshot', interface_name='.Screenshot'):
    param = parameters and GLib.Variant(*parameters)
    proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None, 'org.gnome.Shell' + name,
                                           '/org/gnome/Shell' + object_path, 'org.gnome.Shell' + interface_name, None)
    try:
        return proxy.call_sync(method_name, param, Gio.DBusCallFlags.NONE, -1, None).unpack()
    except Exception as e:
        return False, str(e)

def ld_dbus_get(*property_names):
    proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None, 'org.gnome.Shell',
                                           '/org/gnome/Shell/Extensions/LightDict', 'org.gnome.Shell.Extensions.LightDict', None)
    return map(lambda x: (lambda y: y and list(y))(proxy.get_cached_property(x)), property_names)

def bincount_img(img):
    # Ref: https://stackoverflow.com/a/50900143 ;; detect if image bgcolor is dark or not
    i1d = np.ravel_multi_index(img.reshape(-1, img.shape[-1]).T, (256, 256, 256))
    rgb = np.unravel_index(np.bincount(i1d).argmax(), (256, 256, 256))[:3]
    return colorsys.rgb_to_hls(*[x / 255 for x in rgb])[1] < 0.5

def read_img(filename, trim=False):
    img = cv2.imread(filename)
    if trim:
        # shadows issue: https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/3143
        msk = cv2.imread(filename, cv2.IMREAD_UNCHANGED)
        edg = next((x for x in range(min(*msk.shape[:2])) if msk[x][x][3] == 255), 0)
        img = img[edg : img.shape[0] - edg, edg : img.shape[1] - edg]
    return cv2.bitwise_not(img) if bincount_img(img) else img

def find_rect(rects, point):
    pt_in_rect = lambda p, r: p[0] > r[0] and p[0] < r[0] + r[2] and p[1] > r[1] and p[1] < r[1] + r[3]
    pt_rect_dis = lambda p, r: sum([max(a - b, 0, b - a - c) ** 2 for (b, a, c) in zip(p, r[0:2], r[2:4])])
    return next((x for x in rects if pt_in_rect(point, x)), None) or min(rects, key=lambda x: pt_rect_dis(point, x)) if rects else None

def crop_img(img, point, kernel, iterations, blur=False):
    # Ref: https://stackoverflow.com/a/57262099
    gry = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    blr = cv2.GaussianBlur(gry, (3, 3), 0) if blur else gry
    thr = cv2.threshold(blr, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    dlt = cv2.dilate(thr, cv2.getStructuringElement(cv2.MORPH_RECT, kernel), iterations=iterations)
    cts = cv2.findContours(dlt, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    if DEBUG:
        # cv2.drawContours(img, cts, -1, (40, 240, 80), 2)
        rts = list(map(cv2.boundingRect, cts))
        for x in rts: cv2.rectangle(img, (x[0], x[1]), (x[0] + x[2], x[1] + x[3]), (40, 240, 80), 2)
        cv2.circle(img, point, 20, (240, 80, 40))
        show_img(img)
    return find_rect(list(map(cv2.boundingRect, cts)), point)

def scale_img(image, rect=None, factor=2):
    img = image if rect is None else image[rect[1] : rect[1] + rect[3], rect[0] : rect[0] + rect[2]]
    return img if factor == 1 else cv2.resize(img, None, fx=factor, fy=factor, interpolation=cv2.INTER_LINEAR)

def show_img(image, title='img'):
    cv2.imshow(title, image)
    cv2.waitKey(0)
    cv2.destroyAllWindows()

def typeset_str(para):
    # CJK spaces issue: https://github.com/tesseract-ocr/tesseract/issues/991
    return re.sub(r'\n+', '\r', re.sub(r'([^\n\.\?!; ] *)\n', r'\g<1> ', para)).replace('|', 'I').strip(string.whitespace + '“”‘’')

def detect_cjk(lang):
    return 2 if any([x in lang for x in ['chi', 'jpn', 'kor']]) else 1

def ocr_word(lang, sz=(250, 50)):
    pt, sc = ld_dbus_get('Pointer', 'DisplaySize')
    if pt is None or sc is None: return Result(error='LD dbus error')
    w, h = [min(a, b - a, c) for (a, b, c) in zip(pt, sc, sz)]
    if w < 5 or h < 5: return Result(error='too small to screenshot')
    ar = [pt[0] - w, pt[1] - h, w * 2, h * 2]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*ar, False, f.name)))
        if not ok: return Result(error='GS dbus error')
        dat = pytesseract.image_to_data(read_img(fn), output_type=pytesseract.Output.DICT, lang=lang)
        bxs = [[dat[x][i] for x in ['left', 'top', 'width', 'height', 'text']] for i, x in enumerate(dat['text']) if x]
        rct = find_rect(bxs, (w, h))
        return Result(text=rct[-1].strip(string.punctuation + '“”‘’，。').strip() or None,
                      area=(rct[0] + ar[0], rct[1] + ar[1], rct[2], rct[3] + 5)) if rct else Result(error=' ')

def ocr_area(lang):
    area = gs_dbus_call('SelectArea', None)
    if area[0] is False: return Result(cancel=True) if 'cancel' in area[1] else Result(error='GS dbus error')
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)))
        return Result(text=typeset_str(pytesseract.image_to_string(scale_img(read_img(fn), factor=detect_cjk(lang)), lang=lang)) or None,
                      area=area) if ok else Result(error='GS dbus error')

def ocr_prln(lang, line=False):
    pt, fw = ld_dbus_get('Pointer', 'FocusWindow')
    if pt is None or fw is None: return Result(error='LD dbus error')
    pt = [a - b for (a, b) in zip(pt, fw)]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gs_dbus_call('ScreenshotWindow', ('(bbbs)', (False, False, False, f.name)))
        # ok, fn = gs_dbus_call('ScreenshotArea', ('(iiiibs)', (*fw, False, f.name)))
        if not ok: return Result(error='GS dbus error')
        kn, it = ((15, 3), 1) if line else ((9, 6), 3)
        img = read_img(fn, trim=True)
        rct = crop_img(img, pt, kn, it)
        return Result(text=typeset_str(pytesseract.image_to_string(scale_img(img, rct, detect_cjk(lang)), lang=lang)) or None,
                      area=(rct[0] + fw[0], rct[1] + fw[1], rct[2], rct[3])) if rct else Result(error=' ')

def exe_mode(args):
    result = (lambda m: m[0](*m[1]))({
        'word': (ocr_word, (args.lang,)),
        'area': (ocr_area, (args.lang,)),
        'paragraph': (ocr_prln, (args.lang,)),
        'line': (ocr_prln, (args.lang, True)),
    }[args.mode]);
    result.set_style(args.style, args.name)
    result.set_verbose(args.verbose)
    return result

if __name__ == '__main__':
    main()
