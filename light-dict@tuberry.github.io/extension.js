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
const { EventEmitter } = imports.misc.signals;
const ExtensionUtils = imports.misc.extensionUtils;
const { Meta, Shell, Clutter, IBus, Gio, GLib, GObject, St, Pango, Gdk } = imports.gi;

const InputScMgr = Keyboard.getInputSourceManager();
const Me = ExtensionUtils.getCurrentExtension();
const { Fields } = Me.imports.fields;
const _ = ExtensionUtils.gettext;

const noop = () => {};
const g_pointer = () => global.get_pointer();
const g_size = () => global.display.get_size();
const g_focus = () => global.display.get_focus_window();
const still = (u, v) => u[0] === v[0] && u[1] === v[1];
const dwell = (u, v, w, m) => !still(u, v) * 2 | !(u[2] & m) & !!(v[2] & m) & !!(w[2] & m);
const outOf = (r, p) => p[0] < r[0] || p[1] < r[1] || p[0] > r[0] + r[2] || p[1] > r[1] + r[3];
const genIcon = x => Gio.Icon.new_for_string(Me.dir.get_child('icons').get_child(`${x}-symbolic.svg`).get_path());
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

class Field {
    constructor(prop, gset, obj) {
        this.gset = typeof gset === 'string' ? new Gio.Settings({ schema: gset }) : gset;
        this.prop = prop;
        this.attach(obj);
    }

    _get(x) {
        return this.gset[`get_${this.prop[x][1]}`](this.prop[x][0]);
    }

    _set(x, y) {
        this.gset[`set_${this.prop[x][1]}`](this.prop[x][0], y);
    }

    attach(a) {
        let fs = Object.entries(this.prop);
        fs.forEach(([x]) => { a[x] = this._get(x); });
        this.gset.connectObject(...fs.flatMap(([x, [y]]) => [`changed::${y}`, () => { a[x] = this._get(x); }]), a);
    }

    detach(a) {
        this.gset.disconnectObject(a);
    }
}

class SwitchItem extends PopupMenu.PopupSwitchMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(text, active, callback, params) {
        super(text, active, params);
        this.connect('toggled', (x, y) => callback(y));
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
        this._call1 = cb1;
        this._call2 = cb2 || (x => this._list[x]);
        this.setList(list, index);
    }

    setSelected(index) {
        this._index = index;
        this.label.set_text(`${this._name}：${this._call2(this._index) || ''}`);
        this._items.forEach((y, i) => y.setOrnament(index === i ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
    }

    setList(list, index) {
        let items = this._items;
        let diff = list.length - items.length;
        if(diff > 0) for(let a = 0; a < diff; a++) this.menu.addMenuItem(new MenuItem('', () => this._call1(items.length + a)));
        else if(diff < 0) for(let a = 0; a > diff; a--) items.at(a - 1).destroy();
        this._list = list;
        this._items.forEach((x, i) => x.setLabel(list[i]));
        this.setSelected(index ?? this._index);
    }

    get _items() {
        return this.menu._getMenuItems();
    }
}

class DictPop extends St.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(call1, call2) {
        super({ style_class: 'light-dict-button candidate-box' });
        this.connect('clicked', () => call1(this._index));
        this.connect('enter-event', () => call2(this._index));
    }

    setButton({ icon = null, name: label }, index) {
        if(!icon) this.set_label(label || 'LD');
        else if(icon !== this._icon) this.set_child(new St.Icon({ gicon: Gio.Icon.new_for_string(icon), style_class: 'light-dict-button-icon candidate-label' }));
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

    constructor() {
        super(St.Side.BOTTOM);
        this.visible = false;
        this.style_class = 'light-dict-bar-boxpointer';
        Main.layoutManager.addTopChrome(this);
        this._buildWidgets();
        this._bindSettings();
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

    _bindSettings() {
        this._field = new Field({
            pgsize:    [Fields.PAGESIZE,  'uint'],
            tooltip:   [Fields.TOOLTIP,   'boolean'],
            autohide:  [Fields.AUTOHIDE,  'uint'],
            pcommands: [Fields.PCOMMANDS, 'strv'],
        }, ExtensionUtils.getSettings(), this);
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
            this._tooltip.set_position(g_pointer()[0] - 10, this.get_position()[1] + this.get_size()[1] + 5);
            this._tooltip.set_text(this._cmds[index].tooltip || this._cmds[index].name || 'LD');
            this._tooltip.show();
        }, this.autohide / 2);
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

    _onScroll(actor, event) {
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
        this._delayId = setTimeout(this.dispel.bind(this), actor ? this.autohide / 10 : this.autohide);
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

    constructor() {
        super(St.Side.TOP);
        this.visible = false;
        this.style_class = 'light-dict-box-boxpointer';
        Main.layoutManager.addTopChrome(this);
        this._bindSettings();
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

    _bindSettings() {
        this._field = new Field({
            lcommand:   [Fields.LCOMMAND,  'string'],
            rcommand:   [Fields.RCOMMAND,  'string'],
            autohide:   [Fields.AUTOHIDE,  'uint'],
            hide_title: [Fields.HIDETITLE, 'boolean'],
        }, ExtensionUtils.getSettings(), this);
    }

    get _scrollable() {
        let [, height] = this._view.get_preferred_height(-1);
        let limited = this._view.get_theme_node().get_max_height();
        if(limited < 0) limited = g_size()[1] * 15 / 32;
        return height >= limited;
    }

    set hide_title(hide) {
        this._hide_title = hide;
        this._text?.set_visible(!this._hide_title);
    }

    _onEnter() {
        this._entered = true;
        this._view.visible = true;
        clearTimeout(this._delayId);
    }

    _onLeave(actor) {
        clearTimeout(this._delayId);
        this._delayId = setTimeout(outOf(this._rect, g_pointer()) ? this.dispel.bind(this)
            : () => this._onLeave(true), actor ? this.autohide / 10 : this.autohide);
    }

    _onClick(actor, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._info.get_text()); break;
        case Clutter.BUTTON_PRIMARY: if(this.lcommand) Util.spawnCommandLine(this.lcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); break;
        case Clutter.BUTTON_SECONDARY: if(this.rcommand) Util.spawnCommandLine(this.rcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); this.dispel(); break;
        }
    }

    get _rect() {
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
        if(this._scrollable) {
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
        this._rectt = this._rect;
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
    constructor() {
        super();
        this._bindSettings();
        this._ocr_cmd = `python ${Me.dir.get_child('ldocr.py').get_path()} `;
        this._keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    _bindSettings() {
        this.gset = ExtensionUtils.getSettings();
        this._field = new Field({
            ocr_params: [Fields.OCRPARAMS, 'string'],
            ocr_mode:   [Fields.OCRMODE,   'uint'],
            scommand:   [Fields.SCOMMAND,  'int'],
            dwell_ocr:  [Fields.DWELLOCR,  'boolean'],
            short_ocr:  [Fields.SHORTOCR,  'boolean'],
            enable_ocr: [Fields.ENABLEOCR, 'boolean'],
            scommands:  [Fields.SCOMMANDS, 'strv'],
        }, this.gset, this);
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
        this._ptt = this._pt = dwell_ocr ? g_pointer() : null;
        this._dwellId = (this._dwell_ocr = dwell_ocr) && this._enable_ocr && setInterval(() => {
            let pt = g_pointer();
            if(still(this._pt, pt)) (dw => dw && this.emit('dict-act-dwelled', dw, this._ptt))(dwell(this._ptt, this._pt, pt, LD_MODR));
            [this._ptt, this._pt] = [this._pt, pt];
        }, 375);
    }

    set short_ocr(short) {
        this._shortId && Main.wm.removeKeybinding(Fields.OCRSHORTCUT);
        this._shortId = (this._short_ocr = short) && this._enable_ocr &&
            Main.wm.addKeybinding(Fields.OCRSHORTCUT, this.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this._invokeOCR());
    }

    set ocr_mode(mode) {
        this._ocr_mode = Object.keys(OCRMode)[mode].toLowerCase();
    }

    set screenshot(screenshot) {
        if(global.context.unsafe_mode ?? true) return;
        let checker = Main.shellDBusService._screenshotService._senderChecker;
        checker._isSenderAllowed = screenshot ? () => true : sender => [...checker._allowlistMap.values()].includes(sender);
    }

    _invokeOCR(params = '', addtion = '') {
        if(!this._enable_ocr) return;
        this.screenshot = true;
        this.execute(this._ocr_cmd + (params || [this.ocr_params, addtion, '-m', this._ocr_mode].join(' ')))
            .catch(noop).finally(() => (this.screenshot = false));
    }

    _release(keyname) {
        this._keyboard.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(keyname), Clutter.KeyState.RELEASED);
    }

    _press(keyname) {
        this._keyboard.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(keyname), Clutter.KeyState.PRESSED);
    }

    stroke(keystring) {
        this._keyIds?.forEach(x => clearTimeout(x));
        this._keyIds = keystring.split(/\s+/).map((keys, i) => setTimeout(() => {
            let keyarray = keys.split('+');
            keyarray.forEach(key => this._press(key));
            keyarray.reverse().forEach(key => this._release(key));
        }, i * 100));
    }

    commit(string) {
        if(InputScMgr.currentSource.type === Keyboard.INPUT_SOURCE_TYPE_IBUS) InputScMgr._ibusManager._panelService?.commit_text(IBus.Text.new_from_string(string));
        else Main.inputMethod.commit(string); // TODO: not tested
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
        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if(proc.get_exit_status()) throw new Error(stderr.trim());
        return stdout.trim();
    }

    destroy() {
        this._field.detach(this);
        this._keyIds?.forEach(x => clearTimeout(x));
        this.screenshot = this.enable_ocr = this._keyboard = null;
    }
}

class DictBtn extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        this._buildWidgets();
        this._bindSettings();
        this._addMenuItems();
    }

    _buildWidgets() {
        this._icon = new St.Icon({ style_class: 'light-dict-systray system-status-icon' });
        this.menu.actor.add_style_class_name('app-menu'); // popup-ornament-width: 0;
        this.add_actor(this._icon);
    }

    _bindSettings() {
        this._field = new Field({
            passive:    [Fields.PASSIVE,   'uint'],
            trigger:    [Fields.TRIGGER,   'uint'],
            ocr_mode:   [Fields.OCRMODE,   'uint'],
            dwell_ocr:  [Fields.DWELLOCR,  'boolean'],
            enable_ocr: [Fields.ENABLEOCR, 'boolean'],
            scommand:   [Fields.SCOMMAND,  'int'],
            scommands:  [Fields.SCOMMANDS, 'strv'],
        }, ExtensionUtils.getSettings(), this);
    }

    set scommands(scmds) {
        let cmds = scmds.map(x => JSON.parse(x).name);
        if(this._scmds?.length === cmds.length && this._scmds?.every((x, i) => x === cmds[i])) return;
        this._scmds = cmds;
        this._menus?.scmds.setList(this._scmds);
        this.scommand = this._scmd;
    }

    set scommand(scmd) {
        this._scmd = scmd;
        this._menus?.scmds.setSelected(scmd);
    }

    set passive(passive) {
        this._passive = passive;
        this._menus?.passive.setToggleState(!!passive);
        this._updateIcon();
    }

    set dwell_ocr(dwell_ocr) {
        this._dwell_ocr = dwell_ocr;
        this._menus?.dwell.setToggleState(dwell_ocr);
    }

    set trigger(trigger) {
        this._trigger = trigger;
        this._menus?.trigger.setSelected(trigger);
        this._updateIcon();
    }

    set ocr_mode(ocr_mode) {
        this._ocr_mode = ocr_mode;
        this._menus?.ocr.setSelected(ocr_mode);
    }

    set enable_ocr(enable) {
        this._enable_ocr = enable;
        ['dwell', 'ocr'].forEach(x => enable ? this._menus?.[x].show() : this._menus?.[x].hide());
    }

    vfunc_scroll_event(event) {
        switch(event.direction) {
        case Clutter.ScrollDirection.UP: this._field._set('trigger', (this._trigger + 1) % 2); break;
        case Clutter.ScrollDirection.DOWN: this._field._set('passive', 1 - this._passive); break;
        }
        return Clutter.EVENT_STOP;
    }

    _updateIcon() {
        let style = Object.keys(Trigger)[this._trigger ?? 0].toLowerCase();
        this._icon.set_gicon(genIcon(`${style}-${this._passive ?? 0 ? 'passive' : 'proactive'}`));
    }

    _addMenuItems() {
        this._menus = {
            dwell:    new SwitchItem(_('Dwell OCR'), this._dwell_ocr, x => this._field._set('dwell_ocr', x)),
            passive:  new SwitchItem(_('Passive mode'), !!this._passive, x => this._field._set('passive', x ? 1 : 0)),
            sep1:     new PopupMenu.PopupSeparatorMenuItem(),
            trigger:  new RadioItem(_('Trigger'), Trigger, this._trigger, x => this._field._set('trigger', x)),
            scmds:    new DRadioItem(_('Swift'), this._scmds, this._scmd, x => this._field._set('scommand', x)),
            ocr:      new RadioItem(_('OCR'), OCRMode, this._ocr_mode, x => this._field._set('ocr_mode', x)),
            sep2:     new PopupMenu.PopupSeparatorMenuItem(),
            settings: new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
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
        this._cur = new Clutter.Actor({ opacity: 0 });
        Main.uiGroup.add_actor(this._cur);
        this._bindSettings();
        this._buildWidgets();
        this._onWindowChanged();
    }

    _bindSettings() {
        this._field = new Field({
            filter:     [Fields.TXTFILTER, 'string'],
            app_list:   [Fields.APPLIST,   'string'],
            passive:    [Fields.PASSIVE,   'uint'],
            systray:    [Fields.SYSTRAY,   'boolean'],
            trigger:    [Fields.TRIGGER,   'uint'],
            list_type:  [Fields.LISTTYPE,  'uint'],
            text_strip: [Fields.TXTSTRIP,  'boolean'],
        }, ExtensionUtils.getSettings(), this);
    }

    _buildWidgets() {
        this._act = new DictAct();
        this._box = new DictBox();
        this._bar = new DictBar();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(LD_DBUS, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');
        this._bar.connect('dict-bar-clicked', (actor, cmd) => { this._dlock = true; this._exeCmd(cmd); });
        this._act.connect('dict-act-dwelled', (actor, dw, ptt) => {
            if(this._dlock) return (this._dlock = undefined);
            if(this._box._rectt && !outOf(this._box._rectt, ptt) ||
               this._box.visible && this._box._entered || this._bar.visible && this._bar._entered) return;
            if(this.passive && dw & 0b01 || !this.passive && dw & 0b10) this._act._invokeOCR('', '--quiet');
        });
        global.display.connectObject('notify::focus-window', this._onWindowChanged.bind(this), this);
        global.display.get_selection().connectObject('owner-changed', this._onSelectChanged.bind(this), this);
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new DictBtn(0.5, Me.metadata.uuid);
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button);
        } else {
            if(!this._button) return;
            this._button.destroy();
            this._button = null;
        }
    }

    get _allow() {
        return !this.app_list || this.list_type ^ this.app_list.includes(this._app);
    }

    get appid() {
        return (v => v ? (w => !w || w.is_window_backed() ? '' : w.get_id())(Shell.WindowTracker.get_default().get_window_app(v)) : '')(g_focus());
    }

    set cursor(cursor) {
        let [x, y, w, h] = cursor && cursor[3] < g_size()[1] / 2 ? cursor
            : ((a, b) => [a[0] - b / 2, a[1] - b / 2, b * 1.15, b * 1.15])(g_pointer(), Meta.prefs_get_cursor_size());
        this._cursor = !!cursor && w > 250;
        this._cur.set_position(x, y);
        this._cur.set_size(w, h);
    }

    _onWindowChanged() {
        this._box.dispel();
        this._bar.dispel();
        this._app = this.appid;
    }

    _onSelectChanged(sel, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        clearInterval(this._mouseId);
        if(this._slock) return (this._slock = undefined);
        if(!this._allow || this.trigger === Trigger.Disable) return;
        let mods = g_pointer()[2];
        if(this.passive && !(mods & LD_MODR)) return;
        if(mods & Clutter.ModifierType.BUTTON1_MASK) {
            this._mouseId = setInterval(() => {
                if((mods ^ g_pointer()[2]) !== Clutter.ModifierType.BUTTON1_MASK) return;
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
            let APPID = this._app;
            let LDWORD = this._selection;
            let key = x => this._act.stroke(x);
            let search = x => { Main.overview.toggle(); Main.overview.searchEntry.set_text(x); };
            if(popup | copy | commit | select) {
                let result = String(eval(command)) || '';
                if(copy) this._act.copy(result);
                if(select) this._select(result);
                if(popup) this._display(result);
                if(commit) this._act.commit(result);
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
        this._slock = true;
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
        return new Promise(resolve => St.Clipboard.get_default().get_text(St.ClipboardType.PRIMARY, (_clip, text) => resolve(text)));
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
        this._act._invokeOCR(temp);
    }

    Toggle() {
        let next = (this.trigger + 1) % 2;
        Main.notify(Me.metadata.name, _('Switch to %s style').format(_(Object.keys(Trigger)[next])));
        this._field._set('trigger', next);
    }

    get Pointer() {
        return g_pointer().slice(0, 2);
    }

    get DisplaySize() {
        return g_size();
    }

    get FocusWindow() {
        return (r => r ? [r.x, r.y, r.width, r.height] : null)(g_focus()?.get_frame_rect?.());
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
