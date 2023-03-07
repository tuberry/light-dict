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
const { DBusSenderChecker } = imports.misc.util;

const InputSourceManager = Keyboard.getInputSourceManager();
const Me = ExtensionUtils.getCurrentExtension();
const { Fulu, Extension, Symbiont, DEventEmitter } = Me.imports.fubar;
const { noop, xnor, _ } = Me.imports.util;
const { Field } = Me.imports.const;

const gs_pointer = () => global.get_pointer();
const gs_size = () => global.display.get_size();
const gs_focus = () => global.display.get_focus_window();
const still = (u, v) => u[0] === v[0] && u[1] === v[1];
const outside = (r, p) => p[0] < r[0] || p[1] < r[1] || p[0] > r[0] + r[2] || p[1] > r[1] + r[3];
const genIcon = x => Gio.Icon.new_for_string('%s/icons/hicolor/scalable/status/%s.svg'.format(Me.dir.get_path(), x));
const genEmpty = () => (x => x[Math.floor(Math.random() * x.length)])(['_(:з」∠)_', '¯\\_(ツ)_/¯', 'o(T^T)o', 'Σ(ʘωʘﾉ)ﾉ', 'ヽ(ー_ー)ノ']); // placeholder

const Trigger = { Swift: 0, Popup: 1, Disable: 2 };
const OCRMode = { Word: 0, Paragraph: 1, Area: 2, Line: 3 };
const LDMdf = Clutter.ModifierType.MOD1_MASK;
const LDIface =
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
            this.set_child(new St.Icon({ gicon, style_class: 'candidate-label' }));
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

    constructor(fulu) {
        super(St.Side.BOTTOM);
        this.visible = false;
        this.style_class = 'light-dict-bar-boxpointer';
        Main.layoutManager.addTopChrome(this);
        this._buildWidgets();
        this._bindSettings(fulu);
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
        this._sbt_h = new Symbiont(x => clearTimeout(x), this, x => setTimeout(() => this.dispel(), x ? this.autohide / 10 : this.autohide));
        new Symbiont(() => { this.tooltip = false; }, this);
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            pgsize:    [Field.PAGESIZE,  'uint'],
            tooltip:   [Field.TOOLTIP,   'boolean'],
            autohide:  [Field.AUTOHIDE,  'uint'],
            pcommands: [Field.PCOMMANDS, 'strv'],
        }, this);
    }

    set pcommands(pcmds) {
        let cmds = pcmds.map(x => JSON.parse(x)).filter(x => x.enable);
        let pk = x => JSON.stringify(x.map(y => [y.icon, y.name]));
        if(pk(cmds) === pk(this._cmds ?? [])) { this._cmds = cmds; return; }
        let icons = this._box.get_children();
        let diff = cmds.length - icons.length;
        if(diff > 0) for(let a = 0; a < diff; a++) this._box.add(new DictPop(this.click.bind(this), this.tip.bind(this)));
        else if(diff < 0) for(let a = 0; a > diff; a--) icons.at(a - 1).destroy();
        this._box.get_children().forEach((x, i) => x.setButton(cmds[i], i));
        this._cmds = cmds;
    }

    tip(index) {
        if(!this._tooltip) return;
        this._tooltip.hide();
        this._sbt_t.reset(index);
    }

    click(index) {
        this.dispel();
        this.emit('dict-bar-clicked', this._cmds[index]);
    }

    _updatePages() {
        this._box.get_children().forEach(x => (x.visible = x._visible));
        let icons = this._box.get_children().filter(x => x.visible);
        this._pages = icons.length && this.pgsize ? Math.ceil(icons.length / this.pgsize) : 0;
        if(this._pages < 2) return;
        this._idx = this._idx < 1 ? this._pages : this._idx > this._pages ? 1 : this._idx ?? 1;
        if(this._idx === this._pages && icons.length % this.pgsize) icons.forEach((x, i) => (x.visible = i >= icons.length - this.pgsize && i < icons.length));
        else icons.forEach((x, i) => (x.visible = i >= (this._idx - 1) * this.pgsize && i < this._idx * this.pgsize));
    }

    _updateViz(app, text) {
        let icons = this._box.get_children();
        this._cmds.forEach(({ regexp: r, apps: a }, i) => { icons[i]._visible = (!r || safeRegTest(r, text)) && (!a || a.includes(app)); });
        this._updatePages();
    }

    set tooltip(tooltip) {
        if(xnor(tooltip, this._tooltip)) return;
        if(tooltip) {
            this._tooltip = new St.Label({ visible: false, style_class: 'light-dict-tooltip dash-label' });
            Main.layoutManager.addTopChrome(this._tooltip);
            this._sbt_t = new Symbiont(x => clearTimeout(x), this._tooltip, i => setTimeout(() => {
                if(!this._box.visible) return;
                this._tooltip.set_position(gs_pointer().at(0) - 10, this.get_position().at(1) + this.get_size().at(1) + 5);
                this._tooltip.set_text(this._cmds[i].tooltip || this._cmds[i].name || 'LD');
                this._tooltip.show();
            }, this.autohide / 5));
        } else {
            this._tooltip.destroy();
            this._tooltip = null;
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
        this._sbt_h.dispel();
        this._entered = true;
        this._box.visible = true;
    }

    _onLeave(actor) {
        this._sbt_h.reset(actor);
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
        this._sbt_h.dispel();
        this._entered = false;
        this._box.visible = false;
        this.close(BoxPointer.PopupAnimation.FADE);
        if(!this._tooltip) return;
        this._sbt_t.dispel();
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
            'button-press-event', this._onClick.bind(this), this);
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
        this._sbt_h = new Symbiont(x => clearTimeout(x), this, x => setTimeout(outside(this.getRect(), gs_pointer()) ? this.dispel.bind(this)
            : () => this._onLeave(true), x ? this.autohide / 10 : this.autohide));
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            lcommand:   [Field.LCOMMAND,  'string'],
            rcommand:   [Field.RCOMMAND,  'string'],
            autohide:   [Field.AUTOHIDE,  'uint'],
            hide_title: [Field.HIDETITLE, 'boolean'],
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
        this._sbt_h.dispel();
    }

    _onLeave(actor) {
        this._sbt_h.reset(actor);
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
        if(xnor(error, this._error)) return;
        this._box[`${((this._error = error)) ? 'add' : 'remove'}_style_pseudo_class`]('error');
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
        this._sbt_h.dispel();
        this._rect = this.getRect();
        this._view.visible = false;
        this._info.set_text(genEmpty());
        this.close(BoxPointer.PopupAnimation.FADE);
        this._entered = false;
    }
}

class DictAct extends DEventEmitter {
    constructor(fulu) {
        super();
        this._buildWidgets(fulu);
        this._bindSettings();
    }

    _buildWidgets(fulu) {
        this._fulu = fulu;
        this._ldocr = `python ${Me.dir.get_child('ldocr.py').get_path()} `;
        this._sbt_c = new Symbiont(x => x?.cancel(), this, () => new Gio.Cancellable());
        this._kbd = Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._sbt_k = new Symbiont(x => x?.forEach(y => clearTimeout(y)), this, x => x.split(/\s+/).map(y => y.split('+')).map((z, i) => setTimeout(() => {
            z.forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(k), Clutter.KeyState.PRESSED));
            z.reverse().forEach(k => this._kbd.notify_keyval(Clutter.get_current_event_time() * 1000, Gdk.keyval_from_name(k), Clutter.KeyState.RELEASED));
        }, i * 100)));
        this._sbt_d = new Symbiont(x => clearInterval(x), this, x => x && setInterval(() => {
            let pt = gs_pointer();
            if(still(this._pt, pt) && !still(this._pt, this._ppt)) this.emit('dict-act-dwelled', pt[2], this._ppt);
            [this._ppt, this._pt] = [this._pt, pt];
        }, 300));
        this._sbt_s = new Symbiont(x => x && Main.wm.removeKeybinding(Field.OCRSHORTCUT), this,
            x => x && Main.wm.addKeybinding(Field.OCRSHORTCUT, this._fulu.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.invokeOCR()));
        new Symbiont(() => { this.screenshot = this.enable_ocr = this._kbd = null; }, this);
    }

    _bindSettings() {
        this._fulu.attach({
            ocr_params: [Field.OCRPARAMS, 'string'],
            ocr_mode:   [Field.OCRMODE,   'uint'],
            scommand:   [Field.SCOMMAND,  'int'],
            dwell_ocr:  [Field.DWELLOCR,  'boolean'],
            short_ocr:  [Field.SHORTOCR,  'boolean'],
            enable_ocr: [Field.ENABLEOCR, 'boolean'],
            scommands:  [Field.SCOMMANDS, 'strv'],
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
        this._sbt_d.reset((this._dwell_ocr = dwell_ocr) && this._enable_ocr);
    }

    set short_ocr(short) {
        this._sbt_s.reset((this._short_ocr = short) && this._enable_ocr);
    }

    set ocr_mode(mode) {
        this._ocr_mode = Object.keys(OCRMode)[mode].toLowerCase();
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

    invokeOCR(params = '', supply = '') {
        if(!this._enable_ocr) return;
        this.screenshot = true;
        this.execute(this._ldocr + (params || ['-m', this._ocr_mode, this.ocr_params, supply].join(' ')))
            .catch(noop).finally(() => { this._pid = this.screenshot = null; });
    }

    stroke(keys) {
        this._sbt_k.reset(keys);
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
            argv: GLib.shell_parse_argv(cmd).at(1),
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        let cancel = this._sbt_c.reset();
        cancel.connect(() => proc.force_exit());
        proc.init(cancel);
        this._pid = parseInt(proc.get_identifier());
        try {
            let [stdout, stderr] = await proc.communicate_utf8_async(null, cancel);
            let status = proc.get_exit_status();
            if(status) throw new Gio.IOErrorEnum({ code: Gio.io_error_from_errno(status), message: stderr.trim() || GLib.strerror(status) });
            return stdout.trim();
        } finally {
            this._sbt_c._delegate = null;
        }
    }
}

class DictBtn extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor(fulu, ...params) {
        super(...params);
        this._buildWidgets();
        this._bindSettings(fulu);
        this._addMenuItems();
    }

    _buildWidgets() {
        this.add_style_class_name('light-dict-systray');
        this._icon = new St.Icon({ style_class: 'system-status-icon' });
        this.menu.actor.add_style_class_name('app-menu'); // popup-ornament-width: 0;
        this.add_actor(this._icon);
    }

    _bindSettings(fulu) {
        this._fulu = fulu.attach({
            dwell_ocr:  [Field.DWELLOCR,  'boolean'],
            enable_ocr: [Field.ENABLEOCR, 'boolean'],
            scommands:  [Field.SCOMMANDS, 'strv'],
        }, this).attach({
            passive: [Field.PASSIVE, 'uint', x => this._menus?.passive.setToggleState(!!x)],
            trigger: [Field.TRIGGER, 'uint', x => this._menus?.trigger.setSelected(x)],
        }, this, 'icon').attach({
            ocr_mode: [Field.OCRMODE,  'uint', x => this._menus?.ocr.setSelected(x)],
            scommand: [Field.SCOMMAND, 'int', x => this._menus?.scmds.setSelected(x)],
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
            trigger: new RadioItem(_('Trigger'), Trigger, this.trigger, x => this.setf('trigger', x)),
            scmds:   new DRadioItem(_('Swift'), this._scmds, this.scommand, x => this.setf('scommand', x)),
            ocr:     new RadioItem(_('OCR'), OCRMode, this.ocr_mode, x => this.setf('ocr_mode', x)),
            sep2:    new PopupMenu.PopupSeparatorMenuItem(),
            prefs:   new MenuItem(_('Settings'), () => ExtensionUtils.openPrefs()),
        };
        for(let p in this._menus) this.menu.addMenuItem(this._menus[p]);
        this.enable_ocr = this._enable_ocr;
    }
}

class LightDict extends DEventEmitter {
    constructor() {
        super();
        this._buildWidgets();
        this._bindSettings();
    }

    _bindSettings() {
        this._fulu.attach({
            filter:     [Field.TXTFILTER, 'string'],
            app_list:   [Field.APPLIST,   'string'],
            passive:    [Field.PASSIVE,   'uint'],
            systray:    [Field.SYSTRAY,   'boolean'],
            trigger:    [Field.TRIGGER,   'uint'],
            list_type:  [Field.LISTTYPE,  'uint'],
            text_strip: [Field.TXTSTRIP,  'boolean'],
        }, this);
    }

    _buildWidgets() {
        this.dbus = true;
        this._app = this.getAppid();
        this._dlock = this._slock = [];
        this._fulu = new Fulu({}, ExtensionUtils.getSettings(), this);
        this._cur = new Clutter.Actor({ opacity: 0 });
        Main.uiGroup.add_actor(this._cur);
        this._act = new DictAct(this._fulu);
        this._box = new DictBox(this._fulu);
        this._bar = new DictBar(this._fulu);
        this._act.connect('dict-act-dwelled', this._onActDwelled.bind(this));
        this._bar.connect('dict-bar-clicked', (_a, cmd) => { this._dlock[0] = true; this._exeCmd(cmd); });
        global.display.connectObject('notify::focus-window', () => this._onWindowChanged(), this);
        global.display.get_selection().connectObject('owner-changed', this._onSelectChanged.bind(this), this);
        // FIXME: idle to avoid clutter-stage.c assertion when search() since 44.beta
        // related upstream MR: https://gitlab.gnome.org/GNOME/mutter/-/merge_requests/2342
        this._sbt_e = new Symbiont(x => x && GLib.source_remove(x), this, x => GLib.idle_add(GLib.PRIORITY_LOW, () => {
            x(); this._sbt_e._delegate = null;
            return GLib.SOURCE_REMOVE;
        }));
        this._sbt_m = new Symbiont(x => clearInterval(x), this, x => setInterval(() => {
            if((x ^ gs_pointer().at(2)) !== Clutter.ModifierType.BUTTON1_MASK) return;
            this._sbt_m.dispel();
            this._run().catch(noop);
        }, 50));
        new Symbiont(() => {
            this.systray = this.dbus = null;
            global.display.disconnectObject(this);
            global.display.get_selection().disconnectObject(this);
            ['_bar', '_box', '_act', '_cur'].forEach(x => { this[x].destroy(); this[x] = null; });
        }, this);
    }

    set dbus(dbus) {
        if(xnor(dbus, this._dbus)) return;
        if(dbus) {
            this._dbus = Gio.DBusExportedObject.wrapJSObject(LDIface, this);
            this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/LightDict');
        } else {
            this._dbus.flush();
            this._dbus.unexport();
            this._dbus = null;
        }
    }

    set systray(systray) {
        if(xnor(systray, this._button)) return;
        if(systray) {
            this._button = new DictBtn(this._fulu, 0.5, Me.metadata.uuid);
            Main.panel.addToStatusArea(Me.metadata.uuid, this._button);
        } else {
            this._button.destroy();
            this._button = null;
        }
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
        if(this._dlock.pop() || this._box._rect && !outside(this._box._rect, ppt) ||
           this._box.visible && this._box._entered || this._bar.visible && this._bar._entered) return;
        if(!this.passive || mdf & LDMdf) this._act.invokeOCR('', '--quiet');
    }

    _onWindowChanged() {
        this._box.dispel();
        this._bar.dispel();
        this._app = this.getAppid();
    }

    _onSelectChanged(_sel, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        this._sbt_m.dispel();
        let mdf = gs_pointer().at(2);
        if(this._slock.pop() || this.isFobidden() || this.passive && !(mdf & LDMdf) || this.trigger === Trigger.Disable) return;
        if(mdf & Clutter.ModifierType.BUTTON1_MASK) this._sbt_m.summon(mdf);
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
        else this._sbt_e.reset(() => this._exeJS(cmd));
    }

    _select(x) {
        this._slock[0] = true;
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
        let selection = this.text_strip ? text.replace(/\n\s*\n/g, '\n') : text;
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
            if(!this.passive && this.filter && safeRegTest(this.filter, this._selection)) return;
            this.trigger ? this._popup() : await this._swift();
        } else {
            let [ty, pe] = type.split(':');
            switch(ty === 'auto' ? Object.keys(Trigger)[this.trigger].toLowerCase() : ty) {
            case 'swift':   this._store(text || await this._fetch()); await this._swift(pe); break;
            case 'popup':   this._store(text || await this._fetch()); this._popup(); break;
            case 'display': this._store(text || 'ERROR'); this._display(info.trim() || genEmpty(), !text); break;
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
        Main.notify(Me.metadata.name, _('Switch to %s style').format(_(Object.keys(Trigger)[next])));
        this.setf('trigger', next);
    }
}

function init() {
    return new Extension(LightDict);
}
