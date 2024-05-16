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
import {SwitchItem, MenuItem, RadioItem, Systray, IconButton, offstage} from './menu.js';
import {Setting, Extension, Mortal, Source, view, connect, myself, _, copy, paste, open} from './fubar.js';
import {ROOT, PIPE, noop, omap, xnor, lot, execute, homolog, hook, capitalize, pickle, seq} from './util.js';

const DBusChecker = Main.shellDBusService._screenshotService._senderChecker;

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
        super({styleClass: 'light-dict-button candidate-box'}, () => click(this.$index), null);
    }

    setCommand({icon, name, tooltip}, index, showTip) {
        this.$src.tip.revive(showTip ? tooltip : '');
        if(icon) {
            this.set_label('');
            this.set_icon_name(icon);
        } else {
            this.set_icon_name('');
            this.set_label(name || 'Name');
        }
        this.$index = index;
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

    constructor(set) {
        super(St.Side.BOTTOM);
        this.set({visible: false, styleClass: 'light-dict-bar-boxpointer'});
        this.$buildWidgets();
        this.$bindSettings(set);
    }

    $buildWidgets() {
        this.$src = Source.fuse({
            hide: Source.newTimer(x => [() => this.dispel(), x]),
        }, this);
        this.box = hook({
            'scroll-event': this.$onScroll.bind(this),
            'notify::hover': ({hover}) => hover ? this.$src.hide.dispel() : this.$src.hide.revive(this.autoHide / 10),
        }, new St.BoxLayout({
            reactive: true, vertical: false, trackHover: true, styleClass: 'light-dict-iconbox candidate-popup-content',
        }));
        this.bin.set_child(this.box);
    }

    $bindSettings(set) {
        this.$set = set.attach({
            pageSize: [Field.PGSZ,  'uint'],
            autoHide: [Field.ATHD,  'uint'],
            tooltip:  [Field.TIP,   'boolean', x => this.$onTooltipSet(x)],
            cmds:     [Field.PCMDS, 'value',   x => this.$onCommandsSet(x)],
        }, this);
    }

    $onTooltipSet(tooltip) {
        if(xnor(this.tooltip, tooltip)) return;
        if(tooltip) [...this.box].forEach((x, i) => x.$src.tip.revive(this.cmds[i].tooltip));
        else [...this.box].forEach(x => x.$src.tip.revive(''));
    }

    $onCommandsSet(commands) {
        let cmds = commands.recursiveUnpack().filter(x => x.enable);
        if(!homolog(this.cmds, cmds, this.tooltip ? ['icon', 'name', 'tooltip'] : ['icon', 'name'])) {
            let btns = [...this.box];
            let diff = cmds.length - btns.length;
            if(diff > 0) while(diff-- > 0) this.box.add_child(new DictPop(x => { this.dispel(); this.emit('dict-bar-clicked', this.cmds[x]); }));
            else if(diff < 0) do btns.at(diff).destroy(); while(++diff < 0);
            [...this.box].forEach((x, i) => x.setCommand(cmds[i], i, this.tooltip));
        }
        return cmds;
    }

    $getPages() {
        let length = this.cmds.reduce((p, x) => p + (x.$visible ? 1 : 0), 0);
        return length && this.pageSize ? Math.ceil(length / this.pageSize) : 0;
    }

    $updatePages(pages) {
        let icons = [...this.box].filter((x, i) => (x.visible = this.cmds[i].$visible));
        if(pages < 2) return;
        this.$index = this.$index < 1 ? pages : this.$index > pages ? 1 : this.$index ?? 1;
        if(this.$index === pages && icons.length % this.pageSize) {
            let start = icons.length - this.pageSize;
            icons.forEach((x, i) => view(i >= start, x));
        } else {
            let end = this.$index * this.pageSize;
            let start = (this.$index - 1) * this.pageSize;
            icons.forEach((x, i) => view(i >= start && i < end, x));
        }
    }

    $onScroll(_a, event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this.$index--; break;
        case Clutter.ScrollDirection.DOWN: this.$index++; break;
        default: return;
        }
        this.$updatePages(this.$getPages());
    }

    summon(app, str) {
        this.cmds.forEach(x => { x.$visible = allowed(x, app, str); });
        let pages = this.$getPages();
        if(pages < 1) return;
        if(offstage(this)) Main.layoutManager.addTopChrome(this);
        this.$updatePages(pages);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.$src.hide.revive(this.autoHide);
    }

    dispel() {
        if(offstage(this)) return;
        this.$src.hide.dispel();
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this); // HACK: workaround for unexpected leave event on reappearing in entered prect
    }
}

class DictBox extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor(set) {
        super(St.Side.TOP);
        this.set({visible: false, styleClass: 'light-dict-box-boxpointer'});
        this.$buildWidgets();
        this.$bindSettings(set);
    }

    $buildWidgets() {
        this.$src = Source.fuse({
            hide: Source.newTimer(x => [() => this.dispel(), x]),
        }, this);
        this.view = hook({
            'button-press-event': this.$onClick.bind(this),
            'notify::hover': ({hover}) => hover ? this.$src.hide.dispel() : this.$src.hide.revive(this.autoHide / 10),
        }, new St.ScrollView({
            child: new St.BoxLayout({vertical: true, styleClass: 'light-dict-content'}),
            styleClass: 'light-dict-view', overlayScrollbars: true, reactive: true, trackHover: true,
        }));
        this.$text = this.$genLabel('light-dict-text');
        this.$info = this.$genLabel('light-dict-info');
        [this.$text, this.$info].forEach(x => this.view.child.add_child(x));
        this.bin.set_child(this.view);
    }

    $genLabel(styleClass) {
        return seq(x => x.clutterText.set({lineWrap: true, ellipsize: Pango.EllipsizeMode.NONE, lineWrapMode: Pango.WrapMode.WORD_CHAR}),
            new St.Label({styleClass}));
    }

    $bindSettings(set) {
        this.$set = set.attach({
            autoHide:  [Field.ATHD, 'uint'],
            leftCmd:   [Field.LCMD, 'string'],
            rightCmd:  [Field.RCMD, 'string'],
            hideTitle: [Field.HDTT, 'boolean', x => view(!x, this.$text)],
        }, this);
    }

    $updateScrollAndDelay() {
        let [,, w, h] = this.get_preferred_size(),
            theme = this.view.get_theme_node(),
            limit = theme.get_max_height();
        if(limit <= 0) limit = getDisplay().at(1) * 15 / 32;
        let scroll = h >= limit;
        let count = scroll ? w * limit / (Clutter.Settings.get_default().fontDpi / 1024 * theme.get_font().get_size() / 1024 / 72) ** 2
            : [...this.$info.get_text()].reduce((p, x) => p + (GLib.unichar_iswide(x) ? 2 : GLib.unichar_iszerowidth(x) ? 0 : 1), 0);
        this.$delay = Math.clamp(this.autoHide * count / 36, 1000, 20000);
        this.view.vscrollbarPolicy = scroll ? St.PolicyType.ALWAYS : St.PolicyType.NEVER; // HACK: workaround for trailing lines with default policy (AUTOMATIC)
        this.view.vadjustment.set_value(0);
    }

    $onClick(_a, event) {
        switch(event.get_button()) {
        case Clutter.BUTTON_MIDDLE: copy(this.$info.get_text().trimStart()); break;
        case Clutter.BUTTON_PRIMARY: if(this.leftCmd) execute(this.leftCmd, {LDWORD: this.$txt}).catch(noop); break;
        case Clutter.BUTTON_SECONDARY: if(this.rightCmd) execute(this.rightCmd, {LDWORD: this.$txt}).catch(noop); this.dispel(); break;
        }
    }

    setError(error) {
        if(xnor(this.$error, error)) return;
        if((this.$error = error)) this.view.add_style_pseudo_class('state-error');
        else this.view.remove_style_pseudo_class('state-error');
    }

    summon(info, text, error) {
        this.$txt = text;
        this.setError(error);
        info ||= lot(Kaomojis);
        if(offstage(this)) Main.layoutManager.addTopChrome(this);
        try {
            Pango.parse_markup(info, -1, '');
            // HACK: workaround for https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/1125
            this.$info.clutterText.set_markup(info.startsWith('<') ? ` ${info}` : info);
        } catch(e) {
            this.$info.set_text(info);
        }
        if(this.$text.visible) this.$text.set_text(text);
        this.$updateScrollAndDelay();
        this.open(BoxPointer.PopupAnimation.NONE);
        this.$src.hide.revive(this.autoHide);
    }

    dispel() {
        if(offstage(this)) return;
        this.$src.hide.dispel();
        this.prect = [...this.get_transformed_position(), ...this.get_transformed_size()];
        this.close(BoxPointer.PopupAnimation.FADE);
        Main.layoutManager.removeChrome(this);
    }
}

class DictAct extends Mortal {
    constructor(set) {
        super();
        this.$buildWidgets(set);
        this.$bindSettings();
    }

    $buildWidgets(set) {
        this.$set = set;
        this.$src = Source.fuse({
            cancel: Source.newCancel(),
            tray: new Source(() => this.$genSystray()),
            keys: Source.newKeys(this.$set.gset, Field.KEYS, () => this.invokeOCR()),
            dwell: Source.newTimer(() => [() => this.$dwell(getPointer()), 300], false),
            invoke: new Source(() => { DBusChecker._isSenderAllowed = this.$checkInvoker.bind(this); },
                () => { DBusChecker._isSenderAllowed = DBusSenderChecker.prototype._isSenderAllowed.bind(DBusChecker); }),
            stroke: new Source(x => x.split(/\s+/).map((y, i) => setTimeout(() => this.$stroke(y.split('+')), i * 100)),
                x => x?.splice(0).forEach(clearTimeout)),
            kbd: new Source(() => Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE),
                x => x?.run_dispose(), true), // NOTE: run_dispose to release keys immediately
        }, this);
        this.$tty = new Gio.SubprocessLauncher({flags: PIPE});
        this.$tty.spawnv = x => seq(p => { this.$pid = parseInt(p.get_identifier()); }, Gio.SubprocessLauncher.prototype.spawnv.call(this.$tty, x));
    }

    $stroke(keys) {
        let kbd = this.$src.kbd.hub;
        keys.forEach(k => kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.PRESSED));
        keys.reverse().forEach(k => kbd.notify_keyval(Clutter.get_current_event_time() * 1000, keyval(k), Clutter.KeyState.RELEASED));
    }

    $dwell(pos) {
        if(still(this.pos, pos) && !still(this.pos, this.ppos)) this.emit('dict-act-dwelled', pos[2], this.ppos);
        [this.ppos, this.pos] = [this.pos, pos];
    }

    $bindSettings() {
        this.$set.attach({
            ocrParam: [Field.OCRP, 'string'],
            ocrMode:  [Field.OCRS, 'uint', x => this.$menu?.ocr.setChosen(x)],
        }, this, () => this.$onOcrArgsPut()).attach({
            ocrKeys:   [Field.KEY,  'boolean'],
            ocrDwell:  [Field.DOCR, 'boolean', x => this.$onOcrDwellSet(x)],
            enableOcr: [Field.OCR,  'boolean', x => view(x, this.$menu?.ocr, this.$menu?.dwell)],
        }, this, () => this.$onOcrEnablePut()).attach({
            trigger: [Field.TRG, 'uint', x => this.$menu?.trigger.setChosen(x)],
            passive: [Field.PSV, 'uint', x => !!x, x => this.$menu?.passive.setToggleState(x)],
        }, this, () => this.$src.tray.hub?.$icon.setIcon(this.$icon), true).attach({
            cmds: [Field.SCMDS, 'value',   x => this.$onCommandsSet(x)],
            cmd:  [Field.SCMD,  'int',     x => this.$menu?.cmds.setChosen(x)],
            tray: [Field.STRY,  'boolean', x => this.$src.tray.toggle(x)],
        }, this);
    }

    get $icon() {
        return `ld-${Triggers[this.trigger]}-${this.passive ? 'passive' : 'proactive'}-symbolic`;
    }

    get $menu() {
        return this.$src.tray.hub?.$menu;
    }

    $genSystray() {
        let ocr = {visible: this.enableOcr};
        let btn = new Systray({
            dwell:   new SwitchItem(_('Dwell OCR'), this.ocrDwell, x => this.$set.set('ocrDwell', x, this), null, ocr),
            passive: new SwitchItem(_('Passive mode'), this.passive, x => this.$set.set('passive', x ? 1 : 0, this)),
            sep1:    new PopupMenu.PopupSeparatorMenuItem(),
            trigger: new RadioItem(_('Trigger'), omap(Trigger, ([k, v]) => [[v, _(capitalize(k))]]), this.trigger, x => this.$set.set('trigger', x, this)),
            cmds:    new RadioItem(_('Swift'), this.cmds.map(x => x.name), this.cmd, x => this.$set.set('cmd', x, this)),
            ocr:     new RadioItem(_('OCR'), omap(OCRMode, ([k, v]) => [[v, _(capitalize(k))]]), this.ocrMode, x => this.$set.set('ocrMode', x, this), ocr),
            sep2:    new PopupMenu.PopupSeparatorMenuItem(),
            prefs:   new MenuItem(_('Settings'), () => myself().openPreferences()),
        }, this.$icon);
        this.$setBusyState(btn, this.ocrDwell);
        btn.add_style_class_name('light-dict-systray');
        btn.connect('scroll-event', (_a, event) => {
            switch(event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP: this.$set.set('trigger', (this.trigger + 1) % 2, this); break;
            case Clutter.ScrollDirection.DOWN: this.$set.set('passive', this.passive ? 0 : 1, this); break;
            }
        });
        return btn;
    }

    $setBusyState(actor, busy) {
        if(busy) actor.add_style_pseudo_class('state-busy');
        else actor.remove_style_pseudo_class('state-busy');
    }

    $onOcrDwellSet(ocrDwell) {
        if(!this.$src.tray.active) return;
        this.$menu.dwell.setToggleState(ocrDwell);
        this.$setBusyState(this.$src.tray.hub, ocrDwell);
    }

    $onCommandsSet(commands) {
        return seq(x => homolog(this.cmds, x, ['name']) || this.$menu?.cmds.setOptions(x.map(c => c.name)),
            commands.recursiveUnpack());
    }

    $onOcrEnablePut() {
        this.ppos = this.pos = this.ocrDwell ? getPointer() : null;
        this.$src.dwell.toggle(this.ocrDwell && this.enableOcr);
        this.$src.keys.toggle(this.ocrKeys && this.enableOcr);
    }

    $onOcrArgsPut() {
        this.$ocrCmd = `python ${ROOT}/ldocr.py -m ${OCRModes[this.ocrMode]} ${this.ocrParam}`;
    }

    async $checkInvoker(sender) {
        let pid = await Gio.DBus.session.call('org.freedesktop.DBus', '/', 'org.freedesktop.DBus',
            'GetConnectionUnixProcessID', pickle([sender]), null, Gio.DBusCallFlags.NONE, -1, null);
        return this.$pid === pid.deepUnpack().at(0);
    }

    getCommand(name) {
        return (name ? this.cmds.find(x => x.name === name) : this.cmds[this.cmd]) ?? this.cmds[0];
    }

    invokeOCR(override) {
        if(!this.enableOcr || this.$src.invoke.active) return;
        this.$src.invoke.summon();
        this.execute(override ? `${this.$ocrCmd} ${override}` : this.$ocrCmd).catch(noop)
            .finally(() => { delete this.$pid; this.$src.invoke.dispel(); });
    }

    stroke(keys) {
        this.$src.stroke.revive(keys);
    }

    commit(string) {
        let InputSourceManager = Keyboard.getInputSourceManager();
        if(InputSourceManager.currentSource.type !== Keyboard.INPUT_SOURCE_TYPE_IBUS) Main.inputMethod.commit(string); // TODO: not tested
        else InputSourceManager._ibusManager._panelService?.commit_text(IBus.Text.new_from_string(string));
    }

    execute(cmd, env) {
        return execute(cmd, env, this.$src.cancel.reborn(), this.$tty);
    }
}

class LightDict extends Mortal {
    constructor(gset) {
        super();
        this.$buildWidgets(gset);
        this.$bindSettings();
    }

    $bindSettings() {
        this.$set.attach({
            filter:    [Field.TFLT, 'string'],
            appList:   [Field.APPS, 'string'],
            listType:  [Field.APP,  'uint'],
            textStrip: [Field.TSTP, 'boolean'],
        }, this);
    }

    $buildWidgets(gset) {
        this.$lck = {dwell: [], select: []};
        this.$set = new Setting(null, gset, this);
        this.$src = Source.fuse({
            box: new DictBox(this.$set),
            ptr: new Clutter.Actor({opacity: 0, x: 1, y: 1}), // HACK: init pos to avoid misplacing at the first occurrence
            act: hook({'dict-act-dwelled': this.$onDwell.bind(this)}, new DictAct(this.$set)),
            bar: hook({'dict-bar-clicked': (_a, x) => { this.$lck.dwell[0] = true; this.runCmd(x); }}, new DictBar(this.$set)),
            dbus: Source.newDBus(LD_IFACE, '/org/gnome/Shell/Extensions/LightDict', this, true),
            hold: Source.newTimer(x => [() => this.$onButtonHold(x), 50], false),
            wait: new Source(() => this.$genSpinner()),
        }, this);
        connect(this, global.display.get_selection(), 'owner-changed', this.$onSelect.bind(this),
            global.display, 'notify::focus-window', () => { this.dispelAll(); this.$syncApp(); });
        Main.uiGroup.add_child(this.$src.ptr);
        this.$syncApp();
    }

    $genSpinner() {
        let spinner = new Spinner(16);
        spinner.add_style_class_name('light-dict-view');
        Main.layoutManager.addTopChrome(spinner);
        let [x, y] = getPointer();
        let s = Meta.prefs_get_cursor_size() >>> 1;
        spinner.set_position(x + s, y + s);
        spinner.play();
        return spinner;
    }

    $onButtonHold(mdf) {
        if((mdf ^ getPointer().at(2)) !== Clutter.ModifierType.BUTTON1_MASK) return;
        this.$src.hold.dispel();
        this.run().catch(noop);
    }

    setCursor(area) {
        this.dispelAll();
        let [x, y, w, h] = area && area[3] < getDisplay().at(1) / 2 ? area
            : (s => (([a, b], c, d) => [a - c, b - c, d, d])(getPointer(), s / 2, s * 1.15))(Meta.prefs_get_cursor_size());
        this.center = area && w > 250;
        this.$src.ptr.set_position(x, y);
        this.$src.ptr.set_size(w, h);
    }

    $syncApp() {
        this.app = (w => w ? Shell.WindowTracker.get_default().get_window_app(w)?.get_id() ?? '' : '')(getFocused());
    }

    $denyApp() {
        return this.appList && xnor(this.listType, this.appList.includes(this.app));
    }

    $denyMdf(mdf) {
        return this.$src.act.passive && !(mdf & Clutter.ModifierType.MOD1_MASK);
    }

    $onDwell(_a, mdf, ppos) {
        let {box, bar, act} = this.$src;
        if(this.$lck.dwell.pop() || box.prect && !outside(box.prect, ppos) || act.ocrMode === OCRMode.AREA ||
           box.visible && box.view.hover || bar.visible && bar.box.hover || this.$denyMdf(mdf)) return;
        act.invokeOCR('--quiet');
    }

    dispelAll() {
        this.$src.box.dispel();
        this.$src.bar.dispel();
    }

    $onSelect(_s, type) {
        if(type !== St.ClipboardType.PRIMARY) return;
        this.$src.hold.dispel();
        let mdf = getPointer().at(2);
        if(this.$lck.select.pop() || this.$denyApp() || this.$denyMdf(mdf) || this.$src.act.trigger === Trigger.DISABLE) return;
        if(mdf & Clutter.ModifierType.BUTTON1_MASK) this.$src.hold.summon(mdf);
        else this.run().catch(noop);
    }

    $postRun(output, result) {
        if(result & Result.SHOW) this.display(output);
        if(result & Result.COPY) copy(output);
        if(result & Result.SELECT) copy(output, true);
        if(result & Result.COMMIT) this.$src.act.commit(output);
    }

    async $runSh({command, result}) {
        let env = {LDWORD: this.txt, LDAPPID: this.app};
        if(result) {
            try {
                if(result & Result.AWAIT) {
                    this.$src.wait.toggle(true);
                    let stdout = await this.$src.act.execute(command, env);
                    this.$src.wait.toggle(false);
                    this.$postRun(stdout, result);
                } else {
                    this.$postRun(await this.$src.act.execute(command, env), result);
                }
            } catch(e) {
                this.$src.wait.toggle(false);
                if(!Source.cancelled(e)) this.display(e.message, true);
            }
        } else {
            execute(command, env).catch(logError);
        }
    }

    $runJS({command, result}) {
        try {
            let output = evaluate(command, {
                open, copy,
                LDWORD: this.txt,
                LDAPPID: this.app,
                key: x => this.$src.act.stroke(x),
                search: x => { Main.overview.show(); Main.overview.searchEntry.set_text(x); },
            });
            if(result) this.$postRun(String(output), result);
        } catch(e) {
            this.display(e.message, true);
        }
    }

    async runCmd(cmd) {
        cmd.type ? this.$runJS(cmd) : await this.$runSh(cmd);
    }

    select(text) {
        this.$lck.select[0] = true;
        copy(text, true);
    }

    async swift(name) {
        let cmd = this.$src.act.getCommand(name);
        if(allowed(cmd, this.app, this.txt)) await this.runCmd(cmd);
    }

    popup() {
        this.$src.bar.setPosition(this.$src.ptr, 1 / 2);
        this.$src.bar.summon(this.app, this.txt);
    }

    display(info, error) {
        this.$src.box.setPosition(this.$src.ptr, this.center ? 1 / 2 : 1 / 10);
        this.$src.box.summon(info, this.txt, error);
    }

    store(text) {
        if(this.textStrip) text = text?.replace(/((?<=^)|(?<=\n))\s*(\n|$(?![\r\n]))/gm, '');
        if(!text) throw Error('empty');
        this.txt = text;
    }

    async run() {
        let text = await paste(true);
        if(this.$src.act.passive || !regexTest(this.filter, text, false)) this.$run('auto', text);
    }

    async $run(type, text, info, area) {
        this.setCursor(area);
        let [kind, name] = type === 'auto' ? [Triggers[this.$src.act.trigger]] : type.split(':');
        this.store(text || (kind === 'display' ? 'Oops' : await paste(true)));
        switch(kind) {
        case 'swift':   await this.swift(name); break;
        case 'popup':   this.popup(); break;
        case 'display': this.display(info, !text); break;
        }
    }

    async RunAsync([type, text, info, area], invocation) {
        await this.$run(type, text, info, area.length === 4 ? area : null).catch(noop);
        invocation.return_value(null);
    }

    async GetAsync([props], invocation) {
        try {
            await DBusChecker.checkInvocation(invocation);
            invocation.return_value(new GLib.Variant('(aai)', [props.map(x => {
                switch(x) {
                case 'display': return getDisplay();
                case 'pointer': return getPointer().slice(0, 2);
                case 'focused': return (r => r ? [r.x, r.y, r.width, r.height] : null)(getFocused()?.get_frame_rect?.());
                default: throw Error(`Unknown property: ${x}`);
                }
            })]));
        } catch(e) {
            if(e instanceof GLib.Error) invocation.return_gerror(e);
            else invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, e.message);
        }
    }

    OCR(args) {
        this.$src.act.invokeOCR(args);
    }
}

export default class MyExtension extends Extension { $klass = LightDict; }
