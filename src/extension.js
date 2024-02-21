// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import IBus from 'gi://IBus';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {DBusSenderChecker} from 'resource:///org/gnome/shell/misc/util.js';
import {Spinner} from 'resource:///org/gnome/shell/ui/animation.js';

import {Field, Result} from './const.js';
import {SwitchItem, MenuItem, RadioItem, PanelButton, IconButton, offstage} from './menu.js';
import {Fulu, ExtensionBase, Destroyable, symbiose, omit, connect, getSelf, _, copy, paste, open} from './fubar.js';
import {ROOT, BIND, PIPE, noop, omap, xnor, lot, execute, nonEq, cancelled, homolog, hook, capitalize, has, pickle} from './util.js';

const Trigger = {SWIFT: 0, POPUP: 1, DISABLE: 2};
const OCRMode = {WORD: 0, PARAGRAPH: 1, AREA: 2, LINE: 3, DIALOG: 4};
const Triggers = omap(Trigger, ([k, v]) => [[v, k.toLowerCase()]]);
const OCRModes = omap(OCRMode, ([k, v]) => [[v, k.toLowerCase()]]);
const Kaomojis = ['_(:з」∠)_', '¯\\_(ツ)_/¯', 'o(T^T)o', 'Σ(ʘωʘﾉ)ﾉ', 'ヽ(ー_ー)ノ']; // placeholder
const EvalMask = Object.getOwnPropertyNames(globalThis).filter(x => x !== 'eval').join(',');
const Modifier = {ctrl: Clutter.KEY_Control_L, shift: Clutter.KEY_Shift_L, alt: Clutter.KEY_Alt_L, super: Clutter.KEY_Super_L};
const LD_IFACE = `<node>
    <interface name="org.gnome.Shell.Extensions.LightDict">
        <method name="OCR">
            <arg type="s" direction="in" name="args"/>
        </method>
        <method name="Run">
            <arg type="s" direction="in" name="type"/>
            <arg type="s" direction="in" name="text"/>
            <arg type="s" direction="in" name="info"/>
            <arg type="ai" direction="in" name="area"/>
        </method>
        <method name="Get">
            <arg type="as" direction="in" name="props"/>
            <arg type="aai" direction="out" name="results"/>
        </method>
    </interface>
</node>`; // NOTE: Maybe - https://gitlab.freedesktop.org/dbus/dbus/-/issues/25

const getPointer = () => global.get_pointer();
const getDisplay = () => global.display.get_size();
const getFocused = () => global.display.get_focus_window();

const still = ([x1, y1], [x2, y2]) => x1 === x2 && y1 === y2;
const outside = ([x, y, w, h], [m, n]) => m < x || n < y || m > x + w || n > y + h;
const keyval = keysym => Modifier[keysym] ?? Clutter[`KEY_${keysym}`] ?? Clutter.KEY_VoidSymbol;
const allowed = (cmd, app, str) => cmd ? (cmd.apps?.includes(app) ?? true) && regexTest(cmd.regexp, str) : false;
const evaluate = (script, scope) => Function(Object.keys(scope).concat(EvalMask).join(','),
    `'use strict'; return eval(${JSON.stringify(script)})`)(...Object.values(scope));

function regexTest(exp, str, nil = true) {
    try {
        return exp ? RegExp(exp).test(str) : nil;
    } catch(e) {
        logError(e, exp);
        return nil;
    }
}

class DictPop extends IconButton {
    static {
        GObject.registerClass(this);
    }

    constructor(click) {
        super({style_class: 'light-dict-button candidate-box'}, () => click(this._index), null);
        this._updateTip = () => this._tip?.bin.child.set_text(this._tooltip_text);
    }

    setCommand({icon, name, tooltip}, index, show_tip) {
        this.setTip(show_tip ? tooltip : '');
        if(icon) {
            this.set_label('');
            this.set_icon_name(icon);
        } else {
            this.set_icon_name('');
            this.set_label(name || 'Name');
        }
        this._index = index;
    }

    setTip(tip) {
        this._tooltip_text = tip;
        if(xnor(this._tip, tip)) return;
        if(tip) this._buildTip(tip);
        else omit(this, 'label_actor', '_tip');
    }
}

class DictBar extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass({
            Signals: {
                'dict-bar-clicked': {param_types: [GObject.TYPE_JSOBJECT]},
            },
        }, this);
    }

    constructor(fulu) {
        super(St.Side.BOTTOM);
        this.visible = false;
        this.style_class = 'light-dict-bar-boxpointer';
        this._buildWidgets();
        this._bindSettings(fulu);
    }

    _buildWidgets() {
        this._cmds = [];
        this._sbt = symbiose(this, null, {
            hide: [clearTimeout, (x, t) => x && setTimeout(() => this.dispel(), t)],
        });
        this._box = hook({
            'scroll-event': this._onScroll.bind(this),
            'notify::hover': actor => this._sbt.hide.revive(!actor.hover, this.autohide / 10),
        }, new St.BoxLayout({
            reactive: true, vertical: false, track_hover: true,
            style_class: 'light-dict-iconbox candidate-popup-content',
        }));
        this.bin.set_child(this._box);
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            pgsize:    [Field.PGSZ,  'uint'],
            tooltip:   [Field.TIP,   'boolean'],
            autohide:  [Field.ATHD,  'uint'],
            pcommands: [Field.PCMDS, 'value'],
        }, this);
    }

    set tooltip(tooltip) {
        if(xnor(this._tooltip, tooltip)) return;
        if((this._tooltip = tooltip)) [...this._box].forEach((x, i) => x.setTip(this._cmds[i].tooltip, i));
        else [...this._box].forEach((x, i) => x.setTip('', i));
    }

    set pcommands(pcmds) {
        let cmds = pcmds.recursiveUnpack().filter(x => x.enable);
        if(!homolog(this._cmds, cmds, (x, y) => nonEq(x, y) ? x.icon === y.icon && x.name === y.name && x.tooltip === y.tooltip : x === y)) {
            let btns = [...this._box];
            let diff = cmds.length - btns.length;
            if(diff > 0) while(diff-- > 0) this._box.add_child(new DictPop(x => { this.dispel(); this.emit('dict-bar-clicked', this._cmds[x]); }));
            else if(diff < 0) do btns.at(diff).destroy(); while(++diff < 0);
            [...this._box].forEach((x, i) => x.setCommand(cmds[i], i, this._tooltip));
        }
        this._cmds = cmds;
    }

    _getPages() {
        let length = this._cmds.reduce((p, x) => p + (x._visible ? 1 : 0), 0);
        return length && this.pgsize ? Math.ceil(length / this.pgsize) : 0;
    }

    _updatePages(pages) {
        let icons = [...this._box].filter((x, i) => (x.visible = this._cmds[i]._visible));
        if(pages < 2) return;
        this._idx = this._idx < 1 ? pages : this._idx > pages ? 1 : this._idx ?? 1;
        if(this._idx === pages && icons.length % this.pgsize) {
            let start = icons.length - this.pgsize;
            icons.forEach((x, i) => { x.visible = i >= start; });
        } else {
            let end = this._idx * this.pgsize;
            let start = (this._idx - 1) * this.pgsize;
            icons.forEach((x, i) => { x.visible = i >= start && i < end; });
        }
    }

    _onScroll(_a, event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this._idx--; break;
        case Clutter.ScrollDirection.DOWN: this._idx++; break;
        default: return;
        }
        this._updatePages(this._getPages());
    }

    summon(app, str) {
        this._cmds.forEach(x => { x._visible = allowed(x, app, str); });
        let pages = this._getPages();
        if(pages < 1) return;
        if(offstage(this)) Main.layoutManager.addTopChrome(this);
        this._updatePages(pages);
        this.open(BoxPointer.PopupAnimation.NONE);
        this._sbt.hide.revive(true, this.autohide);
    }

    dispel() {
        if(offstage(this)) return;
        this._sbt.hide.dispel();
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this);
    }
}

class DictBox extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor(fulu) {
        super(St.Side.TOP);
        this.visible = false;
        this.style_class = 'light-dict-box-boxpointer';
        this._buildWidgets();
        this._bindSettings(fulu);
    }

    _buildWidgets() {
        this._sbt = symbiose(this, null, {
            hide: [clearTimeout, (x, t) => x && setTimeout(() => this.dispel(), t)],
        });
        this._view = hook({
            'button-press-event': this._onClick.bind(this),
            'notify::hover': ({hover}) => this._sbt.hide.revive(!hover, this.autohide / 10),
        }, new St.ScrollView({
            child: new St.BoxLayout({vertical: true, style_class: 'light-dict-content'}),
            style_class: 'light-dict-view', overlay_scrollbars: true, reactive: true, track_hover: true,
        }));
        this._text = this._genLabel('light-dict-text');
        this._info = this._genLabel('light-dict-info');
        [this._text, this._info].forEach(x => this._view.child.add_child(x));
        this.bin.set_child(this._view);
    }

    _genLabel(style_class) {
        let label = new St.Label({style_class});
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        return label;
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            lcommand:   [Field.LCMD, 'string'],
            rcommand:   [Field.RCMD, 'string'],
            autohide:   [Field.ATHD, 'uint'],
            hide_title: [Field.HDTT, 'boolean'],
        }, this);
    }

    set hide_title(hide) {
        this._hide_title = hide;
        if(this._text) this._text.visible = !hide;
    }

    _updateScrollAndDelay() {
        let [,, w, h] = this.get_preferred_size(),
            theme = this._view.get_theme_node(),
            limit = theme.get_max_height();
        if(limit <= 0) limit = getDisplay().at(1) * 15 / 32;
        let scroll = h >= limit;
        let count = scroll ? w * limit / (Clutter.Settings.get_default().font_dpi / 1024 * theme.get_font().get_size() / 1024 / 72) ** 2
            : [...this._info.get_text()].reduce((p, x) => p + (GLib.unichar_iswide(x) ? 2 : GLib.unichar_iszerowidth(x) ? 0 : 1), 0);
        this._delay = Math.clamp(this.autohide * count / 36, 1000, 10000);
        this._view.vscrollbar_policy = scroll ? St.PolicyType.ALWAYS : St.PolicyType.NEVER; // HACK: workaround for trailing lines with default policy (AUTOMATIC)
        this._view.get_vadjustment().set_value(0);
    }

    _onClick(_a, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: copy(this._info.get_text().trimStart()); break;
        case Clutter.BUTTON_PRIMARY: if(this.lcommand) execute(this.lcommand, {LDWORD: this._txt}).catch(noop); break;
        case Clutter.BUTTON_SECONDARY: if(this.rcommand) execute(this.rcommand, {LDWORD: this._txt}).catch(noop); break;
        }
    }

    set error(error) {
        if(xnor(error, this._error)) return;
        if((this._error = error)) this._view.add_style_pseudo_class('state-error');
        else this._view.remove_style_pseudo_class('state-error');
    }

    summon(info, text, error) {
        this._txt = text;
        this.error = error;
        info ||= lot(Kaomojis);
        if(offstage(this)) Main.layoutManager.addTopChrome(this);
        try {
            Pango.parse_markup(info, -1, '');
            // HACK: workaround for https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/1125
            this._info.clutter_text.set_markup(info.startsWith('<') ? ` ${info}` : info);
        } catch(e) {
            this._info.set_text(info);
        }
        if(this._text.visible) this._text.set_text(text);
        this._updateScrollAndDelay();
        this.open(BoxPointer.PopupAnimation.NONE);
        this._sbt.hide.revive(true, this.autohide);
    }

    dispel() {
        if(offstage(this)) return;
        this._sbt.hide.dispel();
        this._prect = [...this.get_transformed_position(), ...this.get_transformed_size()];
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this);
    }
}

class DictAct extends Destroyable {
    constructor(fulu) {
        super();
        this._buildWidgets(fulu);
        this._bindSettings();
    }

    _buildWidgets(fulu) {
        this._fulu = fulu;
        this._kbd = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._sbt = symbiose(this, () => omit(this, '_kbd', '_tty', 'screenshot'), {
            cancel: [x => x?.cancel(), () => new Gio.Cancellable()],
            stroke: [x => x?.forEach(clearTimeout), x => x.split(/\s+/).map((y, i) => (z => setTimeout(() => {
                z.forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.PRESSED));
                z.reverse().forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.RELEASED));
            }, i * 100))(y.split('+')))],
            dwell: [clearInterval, x => x && setInterval(() => (pt => {
                if(still(this._pt, pt) && !still(this._pt, this._ppt)) this.emit('dict-act-dwelled', pt[2], this._ppt);
                [this._ppt, this._pt] = [this._pt, pt];
            })(getPointer()), 300)],
            keys: [x => x && Main.wm.removeKeybinding(Field.KEYS),
                x => x && Main.wm.addKeybinding(Field.KEYS, this._fulu.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.invokeOCR())],
        });
        this._tty = new Gio.SubprocessLauncher({flags: PIPE});
        let spawnv = this._tty.spawnv.bind(this._tty);
        this._tty.spawnv = x => { let proc = spawnv(x); this._pid = parseInt(proc.get_identifier()); return proc; };
    }

    _bindSettings() {
        this._fulu.attach({
            scommand:   [Field.SCMD,  'int'],
            dwell_ocr:  [Field.DOCR,  'boolean'],
            short_ocr:  [Field.KEY,   'boolean'],
            enable_ocr: [Field.OCR,   'boolean'],
            scommands:  [Field.SCMDS, 'value'],
        }, this).attach({
            ocr_param:  [Field.OCRP,  'string'],
            ocr_mode:   [Field.OCRS,  'uint'],
        }, this, 'ocr_cmd');
    }

    set scommands(scmds) {
        this._scmds = scmds.recursiveUnpack();
    }

    getCommand(name) {
        return (name ? this._scmds.find(x => x.name === name) : this._scmds[this.scommand]) ?? this._scmds[0];
    }

    set enable_ocr(enable) {
        this._enable_ocr = enable; // EGO:  && !GLib.access(`${ROOT}/ldocr.py`, 0);
        this.short_ocr = this._short_ocr;
        this.dwell_ocr = this._dwell_ocr;
    }

    set dwell_ocr(dwell_ocr) {
        this._ppt = this._pt = dwell_ocr ? getPointer() : null;
        this._sbt.dwell.revive((this._dwell_ocr = dwell_ocr) && this._enable_ocr);
    }

    set short_ocr(short) {
        this._sbt.keys.revive((this._short_ocr = short) && this._enable_ocr);
    }

    set ocr_cmd([k, v]) {
        this[k] = v;
        this._ocr_cmd = `python ${ROOT}/ldocr.py -m ${OCRModes[this.ocr_mode]} ${this.ocr_param}`;
    }

    set screenshot(shot) {
        let checker = Main.shellDBusService._screenshotService._senderChecker;
        checker._isSenderAllowed = shot ? this._dbusChecker.bind(this) : DBusSenderChecker.prototype._isSenderAllowed.bind(checker);
    }

    async _dbusChecker(x) {
        if(global.context.unsafe_mode) return true;
        try {
            let pid = await Gio.DBus.session.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
                new GLib.Variant('(s)', [x]), null, Gio.DBusCallFlags.NONE, -1, null);
            return this._pid === pid.deepUnpack().at(0);
        } catch(e) {
            return false;
        }
    }

    invokeOCR(override) {
        if(!this._enable_ocr) return;
        this.screenshot = true;
        this.execute(override ? `${this._ocr_cmd} ${override}` : this._ocr_cmd).catch(noop).finally(() => omit(this, '_pid', 'screenshot'));
    }

    stroke(keys) {
        this._sbt.stroke.revive(keys);
    }

    commit(string) {
        let InputSourceManager = Keyboard.getInputSourceManager();
        if(InputSourceManager.currentSource.type !== Keyboard.INPUT_SOURCE_TYPE_IBUS) Main.inputMethod.commit(string); // TODO: not tested
        else InputSourceManager._ibusManager._panelService?.commit_text(IBus.Text.new_from_string(string));
    }

    execute(cmd, env) {
        return execute(cmd, env, this._tty, this._sbt.cancel.revive());
    }
}

class DictBtn extends PanelButton {
    static {
        GObject.registerClass(this);
    }

    constructor(fulu) {
        super();
        this._buildWidgets();
        this._bindSettings(fulu);
        this._addMenuItems();
    }

    _buildWidgets() {
        this._scmds = [];
        this.add_style_class_name('light-dict-systray');
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            dwell_ocr:  [Field.DOCR,  'boolean'],
            enable_ocr: [Field.OCR,   'boolean'],
            scommands:  [Field.SCMDS, 'value'],
        }, this).attach({
            trigger: [Field.TRG, 'uint', x => this._menus?.trigger.setChosen(x)],
            passive: [Field.PSV, 'uint', x => this._menus?.passive.setToggleState(!!x)],
        }, this, 'icon').attach({
            ocr_mode: [Field.OCRS, 'uint', x => this._menus?.ocr.setChosen(x)],
            scommand: [Field.SCMD, 'int', x => this._menus?.scmds.setChosen(x)],
        }, this, 'mode');
    }

    set icon([k, v, cb]) {
        cb(this[k] = v);
        if(!has(this, 'trigger', 'passive')) return;
        this._icon._setIcon(`ld-${Triggers[this.trigger]}-${this.passive ? 'passive' : 'proactive'}-symbolic`);
    }

    set mode([k, v, cb]) {
        cb(this[k] = v);
    }

    set scommands(scmds) {
        let cmds = scmds.recursiveUnpack().map(x => x.name);
        if(homolog(this._scmds, cmds)) return;
        this._scmds = cmds;
        this._menus?.scmds.setOptions(cmds, this.scommand);
    }

    set dwell_ocr(dwell_ocr) {
        this._dwell_ocr = dwell_ocr;
        this._menus?.dwell.setToggleState(dwell_ocr);
        if(dwell_ocr) this.add_style_pseudo_class('state-busy');
        else this.remove_style_pseudo_class('state-busy');
    }

    set enable_ocr(enable) {
        if((this._enable_ocr = enable)) this._menus?.ocr.show();
        else this._menus?.ocr.hide();
    }

    vfunc_scroll_event(event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this._fulu.set('trigger', (this.trigger + 1) % 2, this); break;
        case Clutter.ScrollDirection.DOWN: this._fulu.set('passive', 1 - this.passive, this); break;
        }
        return Clutter.EVENT_STOP;
    }

    _addMenuItems() {
        this._menus = {
            dwell:   new SwitchItem(_('Dwell OCR'), this._dwell_ocr, x => this._fulu.set('dwell_ocr', x, this)),
            passive: new SwitchItem(_('Passive mode'), !!this.passive, x => this._fulu.set('passive', x ? 1 : 0, this)),
            sep1:    new PopupMenu.PopupSeparatorMenuItem(),
            trigger: new RadioItem(_('Trigger'), omap(Trigger, ([k, v]) => [[v, _(capitalize(k))]]), this.trigger, x => this._fulu.set('trigger', x, this)),
            scmds:   new RadioItem(_('Swift'), this._scmds, this.scommand, x => this._fulu.set('scommand', x, this)),
            ocr:     new RadioItem(_('OCR'), omap(OCRMode, ([k, v]) => [[v, _(capitalize(k))]]), this.ocr_mode, x => this._fulu.set('ocr_mode', x, this)),
            sep2:    new PopupMenu.PopupSeparatorMenuItem(),
            prefs:   new MenuItem(_('Settings'), () => getSelf().openPreferences()),
        };
        this._menus.dwell.bind_property('visible', this._menus.ocr, 'visible', BIND);
        Object.values(this._menus).forEach(x => this.menu.addMenuItem(x));
        this.enable_ocr = this._enable_ocr;
    }
}

class LightDict extends Destroyable {
    constructor(gset) {
        super();
        this._portSettings(gset);
        this._buildWidgets(gset);
        this._bindSettings();
    }

    _portSettings(gset) { // FIXME: remove in the next version
        let regex = RegExp(/(?<!\$)\bLDWORD\b/g);
        let replace = x => x.replace(regex, '"$LDWORD"');
        [Field.LCMD, Field.RCMD].forEach(x => {
            let cmd = gset.get_string(x);
            if(regex.test(cmd)) gset.set_string(x, replace(cmd));
        });
        [Field.SCMDS, Field.PCMDS].forEach(x => {
            let cmds = gset.get_value(x).recursiveUnpack();
            if(!cmds.some(y => !y.type && regex.test(y.command))) return;
            cmds.forEach(y => { if(!y.type) y.command = replace(y.command); });
            gset.set_value(x, pickle(cmds));
        });
    }

    _bindSettings() {
        this._fulu.attach({
            filter:     [Field.TFLT, 'string'],
            app_list:   [Field.APPS, 'string'],
            passive:    [Field.PSV,  'uint'],
            systray:    [Field.STRY, 'boolean'],
            trigger:    [Field.TRG,  'uint'],
            list_type:  [Field.APP,  'uint'],
            text_strip: [Field.TSTP, 'boolean'],
        }, this);
    }

    _buildWidgets(gset) {
        this.dbus = true;
        this._app = this.getAppID();
        this._lock = {dwell: [], select: []};
        this._fulu = new Fulu({}, gset, this);
        this._box = new DictBox(this._fulu);
        this._csr = new Clutter.Actor({opacity: 0, x: 1, y: 1}); // HACK: init pos to avoid misplacing at the first occurrence
        this._act = hook({'dict-act-dwelled': this._onDwell.bind(this)}, new DictAct(this._fulu));
        this._bar = hook({'dict-bar-clicked': (_a, x) => { this._lock.dwell[0] = true; this._exeCmd(x); }}, new DictBar(this._fulu));
        connect(this, [global.display.get_selection(), 'owner-changed', this._onSelect.bind(this)],
            [global.display, 'notify::focus-window', () => { this._dispelAll(); this._app = this.getAppID(); }]);
        this._sbt = symbiose(this, () => omit(this, 'dbus', 'systray', 'waiting', '_bar', '_box', '_act', '_csr'), {
            select: [clearInterval, x => setInterval(() => this._onButtonPolling(x), 50)],
        });
        Main.uiGroup.add_child(this._csr);
    }

    set dbus(dbus) {
        if(xnor(dbus, this._dbus)) return;
        if(dbus) {
            this._dbus = Gio.DBusExportedObject.wrapJSObject(LD_IFACE, this);
            this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');
        } else {
            this._dbus.flush();
            this._dbus.unexport();
            this._dbus = null;
        }
    }

    set systray(systray) {
        if(xnor(systray, this._btn)) return;
        if(systray) this._btn = new DictBtn(this._fulu);
        else omit(this, '_btn');
    }

    set waiting(waiting) {
        if(xnor(waiting, this._spn)) return;
        if(waiting) {
            this._spn = new Spinner(16);
            this._spn.add_style_class_name('light-dict-view');
            Main.layoutManager.addTopChrome(this._spn);
            let [x, y] = getPointer();
            let l = Meta.prefs_get_cursor_size() >>> 1;
            this._spn.set_position(x + l, y + l);
            this._spn.play();
        } else {
            omit(this, '_spn');
        }
    }

    _onButtonPolling(mdf) {
        if((mdf ^ getPointer().at(2)) !== Clutter.ModifierType.BUTTON1_MASK) return;
        this._sbt.select.dispel();
        this.run().catch(noop);
    }

    setCursor(area) {
        this._dispelAll();
        let [x, y, w, h] = area && area[3] < getDisplay().at(1) / 2 ? area
            : (s => (([a, b], c, d) => [a - c, b - c, d, d])(getPointer(), s / 2, s * 1.15))(Meta.prefs_get_cursor_size());
        this._center = area && w > 250;
        this._csr.set_position(x, y);
        this._csr.set_size(w, h);
    }

    getAppID() {
        return (w => w ? Shell.WindowTracker.get_default().get_window_app(w)?.get_id() ?? '' : '')(getFocused());
    }

    _denyApp() {
        return this.app_list && xnor(this.list_type, this.app_list.includes(this._app));
    }

    _denyMdf(mdf) {
        return this.passive && !(mdf & Clutter.ModifierType.MOD1_MASK);
    }

    _onDwell(_a, mdf, ppt) {
        if(this._lock.dwell.pop() || this._box._prect && !outside(this._box._prect, ppt) || this._act.ocr_mode === OCRMode.AREA ||
           this._box.visible && this._box._view.hover || this._bar.visible && this._bar._box.hover || this._denyMdf(mdf)) return;
        this._act.invokeOCR(`${this._act._ocr_cmd} --quiet`);
    }

    _dispelAll() {
        this._box.dispel();
        this._bar.dispel();
    }

    _onSelect(_sel, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        this._sbt.select.dispel();
        let mdf = getPointer().at(2);
        if(this._lock.select.pop() || this._denyApp() || this._denyMdf(mdf) || this.trigger === Trigger.DISABLE) return;
        if(mdf & Clutter.ModifierType.BUTTON1_MASK) this._sbt.select.summon(mdf);
        else this.run().catch(noop);
    }

    _postExe(output, result) {
        if(result & Result.SHOW) this._display(output);
        if(result & Result.COPY) copy(output);
        if(result & Result.SELECT) copy(output, true);
        if(result & Result.COMMIT) this._act.commit(output);
    }

    async _exeSh({command, result}) {
        let env = {LDWORD: this._txt, LDAPPID: this._app};
        if(result) {
            try {
                if(result & Result.WAIT) {
                    this.waiting = true;
                    let stdout = await this._act.execute(command, env);
                    this.waiting = false;
                    this._postExe(stdout, result);
                } else {
                    this._postExe(await this._act.execute(command, env), result);
                }
            } catch(e) {
                this.waiting = false;
                if(!cancelled(e)) this._display(e.message, true);
            }
        } else {
            execute(command, env).catch(logError);
        }
    }

    _exeJS({command, result}) {
        try {
            let output = evaluate(command, {
                open, copy,
                LDWORD: this._txt,
                LDAPPID: this._app,
                key: x => this._act.stroke(x),
                search: x => { Main.overview.show(); Main.overview.searchEntry.set_text(x); },
            });
            if(result) this._postExe(String(output), result);
        } catch(e) {
            this._display(e.message, true);
        }
    }

    async _exeCmd(cmd) {
        cmd.type ? this._exeJS(cmd) : await this._exeSh(cmd);
    }

    _select(text) {
        this._lock.select[0] = true;
        copy(text, true);
    }

    async _swift(name) {
        let cmd = this._act.getCommand(name);
        if(allowed(cmd, this._app, this._txt)) await this._exeCmd(cmd);
    }

    _popup() {
        this._bar.setPosition(this._csr, 1 / 2);
        this._bar.summon(this._app, this._txt);
    }

    _display(info, error) {
        this._box.setPosition(this._csr, this._center ? 1 / 2 : 1 / 10);
        this._box.summon(info, this._txt, error);
    }

    _store(text) {
        if(this.text_strip) text = text?.replace(/((?<=^)|(?<=\n))\s*(\n|$(?![\r\n]))/gm, '');
        if(!text) throw Error('empty');
        this._txt = text;
    }

    async run() {
        let text = await paste(true);
        if(this.passive || !regexTest(this.filter, text, false)) this._run('auto', text);
    }

    async _run(type, text, info, area) {
        this.setCursor(area);
        let [kind, name] = type === 'auto' ? [Triggers[this.trigger]] : type.split(':');
        this._store(text || (kind === 'display' ? 'Oops' : await paste(true)));
        switch(kind) {
        case 'swift':   await this._swift(name); break;
        case 'popup':   this._popup(); break;
        case 'display': this._display(info, !text); break;
        }
    }

    async RunAsync([type, text, info, area], invocation) {
        await this._run(type, text, info, area.length === 4 ? area : null).catch(noop);
        invocation.return_value(null);
    }

    async GetAsync([props], invocation) {
        try {
            if(await this._act._dbusChecker(invocation.get_sender())) {
                invocation.return_value(new GLib.Variant('(aai)', [props.map(x => {
                    switch(x) {
                    case 'display': return getDisplay();
                    case 'pointer': return getPointer().slice(0, 2);
                    case 'focused': return (r => r ? [r.x, r.y, r.width, r.height] : null)(getFocused()?.get_frame_rect?.());
                    default: return null;
                    }
                })]));
            } else {
                invocation.return_error_literal(Gio.DBusError, Gio.DBusError.ACCESS_DENIED, `${invocation.get_method_name()} is forbidden`);
            }
        } catch(e) {
            invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, `${invocation.get_method_name()} failed`);
        }
    }

    OCR(args) {
        this._act.invokeOCR(args);
    }
}

export default class Extension extends ExtensionBase { $klass = LightDict; }
