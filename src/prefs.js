// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import {Field, Result} from './const.js';
import {ROOT, BIND, omap, noop, execute, pickle, hook, has, seq} from './util.js';

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');

const {_, _GTK, vprop, gprop, myself}  = UI;

class AppItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: gprop({
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
        this.append(this.$check = new Gtk.Image({icon_name: 'object-select-symbolic'}));
    }
}

class AppsDialog extends UI.AppDialog {
    static {
        GObject.registerClass(this);
    }

    $buildWidgets(opts) {
        let factory = hook({
                setup: (_f, x) => x.set_child(new AppLabel('application-x-executable-symbolic')),
                bind: (_f, {child, item}) => {
                    UI.Broker.bind(item, 'selected', child.$check, 'visible');
                    child.setContent(item.app.get_icon(), item.app.get_display_name());
                },
                unbind: (_f, {child, item}) => UI.Broker.unbind(item, child.$check),
            }, new Gtk.SignalListItemFactory()),
            filter = Gtk.CustomFilter.new(null),
            model = new Gio.ListStore({item_type: AppItem}),
            select = new Gtk.SingleSelection({model: new Gtk.FilterListModel({model, filter})}),
            content = hook({activate: () => select.get_selected_item().toggle()},
                new Gtk.ListView({single_click_activate: true, model: select, factory, vexpand: true}));
        if(opts?.no_display) Gio.AppInfo.get_all().forEach(x => model.append(new AppItem(x)));
        else Gio.AppInfo.get_all().filter(x => x.should_show()).forEach(x => model.append(new AppItem(x)));
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
        super(param, null);
        if(tip2) this.$btn.set_tooltip_text(tip2);
        this.$btn.set_icon_name('list-add-symbolic');
        this.$box = new UI.Box(null, {hexpand: true, can_focus: false, tooltip_text: tip1 || ''});
        this.prepend(new Gtk.ScrolledWindow({child: this.$box, vexpand: false, css_name: 'entry', vscrollbar_policy: Gtk.PolicyType.NEVER}));
        this.value = '';
    }

    $genDialog() {
        return new AppsDialog();
    }

    $genApp(id) {
        let app = Gio.DesktopAppInfo.new(id);
        return hook({clicked: () => { this.$gvalue.delete(id); this.value = [...this.$gvalue].join(','); }}, app
            ? new Gtk.Button({child: new Gtk.Image({gicon: app.get_icon()}), tooltip_text: app.get_display_name(), has_frame: false})
            : new Gtk.Button({icon_name: 'help-browser-symbolic', tooltip_text: id, has_frame: false}));
    }

    $onClick() {
        return this.dlg.choose_sth(this.get_root(), this.$gvalue);
    }

    $setValue(v) {
        this.$value = v;
        this.$gvalue = new Set(v ? v.split(',') : null);
        if(this.$box) [...this.$box].forEach(x => this.$box.remove(x));
        if(this.$value) this.$gvalue.forEach(x => this.$box.append(this.$genApp(x)));
    }
}

class SideItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: gprop({
                cmd: ['jsobject', null],
                enable: ['boolean', false],
            }),
        }, this);
    }

    constructor(cmd, enable = false) {
        super();
        this.cmd = cmd;
        this.enable = enable;
        this.copy = () => new SideItem({...this.cmd}, this.enable);
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
        this.$btn = hook({toggled: () => this.emit('toggled', this.get_index(), this.$btn.active)},
            new UI.Check({group: group ? new UI.Check() : null}));
        this.$txt = hook({changed: () => !this.$txt.editing && this.emit('changed', this.get_index(), this.$txt.text)},
            new Gtk.EditableLabel({max_width_chars: 9}));
        this.$img = new Gtk.Image({icon_name: 'open-menu-symbolic'});
        this.set_child(new UI.Box([this.$btn, this.$txt, this.$img], {spacing: 5, margin_end: 5}));
        this.$txt.get_delegate().connect('activate', () => this.emit('changed', this.get_index(), this.$txt.text));
        item.bind_property_full('cmd', this.$txt, 'text', GObject.BindingFlags.SYNC_CREATE, (_b, v) => [true, v.name], null);
        if(group) item.bind_property('enable', this.$btn, 'active', GObject.BindingFlags.SYNC_CREATE);
        else item.bind_property_full('cmd', this.$btn, 'active', GObject.BindingFlags.SYNC_CREATE, (_b, v) => [true, !!v.enable], null);
        this.$buildDND(item, this.$img);
    }

    $buildDND(item, handle) {
        // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        handle.add_controller(hook({
            prepare: () => Gdk.ContentProvider.new_for_value(this),
            drag_begin: (_s, drag) => {
                let {width: width_request, height: height_request} = this.get_allocation();
                let row = new SideRow(item, this.$grp ? new UI.Check() : null, {width_request, height_request, css_name: 'ld-dragging'});
                Gtk.DragIcon.get_for_drag(drag).set_child(row);
                drag.set_hotspot(width_request - this.$img.get_width() / 2, height_request - this.$img.get_height() / 2);
            },
        }, new Gtk.DragSource({actions: Gdk.DragAction.MOVE})));
        this.add_controller(hook({
            motion: (_t, _x, y) => {
                let top = y < this.get_height() / 2;
                this.add_css_class(top ? 'ld-drop-top' : 'ld-drop-bottom');
                this.remove_css_class(top ? 'ld-drop-bottom' : 'ld-drop-top');
                return Gdk.DragAction.MOVE;
            },
            drop: (_t, src, _x, y) => {
                this.$clearDropStyle();
                if(src.$grp !== this.$grp) return false;
                let drag = src.get_index(),
                    target = this.get_index() + (y > this.get_height() / 2),
                    drop = target > drag ? target - 1 : target;
                if(drag === drop) return false;
                this.emit('dropped', drag, drop);
                return true;
            },
            leave: () => this.$clearDropStyle(),
        }, Gtk.DropTarget.new(SideRow, Gdk.DragAction.MOVE)));
    }

    $clearDropStyle() {
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
        GObject.registerClass(vprop('uint', 0, GLib.MAXINT32, 0), this);
    }

    addToPane(group) {
        this.addToPane = null;
        [
            [Result.SHOW,   _('Show result'),   new UI.Switch()],
            [Result.COPY,   _('Copy result'),   new UI.Switch()],
            [Result.AWAIT,  _('Await result'),  new UI.Switch()],
            [Result.SELECT, _('Select result'), new UI.Switch()],
            [Result.COMMIT, _('Commit result'), new UI.Switch()],
        ].forEach(([mask, description, widget]) => {
            group.add(new UI.PrefRow([description], widget));
            this.bind_property_full('value', widget, 'active', BIND, (_b, v) => (x => [x ^ widget.active, x])(!!(v & mask)),
                (_b, v) => [!!(this.value & mask) ^ v, this.value ^ mask]);
        });
    }
}

class PrefsAbout extends UI.PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this.addToGroup(new UI.Box([this.$genIcons(gset), this.$genInfo(), this.$genTips(), new Gtk.Box({vexpand: true}),
            this.$genLicense()], {orientation: Gtk.Orientation.VERTICAL, margin_top: 30, margin_bottom: 30, valign: Gtk.Align.FILL}, false));
    }

    $genIcons(gset) {
        return new UI.Box(gset.get_value(Field.PCMDS)
            .recursiveUnpack()
            .slice(0, gset.get_uint(Field.PGSZ))
            .flatMap(({icon}) => icon ? [icon] : [])
            .reduce((p, x, i) => Object.assign(p, {[i]: x}), ['accessories-dictionary-symbolic'])
            .map(icon_name => new Gtk.Image({icon_name, icon_size: Gtk.IconSize.LARGE})),
        {halign: Gtk.Align.CENTER, margin_bottom: 30}, false);
    }

    $genLabel(label) {
        return new Gtk.Label({label, wrap: true, use_markup: true, justify: Gtk.Justification.CENTER});
    }

    $genInfo() {
        let {name, version, url} = myself().metadata;
        return this.$genLabel([
            `<b><big>${name}</big></b>`,
            _('Version %d').format(version),
            _('Lightweight extension for on-the-fly manipulation to primary selections, especially optimized for Dictionary lookups.'),
            `<span><a href="${url}">${_GTK('Website')}\n</a></span>`,
        ].join('\n\n'));
    }

    $genTips() {
        return new Gtk.MenuButton({
            popover: new Gtk.Popover({
                child: new UI.Box([
                    _('Get the selected text via the <b>LDWORD</b> (environment) variable'),
                    _('Leave RegExp/App list blank for no such restriction'),
                    _('Middle click the panel to copy the result to clipboard'),
                    _('Simulate keyboard input in JS statement: <tt>key("ctrl+c")</tt>'),
                    _('Visit the <u>website</u> above for more information and support'),
                ].map((x, i) => new Gtk.Label({halign: Gtk.Align.START, use_markup: true, label: `${i}. ${x}`})),
                {spacing: 2, orientation: Gtk.Orientation.VERTICAL}, false),
            }),
            label: _('Tips'), halign: Gtk.Align.CENTER, direction: Gtk.ArrowType.NONE,
        });
    }

    $genLicense() {
        let url = 'https://www.gnu.org/licenses/gpl-3.0.html',
            gpl = 'GNU General Public License, version 3 or later',
            info = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.';
        return this.$genLabel(`<small>\n\n${_GTK(info).format(url, _GTK(gpl))}</small>`);
    }
}

class PrefsBasic extends UI.PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this.$buildWidgets(gset);
        this.$buildUI();
    }

    $buildWidgets(gset) {
        this.$blk = UI.block({
            KEY:  new UI.Check(),
            DOCR: new UI.Switch(),
            HDTT: new UI.Switch(),
            STRY: new UI.Switch(),
            TIP:  new UI.Switch(),
            TSTP: new UI.Switch(),
            OCRP: new UI.LazyEntry(),
            PGSZ: new UI.Spin(1, 10, 1),
            ATHD: new UI.Spin(1000, 10000, 250),
            LCMD: new UI.LazyEntry('notify-send "$LDWORD"'),
            RCMD: new UI.LazyEntry('notify-send "$LDWORD"'),
            TFLT: new UI.LazyEntry('^[^\\n\\.\\t/,{3,50}$'),
            APPS: new Apps(_('Click the app icon to remove')),
            PSV:  new UI.Drop([_('Proactive'), _('Passive')]),
            APP:  new UI.Drop([_('Allowlist'), _('Blocklist')]),
            TRG:  new UI.Drop([_('Swift'), _('Popup'), _('Disable')]),
            OCRS: new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line'), _('Dialog')]),
            OCR:  new UI.FoldRow(_('OCR'), _('Depends on python-opencv and python-pytesseract')),
        }, gset);
        this.$blk.KEYS = new UI.Keys({gset, key: Field.KEYS});
        this.$blk.HELP = new Gtk.MenuButton({label: _('Parameters'), direction: Gtk.ArrowType.NONE, valign: Gtk.Align.CENTER});
        this.$genHelpPopover().then(scc => this.$blk.HELP.set_popover(scc)).catch(noop);
    }

    $buildUI() {
        [
            [this.$blk.KEY, [_('Shortcut')], this.$blk.KEYS],
            [[_('Dwell OCR')], this.$blk.DOCR],
            [[_('Work mode')], this.$blk.OCRS],
            [this.$blk.HELP, [], this.$blk.OCRP],
        ].forEach(xs => this.$blk.OCR.add_row(new UI.PrefRow(...xs)));
        [
            [[_('Enable systray')], this.$blk.STRY],
            [[_('Trigger style'), _('Passive means that pressing Alt to trigger')], this.$blk.PSV, this.$blk.TRG],
            [[_('App list')], this.$blk.APPS, this.$blk.APP],
        ].forEach(xs => this.addToGroup(new UI.PrefRow(...xs)));
        [
            this.$genExpander(_('Other'),
                [[_('Trim blank lines')], this.$blk.TSTP],
                [[_('Autohide interval')], this.$blk.ATHD],
                [[_('RegExp filter')], this.$blk.TFLT]),
            this.$genExpander(_('Panel'),
                [[_('Hide title')], this.$blk.HDTT],
                [[_('Right command'), _('Right click to run and hide panel')], this.$blk.RCMD],
                [[_('Left command'), _('Left click to run')], this.$blk.LCMD]),
            this.$genExpander(_('Popup'),
                [[_('Enable tooltip')], this.$blk.TIP],
                [[_('Page size')], this.$blk.PGSZ]),
            this.$blk.OCR,
        ].forEach(x => this.addToGroup(x));
    }


    $genExpander(title, ...list) {
        return seq(x => list.forEach(args => x.add_row(new UI.PrefRow(...args))), new Adw.ExpanderRow({title}));
    }

    async $genHelpPopover() {
        try {
            let label = await execute(`python ${ROOT}/ldocr.py -h`);
            return new Gtk.Popover({child: new Gtk.Label({label})});
        } catch(e) {
            return new Gtk.Popover({child: new Gtk.Label({label: e.message})});
        }
    }
}

class PrefsPopup extends UI.PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset, key) {
        super(param);
        this.$save = (func, grab, name, pane) => {
            func(this.$cmds);
            gset.set_value(key, pickle([...this.$cmds].map(x => x.cmd), false));
            if(grab >= 0) this.grabFocus(grab, name);
            if(pane) this.$updatePaneSensitive(this.$cmds.n_items > 0);
        };
        this.$buildUI(gset, key);
    }

    $buildUI(gset, key) {
        let pane = this.$genPane();
        let side = this.$genSide(gset.get_value(key).recursiveUnpack(), key === Field.SCMDS);
        this.addToGroup(new Gtk.Frame({child: new UI.Box([side, pane], {vexpand: false, css_name: 'list'})}));
        this.grabFocus(0);
    }

    $genSide(cmds, group) {
        this.$cmds = new Gio.ListStore({item_type: SideItem});
        this.$cmds.splice(0, 0, cmds.map(x => new SideItem(x)));
        this.$list = hook({'row-selected': (_w, row) => row && this.$onSelect(row.get_index())},
            new Gtk.ListBox({selection_mode: Gtk.SelectionMode.SINGLE, vexpand: true}));
        this.$list.add_css_class('data-table');
        this.$list.bind_model(this.$cmds, item => hook({
            dropped: (_w, f, t) => this.$onDrop(f, t),
            changed: (_w, p, v) => this.$onChange(p, 'name',  v),
            toggled: (_w, p, v) => this.$onChange(p, 'enable', v),
        }, new SideRow(item, group)));
        return new UI.Box([this.$genTools(), new Gtk.Separator(), new Gtk.ScrolledWindow({overlay_scrolling: false, child: this.$list})],
            {valign: Gtk.Align.FILL, orientation: Gtk.Orientation.VERTICAL});
    }

    grabFocus(index, name) {
        let row = this.$list.get_row_at_index(index);
        this.$list.select_row(row);
        if(name) row.editName();
    }

    $genPaneWidgets() {
        return {
            command: ['', _('Run command'),    new UI.LazyEntry('gio open "$LDWORD"')],
            icon:    ['', _('Icon name'),      new UI.Icon()],
            type:    [0,  _('Command type'),   new UI.Drop(['Bash', 'JS'])],
            result:  [0,  '',                  new ResultRows()],
            apps:    ['', _('App list'),       new Apps(_('Click the app icon to remove'), _('Allowlist'))],
            regexp:  ['', _('RegExp matcher'), new UI.LazyEntry('(https?|ftp|file)://.*')],
            tooltip: ['', _('Icon tooltip'),   new UI.LazyEntry('Open URL')],
        };
    }

    $genPane() {
        let pane = new Adw.PreferencesGroup({hexpand: true});
        this.$updatePaneSensitive = x => { if(!x) this.$onSelect(); pane.set_sensitive(x); };
        this.$pane = omap(this.$genPaneWidgets(), ([key, [fallback, description, widget]]) => {
            if(widget instanceof ResultRows) widget.addToPane(pane);
            else pane.add(new UI.PrefRow([description], widget));
            widget.connect('notify::value', ({value}) => !this.$syncing && this.$onChange(this.selected, key, value));
            widget.fallback = fallback;
            return [[key, widget]];
        });
        return pane;
    }

    $genTools() {
        return new UI.Box([
            ['list-add-symbolic',    _('Add'),    () => this.$onAdd()],
            ['list-remove-symbolic', _('Remove'), () => this.$onRemove()],
            ['edit-copy-symbolic',   _('Copy'),   () => this.$onCopy()],
            ['edit-paste-symbolic',  _('Paste'),  () => this.$onPaste()],
        ].map(([icon_name, tooltip_text, clicked]) => hook({clicked},
            new Gtk.Button({icon_name, tooltip_text, has_frame: false}))));
    }

    get selected() {
        return this.$list.get_selected_row()?.get_index() ?? -1;
    }

    $onSelect(pos = this.selected) {
        this.$syncing = true;
        let cmd = pos < 0 ? {} : this.$cmds.get_item(pos).cmd;
        for(let k in this.$pane) this.$pane[k].value = cmd[k] ?? this.$pane[k].fallback;
        this.$syncing = false;
    }

    $onChange(pos, key, value) {
        if(pos >= 0) this.$save(x => x.get_item(pos).change(key, value), key === 'enable' ? pos : -1);
    }

    $onAdd(cmd = {name: 'Name'}, pos = this.selected + 1) {
        this.$save(x => x.insert(pos, new SideItem(cmd)), pos, true, true);
    }

    $onRemove(pos = this.selected) {
        if(pos >= 0) this.$save(x => x.remove(pos), Math.min(pos, this.$cmds.n_items - 2), false, true);
    }

    $onDrop(drag, drop) {
        this.$save(x => { let item = x.get_item(drag).copy(); x.remove(drag); x.insert(drop, item); }, drop);
    }

    $onCopy(pos = this.selected) {
        if(pos < 0) return;
        this.get_clipboard().set(JSON.stringify(this.$cmds.get_item(pos).cmd));
        this.$addToast(_('Content copied'));
    }

    async $onPaste() {
        try {
            let cmd = JSON.parse(await this.get_clipboard().read_text_async(null));
            this.$onAdd(omap(cmd, ([k, v]) => has(this.$pane, k) || k === 'name' || k === 'enable' ? [[k, v]] : []));
        } catch(e) {
            this.$addToast(_('Pasted content parsing failed'));
        }
    }

    $addToast(title) {
        this.get_root().add_toast(new Adw.Toast({title, timeout: 5}));
    }
}

class PrefsSwift extends PrefsPopup {
    static {
        GObject.registerClass({
            Properties: gprop({
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
        if(pos < 0) return;
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
        if(pos < 0) return;
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

export default class PrefsWidget extends UI.Prefs {
    fillPreferencesWindow(win) {
        let provider = new Gtk.CssProvider();
        // Ref: https://gist.github.com/JMoerman/6f2fa1494847ce7b7044b99787ccc769
        provider.load_from_string(`ld-dragging { background: alpha(@window_bg_color, .85); color: @accent_color; border: 1px dashed @accent_color; border-radius: 4px; }
                                  .ld-drop-top { background: linear-gradient(to bottom, alpha(@accent_bg_color, .85) 0%, alpha(@accent_bg_color, 0) 35%); }
                                  .ld-drop-bottom { background: linear-gradient(to bottom, alpha(@accent_bg_color, 0) 65%, alpha(@accent_bg_color, .85) 100%); }`);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(`${ROOT}/icons`);
        let gset = this.getSettings();
        [
            new PrefsBasic({title: _('Basic'), icon_name: 'ld-disable-passive-symbolic'}, gset),
            new PrefsSwift({title: _('Swift'), icon_name: 'ld-swift-passive-symbolic'}, gset, Field.SCMDS),
            new PrefsPopup({title: _('Popup'), icon_name: 'ld-popup-passive-symbolic'}, gset, Field.PCMDS),
            new PrefsAbout({title: _('About'), icon_name: 'help-about-symbolic'}, gset),
        ].forEach(x => win.add(x));
    }
}
