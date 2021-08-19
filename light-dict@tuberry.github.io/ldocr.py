#!/usr/bin/env python
# by tuberry

import cv2
import ast
import string
import colorsys
import argparse
import pytesseract
import numpy as np
from gi.repository import Gio, GLib
from tempfile import NamedTemporaryFile

edge = 10 # FIXME: some screenshots with obvious edges lead to only 1 huge contour, e.g. Chrome

# @profile
def main():
    args = parser().parse_args()
    result = mode_exe(args)
    if args.flash and result.area: gsdbus_call('FlashArea', ('(iiii)', (*result.area,)), '.Screenshot', '/Screenshot', '.Screenshot')
    if args.cursor: result.area = None
    if args.dest: result.tran_text(args.dest)
    # FIXME: better shortcut needs progress of https://gitlab.gnome.org/GNOME/mutter/-/issues/207
    gsdbus_call(*result.param, '', '/Extensions/LightDict', '.Extensions.LightDict')

def parser():
    ap = argparse.ArgumentParser()
    ap.add_argument('-m', '--mode', default='word', choices = ['word', 'paragraph', 'line', 'area', 'selection', 'button'],
                help='specify the work mode: [%(choices)s] (default: %(default)s)')
    ap.add_argument('-s', '--style', default='swift', choices = ['swift', 'popup', 'display', 'auto'],
                help='specify the LD style: [%(choices)s] (default: %(default)s)')
    ap.add_argument('-l', '--lang', default='eng',
                help='specify language(s) used by tesseract OCR (default: %(default)s)')
    ap.add_argument('-d', '--dest', default='',
                help='specify the dest language used by python-googletrans (default: %(default)s)')
    ap.add_argument('-c', '--cursor', default=False, action=argparse.BooleanOptionalAction,
                help='invoke the LD around the cursor')
    ap.add_argument('-f', '--flash', default=False, action=argparse.BooleanOptionalAction,
                help='flash the detected area')
    ap.add_argument('-v', '--verbose', default=True, action=argparse.BooleanOptionalAction,
                help='report error messages')
    return ap

class Result:
    def __init__(self, text=None, area=None, error=None):
        self.text = text
        self.area = area
        self.tran = None
        self.error = error
        self.style = 0

    def set_style(self, style):
        self.style = { 'swift': 0, 'popup': 1, 'display': 2, 'auto': -1 }[style]

    def tran_text(self, dest):
        if not self.text: return
        try:
            from googletrans import Translator
            try:
                self.tran = Translator(http2=True).translate(self.text, dest=dest).text
                self.error = 'googletrans/http2 is available'
            except ImportError:
                self.tran = Translator(http2=False).translate(self.text, dest=dest).text
        except ImportError:
            self.error = 'python-googletrans is missing'
        finally:
            self.style = 2

    def set_verbose(self, verbose):
        if not verbose and self.error: self.error = ' '

    @property
    def param(self):
        style = 2 if self.error or not self.text else self.style
        text = (lambda t: [self.tran, t] if self.tran else [t, 'Error'])(self.error or self.text)
        return ('RunAt', ('(iasiiii)', (style, text, *self.area))) if self.area else ('Run', ('(ias)', (style, text)))

def gsdbus_call(method_name, parameters, name='', object_path='', interface_name=''):
    param = parameters if parameters == None else GLib.Variant(*parameters)
    proxy = Gio.DBusProxy.new_for_bus_sync(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, None,
                                           'org.gnome.Shell' + name,
                                           '/org/gnome/Shell' + object_path,
                                           'org.gnome.Shell' + interface_name, None)
    return proxy.call_sync(method_name, param, Gio.DBusCallFlags.NONE, -1, None).unpack()

def bincount_img(img):
    # Ref: https://stackoverflow.com/a/50900143 ;; detect if image bgcolor is dark or not
    i1d = np.ravel_multi_index(img.reshape(-1, img.shape[-1]).T, (256, 256, 256))
    rgb = np.unravel_index(np.bincount(i1d).argmax(), (256, 256, 256))[:3]
    return colorsys.rgb_to_hls(*rgb)[1] < 50

def read_img(filename, trim=False):
    img = cv2.imread(filename)
    if trim: img = (lambda e, s: img[e:s[0]-e, e:s[1]-e])(edge, img.shape)
    if bincount_img(img): img = cv2.bitwise_not(img)
    return cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)

def find_rect(rects, point):
    pt_in_rect = lambda p, r: p[0] > r[0] and p[0] < r[0] + r[2] and p[1] > r[1] and p[1] < r[1] + r[3]
    pt_rect_dis = lambda p, r: sum([max(a - b, 0, b - a - c) ** 2 for (b, a, c) in zip(p, r[0:2], r[2:4])])
    return next((x for x in rects if pt_in_rect(point, x)), None) or min(rects, key=lambda x: pt_rect_dis(point, x)) if rects else None

def crop_img(img, point, kernel, iterations, blur=False):
    # Ref: https://stackoverflow.com/a/57262099
    blr = cv2.GaussianBlur(gry, (3, 3), 0) if blur else img
    thr = cv2.threshold(blr, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    dlt = cv2.dilate(thr, cv2.getStructuringElement(cv2.MORPH_RECT, kernel), iterations=iterations)
    cts = cv2.findContours(dlt, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    return find_rect(list(map(cv2.boundingRect, cts)), point)

def ocr_word(lang, bttn=False, sz=(250, 50)):
    ok, ps = gsdbus_call('Eval', ('(s)', ('((a, b) => [[a[0], a[1]], [b[0], b[1]]])(global.get_pointer(), global.get_display().get_size())',)))
    if not ok: return Result(error='Gnome Shell DBus error.')
    pt, sc = ast.literal_eval(ps)
    w, h = [min(a, b - a, c) for (a, b, c) in zip(pt, sc, sz)]
    if w < 5 or h < 5: return Result(error='Too small to screenshot.')
    ar = [pt[0] - w, pt[1] - h, w * 2, h * 2]
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gsdbus_call('ScreenshotArea', ('(iiiibs)', (*ar, False, f.name)), '.Screenshot', '/Screenshot', '.Screenshot')
        if not ok: return Result(error='Gnome Shell DBus error.')
        if bttn:
            img = read_img(fn)
            rct = crop_img(img, (w, h), (3, 3), 1)
            return Result(text=pytesseract.image_to_string(img[rct[1]:rct[1]+rct[3], rct[0]:rct[0]+rct[2]], lang=lang).strip(),
                          area=(rct[0] + ar[0], rct[1] + ar[1], rct[2], rct[3])) if rct else Result(error=' ')
        else:
            img = read_img(fn)
            dat = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT, lang=lang)
            bxs = [[dat[x][i] for x in ['left', 'top', 'width', 'height', 'text']] for i, x in enumerate(dat['text']) if x]
            rct = find_rect(bxs, (w, h))
            return Result(text=rct[-1].strip(string.punctuation),
                          area=(rct[0] + ar[0], rct[1] + ar[1] - edge, rct[2], rct[3] + edge * 2))

def ocr_area(lang):
    area = gsdbus_call('SelectArea', None, '.Screenshot', '/Screenshot', '.Screenshot')
    with NamedTemporaryFile(suffix='.png') as f:
        ok, fn = gsdbus_call('ScreenshotArea', ('(iiiibs)', (*area, False, f.name)), '.Screenshot', '/Screenshot', '.Screenshot')
        return Result(text=pytesseract.image_to_string(read_img(fn), lang=lang).replace('\n\n', '\r').replace('\n', ' ').replace('|', 'I').strip(),
                      area=area) if ok else Result(error='Gnome Shell DBus error.')

def ocr_prln(lang, line=False):
    ok, pf = gsdbus_call('Eval', ('(s)', ('((a, b) => [[a[0], a[1]], [b.x, b.y, b.width, b.height]])'\
                                          '(global.get_pointer(), global.display.focus_window.get_frame_rect())',)))
    if not ok: return Result(error='Gnome Shell DBus error.')
    pt, fw = ast.literal_eval(pf)
    pt = [a - b - edge for (a, b) in zip(pt, fw)]
    with NamedTemporaryFile(suffix='.png') as f:
        # ok, fn = gsdbus_call('ScreenshotArea', ('(iiiibs)', (*fw, False, f.name)), '.Screenshot', '/Screenshot', '.Screenshot')
        ok, fn = gsdbus_call('ScreenshotWindow', ('(bbbs)', (False, False, False, f.name)), '.Screenshot', '/Screenshot', '.Screenshot')
        if not ok: return Result(error='Gnome Shell DBus error.')
        kn, it = ((15, 3), 1) if line else ((9, 6), 3)
        img = read_img(fn, trim=True)
        rct = crop_img(img, pt, kn, it)
        return Result(text=pytesseract.image_to_string(img[rct[1]:rct[1]+rct[3], rct[0]:rct[0]+rct[2]], lang=lang).replace('\n', ' ').replace('|', 'I').strip(),
                      area=(rct[0] + fw[0] + edge, rct[1] + fw[1] + edge, rct[2], rct[3])) if rct else Result(error=' ')

def mode_exe(args):
    result = (lambda m : m[0](*m[1]))({
        'word': (ocr_word, (args.lang,)),
        'button': (ocr_word, (args.lang, True)),
        'paragraph': (ocr_prln, (args.lang,)),
        'line': (ocr_prln, (args.lang, True)),
        'area': (ocr_area, (args.lang,)),
        'selection': (lambda: Result(text=' '), ())
    }[args.mode]);
    result.set_style(args.style)
    result.set_verbose(args.verbose)
    return result

if __name__ == '__main__':
    main()
