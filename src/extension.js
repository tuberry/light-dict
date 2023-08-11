// vim:fdm=syntax
// by tuberry

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
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import { DBusSenderChecker } from 'resource:///org/gnome/shell/misc/util.js';

import { Field } from './const.js';
import { noop, scap, omap, bmap, xnor, raise, gerror, lot } from './util.js';
import { SwitchItem, MenuItem, RadioItem, DRadioItem, TrayIcon, gicon } from './menu.js';
import { Fulu, BaseExtension, Destroyable, symbiose, omit, onus, getSelf, _ } from './fubar.js';

const InputSourceManager = Keyboard.getInputSourceManager();

const gs_pointer = () => global.get_pointer();
const gs_size = () => global.display.get_size();
const gs_focus = () => global.display.get_focus_window();
const still = ([x1, y1], [x2, y2]) => x1 === x2 && y1 === y2;
const outside = ([x, y, w, h], [m, n]) => m < x || n < y || m > x + w || n > y + h;
const ahomo = (a, b, f = (x, y) => x === y) => a.length === b.length && a.every((x, i) => f(x, b[i]));

const Trigger = bmap({ swift: 0, popup: 1, disable: 2 });
const OCRMode = bmap({ word: 0, paragraph: 1, area: 2, line: 3, dialog: 4 });
const Kaomoji = ['_(:з」∠)_', '¯\\_(ツ)_/¯', 'o(T^T)o', 'Σ(ʘωʘﾉ)ﾉ', 'ヽ(ー_ー)ノ']; // placeholder
const LD_MDF = Clutter.ModifierType.MOD1_MASK;
const LD_IFACE =
`<node>
    <interface name="org.gnome.Shell.Extensions.LightDict">
        <method name="Toggle"/>
        <method name="OCR">
            <arg type="s" direction="in" name="temp"/>
        </method>
        <method name="Run">
            <arg type="s" direction="in" name="type"/>
            <arg type="s" direction="in" name="text"/>
            <arg type="s" direction="in" name="info"/>
        </method>
        <method name="RunAt">
            <arg type="s" direction="in" name="type"/>
            <arg type="s" direction="in" name="text"/>
            <arg type="s" direction="in" name="info"/>
            <arg type="i" direction="in" name="x"/>
            <arg type="i" direction="in" name="y"/>
            <arg type="i" direction="in" name="width"/>
            <arg type="i" direction="in" name="height"/>
        </method>
        <method name="Get">
            <arg type="as" direction="in" name="props"/>
            <arg type="aai" direction="out" name="results"/>
        </method>
    </interface>
</node>`;

function safeRegTest(exp, str) {
    try {
        return RegExp(exp).test(str);
    } catch(e) {
        logError(e, exp);
        return true;
    }
}

class DictPop extends St.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(click, enter) {
        super({ style_class: 'light-dict-button candidate-box' });
        this.connect('clicked', () => click(this._index));
        this.connect('enter-event', () => enter(this._index));
    }

    setButton({ icon = '', name: label }, index) {
        if(!icon) this.set_label(label || 'LD');
        else if(icon !== this._icon) this.set_child(new St.Icon({ gicon: Gio.Icon.new_for_string(icon), style_class: 'candidate-label' }));
        this._icon = icon;
        this._index = index;
    }
}

class DictBar extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass({
            Signals: {
                dict_bar_clicked: { param_types: [GObject.TYPE_JSOBJECT] },
            },
        }, this);
    }

    constructor(fulu) {
        super(St.Side.BOTTOM);
        this.visible = false;
        this.style_class = 'light-dict-bar-boxpointer';
        Main.layoutManager.addTopChrome(this);
        this._buildWidgets();
        this._bindSettings(fulu);
    }

    _buildWidgets() {
        this._cmds = [];
        this._box = new St.BoxLayout({
            visible: false, reactive: true, vertical: false,
            style_class: 'light-dict-iconbox candidate-popup-content',
        });
        this.bin.set_child(this._box);
        this._box.connectObject('leave-event', this._onLeave.bind(this),
            'enter-event', this._onEnter.bind(this),
            'scroll-event', this._onScroll.bind(this), onus(this));
        this._sbt = symbiose(this, () => omit(this, 'tooltip'), {
            hide: [clearTimeout, x => setTimeout(() => this.dispel(), x ? this.autohide / 10 : this.autohide)],
            tip: [clearTimeout, i => setTimeout(() => {
                if(!this._box.visible) return;
                this._tooltip.set_position(gs_pointer().at(0) - 10, this.get_position().at(1) + this.get_size().at(1) + 5);
                this._tooltip.set_text(this._cmds[i].tooltip || this._cmds[i].name || 'LD');
                this._tooltip.show();
            }, this.autohide / 5)],
        });
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            pgsize:    [Field.PGSZ,  'uint'],
            tooltip:   [Field.TIP,   'boolean'],
            autohide:  [Field.ATHD,  'uint'],
            pcommands: [Field.PCMDS, 'strv'],
        }, this);
    }

    set pcommands(pcmds) {
        let cmds = pcmds.map(x => JSON.parse(x)).filter(x => x.enable);
        if(!ahomo(this._cmds, cmds, (a, b) => a.icon === b.icon && a.name === b.name)) {
            this.dispel();
            let icons = this._box.get_children();
            let diff = cmds.length - icons.length;
            if(diff > 0) while(diff-- > 0) this._box.add(new DictPop(x => this.click(x), x => this.tip(x)));
            else if(diff < 0) do icons.at(diff).destroy(); while(++diff < 0);
            this._box.get_children().forEach((x, i) => x.setButton(cmds[i], i));
        }
        this._cmds = cmds;
    }

    tip(index) {
        if(!this._tooltip) return;
        this._tooltip.hide();
        this._sbt.tip.revive(index);
    }

    click(index) {
        this.dispel();
        this.emit('dict-bar-clicked', this._cmds[index]);
    }

    _updatePages() {
        let icons = this._box.get_children();
        icons.forEach((x, i) => { x.visible = this._cmds[i]._visible; });
        icons = icons.filter(x => x.visible);
        this._pages = icons.length && this.pgsize ? Math.ceil(icons.length / this.pgsize) : 0;
        if(this._pages < 2) return;
        this._idx = this._idx < 1 ? this._pages : this._idx > this._pages ? 1 : this._idx ?? 1;
        if(this._idx === this._pages && icons.length % this.pgsize) {
            let start = icons.length - this.pgsize;
            icons.forEach((x, i) => { x.visible = i >= start; });
        } else {
            let end = this._idx * this.pgsize;
            let start = (this._idx - 1) * this.pgsize;
            icons.forEach((x, i) => { x.visible = i >= start && i < end; });
        }
    }

    _updateViz(app, text) {
        let viz = this._cmds.map(({ regexp: r, apps: a }) => (!r || safeRegTest(r, text)) && (!a || a.includes(app)));
        if(this._cmds.every((x, i) => x._visible === viz[i])) return;
        this._cmds.forEach((x, i) => { x._visible = viz[i]; });
        this._updatePages();
    }

    set tooltip(tooltip) {
        if(xnor(tooltip, this._tooltip)) return;
        if(tooltip) {
            this._tooltip = new St.Label({ visible: false, style_class: 'light-dict-tooltip dash-label' });
            Main.layoutManager.addTopChrome(this._tooltip);
        } else {
            omit(this, '_tooltip');
        }
    }

    _onScroll(_a, event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this._idx--; break;
        case Clutter.ScrollDirection.DOWN: this._idx++; break;
        }
        this._updatePages();
    }

    _onEnter() {
        this._sbt.hide.dispel();
        this._entered = true;
        this._box.visible = true;
    }

    _onLeave(actor) {
        this._sbt.hide.revive(actor);
    }

    summon(fw, text) {
        this.dispel();
        this._updateViz(fw, text);
        if(this._pages < 1) return;
        if(!this._box.visible) {
            this._box.visible = true;
            this.open(BoxPointer.PopupAnimation.FULL);
            this.get_parent().set_child_above_sibling(this, null);
        }
        this._onLeave();
    }

    dispel() {
        if(!this._box.visible) return;
        this._sbt.hide.dispel();
        this._entered = false;
        this._box.visible = false;
        this.close(BoxPointer.PopupAnimation.FADE);
        if(!this._tooltip) return;
        this._sbt.tip.dispel();
        this._tooltip.hide();
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
        Main.layoutManager.addTopChrome(this);
        this._bindSettings(fulu);
        this._buildWidgets();
    }

    _buildWidgets() {
        this._view = new St.ScrollView({
            visible: false, overlay_scrollbars: true, clip_to_allocation: true,
            style_class: 'light-dict-scroll', hscrollbar_policy: St.PolicyType.NEVER,
        });
        this._box = new St.BoxLayout({ reactive: true, vertical: true, style_class: 'light-dict-content' });
        this._box.connectObject('leave-event', this._onLeave.bind(this), 'enter-event', this._onEnter.bind(this),
            'button-press-event', this._onClick.bind(this), onus(this));
        this._text = new St.Label({ style_class: 'light-dict-text', visible: !this._hide_title });
        this._info = new St.Label({ style_class: 'light-dict-info' });
        [this._text, this._info].forEach(x => {
            x.clutter_text.line_wrap = true;
            x.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            x.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            this._box.add(x);
        });
        this._view.add_actor(this._box);
        this.bin.set_child(this._view);
        this._sbt = symbiose(this, null, {
            hide: [clearTimeout, x => setTimeout(outside(this.getRect(), gs_pointer())
                ? this.dispel.bind(this) : () => this._onLeave(true), x ? this.autohide / 10 : this.autohide)],
        });
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

    needScroll() {
        let [, height] = this._view.get_preferred_height(-1);
        let limited = this._view.get_theme_node().get_max_height();
        if(limited < 0) limited = gs_size().at(1) * 15 / 32;
        return height >= limited;
    }

    _onEnter() {
        this._entered = true;
        this._view.visible = true;
        this._sbt.hide.dispel();
    }

    _onLeave(actor) {
        this._sbt.hide.revive(actor);
    }

    _onClick(_a, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._info.get_text().trimStart()); break;
        case Clutter.BUTTON_PRIMARY: if(this.lcommand) Util.spawnCommandLine(this.lcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); break;
        case Clutter.BUTTON_SECONDARY: if(this.rcommand) Util.spawnCommandLine(this.rcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); this.dispel(); break;
        }
    }

    getRect() {
        return [...this.get_transformed_position(), ...this.get_transformed_size()];
    }

    set error(error) {
        if(xnor(error, this._error)) return;
        this._box[`${((this._error = error)) ? 'add' : 'remove'}_style_pseudo_class`]('error');
    }

    summon(info, text, error) {
        this.error = error;
        this._selection = text;
        try {
            Pango.parse_markup(info, -1, '');
            // FIXME: workaround for https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/1125
            this._info.clutter_text.set_markup(info ? info.startsWith('<') ? ` ${info}` : info : lot(Kaomoji));
        } catch(e) {
            this._info.set_text(info || lot(Kaomoji));
        }
        if(this._text.visible) this._text.set_text(text);
        if(this.needScroll()) {
            this._view.add_style_pseudo_class('scrolled');
            this._view.vscrollbar_policy = St.PolicyType.AUTOMATIC;
            this._view.vscroll.get_adjustment().set_value(0);
        } else {
            this._view.vscrollbar_policy = St.PolicyType.NEVER;
            this._view.remove_style_pseudo_class('scrolled');
        }
        if(!this._view.visible) {
            this._view.visible = true;
            this.open(BoxPointer.PopupAnimation.FULL);
            this.get_parent().set_child_above_sibling(this, null);
        }
        this._onLeave();
    }

    dispel() {
        if(!this._view.visible) return;
        this._sbt.hide.dispel();
        this._rect = this.getRect();
        this._view.visible = false;
        this._info.set_text(lot(Kaomoji));
        this.close(BoxPointer.PopupAnimation.FADE);
        this._entered = false;
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
        this._ldocr = `python ${getSelf().path}/ldocr.py `;
        this._kbd = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._tty = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE });
        this._sbt = symbiose(this, () => omit(this, '_kbd', '_tty', 'screenshot'), {
            cancel: [x => x?.cancel(), () => new Gio.Cancellable()],
            stroke: [x => x?.forEach(clearTimeout), x => x.split(/\s+/).map(y => y.split('+')).map((z, i) => setTimeout(() => {
                z.forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, IBus.keyval_from_name(k), Clutter.KeyState.PRESSED));
                z.reverse().forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, IBus.keyval_from_name(k), Clutter.KeyState.RELEASED));
            }, i * 100))],
            dwell: [clearInterval, x => x && setInterval(() => {
                let pt = gs_pointer();
                if(still(this._pt, pt) && !still(this._pt, this._ppt)) this.emit('dict-act-dwelled', pt[2], this._ppt);
                [this._ppt, this._pt] = [this._pt, pt];
            }, 300)],
            keys: [x => x && Main.wm.removeKeybinding(Field.KEYS),
                x => x && Main.wm.addKeybinding(Field.KEYS, this._fulu.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.invokeOCR())],
        });
    }

    _bindSettings() {
        this._fulu.attach({
            ocr_param:  [Field.OCRP,  'string'],
            ocr_mode:   [Field.OCRS,  'uint'],
            scommand:   [Field.SCMD,  'int'],
            dwell_ocr:  [Field.DOCR,  'boolean'],
            short_ocr:  [Field.KEY,   'boolean'],
            enable_ocr: [Field.OCR,   'boolean'],
            scommands:  [Field.SCMDS, 'strv'],
        }, this);
    }

    set scommands(scmds) {
        this._scmds = scmds.map(x => JSON.parse(x));
    }

    getCommand(name) {
        return name ? this._scmds[this._scmds.findIndex(x => x.name === name)] || this._scmds[this.scommand] || this._scmds[0]
            : this._scmds[this.scommand] || this._scmds[0];
    }

    set enable_ocr(enable) {
        this._enable_ocr = enable;
        this.short_ocr = this._short_ocr;
        this.dwell_ocr = this._dwell_ocr;
    }

    set dwell_ocr(dwell_ocr) {
        this._ppt = this._pt = dwell_ocr ? gs_pointer() : null;
        this._sbt.dwell.revive((this._dwell_ocr = dwell_ocr) && this._enable_ocr);
    }

    set short_ocr(short) {
        this._sbt.keys.revive((this._short_ocr = short) && this._enable_ocr);
    }

    set ocr_mode(mode) {
        this._ocr_mode = OCRMode[mode];
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

    invokeOCR(param = '', supply = '') {
        if(!this._enable_ocr) return;
        this.screenshot = true;
        this.execute(this._ldocr + (param || ['-m', this._ocr_mode, this.ocr_param, supply].join(' ')))
            .catch(noop).finally(() => omit(this, '_pid', 'screenshot'));
    }

    stroke(keys) {
        this._sbt.stroke.revive(keys);
    }

    commit(string) {
        if(InputSourceManager.currentSource.type !== Keyboard.INPUT_SOURCE_TYPE_IBUS) Main.inputMethod.commit(string); // TODO: not tested
        else InputSourceManager._ibusManager._panelService?.commit_text(IBus.Text.new_from_string(string));
    }

    copy(string) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, string);
    }

    select(string) {
        St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, string);
    }

    async execute(cmd) {
        let cancel = this._sbt.cancel.revive(); // FIXME: '|' as an arg like `echo "|" | cat` not covered
        let cmdv = GLib.shell_parse_argv(cmd).at(1).reduce((a, x) => (x === '|' ? a.push([]) : a.at(-1).push(x)) && a, [[]]);
        let ret = await cmdv.filter(x => x.length).reduce(async (a, x) => {
            let proc = this._tty.spawnv(x);
            this._pid = parseInt(proc.get_identifier());
            let [stdout, stderr] = await proc.communicate_utf8_async(await a, cancel);
            let status = proc.get_exit_status();
            if(status) throw gerror(Gio.io_error_from_errno(status), stderr.trimEnd());
            return stdout;
        }, null);
        return ret?.trimEnd() ?? '';
    }
}

class DictBtn extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(fulu, ...args) {
        super(...args);
        this._buildWidgets();
        this._bindSettings(fulu);
        this._addMenuItems();
    }

    _buildWidgets() {
        this._scmds = [];
        this._icon = new TrayIcon();
        this.add_actor(this._icon);
        this.add_style_class_name('light-dict-systray');
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            dwell_ocr:  [Field.DOCR,  'boolean'],
            enable_ocr: [Field.OCR,   'boolean'],
            scommands:  [Field.SCMDS, 'strv'],
        }, this).attach({
            passive: [Field.PSV, 'uint', x => this._menus?.passive.setToggleState(!!x)],
            trigger: [Field.TRG, 'uint', x => this._menus?.trigger.setSelected(x)],
        }, this, 'icon').attach({
            ocr_mode: [Field.OCRS, 'uint', x => this._menus?.ocr.setSelected(x)],
            scommand: [Field.SCMD, 'int', x => this._menus?.scmds.setSelected(x)],
        }, this, 'mode');
    }

    set icon([k, v, out]) {
        out(this[k] = v);
        if(!['trigger', 'passive'].every(x => x in this)) return;
        let icon = `ld-${Trigger[this.trigger]}-${this.passive ? 'passive' : 'proactive'}-symbolic`;
        this._icon.set_fallback_gicon(gicon(icon));
        this._icon.set_icon_name(icon);
    }

    set mode([k, v, out]) {
        out(this[k] = v);
    }

    set scommands(scmds) {
        let cmds = scmds.map(x => JSON.parse(x).name);
        if(ahomo(this._scmds, cmds)) return;
        this._scmds = cmds;
        this._menus?.scmds.setList(cmds, this.scommand);
    }

    set dwell_ocr(dwell_ocr) {
        this._dwell_ocr = dwell_ocr;
        this._menus?.dwell.setToggleState(dwell_ocr);
        if(dwell_ocr) this.add_style_pseudo_class('busy');
        else this.remove_style_pseudo_class('busy');
    }

    set enable_ocr(enable) {
        this._enable_ocr = enable;
        ['dwell', 'ocr'].forEach(x => this._menus?.[x][enable ? 'show' : 'hide']());
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
            trigger: new RadioItem(_('Trigger'), omap(Trigger, ([k, v]) => isNaN(k) ? [[v, _(scap(k))]] : []), this.trigger, x => this._fulu.set('trigger', x, this)),
            scmds:   new DRadioItem(_('Swift'), this._scmds, this.scommand, x => this._fulu.set('scommand', x, this)),
            ocr:     new RadioItem(_('OCR'), omap(OCRMode, ([k, v]) => isNaN(k) ? [[v, _(scap(k))]] : []), this.ocr_mode, x => this._fulu.set('ocr_mode', x, this)),
            sep2:    new PopupMenu.PopupSeparatorMenuItem(),
            prefs:   new MenuItem(_('Settings'), () => getSelf().openPreferences()),
        };
        for(let p in this._menus) this.menu.addMenuItem(this._menus[p]);
        this.enable_ocr = this._enable_ocr;
    }
}

class LightDict extends Destroyable {
    constructor(gset) {
        super();
        this._buildWidgets(gset);
        this._bindSettings();
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
        this._lock_d = [];
        this._lock_s = [];
        this._app = this.getAppid();
        this._fulu = new Fulu({}, gset, this);
        this._cur = new Clutter.Actor({ opacity: 0 });
        Main.uiGroup.add_actor(this._cur);
        this._act = new DictAct(this._fulu);
        this._box = new DictBox(this._fulu);
        this._bar = new DictBar(this._fulu);
        this._act.connectObject('dict-act-dwelled', this._onActDwelled.bind(this), onus(this));
        this._bar.connectObject('dict-bar-clicked', (_a, cmd) => { this._lock_d[0] = true; this._exeCmd(cmd); }, onus(this));
        global.display.connectObject('notify::focus-window', () => this._onWindowChanged(), onus(this));
        global.display.get_selection().connectObject('owner-changed', this._onSelectChanged.bind(this), onus(this));
        // FIXME: idle eval to avoid clutter-stage.c assertion when search() since 44.beta
        // related upstream issue: https://gitlab.gnome.org/GNOME/mutter/-/issues/2700
        // related upstream MR: https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/2342
        this._sbt = symbiose(this, () => omit(this, 'dbus', 'systray', '_bar', '_box', '_act', '_cur'), {
            eval: [clearTimeout, setTimeout],
            select: [clearInterval, x => setInterval(() => {
                if((x ^ gs_pointer().at(2)) !== Clutter.ModifierType.BUTTON1_MASK) return;
                this._sbt.select.dispel();
                this._run().catch(noop);
            }, 50)],
        });
    }

    set dbus(dbus) {
        if(xnor(dbus, this._dbus)) return;
        if(dbus) {
            this._dbus = Gio.DBusExportedObject.wrapJSObject(LD_IFACE, this);
            this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');
        } else {
            this._dbus.flush();
            this._dbus.unexport();
            delete this._dbus;
        }
    }

    set systray(systray) {
        if(xnor(systray, this._btn)) return;
        if(systray) this._btn = Main.panel.addToStatusArea(getSelf().uuid, new DictBtn(this._fulu, 0.5));
        else omit(this, '_btn');
    }

    set cursor(cursor) {
        let [x, y, w, h] = cursor && cursor[3] < gs_size().at(1) / 2 ? cursor
            : ((a, b) => [a[0] - b / 2, a[1] - b / 2, b * 1.15, b * 1.15])(gs_pointer(), Meta.prefs_get_cursor_size());
        this._cursor = !!cursor && w > 250;
        this._cur.set_position(x, y);
        this._cur.set_size(w, h);
    }

    isFobidden() {
        return this.app_list && xnor(this.list_type, this.app_list.includes(this._app));
    }

    getAppid() {
        return (v => v ? Shell.WindowTracker.get_default().get_window_app(v)?.get_id() ?? '' : '')(gs_focus());
    }

    _onActDwelled(_a, mdf, ppt) {
        if(this._lock_d.pop() || this._box._rect && !outside(this._box._rect, ppt) || this._act._ocr_mode === OCRMode.area ||
           this._box.visible && this._box._entered || this._bar.visible && this._bar._entered) return;
        if(!this.passive || mdf & LD_MDF) this._act.invokeOCR('', '--quiet');
    }

    _onWindowChanged() {
        this._box.dispel();
        this._bar.dispel();
        this._app = this.getAppid();
    }

    _onSelectChanged(_sel, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        this._sbt.select.dispel();
        let mdf = gs_pointer().at(2);
        if(this._lock_s.pop() || this.isFobidden() || this.passive && !(mdf & LD_MDF) || this.trigger === Trigger.disable) return;
        if(mdf & Clutter.ModifierType.BUTTON1_MASK) this._sbt.select.summon(mdf);
        else this._run().catch(noop);
    }

    async _exeSh({ command, popup, copy, commit, select }) {
        let cmd = command.replace(/LDWORD/g, GLib.shell_quote(this._selection)).replace(/APPID/g, GLib.shell_quote(this._app));
        if(popup | copy | commit | select) {
            try {
                let ret = await this._act.execute(cmd);
                if(select) this._select(ret);
                if(copy) this._act.copy(ret);
                if(popup) this._display(ret);
                if(commit) this._act.commit(ret);
            } catch(e) {
                if(!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) this._display(e.message, true);
            }
        } else {
            Util.spawnCommandLine(cmd);
        }
    }

    _exeJS({ command, popup, copy, commit, select }) {
        /* eslint-disable no-unused-vars */
        try {
            let APPID = this._app,
                LDWORD = this._selection,
                key = x => this._act.stroke(x),
                search = x => { Main.overview.show(); Main.overview.searchEntry.set_text(x); };
            if(popup | copy | commit | select) {
                let ret = String(eval(command)) || '';
                if(copy) this._act.copy(ret);
                if(select) this._select(ret);
                if(popup) this._display(ret);
                if(commit) this._act.commit(ret);
            } else {
                eval(command);
            }
        } catch(e) {
            this._display(e.message, true);
        }
    }

    async _exeCmd(cmd) {
        if(!cmd.type) await this._exeSh(cmd);
        else this._sbt.eval.revive(() => this._exeJS(cmd));
    }

    _select(x) {
        this._lock_s[0] = true;
        this._act.select(x);
    }

    async _swift(name) {
        let cmd = this._act.getCommand(name);
        if(!cmd || cmd.apps && !cmd.apps.includes(this._app) || cmd.regexp && !safeRegTest(cmd.regexp, this._selection)) return;
        await this._exeCmd(cmd);
    }

    _popup() {
        this._box.dispel();
        this._bar.setPosition(this._cur, 1 / 2);
        this._bar.summon(this._app, this._selection);
    }

    _display(info, error) {
        this._box.dispel();
        this._box.setPosition(this._cur, this._cursor ? 1 / 2 : 1 / 10);
        this._box.summon(info, this._selection, error);
    }

    _store(text) {
        let selection = this.text_strip ? text.replaceAll(/((?<=^)|(?<=\n))\s*(\n|$(?![\r\n]))/gm, '') : text;
        if(!selection) raise('Empty string');
        this._selection = selection.replaceAll(/\n/gm, '\\n'); // escape \n
    }

    _fetch() {
        return new Promise(resolve => St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (_c, text) => resolve(text)));
    }

    async _run(type, text, info, cursor) {
        this.cursor = cursor;
        if(type === undefined) {
            this._store(await this._fetch());
            if(!this.passive && this.filter && safeRegTest(this.filter, this._selection)) return;
            this.trigger ? this._popup() : await this._swift();
        } else {
            let [ty, pe] = type.split(':');
            switch(ty === 'auto' ? Trigger[this.trigger] : ty) {
            case 'swift':   this._store(text || await this._fetch()); await this._swift(pe); break;
            case 'popup':   this._store(text || await this._fetch()); this._popup(); break;
            case 'display': this._store(text || 'Oops'); this._display(info.trimEnd() || lot(Kaomoji), !text); break;
            }
        }
    }

    async RunAsync([type, text, info], ic) {
        await this._run(type, text, info).catch(noop);
        ic.return_value(null);
    }

    async RunAtAsync([type, text, info, x, y, w, h], ic) {
        await this._run(type, text, info, [x, y, w, h]).catch(noop);
        ic.return_value(null);
    }

    async GetAsync([ps], ic) {
        if(await this._act._dbusChecker(ic.get_sender())) {
            try {
                ic.return_value(new GLib.Variant('(aai)', [ps.map(x => {
                    switch(x) {
                    case 'display': return gs_size();
                    case 'pointer': return gs_pointer().slice(0, 2);
                    case 'focused': return (r => r ? [r.x, r.y, r.width, r.height] : null)(gs_focus()?.get_frame_rect?.());
                    default: return null;
                    }
                })]));
            } catch(e) {
                ic.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, `${ic.get_method_name()} failed`);
            }
        } else {
            ic.return_error_literal(Gio.DBusError, Gio.DBusError.ACCESS_DENIED, `${ic.get_method_name()} is not allowed`);
        }
    }

    OCR(temp) {
        this._act.invokeOCR(temp);
    }

    Toggle() {
        let next = (this.trigger + 1) % 2;
        this._fulu.set('trigger', next, this);
        Main.notify(getSelf().metadata.name, _('Switch to %s style').format(_(Trigger[next])));
    }
}

export default class Extension extends BaseExtension {  $klass = LightDict; }
