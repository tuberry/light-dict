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

const InputScMgr = Keyboard.getInputSourceManager();
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.fields.Fields;
const _ = ExtensionUtils.gettext;
let gsettings = null;

const noop = () => {};
const g_pointer = () => global.get_pointer();
const g_size = () => global.display.get_size();
const g_focus = () => global.display.get_focus_window();
const still = (u, v) => u[0] === v[0] && u[1] === v[1];
const dwell = (u, v, w, m) => !still(u, v) << 1 | !(u[2] & m) & !!(v[2] & m) & !!(w[2] & m);
const outOf = (r, p) => p[0] < r[0] || p[1] < r[1] || p[0] > r[0] + r[2] || p[1] > r[1] + r[3];
const genIcon = x => Gio.Icon.new_for_string(Me.dir.get_child('icons').get_child('%s-symbolic.svg'.format(x)).get_path());
const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

const Trigger = { Swift: 0, Popup: 1, Disable: 2 };
const OCRMode = { Word: 0, Paragraph: 1, Area: 2, Line: 3 };
const LD_MODR = Clutter.ModifierType.MOD1_MASK;
const LD_DBUS =
`<node>
    <interface name="org.gnome.Shell.Extensions.LightDict">
        <method name="Block"/>
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
        this.connect('toggled', (x_, y) => { callback(y); });
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
        this._list.map((x, i) => new MenuItem(_(x), () => { callback(i); })).forEach(x => this.menu.addMenuItem(x));
        this.setSelected(index);
    }

    setSelected(index) {
        if(!(index in this._list)) return;
        this.label.set_text(this._name + _(this._list[index]));
        this.menu._getMenuItems().forEach((y, i) => y.setOrnament(index === i ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
    }
}

class DListItem extends PopupMenu.PopupSubMenuMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(name, modes, index, callback) {
        super('');
        this._name = name;
        this._call = callback;
        this.setList(modes);
        this.setSelected(index);
    }

    setSelected(index) {
        this._index = index;
        this.label.set_text('%s%s'.format(this._name, this._list[this._index] ?? ''));
        this._items.forEach((y, i) => y.setOrnament(index === i ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE));
    }

    setList(list) {
        let items = this._items;
        let diff = list.length - items.length;
        if(diff > 0) for(let a = 0; a < diff; a++) this.menu.addMenuItem(new MenuItem('', () => { this._call(items.length + a); }));
        else if(diff < 0) for(let a = 0; a > diff; a--) items.at(a - 1).destroy();
        this._list = list;
        this._items.forEach((x, i) => x.setLabel(this._list[i]));
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
        this.connect('clicked', () => { call1(this._index); });
        this.connect('enter-event', () => { call2(this._index); });
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
            Properties: {
                size: genParam('uint', 'size', 1, 10, 5),
                tooltip: genParam('boolean', 'tooltip', false),
                autohide: genParam('uint', 'autohide', 500, 10000, 2500),
            },
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
        [[Fields.TOOLTIP, 'tooltip'], [Fields.PAGESIZE, 'size'], [Fields.AUTOHIDE, 'autohide']]
            .forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
        this.setPcommands();
        gsettings.connectObject('changed::%s'.format(Fields.PCOMMANDS), () => { this.setPcommands(); }, this);
        // gsettings.bind_with_mapping(Fields.PCOMMANDS, this, 'pcommands', Gio.SettingsBindFlags.GET); // NOTE: unavailable
    }

    setPcommands() {
        let cmds = gsettings.get_strv(Fields.PCOMMANDS).map(x => JSON.parse(x)).filter(x => x.enable);
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
        this._icons.forEach(x => { x.visible = x._visible; });
        let icons = this._icons.filter(x => x.visible);
        this._pages = icons.length && this.size ? Math.ceil(icons.length / this.size) : 0;
        if(this._pages < 2) return;
        this._idx = this._idx < 1 ? this._pages : this._idx > this._pages ? 1 : this._idx ?? 1;
        if(this._idx === this._pages && icons.length % this.size) icons.forEach((x, i) => { x.visible = i >= icons.length - this.size && i < icons.length; });
        else icons.forEach((x, i) => { x.visible = i >= (this._idx - 1) * this.size && i < this._idx * this.size; });
    }

    _updateViz(app, text) {
        let ics = this._icons;
        this._cmds.forEach(({ regexp, apps }, i) => {
            switch(!!regexp << 1 | !!apps) {
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
        gsettings.disconnectObject(this);
        clearTimeout(this._tooltipId);
        clearTimeout(this._delayId);
        this.tooltips = false;
        super.destroy();
    }
}

class DictBox extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass({
            Properties: {
                lcommand: genParam('string', 'lcommand', ''),
                rcommand: genParam('string', 'rcommand', ''),
                autohide: genParam('uint', 'autohide', 500, 10000, 2500),
            },
        }, this);
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
            visible: false, overlay_scrollbars: true,
            style_class: 'light-dict-scroll', hscrollbar_policy: St.PolicyType.NEVER,
        });
        this._box = new St.BoxLayout({ reactive: true, vertical: true, style_class: 'light-dict-content' });
        this._text = new St.Label({ style_class: 'light-dict-text' });
        this._info = new St.Label({ style_class: 'light-dict-info' });
        this._text.clutter_text.line_wrap = true; // FIXME: incompatible with ScrollView AUTOMATIC policy / GNOME 42
        this._info.clutter_text.line_wrap = true;
        this._box.add(this._text);
        this._box.add(this._info);
        this._view.add_actor(this._box);
        this.bin.set_child(this._view);
        this._box.connectObject('leave-event', this._onLeave.bind(this), 'enter-event', this._onEnter.bind(this),
            'button-press-event', this._onClick.bind(this), this); // FIXME: missing `leave-event` signals on Wayland / GNOME 42
        gsettings.bind(Fields.HIDETITLE, this._text, 'visible', Gio.SettingsBindFlags.INVERT_BOOLEAN);
    }

    _bindSettings() {
        [[Fields.AUTOHIDE, 'autohide'], [Fields.LCOMMAND, 'lcommand'], [Fields.RCOMMAND, 'rcommand']]
            .forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
    }

    get _scrollable() {
        let [, height] = this._view.get_preferred_height(-1);
        let limited = this._view.get_theme_node().get_max_height();
        if(limited < 0) limited = g_size()[1] * 15 / 32;

        return height >= limited;
    }

    _onEnter() {
        this._entered = true;
        this._view.visible = true;
        clearTimeout(this._delayId);
    }

    _onLeave(actor) {
        clearTimeout(this._delayId);
        this._delayId = setTimeout(outOf(this._rect, g_pointer()) ? this.dispel.bind(this)
            : () => { this._onLeave(true); }, actor ? this.autohide / 10 : this.autohide);
    }

    _onClick(actor, event) {
        switch(event.get_button()) {
        case 1: if(this.lcommand) Util.spawnCommandLine(this.lcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); break;
        case 2: St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, this._info.get_text()); break;
        case 3: if(this.rcommand) Util.spawnCommandLine(this.rcommand.replace(/LDWORD/g, GLib.shell_quote(this._selection))); this.dispel(); break;
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
            this._info.clutter_text.set_markup(info || 'Σ(ʘωʘﾉ)ﾉ');
        } catch(e) {
            this._info.set_text(info || 'o(T^T)o');
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
        this._info.set_text('ヽ(ー_ー)ノ');
        this.close(BoxPointer.PopupAnimation.FADE);
        this._entered = false;
    }

    destroy() {
        clearTimeout(this._delayId);
        super.destroy();
    }
}

class DictAct extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                ocr_params: genParam('string', 'ocr_params', ''),
                ocr_mode:   genParam('uint', 'ocr_mode', 0, 5, 0),
                scommand:   genParam('int', 'scommand', -1, 2000, 0),
                dwell_ocr:  genParam('boolean', 'dwell_ocr', false),
                short_ocr:  genParam('boolean', 'short_ocr', false),
                enable_ocr: genParam('boolean', 'enable_ocr', false),
            },
            Signals: {
                dict_act_dwelled: { param_types: [GObject.TYPE_UINT, GObject.TYPE_JSOBJECT] },
            },
        }, this);
    }

    constructor() {
        super();
        this._bindSettings();
        this._ocr_cmd = 'python %s '.format(Me.dir.get_child('ldocr.py').get_path());
        this._keyboard = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }

    _bindSettings() {
        [
            [Fields.ENABLEOCR, 'enable_ocr'],
            [Fields.OCRMODE,   'ocr_mode'],
            [Fields.OCRPARAMS, 'ocr_params'],
            [Fields.SCOMMAND,  'scommand'],
            [Fields.DWELLOCR,  'dwell_ocr'],
            [Fields.SHORTOCR,  'short_ocr'],
        ].forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
        this.setScommands();
        gsettings.connectObject('changed::%s'.format(Fields.SCOMMANDS), this.setScommands.bind(this), this);
    }

    setScommands() {
        this._scmds = gsettings.get_strv(Fields.SCOMMANDS).map(x => JSON.parse(x));
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
            if(still(this._pt, pt)) (dw => dw && this.emit('dict_act_dwelled', dw, this._ptt))(dwell(this._ptt, this._pt, pt, LD_MODR));
            [this._ptt, this._pt] = [this._pt, pt];
        }, 375);
    }

    set short_ocr(short) {
        this._shortId && Main.wm.removeKeybinding(Fields.OCRSHORTCUT);
        this._shortId = (this._short_ocr = short) && this._enable_ocr &&
            Main.wm.addKeybinding(Fields.OCRSHORTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => { this._invokeOCR(); });
    }

    set ocr_mode(mode) {
        this._ocr_mode = Object.keys(OCRMode)[mode].toLowerCase();
    }

    set screenshot(screenshot) {
        if(global.context?.unsafe_mode ?? true) return;
        let checker = Main.shellDBusService._screenshotService._senderChecker;
        checker._isSenderAllowed = screenshot ? () => true : sender => [...checker._allowlistMap.values()].includes(sender);
    }

    _invokeOCR(params = '', attach = '') {
        if(!this._enable_ocr) return;
        this.screenshot = true;
        this.execute(this._ocr_cmd + (params || [this.ocr_params, attach, '-m', this._ocr_mode].join(' ')))
            .catch(noop).finally(() => { this.screenshot = false; });
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
        }, i * 100)); // NOTE: Modifier keys aren't working on Wayland (input area)
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
        gsettings.disconnectObject(this);
        this._keyIds?.forEach(x => clearTimeout(x));
        this.screenshot = this.enable_ocr = this._keyboard = null;
    }
}

class DictBtn extends PanelMenu.Button {
    static {
        GObject.registerClass({
            Properties: {
                passive:    genParam('uint', 'passive', 0, 1, 0),
                trigger:    genParam('uint', 'trigger', 0, 2, 1),
                ocr_mode:   genParam('uint', 'ocr_mode', 0, 5, 0),
                dwell_ocr:  genParam('boolean', 'dwell_ocr', false),
                enable_ocr: genParam('boolean', 'enable_ocr', false),
                scommand:   genParam('int', 'scommand', -1, 2000, 0),
            },
            Signals: {
                dict_app_toggled: {},
            },
        }, this);
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
        [
            [Fields.ENABLEOCR, 'enable_ocr'],
            [Fields.DWELLOCR,  'dwell_ocr'],
            [Fields.PASSIVE,   'passive'],
            [Fields.TRIGGER,   'trigger'],
            [Fields.OCRMODE,   'ocr_mode'],
            [Fields.SCOMMAND,  'scommand'],
        ].forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
        this.setScommands();
        gsettings.connectObject('changed::%s'.format(Fields.SCOMMANDS), this.setScommands.bind(this), this);
    }

    setScommands() {
        let cmds = gsettings.get_strv(Fields.SCOMMANDS).map(x => JSON.parse(x).name);
        if(this._scmds?.every((x, i) => x === cmds[i])) return;
        this._scmds = cmds;
        this._menus?.scmds.setList(this._scmds);
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
        case Clutter.ScrollDirection.UP: gsettings.set_uint(Fields.TRIGGER, (this._trigger + 1) % 2); break;
        case Clutter.ScrollDirection.DOWN: gsettings.set_uint(Fields.PASSIVE, 1 - this._passive); break;
        }
        return Clutter.EVENT_STOP;
    }

    _updateIcon() {
        let style = Object.keys(Trigger)[this._trigger ?? 0].toLowerCase();
        this._icon.set_gicon(genIcon('%s-%s'.format(style, this._passive ?? 0 ? 'passive' : 'proactive')));
    }

    _addMenuItems() {
        this._menus = {
            dwell:    new SwitchItem(_('Dwell OCR'), this._dwell_ocr, x => gsettings.set_boolean(Fields.DWELLOCR, x)),
            passive:  new SwitchItem(_('Passive mode'), !!this._passive, x => gsettings.set_uint(Fields.PASSIVE, x ? 1 : 0)),
            sep1:     new PopupMenu.PopupSeparatorMenuItem(),
            trigger:  new RadioItem(_('Trigger: '), Trigger, this._trigger, x => gsettings.set_uint(Fields.TRIGGER, x)),
            scmds:    new DListItem(_('Swift: '), this._scmds, this._scmd, x => gsettings.set_int(Fields.SCOMMAND, x)),
            ocr:      new RadioItem(_('OCR: '), OCRMode, this._ocr_mode, x => gsettings.set_uint(Fields.OCRMODE, x)),
            app:      new MenuItem(_('Allow/block current app'), () => { this.emit('dict_app_toggled'); }),
            sep2:     new PopupMenu.PopupSeparatorMenuItem(),
            settings: new MenuItem(_('Settings'), () => { ExtensionUtils.openPrefs(); }),
        };
        for(let p in this._menus) this.menu.addMenuItem(this._menus[p]);
        this.enable_ocr = this._enable_ocr;
    }

    destroy() {
        gsettings.disconnectObject(this);
        super.destroy();
    }
}

class LightDict extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                filter:     genParam('string', 'filter', ''),
                app_list:   genParam('string', 'app_list', ''),
                passive:    genParam('uint', 'passive', 0, 1, 0),
                systray:    genParam('boolean', 'systray', true),
                trigger:    genParam('uint', 'trigger', 0, 2, 1),
                list_type:  genParam('uint', 'list_type', 0, 1, 1),
                text_strip: genParam('boolean', 'text_strip', true),
            },
        }, this);
    }

    constructor() {
        super();
        this._cur = new Clutter.Actor({ opacity: 0 });
        Main.uiGroup.add_actor(this._cur);
        this._bindSettings();
        this._buildWidgets();
        this._onWindowChanged();
    }

    _bindSettings() {
        [
            [Fields.APPLIST,   'app_list', Gio.SettingsBindFlags.DEFAULT],
            [Fields.TRIGGER,   'trigger',  Gio.SettingsBindFlags.DEFAULT],
            [Fields.SYSTRAY,   'systray'],
            [Fields.TXTFILTER, 'filter'],
            [Fields.LISTTYPE,  'list_type'],
            [Fields.PASSIVE,   'passive'],
            [Fields.TEXTSTRIP, 'text_strip'],
        ].forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
    }

    _buildWidgets() {
        this._act = new DictAct();
        this._box = new DictBox();
        this._bar = new DictBar();
        this._dbus = Gio.DBusExportedObject.wrapJSObject(LD_DBUS, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');
        this._bar.connect('dict-bar-clicked', (actor, cmd) => { this._dLock = true; this._exeCmd(cmd); });
        this._act.connect('dict-act-dwelled', (actor, dw, ptt) => {
            if(this._dLock) { this._dLock = null; return; }
            if(this._box._rectt && !outOf(this._box._rectt, ptt) ||
               this._box.visible && this._box._entered || this._bar.visible && this._bar._entered) return;
            if(this.passive && dw & 0b01 || !this.passive && dw & 0b10) this._act._invokeOCR('', '--no-verbose');
        });
        global.display.connectObject('notify::focus-window', this._onWindowChanged.bind(this), this);
        global.display.get_selection().connectObject('owner-changed', this._onSelectChanged.bind(this), this);
    }

    set systray(systray) {
        if(systray) {
            if(this._button) return;
            this._button = new DictBtn(0.5, Me.metadata.uuid);
            this._button.connect('dict-app-toggled', this.Block.bind(this));
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
            : ((a, b) => [a[0] - b / 2, a[1] - b / 2, b, b])(g_pointer(), Meta.prefs_get_cursor_size());
        this._cursor = !!cursor && w > 250;
        this._cur.set_position(x, y);
        this._cur.set_size(w, h);
    }

    _onWindowChanged() {
        this._box.dispel();
        this._bar.dispel();
        this._app = this.appid;
    }

    _onSelectChanged(_sel, type, _src) {
        if(type !== St.ClipboardType.PRIMARY) return;
        clearInterval(this._mouseId);
        if(this._sLock) { this._sLock = null; return; }
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

    _exeSh(cmd, pop, cpy, cmt, sel) {
        let rcmd = cmd.replace(/LDWORD/g, GLib.shell_quote(this._selection)).replace(/APPID/g, GLib.shell_quote(this._app));
        if(pop | cpy | cmt | sel) {
            this._act.execute(rcmd).then(scc => {
                if(sel) this._select(scc);
                if(cpy) this._act.copy(scc);
                if(cmt) this._act.commit(scc);
                if(pop) this._display(scc);
            }).catch(err => {
                this._display(err.message, true);
            });
        } else {
            Util.spawnCommandLine(rcmd);
        }
    }

    _exeJS(cmd, pop, cpy, cmt, sel) {
        /* eslint-disable no-unused-vars */
        try {
            let APPID = this._app;
            let LDWORD = this._selection;
            let key = x => this._act.stroke(x);
            if(pop | cpy | cmt | sel) {
                let result = String(eval(cmd)) || '';
                if(cpy) this._act.copy(result);
                if(cmt) this._act.commit(result);
                if(sel) this._select(result);
                if(pop) this._display(result);
            } else {
                eval(cmd);
            }
        } catch(e) {
            this._display(e.message, true);
        }
    }

    _exeCmd(p) {
        (q => p.type ? this._exeJS(...q) : this._exeSh(...q))([p.command, p.popup, p.copy, p.commit, p.select]);
    }

    _select(x) {
        this._sLock = true;
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
            case 'swift': this._store(text || await this._fetch()); this._swift(pe); break;
            case 'popup': this._store(text || await this._fetch()); this._popup(); break;
            case 'display': this._store(text || '¯\\_(ツ)_/¯'); this._display(info.trim() || '_(:з」∠)_'); break;
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
        this.trigger = next;
    }

    Block() {
        if(!this._app) return;
        if(!this.app_list) {
            this.app_list = this._app;
        } else {
            let apps = this.app_list.split(',');
            this.app_list.includes(this._app) ? apps.splice(apps.indexOf(this._app), 1) : apps.push(this._app);
            this.app_list = apps.join(',');
        }
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
    static {
        ExtensionUtils.initTranslations();
    }

    enable() {
        gsettings = ExtensionUtils.getSettings();
        this._ext = new LightDict();
    }

    disable() {
        this._ext.destroy();
        this._ext = gsettings = null;
    }
}

function init() {
    return new Extension();
}

