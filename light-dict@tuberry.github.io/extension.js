// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const Util = imports.misc.util;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const BoxPointer = imports.ui.boxpointer;
const Keyboard = imports.ui.status.keyboard;
const ExtensionUtils = imports.misc.extensionUtils;
const { Meta, Shell, Clutter, IBus, Gio, GLib, GObject, St, Pango, Gdk } = imports.gi;
const { loadInterfaceXML } = imports.misc.fileUtils;
const { DBusSenderChecker } = imports.misc.util;
const { EventEmitter } = imports.misc.signals;

const InputSourceManager = Keyboard.getInputSourceManager();
const Me = ExtensionUtils.getCurrentExtension();
const { Fields, Field } = Me.imports.fields;
const _ = ExtensionUtils.gettext;

const noop = () => {};
const gs_pointer = () => global.get_pointer();
const gs_size = () => global.display.get_size();
const gs_focus = () => global.display.get_focus_window();
const still = (u, v) => u[0] === v[0] && u[1] === v[1];
const dwell = (u, v, w, m) => !still(u, v) * 2 | !(u[2] & m) & !!(v[2] & m) & !!(w[2] & m);
const outOf = (r, p) => p[0] < r[0] || p[1] < r[1] || p[0] > r[0] + r[2] || p[1] > r[1] + r[3];
const genIcon = x => Gio.Icon.new_for_string(Me.dir.get_child('icons').get_child(`${x}.svg`).get_path());
const genEmpty = () => (x => x[Math.floor(Math.random() * x.length)])(['_(:з」∠)_', '¯\\_(ツ)_/¯', 'o(T^T)o', 'Σ(ʘωʘﾉ)ﾉ', 'ヽ(ー_ー)ノ']); // placeholder

const Trigger = { Swift: 0, Popup: 1, Disable: 2 };
const OCRMode = { Word: 0, Paragraph: 1, Area: 2, Line: 3 };
const LD_MODR = Clutter.ModifierType.MOD1_MASK;
const LD_DBUS =
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
        <property name="Pointer" type="au" access="read"/>
        <property name="DisplaySize" type="au" access="read"/>
        <property name="FocusWindow" type="au" access="read"/>
    </interface>
</node>`;

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

class SwitchItem extends PopupMenu.PopupSwitchMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(text, active, callback, params) {
        super(text, active, params);
        this.connect('toggled', (_x, y) => callback(y));
    }
}

class MenuItem extends PopupMenu.PopupMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(text, callback, params) {
        super(text, params);
        this.connect('activate', callback);
    }

    setLabel(label) {
        if(this.label.text !== label) this.label.set_text(label);
    }
}

class RadioItem extends PopupMenu.PopupSubMenuMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(name, modes, index, callback) {
        super('');
        this._name = name;
        this._list = Object.keys(modes);
        this._list.map((x, i) => new MenuItem(_(x), () => callback(i))).forEach(x => this.menu.addMenuItem(x));
        this.setSelected(index);
    }

    setSelected(index) {
        if(!(index in this._list)) return;
        this.label.set_text(`${this._name}：${_(this._list[index])}`);
        this.menu._getMenuItems().forEach((y, i) => y.setOrnament(index === i ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
    }
}

class DRadioItem extends PopupMenu.PopupSubMenuMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(name, list, index, cb1, cb2) {
        super('');
        this._name = name;
        this._cb1 = cb1;
        this._cb2 = cb2 || (x => this._list[x]);
        this.setList(list, index);
    }

    setSelected(index) {
        this._index = index;
        this.label.set_text(`${this._name}：${this._cb2(this._index) || ''}`);
        this.menu._getMenuItems().forEach((y, i) => y.setOrnament(index === i ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
    }

    setList(list, index) {
        let items = this.menu._getMenuItems();
        let diff = list.length - items.length;
        if(diff > 0) for(let a = 0; a < diff; a++) this.menu.addMenuItem(new MenuItem('', () => this._cb1(items.length + a)));
        else if(diff < 0) for(let a = 0; a > diff; a--) items.at(a - 1).destroy();
        this._list = list;
        this.menu._getMenuItems().forEach((x, i) => x.setLabel(list[i]));
        this.setSelected(index ?? this._index);
    }
}

class DictPop extends St.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(cb1, cb2) {
        super({ style_class: 'light-dict-button candidate-box' });
        this.connect('clicked', () => cb1(this._index));
        this.connect('enter-event', () => cb2(this._index));
    }

    setButton({ icon = null, name: label }, index) {
        if(!icon) {
            this.set_label(label || 'LD');
        } else if(icon !== this._icon) {
            let gicon = Gio.Icon.new_for_string(icon);
            this.set_child(new St.Icon({ gicon, style_class: 'light-dict-button-icon candidate-label' }));
        }
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

    constructor(field) {
        super(St.Side.BOTTOM);
        this.visible = false;
        this.style_class = 'light-dict-bar-boxpointer';
        Main.layoutManager.addTopChrome(this);
        this._buildWidgets();
        this._bindSettings(field);
    }

    _buildWidgets() {
        this._box = new St.BoxLayout({
            visible: false, reactive: true, vertical: false,
            style_class: 'light-dict-iconbox candidate-popup-content',
        });
        this.bin.set_child(this._box);
        this._box.connectObject('leave-event', this._onLeave.bind(this),
            'enter-event', this._onEnter.bind(this),
            'scroll-event', this._onScroll.bind(this), this);
    }

    _bindSettings(field) {
        this._field = field.attach({
            pgsize:    [Fields.PAGESIZE,  'uint'],
            tooltip:   [Fields.TOOLTIP,   'boolean'],
            autohide:  [Fields.AUTOHIDE,  'uint'],
            pcommands: [Fields.PCOMMANDS, 'strv'],
        }, this);
    }

    set pcommands(pcmds) {
        let cmds = pcmds.map(x => JSON.parse(x)).filter(x => x.enable);
        let pk = x => JSON.stringify(x.map(y => [y.icon, y.name]));
        if(pk(cmds) === pk(this._cmds ?? [])) { this._cmds = cmds; return; }
        let icons = this._icons;
        let diff = cmds.length - icons.length;
        if(diff > 0) for(let a = 0; a < diff; a++) this._box.add(new DictPop(this.click.bind(this), this.tip.bind(this)));
        else if(diff < 0) for(let a = 0; a > diff; a--) icons.at(a - 1).destroy();
        this._icons.forEach((x, i) => x.setButton(cmds[i], i));
        this._cmds = cmds;
    }

    tip(index) {
        if(!this._tooltip) return;
        this._tooltip.hide();
        clearTimeout(this._tooltipId);
        this._tooltipId = setTimeout(() => {
            if(!this._box.visible) return;
            this._tooltip.set_position(gs_pointer()[0] - 10, this.get_position()[1] + this.get_size()[1] + 5);
            this._tooltip.set_text(this._cmds[index].tooltip || this._cmds[index].name || 'LD');
            this._tooltip.show();
        }, this.autohide / 5);
    }

    click(index) {
        this.dispel();
        this.emit('dict-bar-clicked', this._cmds[index]);
    }

    _updatePages() {
        this._icons.forEach(x => (x.visible = x._visible));
        let icons = this._icons.filter(x => x.visible);
        this._pages = icons.length && this.pgsize ? Math.ceil(icons.length / this.pgsize) : 0;
        if(this._pages < 2) return;
        this._idx = this._idx < 1 ? this._pages : this._idx > this._pages ? 1 : this._idx ?? 1;
        if(this._idx === this._pages && icons.length % this.pgsize) icons.forEach((x, i) => (x.visible = i >= icons.length - this.pgsize && i < icons.length));
        else icons.forEach((x, i) => (x.visible = i >= (this._idx - 1) * this.pgsize && i < this._idx * this.pgsize));
    }

    _updateViz(app, text) {
        let ics = this._icons;
        this._cmds.forEach(({ regexp, apps }, i) => {
            switch(!!regexp * 2 | !!apps) {
            case 0: ics[i]._visible = true; break;
            case 1: ics[i]._visible = apps.includes(app); break;
            case 2: ics[i]._visible = RegExp(regexp).test(text); break;
            case 3: ics[i]._visible = apps.includes(app) && RegExp(regexp).test(text); break;
            }
        });
        this._updatePages();
    }

    set tooltip(tooltip) {
        if(tooltip) {
            if(this._tooltip) return;
            this._tooltip = new St.Label({ visible: false, style_class: 'light-dict-tooltip dash-label' });
            Main.layoutManager.addTopChrome(this._tooltip);
        } else {
            if(!this._tooltip) return;
            this._tooltip.destroy();
            this._tooltip = null;
        }
    }

    get _icons() {
        return this._box.get_children();
    }

    _onScroll(_a, event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this._idx--; break;
        case Clutter.ScrollDirection.DOWN: this._idx++; break;
        }
        this._updatePages();
    }

    _onEnter() {
        clearTimeout(this._delayId);
        this._entered = true;
        this._box.visible = true;
    }

    _onLeave(actor) {
        clearTimeout(this._delayId);
        this._delayId = setTimeout(() => this.dispel(), actor ? this.autohide / 10 : this.autohide);
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
        clearTimeout(this._delayId);
        this._entered = false;
        this._box.visible = false;
        this.close(BoxPointer.PopupAnimation.FADE);
        if(!this._tooltip) return;
        this._tooltip.hide();
        clearTimeout(this._tooltipId);
    }

    destroy() {
        this._field.detach(this);
        clearTimeout(this._tooltipId);
        clearTimeout(this._delayId);
        this.tooltips = false;
        super.destroy();
    }
}

class DictBox extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor(field) {
        super(St.Side.TOP);
        this.visible = false;
        this.style_class = 'light-dict-box-boxpointer';
        Main.layoutManager.addTopChrome(this);
        this._bindSettings(field);
        this._buildWidgets();
    }

    _buildWidgets() {
        this._view = new St.ScrollView({
            visible: false, overlay_scrollbars: true, clip_to_allocation: true,
            style_class: 'light-dict-scroll', hscrollbar_policy: St.PolicyType.NEVER,
        });
        this._box = new St.BoxLayout({ reactive: true, vertical: true, style_class: 'light-dict-content' });
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
        this._box.connectObject('leave-event', this._onLeave.bind(this), 'enter-event', this._onEnter.bind(this),
            'button-press-event', this._onClick.bind(this), this);
    }

    _bindSettings(field) {
        this._field = field.attach({
            lcommand:   [Fields.LCOMMAND,  'string'],
            rcommand:   [Fields.RCOMMAND,  'string'],
            autohide:   [Fields.AUTOHIDE,  'uint'],
            hide_title: [Fields.HIDETITLE, 'boolean'],
        }, this);
    }

    set hide_title(hide) {
        this._hide_title = hide;
        this._text?.set_visible(!this._hide_title);
    }

    needScroll() {
        let [, height] = this._view.get_preferred_height(-1);
        let limited = this._view.get_theme_node().get_max_height();
        if(limited < 0) limited = gs_size()[1] * 15 / 32;
        return height >= limited;
    }

    _onEnter() {
        this._entered = true;
        this._view.visible = true;
        clearTimeout(this._delayId);
    }

    _onLeave(actor) {
        clearTimeout(this._delayId);
        this._delayId = setTimeout(outOf(this.getRect(), gs_pointer()) ? this.dispel.bind(this)
            : () => this._onLeave(true), actor ? this.autohide / 10 : this.autohide);
    }

    _onClick(_a, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._info.get_text()); break;
        case Clutter.BUTTON_PRIMARY: if(this.lcommand) Util.spawnCommandLine(this.lcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); break;
        case Clutter.BUTTON_SECONDARY: if(this.rcommand) Util.spawnCommandLine(this.rcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); this.dispel(); break;
        }
    }

    getRect() {
        return [...this.get_transformed_position(), ...this.get_transformed_size()];
    }

    set error(error) {
        if(!(error ^ this._error)) return;
        this._error = !!error;
        this._error ? this._box.add_style_pseudo_class('error') : this._box.remove_style_pseudo_class('error');
    }

    summon(info, text, error) {
        this.error = error;
        this._selection = text;
        try {
            Pango.parse_markup(info, -1, '');
            this._info.clutter_text.set_markup(info || genEmpty());
        } catch(e) {
            this._info.set_text(info || genEmpty());
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
        clearTimeout(this._delayId);
        this._rect = this.getRect();
        this._view.visible = false;
        this._info.set_text(genEmpty());
        this.close(BoxPointer.PopupAnimation.FADE);
        this._entered = false;
    }

    destroy() {
        this._field.detach(this);
        clearTimeout(this._delayId);
        super.destroy();
    }
}

class DictAct extends EventEmitter {
    constructor(field) {
        super();
        this._bindSettings(field);
        this._ocr_cmd = `python ${Me.dir.get_child('ldocr.py').get_path()} `;
        let DbusProxy = Gio.DBusProxy.makeProxyWrapper(loadInterfaceXML('org.freedesktop.DBus'));
        this._proxy = new DbusProxy(Gio.DBus.session, 'org.freedesktop.DBus', '/org/freedesktop/DBus', null);
        this._kbd = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._proxy.init_async(GLib.PRIORITY_DEFAULT, null).catch(noop);
    }

    _bindSettings(field) {
        this._field = field;
        this._field.attach({
            ocr_params: [Fields.OCRPARAMS, 'string'],
            ocr_mode:   [Fields.OCRMODE,   'uint'],
            scommand:   [Fields.SCOMMAND,  'int'],
            dwell_ocr:  [Fields.DWELLOCR,  'boolean'],
            short_ocr:  [Fields.SHORTOCR,  'boolean'],
            enable_ocr: [Fields.ENABLEOCR, 'boolean'],
            scommands:  [Fields.SCOMMANDS, 'strv'],
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
        clearInterval(this._dwellId);
        this._ppt = this._pt = dwell_ocr ? gs_pointer() : null;
        this._dwellId = (this._dwell_ocr = dwell_ocr) && this._enable_ocr && setInterval(() => {
            let pt = gs_pointer();
            if(still(this._pt, pt)) (dw => dw && this.emit('dict-act-dwelled', dw, this._ppt))(dwell(this._ppt, this._pt, pt, LD_MODR));
            [this._ppt, this._pt] = [this._pt, pt];
        }, 300);
    }

    set short_ocr(short) {
        this._shortId && Main.wm.removeKeybinding(Fields.OCRSHORTCUT);
        this._shortId = (this._short_ocr = short) && this._enable_ocr &&
            Main.wm.addKeybinding(Fields.OCRSHORTCUT, this._field.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.invokeOCR());
    }

    set ocr_mode(mode) {
        this._ocr_mode = Object.keys(OCRMode)[mode].toLowerCase();
    }

    set screenshot(shot) {
        if(global.context.unsafe_mode ?? true) return;
        let checker = Main.shellDBusService._screenshotService._senderChecker;
        checker._isSenderAllowed = shot ? this._screenshotChecker.bind(this) : DBusSenderChecker.prototype._isSenderAllowed.bind(checker);
    }

    async _screenshotChecker(x) {
        let pid = await this._proxy.call('GetConnectionUnixProcessID', new GLib.Variant('(s)', [x]), Gio.DBusCallFlags.NONE, -1, null);
        return this._pid === pid.deepUnpack()[0];
    }

    invokeOCR(params = '', addtion = '') {
        if(!this._enable_ocr) return;
        this.screenshot = true;
        this.execute(this._ocr_cmd + (params || [this.ocr_params, addtion, '-m', this._ocr_mode].join(' ')))
            .catch(noop).finally(() => { this.screenshot = false; this._pid = null; });
    }

    stroke(keystring) {
        this._keyIds?.forEach(x => clearTimeout(x));
        this._keyIds = keystring.split(/\s+/).map((keys, i) => setTimeout(() => {
            let ks = keys.split('+');
            ks.forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(k), Clutter.KeyState.PRESSED));
            ks.reverse().forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(k), Clutter.KeyState.RELEASED));
        }, i * 100));
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
        let proc = new Gio.Subprocess({
            argv: GLib.shell_parse_argv(cmd)[1],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        this._pid = parseInt(proc.get_identifier());
        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if(proc.get_exit_status()) throw new Error(stderr.trim());
        return stdout.trim();
    }

    destroy() {
        this._field.detach(this);
        this._keyIds?.forEach(x => clearTimeout(x));
        this.screenshot = this.enable_ocr = this._proxy = this._kbd = null;
    }
}

class DictBtn extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(field, ...params) {
        super(...params);
        this._buildWidgets();
        this._bindSettings(field);
        this._addMenuItems();
    }

    _buildWidgets() {
        this._icon = new St.Icon({ style_class: 'light-dict-systray system-status-icon' });
        this.menu.actor.add_style_class_name('app-menu'); // popup-ornament-width: 0;
        this.add_actor(this._icon);
    }

    _bindSettings(field) {
        this._field = field;
        this._field.attach({
            dwell_ocr:  [Fields.DWELLOCR,  'boolean'],
            enable_ocr: [Fields.ENABLEOCR, 'boolean'],
            scommands:  [Fields.SCOMMANDS, 'strv'],
        }, this).attach({
            passive: [Fields.PASSIVE, 'uint', x => this._menus?.passive.setToggleState(!!x)],
            trigger: [Fields.TRIGGER, 'uint', x => this._menus?.trigger.setSelected(x)],
        }, this, 'icon').attach({
            ocr_mode: [Fields.OCRMODE,  'uint', x => this._menus?.ocr.setSelected(x)],
            scommand: [Fields.SCOMMAND, 'int', x => this._menus?.scmds.setSelected(x)],
        }, this, 'mode');
    }

    set icon([k, v, out]) {
        out(this[k] = v);
        if(!('trigger' in this && 'passive' in this)) return;
        let style = Object.keys(Trigger)[this.trigger ?? 0].toLowerCase();
        this._icon.set_gicon(genIcon(`${style}-${this.passive ?? 0 ? 'passive' : 'proactive'}-symbolic`));
    }

    set mode([k, v, out]) {
        out(this[k] = v);
    }

    set scommands(scmds) {
        let cmds = scmds.map(x => JSON.parse(x).name);
        if(this._scmds?.length === cmds.length && this._scmds?.every((x, i) => x === cmds[i])) return;
        this._scmds = cmds;
        this._menus?.scmds.setList(this._scmds);
        this._menus?.scmds.setSelected(this.scommand);
    }

    set dwell_ocr(dwell_ocr) {
        this._dwell_ocr = dwell_ocr;
        this._menus?.dwell.setToggleState(dwell_ocr);
        if(dwell_ocr) this.add_style_class_name('screen-sharing-indicator');
        else this.remove_style_class_name('screen-sharing-indicator');
    }

    set enable_ocr(enable) {
        this._enable_ocr = enable;
        ['dwell', 'ocr'].forEach(x => enable ? this._menus?.[x].show() : this._menus?.[x].hide());
    }

    vfunc_scroll_event(event) {
        switch(event.direction) {
        case Clutter.ScrollDirection.UP: this.setf('trigger', (this.trigger + 1) % 2); break;
        case Clutter.ScrollDirection.DOWN: this.setf('passive', 1 - this.passive); break;
        }
        return Clutter.EVENT_STOP;
    }

    _addMenuItems() {
        this._menus = {
            dwell:   new SwitchItem(_('Dwell OCR'), this._dwell_ocr, x => this.setf('dwell_ocr', x)),
            passive: new SwitchItem(_('Passive mode'), !!this.passive, x => this.setf('passive', x ? 1 : 0)),
            sep1:    new PopupMenu.PopupSeparatorMenuItem(),
            trigger: new RadioItem(_('Trigger'), Trigger, this.trigger, x => this.setf('trigger', x, this)),
            scmds:   new DRadioItem(_('Swift'), this._scmds, this.scommand, x => this.setf('scommand', x)),
            ocr:     new RadioItem(_('OCR'), OCRMode, this.ocr_mode, x => this.setf('ocr_mode', x)),
            sep2:    new PopupMenu.PopupSeparatorMenuItem(),
            prefs:   new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
        };
        for(let p in this._menus) this.menu.addMenuItem(this._menus[p]);
        this.enable_ocr = this._enable_ocr;
    }

    destroy() {
        this._field.detach(this);
        super.destroy();
    }
}

class LightDict {
    constructor() {
        this._dlock = this._slock = [];
        this._cur = new Clutter.Actor({ opacity: 0 });
        Main.uiGroup.add_actor(this._cur);
        this._bindSettings();
        this._buildWidgets();
        this._onWindowChanged();
    }

    _bindSettings() {
        this._field = new Field({}, ExtensionUtils.getSettings(), this);
        this._field.attach({
            filter:     [Fields.TXTFILTER, 'string'],
            app_list:   [Fields.APPLIST,   'string'],
            passive:    [Fields.PASSIVE,   'uint'],
            systray:    [Fields.SYSTRAY,   'boolean'],
            trigger:    [Fields.TRIGGER,   'uint'],
            list_type:  [Fields.LISTTYPE,  'uint'],
            text_strip: [Fields.TXTSTRIP,  'boolean'],
        }, this);
    }

    _buildWidgets() {
        this._act = new DictAct(this._field);
        this._box = new DictBox(this._field);
        this._bar = new DictBar(this._field);
        this._dbus = Gio.DBusExportedObject.wrapJSObject(LD_DBUS, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');
        this._bar.connect('dict-bar-clicked', (_a, cmd) => { this._dlock[0] = true; this._exeCmd(cmd); });
        this._act.connect('dict-act-dwelled', (_a, dw, ppt) => {
            if(this._dlock.pop()) return;
            if(this._box._rect && !outOf(this._box._rect, ppt) ||
               this._box.visible && this._box._entered || this._bar.visible && this._bar._entered) return;
            if(this.passive && dw & 0b01 || !this.passive && dw & 0b10) this._act.invokeOCR('', '--quiet');
        });
        global.display.connectObject('notify::focus-window', () => this._onWindowChanged(), this);
        global.display.get_selection().connectObject('owner-changed', this._onSelectChanged.bind(this), this);
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new DictBtn(this._field, 0.5, Me.metadata.uuid);
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button);
        } else {
            if(!this._button) return;
            this._button.destroy();
            this._button = null;
        }
    }

    set cursor(cursor) {
        let [x, y, w, h] = cursor && cursor[3] < gs_size()[1] / 2 ? cursor
            : ((a, b) => [a[0] - b / 2, a[1] - b / 2, b * 1.15, b * 1.15])(gs_pointer(), Meta.prefs_get_cursor_size());
        this._cursor = !!cursor && w > 250;
        this._cur.set_position(x, y);
        this._cur.set_size(w, h);
    }

    isAllowed() {
        return !this.app_list || this.list_type ^ this.app_list.includes(this._app);
    }

    getAppid() {
        return (v => v ? (w => !w || w.is_window_backed() ? '' : w.get_id())(Shell.WindowTracker.get_default().get_window_app(v)) : '')(gs_focus());
    }

    _onWindowChanged() {
        this._box.dispel();
        this._bar.dispel();
        this._app = this.getAppid();
    }

    _onSelectChanged(_sel, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        clearInterval(this._mouseId);
        if(this._slock.pop()) return;
        if(!this.isAllowed() || this.trigger === Trigger.Disable) return;
        let mods = gs_pointer()[2];
        if(this.passive && !(mods & LD_MODR)) return;
        if(mods & Clutter.ModifierType.BUTTON1_MASK) {
            this._mouseId = setInterval(() => {
                if((mods ^ gs_pointer()[2]) !== Clutter.ModifierType.BUTTON1_MASK) return;
                clearInterval(this._mouseId);
                this._run().catch(noop);
            }, 50); // NOTE: `owner-changed` is emitted every char in Gtk+ apps
        } else {
            this._run().catch(noop);
        }
    }

    _exeSh({ command, popup, copy, commit, select }) {
        let cmd = command.replace(/LDWORD/g, GLib.shell_quote(this._selection)).replace(/APPID/g, GLib.shell_quote(this._app));
        if(popup | copy | commit | select) {
            this._act.execute(cmd).then(scc => {
                if(select) this._select(scc);
                if(copy) this._act.copy(scc);
                if(popup) this._display(scc);
                if(commit) this._act.commit(scc);
            }).catch(err => {
                this._display(err.message, true);
            });
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
                search = x => { Main.overview.toggle(); Main.overview.searchEntry.set_text(x); };
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

    _exeCmd(cmd) {
        cmd.type ? this._exeJS(cmd) : this._exeSh(cmd);
    }

    _select(x) {
        this._slock[0] = true;
        this._act.select(x);
    }

    _swift(name) {
        let cmd = this._act.getCommand(name);
        if(!cmd) return;
        if(cmd.apps && !cmd.apps.includes(this._app)) return;
        if(cmd.regexp && !RegExp(cmd.regexp).test(this._selection)) return;
        this._exeCmd(cmd);
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
        let selection = this.text_strip ? text.replace(/\n\s*\n/g, '\r') : text;
        if(!selection) throw new Error('Empty string');
        this._selection = selection.replace(/\n/g, '\r'); // shell args
    }

    _fetch() {
        return new Promise(resolve => St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (_c, text) => resolve(text)));
    }

    async _run(type, text, info, cursor) {
        this.cursor = cursor;
        if(type === undefined) {
            this._store(await this._fetch());
            if(!this.passive && this.filter && !RegExp(this.filter).test(this._selection)) return;
            this.trigger ? this._popup() : this._swift();
        } else {
            let [ty, pe] = type.split(':');
            switch(ty === 'auto' ? Object.keys(Trigger)[this.trigger].toLowerCase() : ty) {
            case 'swift':   this._store(text || await this._fetch()); this._swift(pe); break;
            case 'popup':   this._store(text || await this._fetch()); this._popup(); break;
            case 'display': this._store(text || 'ERROR'); this._display(info.trim() || genEmpty(), !text); break;
            }
        }
    }

    async Run(type, text, info) {
        await this._run(type, text, info).catch(noop);
    }

    async RunAt(type, text, info, x, y, w, h) {
        await this._run(type, text, info, [x, y, w, h]).catch(noop);
    }

    OCR(temp) {
        this._act.invokeOCR(temp);
    }

    Toggle() {
        let next = (this.trigger + 1) % 2;
        Main.notify(Me.metadata.name, _('Switch to %s style').format(_(Object.keys(Trigger)[next])));
        this.setf('trigger', next);
    }

    get Pointer() {
        return gs_pointer().slice(0, 2);
    }

    get DisplaySize() {
        return gs_size();
    }

    get FocusWindow() {
        return (r => r ? [r.x, r.y, r.width, r.height] : null)(gs_focus()?.get_frame_rect?.());
    }

    destroy() {
        this._field.detach(this);
        this._dbus.flush();
        this._dbus.unexport();
        clearInterval(this._mouseId);
        this.systray = this._dbus = null;
        global.display.disconnectObject(this);
        global.display.get_selection().disconnectObject(this);
        ['_bar', '_box', '_act', '_cur'].forEach(x => { this[x].destroy(); this[x] = null; });
    }
}

class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._ext = new LightDict();
    }

    disable() {
        this._ext.destroy();
        this._ext = null;
    }
}

function init() {
    return new Extension();
}
