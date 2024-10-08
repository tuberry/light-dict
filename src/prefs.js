// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import * as Util from './util.js';
import {Field, Result} from './const.js';

const {_}  = UI;
const EXE = 'application/x-executable';

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');

class AppItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: UI.trait({
                selected: ['boolean', false],
                app: ['object', Gio.DesktopAppInfo],
            }),
        }, this);
    }

    constructor(app) {
        super();
        this.app = app;
        this.toggle = () => { this.selected = !this.selected; };
    }
}

class AppLabel extends UI.IconLabel {
    static {
        GObject.registerClass(this);
    }

    constructor(...args) {
        super(...args);
        this.append(this.$check = new Gtk.Image({iconName: 'object-select-symbolic'}));
    }
}

class AppsDialog extends UI.AppDialog {
    static {
        GObject.registerClass(this);
    }

    $buildWidgets(opts) {
        let factory = Util.hook({
                setup: (_f, x) => x.set_child(new AppLabel('application-x-executable-symbolic')),
                bind: (_f, {child, item}) => {
                    UI.Broker.tie(item, 'selected', child.$check, 'visible');
                    child.setup(item.app.get_icon(), item.app.get_display_name());
                },
                unbind: (_f, {child, item}) => UI.Broker.untie(item, child.$check),
            }, new Gtk.SignalListItemFactory()),
            filter = Gtk.CustomFilter.new(null),
            model = new Gio.ListStore({itemType: AppItem}),
            select = new Gtk.SingleSelection({model: new Gtk.FilterListModel({model, filter})}),
            content = Util.hook({activate: () => select.get_selected_item().toggle()},
                new Gtk.ListView({singleClickActivate: true, model: select, factory, vexpand: true}));
        if(opts?.noDisplay) model.splice(0, 0, Gio.AppInfo.get_all().map(x => new AppItem(x)));
        else model.splice(0, 0, Gio.AppInfo.get_all().filter(x => x.should_show()).map(x => new AppItem(x)));
        this.getSelected = () => [...model].filter(x => x.selected).map(x => x.app.get_id()).join(',');
        this.initSelected = s => [...model].forEach(x => { x.selected = s.has(x.app.get_id()); });
        filter.set_search = s => filter.set_filter_func(s ? (a => x => a.has(x.app.get_id()))(new Set(Gio.DesktopAppInfo.search(s).flat())) : null);
        return {content, filter};
    }
}

class Apps extends UI.DialogButtonBase {
    static {
        GObject.registerClass(this);
    }

    constructor(tip1, tip2, param) {
        super(null, param, null);
        if(tip2) this.$btn.set_tooltip_text(tip2);
        this.$btn.set_icon_name('list-add-symbolic');
        this.$box = new UI.Box(null, {hexpand: true, canFocus: false, tooltipText: tip1 || ''});
        this.prepend(new Gtk.ScrolledWindow({child: this.$box, vexpand: false, cssName: 'entry', vscrollbarPolicy: Gtk.PolicyType.NEVER}));
        this.value = '';
    }

    $genDialog() {
        return new AppsDialog();
    }

    $genApp(id) {
        let app = Gio.DesktopAppInfo.new(id);
        return Util.hook({clicked: () => { this.$gvalue.delete(id); this.value = [...this.$gvalue].join(','); }}, app
            ? new Gtk.Button({child: new Gtk.Image({gicon: app.get_icon()}), tooltipText: app.get_display_name(), hasFrame: false})
            : new Gtk.Button({iconName: 'system-help-symbolic', tooltipText: id, hasFrame: false}));
    }

    $onClick() {
        return this.dlg.choose_sth(this.get_root(), this.$gvalue);
    }

    $setValue(value) {
        this.$value = value;
        this.$gvalue = new Set(value ? value.split(',') : null);
        if(this.$box) [...this.$box].forEach(x => this.$box.remove(x));
        if(this.$value) this.$gvalue.forEach(x => this.$box.append(this.$genApp(x)));
    }
}

class SideItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: UI.trait({
                cmd: ['jsobject', null],
                enable: ['boolean', false],
            }),
        }, this);
    }

    constructor(cmd, enable = false) {
        super();
        this.cmd = cmd;
        this.enable = enable;
    }

    change(key, value) {
        if(value) this.cmd[key] = value;
        else delete this.cmd[key];
    }
}

class SideRow extends Gtk.ListBoxRow {
    static {
        GObject.registerClass({
            Signals: {
                dropped: {param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT]},
                changed: {param_types: [GObject.TYPE_UINT, GObject.TYPE_STRING]},
                toggled: {param_types: [GObject.TYPE_UINT, GObject.TYPE_BOOLEAN]},
            },
        }, this);
    }

    constructor(item, group, param) {
        super({hexpand: false, ...param});
        this.$grp = group;
        this.$btn = Util.hook({toggled: () => this.emit('toggled', this.get_index(), this.$btn.active)},
            new UI.Check({group: group ? new UI.Check() : null}));
        this.$txt = Util.hook({changed: () => !this.$txt.editing && this.emit('changed', this.get_index(), this.$txt.text)},
            new Gtk.EditableLabel({maxWidthChars: 9}));
        this.$img = new Gtk.Image({iconName: 'list-drag-handle-symbolic'});
        this.set_child(new UI.Box([this.$btn, this.$txt, this.$img], {spacing: 5, marginEnd: 5}));
        this.$txt.get_delegate().connect('activate', () => this.emit('changed', this.get_index(), this.$txt.text));
        item.bind_property_full('cmd', this.$txt, 'text', GObject.BindingFlags.SYNC_CREATE, (_b, v) => [true, v.name], null);
        if(group) item.bind_property('enable', this.$btn, 'active', GObject.BindingFlags.SYNC_CREATE);
        else item.bind_property_full('cmd', this.$btn, 'active', GObject.BindingFlags.SYNC_CREATE, (_b, v) => [true, !!v.enable], null);
        this.$buildDND(item, this.$img);
    }

    $buildDND(item, handle) {
        // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        handle.add_controller(Util.hook({
            prepare: () => Gdk.ContentProvider.new_for_value(this),
            drag_begin: (_s, drag) => {
                let {width: widthRequest, height: heightRequest} = this.get_allocation();
                let row = new SideRow(item, this.$grp ? new UI.Check() : null, {widthRequest, heightRequest, cssClasses: ['ld-dragging']});
                Gtk.DragIcon.get_for_drag(drag).set_child(row);
                drag.set_hotspot(widthRequest - this.$img.get_width() / 2, heightRequest - this.$img.get_height() / 2);
            },
        }, new Gtk.DragSource({actions: Gdk.DragAction.MOVE})));
        this.add_controller(Util.hook({
            motion: (_t, _x, y) => {
                let top = y < this.get_height() / 2;
                this.add_css_class(top ? 'ld-drop-top' : 'ld-drop-bottom');
                this.remove_css_class(top ? 'ld-drop-bottom' : 'ld-drop-top');
                return Gdk.DragAction.MOVE;
            },
            drop: (_t, src, _x, y) => {
                this.#clearDropStyle();
                if(src.$grp !== this.$grp) return false;
                let drag = src.get_index(),
                    target = this.get_index() + (y > this.get_height() / 2),
                    drop = target > drag ? target - 1 : target;
                if(drag === drop) return false;
                this.emit('dropped', drag, drop);
                return true;
            },
            leave: () => this.#clearDropStyle(),
        }, Gtk.DropTarget.new(SideRow, Gdk.DragAction.MOVE)));
    }

    #clearDropStyle() {
        this.remove_css_class('ld-drop-top');
        this.remove_css_class('ld-drop-bottom');
    }

    editName() {
        this.$txt.grab_focus();
        this.$txt.start_editing();
    }
}

class ResultRows extends GObject.Object {
    static {
        GObject.registerClass(UI.val('uint', 0, GLib.MAXINT32, 0), this);
    }

    addToPane(group) {
        this.addToPane = null;
        [
            [Result.SHOW,  [_('S_how result')],   new UI.Switch()],
            [Result.COPY,  [_('Cop_y result')],   new UI.Switch()],
            [Result.AWAIT, [_('A_wait result'), _('Show a spinner when running')],  new UI.Switch()],
            [Result.SELECT, [_('Se_lect result')], new UI.Switch()],
            [Result.COMMIT, [_('Co_mmit result')], new UI.Switch()],
        ].forEach(([mask, titles, widget]) => {
            group.add(new UI.ActRow(titles, widget));
            this.bind_property_full('value', widget, 'active', Util.BIND, (_b, v) => (x => [x ^ widget.active, x])(!!(v & mask)),
                (_b, v) => [!!(this.value & mask) ^ v, this.value ^ mask]);
        });
    }
}

class PrefsBasic extends UI.PrefsPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this.#buildWidgets(gset);
        this.#buildUI();
    }

    #buildWidgets(gset) {
        this.$blk = UI.tie({
            KEY:  new UI.Check(),
            DOCR: new UI.Switch(),
            TITL: new UI.Switch(),
            STRY: new UI.Switch(),
            TIP:  new UI.Switch(),
            SPLC: new UI.Switch(),
            OCRP: new UI.Entry('-h'),
            TFLT: new UI.Entry('\\W'),
            PGSZ: new UI.Spin(1, 10, 1),
            ATHD: new UI.Spin(1000, 10000, 250),
            APPS: new Apps(_('Click the app icon to remove')),
            PSV:  new UI.Drop([_('Proactive'), _('Passive')]),
            APP:  new UI.Drop([_('Whitelist'), _('Blacklist')]),
            TRG:  new UI.Drop([_('Swift'), _('Popup'), _('Disable')]),
            OCRS: new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line'), _('Dialog')]),
            LCMD: new UI.Entry('notify-send "$LDWORD"', [EXE], _('Use env var LDWORD for the selected text')),
            RCMD: new UI.Entry('notify-send "$LDWORD"', [EXE], _('Use env var LDWORD for the selected text')),
            OCR:  new UI.FoldRow(_('O_CR'), _('Depends on <a href="https://pypi.org/project/opencv-python/">opencv-python</a> and <a href="https://pypi.org/project/pytesseract/">pytesseract</a>')),
        }, gset);
        this.$blk.KEYS = new UI.Keys({gset, key: Field.KEYS});
        this.$blk.HELP = new UI.Help('', {cssClasses: ['ld-popover'], useMarkup: false});
        Util.execute(`python ${Util.ROOT}/ldocr.py -h`).then(x => this.$blk.HELP.setup(x)).catch(e => this.$blk.HELP.setup(e.message, true));
    }

    #buildUI() {
        this.addActRows([
            [[_('Enable s_ystray'), _('Scroll to toggle the trigger style')], this.$blk.STRY],
            [[_('_Trigger style'), _('Passive means pressing Alt to trigger')], this.$blk.PSV, this.$blk.TRG],
            [[_('_App list')], this.$blk.APPS, this.$blk.APP],
        ]);
        [
            [this.$blk.KEY, [_('Sho_rtcut')], this.$blk.KEYS],
            [[_('_Dwell OCR')], this.$blk.DOCR],
            [[_('_Work mode')], this.$blk.OCRS],
            [[_('Other para_meters')], this.$blk.HELP, this.$blk.OCRP],
        ].forEach(xs => this.$blk.OCR.add_row(new UI.ActRow(...xs)));
        let genExpander = (param, ...xs) => Util.seq(x => xs.forEach(args => x.add_row(new UI.ActRow(...args))),
            new Adw.ExpanderRow({useUnderline: true, ...param}));
        [
            genExpander({title: _('_Other')},
                [[_('Sp_lice text'), _('Try to replace redundant line breaks with spaces')], this.$blk.SPLC],
                [[_('Autohide inter_val'), _('Unit: millisecond')], this.$blk.ATHD],
                [[_('RegE_xp filter')], this.$blk.TFLT]),
            genExpander({title: _('Pa_nel'), subtitle: _('Middle click to copy the result')},
                [[_('_Enable title')], this.$blk.TITL],
                [[_('Ri_ght command'), _('Right click to run and hide panel')], this.$blk.RCMD],
                [[_('Le_ft command'), _('Left click to run')], this.$blk.LCMD]),
            genExpander({title: _('Pop_up'), subtitle: _('Scroll to flip pages')},
                [[_('Enable toolt_ip')], this.$blk.TIP],
                [[_('Page si_ze')], this.$blk.PGSZ]),
            this.$blk.OCR,
        ].forEach(x => this.addToGroup(x));
    }
}

class PrefsPopup extends UI.PrefsPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset, key) {
        super(param);
        this.$save = (func, grab, name, pane) => {
            func(this.$cmds);
            gset.set_value(key, Util.pickle([...this.$cmds].map(x => x.cmd), false));
            if(grab >= 0) this.grabFocus(grab, name);
            if(pane) this.$updatePaneSensitive(this.$cmds.nItems > 0);
        };
        this.$buildUI(gset, key);
    }

    $buildUI(gset, key) {
        let pane = this.$genPane();
        let side = this.$genSide(gset.get_value(key).recursiveUnpack(), key === Field.SCMDS);
        this.addToGroup(new Gtk.Frame({child: new UI.Box([side, pane], {vexpand: false, cssName: 'list'})}));
        this.grabFocus(0);
    }

    $genSide(cmds, group) {
        this.$cmds = new Gio.ListStore({item_type: SideItem});
        this.$cmds.splice(0, 0, cmds.map(x => new SideItem(x)));
        this.$list = Util.hook({'row-selected': (_w, row) => row && this.$onSelect(row.get_index())},
            new Gtk.ListBox({selectionMode: Gtk.SelectionMode.SINGLE, vexpand: true}));
        this.$list.add_css_class('data-table');
        this.$list.bind_model(this.$cmds, item => Util.hook({
            dropped: (_w, f, t) => this.$onDrop(f, t),
            changed: (_w, p, v) => this.$onChange(p, 'name',  v),
            toggled: (_w, p, v) => this.$onChange(p, 'enable', v),
        }, new SideRow(item, group)));
        return new UI.Box([this.$genTools(), new Gtk.Separator(), new Gtk.ScrolledWindow({overlayScrolling: false, child: this.$list})],
            {valign: Gtk.Align.FILL, orientation: Gtk.Orientation.VERTICAL});
    }

    grabFocus(index, name) {
        let row = this.$list.get_row_at_index(index);
        this.$list.select_row(row);
        if(name) row.editName();
    }

    $genCmdHelp() {
        return new UI.Help(_(`<b>Bash</b>
please scrutinize your code as in a terminal
<b>JS</b>
<tt>open('URI')</tt>: open URI with default app
<tt>key('super+a')</tt>: simulate keyboard input
<tt>copy(LDWORD)</tt>: copy <tt>LDWORD</tt> to clipboard
<tt>search(LDWORD)</tt>: search <tt>LDWORD</tt> in Overview
other: some native functions like <tt>LDWORD.trim()</tt>`), {cssClasses: ['ld-popover']});
    }

    $genPaneWidgets() {
        return {
            command: ['', [_('_Run command')],    new UI.Entry('gio open "$LDWORD"', [EXE], _('Use (env) var LDWORD for the selected text'))],
            type:    [0,  [_('_Command type')],   new UI.Drop(['Bash', 'JS']), this.$genCmdHelp()],
            icon:    ['', [_('_Icon name')],      new UI.Icon()],
            result:  [0,  [],                     new ResultRows()],
            apps:    ['', [_('_App list')],       new Apps(_('Click the app icon to remove'), _('Whitelist'))],
            regexp:  ['', [_('RegE_xp matcher')], new UI.Entry('(https?|ftp|file)://.*')],
            tooltip: ['', [_('Ic_on tooltip')],   new UI.Entry('Open URL')],
        };
    }

    $genPane() {
        let pane = new Adw.PreferencesGroup({hexpand: true});
        this.$updatePaneSensitive = x => { if(!x) this.$onSelect(); pane.set_sensitive(x); };
        this.$pane = Util.omap(this.$genPaneWidgets(), ([key, [fallback, titles, widget, help]]) => {
            if(widget instanceof ResultRows) widget.addToPane(pane);
            else if(help) pane.add(new UI.ActRow(titles, help, widget));
            else pane.add(new UI.ActRow(titles, widget));
            widget.connect('notify::value', ({value}) => !this.$syncing && this.$select(p => this.$onChange(p, key, value)));
            widget.fallback = fallback;
            return [[key, widget]];
        });
        return pane;
    }

    $genTools() {
        return new UI.Box([
            ['list-add-symbolic',    _('Add'),    () => this.$onAdd()],
            ['list-remove-symbolic', _('Remove'), () => this.$select(p => this.$onRemove(p))],
            ['edit-copy-symbolic',   _('Copy'),   () => this.$select(p => this.$onCopy(p))],
            ['edit-paste-symbolic',  _('Paste'),  () => this.$onPaste()],
        ].map(([x, y, z]) => Util.hook({clicked: z}, new Gtk.Button({iconName: x, tooltipText: y, hasFrame: false}))));
    }

    get selected() {
        return this.$list.get_selected_row()?.get_index() ?? -1;
    }

    $select(callback) {
        let pos = this.selected;
        if(pos >= 0) callback(pos);
    }

    $onSelect(pos = this.selected) {
        this.$syncing = true;
        let cmd = pos < 0 ? {} : this.$cmds.get_item(pos).cmd;
        for(let k in this.$pane) this.$pane[k].value = cmd[k] ?? this.$pane[k].fallback;
        this.$syncing = false;
    }

    $onChange(pos, key, value) {
        this.$save(x => x.get_item(pos).change(key, value), key === 'enable' ? pos : -1);
    }

    $onAdd(cmd = {name: 'Name'}, pos = this.selected + 1) {
        this.$save(x => x.insert(pos, new SideItem(cmd)), pos, true, true);
    }

    $onDrop(drag, drop) {
        this.$save(x => { let item = x.get_item(drag); x.remove(drag); x.insert(drop, item); }, drop);
    }

    $onRemove(pos) {
        this.$save(x => { let item = x.get_item(pos); x.remove(pos); this.$toastRemove(item); }, Math.min(pos, this.$cmds.nItems - 2), false, true);
    }

    $toastRemove(item) {
        this.get_root().add_toast(Util.hook({'button-clicked': () => this.$save(x => x.append(item), this.$cmds.nItems, true, true)},
            new Adw.Toast({title: _('Removed <i>%s</i> command').format(item.cmd.name ?? ''), buttonLabel: UI._GTK('_Undo')})));
    }

    $onCopy(pos) {
        let {cmd} = this.$cmds.get_item(pos);
        this.get_clipboard().set(JSON.stringify(cmd));
        this.$toastInfo(_('Copied <i>%s</i> command').format(cmd.name ?? ''));
    }

    async $onPaste() {
        try {
            let cmd = JSON.parse(await this.get_clipboard().read_text_async(null));
            this.$onAdd(Util.omap(cmd, ([k, v]) => Util.has(this.$pane, k) || k === 'name' || k === 'enable' ? [[k, v]] : []));
        } catch(e) {
            this.$toastInfo(_('Failed to parse pasted command'));
        }
    }

    $toastInfo(title) {
        this.get_root().add_toast(new Adw.Toast({title, timeout: 5}));
    }
}

class PrefsSwift extends PrefsPopup {
    static {
        GObject.registerClass({
            Properties: UI.trait({
                enabled: ['int', -1, GLib.MAXINT32, -1],
            }),
        }, this);
    }

    constructor(param, gset, key) {
        super(param, gset, key);
        gset.bind(Field.SCMD, this, 'enabled', Gio.SettingsBindFlags.DEFAULT);
    }

    get enabled() {
        return this.$enabled;
    }

    set enabled(enabled) {
        if(this.$enabled === enabled) return;
        this.$enabled = enabled;
        [...this.$cmds].forEach((x, i) => { x.enable = i === enabled; });
        this.notify('enabled');
    }

    $genPaneWidgets() {
        let {icon: i_, tooltip: t_, ...widgets} = super.$genPaneWidgets();
        return widgets;
    }

    $onChange(pos, key, value) {
        if(key === 'enable') {
            if(!value) return;
            this.enabled = pos;
            this.grabFocus(pos);
        } else {
            super.$onChange(pos, key, value);
        }
    }

    $onAdd(cmd = {name: 'Name'}, pos = this.selected + 1) {
        delete cmd.enable;
        super.$onAdd(cmd, pos);
        if(this.enabled > pos) this.enabled += 1;
    }

    $onRemove(pos = this.selected) {
        super.$onRemove(pos);
        if(this.enabled > pos) this.enabled -= 1;
        else if(this.enabled === pos) this.enabled = -1;
    }

    $onDrop(drag, drop) {
        super.$onDrop(drag, drop);
        if(this.enabled > Math.max(drag, drop) || this.enabled < Math.min(drag, drop)) return;
        if(this.enabled > drag) this.enabled -= 1;
        else if(this.enabled === drag) this.enabled = drop;
        else this.enabled += 1;
    }
}

export default class Prefs extends UI.Prefs {
    fillPreferencesWindow(win) {
        let provider = new Gtk.CssProvider(); // Ref: https://gist.github.com/JMoerman/6f2fa1494847ce7b7044b99787ccc769
        provider.load_from_string(`:root { --abc: var(--accent-bg-color); --ac: var(--accent-color); }
.ld-popover { caret-color: var(--ac); }
.ld-dragging { background: color-mix(in srgb, var(--window-bg-color) 65%, transparent); color: var(--ac); border: 1px dashed var(--ac); border-radius: 4px; }
.ld-drop-top { background: linear-gradient(to bottom, color-mix(in srgb, var(--abc) 85%, transparent) 0%, color-mix(in srgb, var(--abc) 0, transparent) 35%); }
.ld-drop-bottom { background: linear-gradient(to bottom, color-mix(in srgb, var(--abc) 0, transparent) 65%, color-mix(in srgb, var(--abc) 85%, transparent) 100%); }`);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(`${Util.ROOT}/icons`);
        let gset = this.getSettings();
        [
            new PrefsBasic({title: _('_Basic'), iconName: 'ld-disable-passive-symbolic'}, gset),
            new PrefsSwift({title: _('_Swift'), iconName: 'ld-swift-passive-symbolic'}, gset, Field.SCMDS),
            new PrefsPopup({title: _('_Popup'), iconName: 'ld-popup-passive-symbolic'}, gset, Field.PCMDS),
        ].forEach(x => win.add(x));
    }
}
