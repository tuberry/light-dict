// vim:fdm=syntax
// by tuberry

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import { Field } from './const.js';
import { ROOT_DIR, noop, gprops, execute, pickle, hook } from './util.js';

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');

const { _, _GTK, getSelf }  = UI;

class PrefPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param) {
        super(param);
        let prefs = new Adw.PreferencesGroup();
        this._add = widget => prefs.add(widget);
        this.add(prefs);
    }
}

class AppItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: gprops({
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
        this.append(this._check = new Gtk.Image({ icon_name: 'object-select-symbolic' }));
    }

    bindItem(item) {
        this.setupContent(item.app.get_icon(), item.app.get_display_name());
        this._binding = item.bind_property('selected', this._check, 'visible', GObject.BindingFlags.SYNC_CREATE);
    }

    unbindItem() {
        this._binding.unbind();
    }
}

class AppsDialog extends UI.AppDialog {
    static {
        GObject.registerClass(this);
    }

    _buildList(param) {
        let factory = hook({
                setup: (_f, x) => x.set_child(new AppLabel('application-x-executable-symbolic')),
                bind: (_f, x) => x.get_child().bindItem(x.get_item()),
                unbind: (_f, x) => x.get_child().unbindItem(),
            }, new Gtk.SignalListItemFactory()),
            filter = Gtk.CustomFilter.new(null),
            model = new Gio.ListStore({ item_type: AppItem }),
            select = new Gtk.SingleSelection({ model: new Gtk.FilterListModel({ model, filter }) }),
            view = hook({ activate: () => select.get_selected_item().toggle() },
                new Gtk.ListView({ single_click_activate: true, model: select, factory, vexpand: true }));
        if(param?.no_display) Gio.AppInfo.get_all().forEach(x => model.append(new AppItem(x)));
        else Gio.AppInfo.get_all().filter(x => x.should_show()).forEach(x => model.append(new AppItem(x)));
        this.getSelected = () => [...model].filter(x => x.selected).map(x => x.app.get_id()).join(',');
        this.initSelected = s => [...model].forEach(x => { x.selected = s.has(x.app.get_id()); });
        filter.set_search = s => filter.set_filter_func(s ? (a => x => a.has(x.app.get_id()))(new Set(Gio.DesktopAppInfo.search(s).flat())) : null);
        return { view, filter };
    }

    choose_sth(root, selected) {
        this.initSelected(selected);
        return super.choose_sth(root);
    }
}

class Apps extends UI.DialogButtonBase {
    static {
        GObject.registerClass(this);
    }

    constructor(tip1, tip2) {
        super(null);
        if(tip2) this._btn.set_tooltip_text(tip2);
        this._btn.set_icon_name('list-add-symbolic');
        this._box = new UI.Box(null, { hexpand: true, can_focus: false, tooltip_text: tip1 || ''  });
        let scroll = new Gtk.ScrolledWindow({ child: this._box, vexpand: false, css_name: 'entry', vscrollbar_policy: Gtk.PolicyType.NEVER });
        this.prepend(scroll);
        this.value = '';
    }

    _buildDialog() {
        this._dlg = new AppsDialog();
    }

    _genApp(id) {
        let app = Gio.DesktopAppInfo.new(id);
        return hook({ clicked: () => { this._gvalue.delete(id); this.value = [...this._gvalue].join(','); } }, app
            ? new Gtk.Button({ child: new Gtk.Image({ gicon: app.get_icon() }), tooltip_text: app.get_display_name(), has_frame: false })
            : new Gtk.Button({ icon_name: 'help-browser-symbolic', tooltip_text: id, has_frame: false }));
    }

    _onClick() {
        if(!this._dlg) this._buildDialog();
        return this._dlg.choose_sth(this.get_root(), this._gvalue);
    }

    _setValue(v) {
        this._value = v;
        this._gvalue = new Set(v ? v.split(',') : null);
        if(this._box) [...this._box].forEach(x => this._box.remove(x));
        if(this._value) this._gvalue.forEach(x => this._box.append(this._genApp(x)));
    }
}

class SideItem extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: gprops({
                name: ['string', 'Name'],
                enable: ['boolean', false],
            }),
        }, this);
    }

    constructor({ enable, name }) {
        super();
        this.name = name || 'Name';
        this.enable = enable ?? false;
    }
}

class SideRow extends Gtk.Box {
    static {
        GObject.registerClass({
            Signals: {
                dropped: { param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT] },
                changed: { param_types: [GObject.TYPE_UINT, GObject.TYPE_STRING] },
                toggled: { param_types: [GObject.TYPE_UINT, GObject.TYPE_BOOLEAN] },
            },
        }, this);
    }

    constructor(group, uuid, param) {
        super({ spacing: 5, margin_end: 5, hexpand: false, ...param });
        this._btn = hook({ toggled: () => this._emit('toggled', this._btn.active) }, new Gtk.CheckButton({ group }));
        this._txt = hook({ changed: () => !this._txt.editing && this._txt.text && this._emit('changed', this._txt.text) },
            new Gtk.EditableLabel({ max_width_chars: 9 }));
        this._txt.get_delegate().connect('activate', () => this._emit('changed', this._txt.text));
        this._img = new Gtk.Image({ icon_name: 'open-menu-symbolic' });
        ['_btn', '_txt', '_img'].forEach(x => this.append(this[x]));
        this._group = !!group;
        this._uuid = uuid;
        this._buildDND();
    }

    _buildDND() {
        // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        this._img.add_controller(hook({
            prepare: () => Gdk.ContentProvider.new_for_value(this),
            drag_begin: (_src, drag) => {
                let width = this.get_width(),
                    height = this.get_height(),
                    widget = new SideRow(this._group ? new Gtk.CheckButton() : null, '',
                        { width_request: width, height_request: height, css_name: 'ld-dragging' });
                widget.syncValue({ enable: this._btn.active, name: this._txt.text }, this._position);
                Gtk.DragIcon.get_for_drag(drag).set_child(widget);
                drag.set_hotspot(width - this._img.get_width() / 2, height - this._img.get_height() / 2);
            },
        }, new Gtk.DragSource({ actions: Gdk.DragAction.MOVE })));
        this.add_controller(hook({
            motion: (_target, _x, y) => {
                let top = y < this.get_height() / 2;
                this.add_css_class(top ? 'ld-drop-top' : 'ld-drop-bottom');
                this.remove_css_class(top ? 'ld-drop-bottom' : 'ld-drop-top');
                return Gdk.DragAction.MOVE;
            },
            drop: (_target, { _uuid, _position }, _x, y) => {
                this._clearDropStyle();
                if(_uuid !== this._uuid) return false;
                this.emit('dropped', _position, this._position + (y > this.get_height() / 2));
                return true;
            },
            leave: () => this._clearDropStyle(),
        }, Gtk.DropTarget.new(SideRow, Gdk.DragAction.MOVE)));
    }

    _clearDropStyle() {
        ['top', 'bottom'].forEach(x => this.remove_css_class(`ld-drop-${x}`));
    }

    _emit(signal, value) {
        if(!this._syncing) this.emit(signal, this._position, value);
    }

    syncValue({ name, enable }, position) {
        this._syncing = true;
        this._txt.text = name;
        this._btn.active = enable;
        this._position = position;
        this._syncing = false;
    }
}

class PopupSide extends Gtk.Box {
    static {
        GObject.registerClass({
            Signals: {
                copied:   { param_types: [GObject.TYPE_INT] },
                removed:  { param_types: [GObject.TYPE_INT] },
                selected: { param_types: [GObject.TYPE_INT] },
                moved:    { param_types: [GObject.TYPE_INT, GObject.TYPE_INT] },
                changed:  { param_types: [GObject.TYPE_INT, GObject.TYPE_JSOBJECT] },
                added:    { param_types: [GObject.TYPE_INT, GObject.TYPE_JSOBJECT] },
            },
        }, this);
    }

    constructor(cmds, group) {
        super({ orientation: Gtk.Orientation.VERTICAL });
        [this._buildList(cmds, group), new Gtk.Separator(), this._buildTool()].forEach(x => this.append(x));
    }

    _buildList(cmds, group) {
        // Ref: https://blog.gtk.org/2020/09/05/a-primer-on-gtklistview/
        this._group = group;
        let uuid = GLib.uuid_string_random();
        this._model = new Gio.ListStore({ item_type: SideItem });
        cmds.forEach(x => this._model.append(new SideItem(x)));
        this._select = hook({ selection_changed: () => this.emit('selected', this.selected) },
            new Gtk.SingleSelection({ autoselect: false, model: this._model }));
        let factory = hook({
            setup: (_f, x) => x.set_child(new SideRow(this._group, uuid)),
            bind: (_f, x) => UI.Hook.attach({
                dropped: (_w, f, t) => this._onDropped(f, t),
                changed: (_w, p, v) => this._onChanged(p, 'name', v),
                toggled: (_w, p, v) => this._onChanged(p, 'enable', v),
            }, x.get_child()).syncValue(x.get_item(), x.get_position()),
            unbind: (_f, x) => UI.Hook.detach(x.get_child()),
        }, new Gtk.SignalListItemFactory());
        return new Gtk.ScrolledWindow({
            overlay_scrolling: false,
            child: hook({ activate: () => this.emit('selected', this.selected) },
                new Gtk.ListView({ model: this._select, factory, vexpand: true })),
        });
    }

    get selected() {
        return this._select.get_selected();
    }

    _onChanged(position, key, value) {
        let item = this._model.get_item(position);
        if(value !== item[key]) this.emit('changed', position, { [key]: (item[key] = value) || undefined });
    }

    _onDropped(drag, drop) {
        let target = drop > drag ? drop - 1 : drop;
        if(drag === target) return;
        let item = new SideItem(this._model.get_item(drag));
        this._model.remove(drag);
        this._model.insert(target, item);
        this.emit('moved', drag, target);
    }

    _onAdded(cmd) {
        let potition = this.selected;
        if(potition === Gtk.INVALID_LIST_POSITION) potition = -1;
        this._model.insert(potition + 1, new SideItem(cmd));
        this.emit('added', potition, cmd);
    }

    grabFocus(position) {
        this._select.set_selected(position);
    }

    _buildTool() {
        return new UI.Box(
            [['list-add-symbolic', _('Add'), () => {
                this._onAdded({ name: 'Name' });
            }], ['list-remove-symbolic', _('Remove'), () => {
                let position = this.selected;
                if(position === Gtk.INVALID_LIST_POSITION) return;
                this._model.remove(position);
                this.emit('removed', position);
            }], ['edit-copy-symbolic', _('Copy'), () => {
                this.emit('copied', this.selected);
            }], ['edit-paste-symbolic', _('Paste'), async () => {
                try {
                    this._onAdded(JSON.parse(await this.get_clipboard().read_text_async(null)));
                } catch(e) {
                    this.get_root().add_toast(new Adw.Toast({ title: _('Pasted content parsing failed'), timeout: 5 }));
                }
            }]].map(([icon_name, tooltip_text, callback]) => hook({ clicked: callback },
                new Gtk.Button({ icon_name, tooltip_text, has_frame: false }))));
    }
}

class SwiftSide extends PopupSide {
    static {
        GObject.registerClass(this);
    }

    _onAdded(cmd) {
        cmd.enable = undefined;
        super._onAdded(cmd);
    }

    setEnabled(position) {
        if(position >= 0 && position < this._model.n_items) {
            let { name, enable } = this._model.get_item(position);
            if(!enable) this._model.splice(position, 1, [new SideItem({ enable: true, name })]);
        } else { this._swift.active = true; }
    }
}

class SwiftPane extends Adw.PreferencesPage {
    static {
        GObject.registerClass({
            Signals: {
                changed: { param_types: [GObject.TYPE_JSOBJECT] },
            },
        }, this);
    }

    constructor() {
        super({ hexpand: true });
        this._buildUI();
    }

    _buildWidgets() {
        return [
            ['command', '',    'changed',   [_('Run command')],      new UI.LazyEntry('gio open LDWORD')],
            ['type',    0,     'changed',   [_('Command type')],     new UI.Drop(['sh', 'JS'])],
            ['popup',   false, 'state-set', [_('Show result')],      new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            ['copy',    false, 'state-set', [_('Copy result')],      new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            ['select',  false, 'state-set', [_('Select result')],    new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            ['commit',  false, 'state-set', [_('Commit result')],    new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            ['apps',    '',    'changed',   [_('Application list')], new Apps(_('Click the app icon to remove'), _('Allowlist'))],
            ['regexp',  '',    'changed',   [_('RegExp matcher')],   new UI.LazyEntry('(https?|ftp|file)://.*')],
        ];
    }

    _buildUI() {
        this._widgets = {};
        this._defaults = {};
        let prefs = new Adw.PreferencesGroup();
        this._buildWidgets().forEach(([key, value, signal, description, widget]) => {
            prefs.add(new UI.PrefRow(description, widget));
            widget.connect(signal, (_w, v) => !this._syncing && this.emit('changed', { [key]: v || undefined }));
            this._widgets[key] = widget;
            this._defaults[key] = value;
        });
        this.add(prefs);
    }

    set config(config) {
        this._syncing = true;
        Object.entries({ ...this._defaults, ...config }).forEach(([k, v]) => {
            let widget = this._widgets[k];
            if(!widget) return;
            switch(typeof v) {
            case 'boolean': widget.set_state(v); break;
            case 'number':  widget.set_selected(v); break;
            case 'string': widget.value = v; break;
            }
        });
        this._syncing = false;
    }
}

class PopupPane extends SwiftPane {
    static {
        GObject.registerClass(this);
    }

    _buildWidgets() {
        let widgets = super._buildWidgets();
        widgets.splice(2, 0, ['icon', '', 'changed', [_('Icon name')], new UI.Icon()]);
        widgets.push(['tooltip', '', 'changed', [_('Icon tooltip')], new UI.LazyEntry('Open URL')]);
        return widgets;
    }
}

class PrefsAbout extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this._add(new UI.Box([this._buildIcon(gset), this._buildInfo(), this._buildTips(), new Gtk.Box({ vexpand: true }),
            this._buildLicense()], { orientation: Gtk.Orientation.VERTICAL, margin_top: 30, margin_bottom: 30, valign: Gtk.Align.FILL }, false));
    }

    _buildIcon(gset) {
        return new UI.Box(gset.get_value(Field.PCMDS)
            .recursiveUnpack()
            .slice(0, gset.get_uint(Field.PGSZ))
            .flatMap(({ icon }) => icon ? [icon] : [])
            .reduce((p, v, i) => Object.assign(p, { [i]: v }), ['accessories-dictionary-symbolic'])
            .map(icon_name => new Gtk.Image({ icon_name, icon_size: Gtk.IconSize.LARGE })),
        { halign: Gtk.Align.CENTER, margin_bottom: 30 }, false);
    }

    _buildLabel(label) {
        return new Gtk.Label({ label, wrap: true, use_markup: true, justify: Gtk.Justification.CENTER });
    }

    _buildInfo() {
        let { name, version, url } = getSelf().metadata;
        return this._buildLabel([
            `<b><big>${name}</big></b>`,
            _('Version %d').format(version),
            _('Lightweight extension for on-the-fly manipulation to primary selections, especially optimized for Dictionary lookups.'),
            `<span><a href="${url}">${_GTK('Website')}\n</a></span>`,
        ].join('\n\n'));
    }

    _buildTips() {
        return new Gtk.MenuButton({
            popover: new Gtk.Popover({
                child: new UI.Box([
                    _('Leave RegExp/application list blank for no restriction'),
                    _('Middle click the panel to copy the result to clipboard'),
                    _('Substitute <b>LDWORD</b> for the selected text in the command'),
                    _('Simulate keyboard input in JS statement: <i>key("Control_L+c")</i>'),
                ].map((x, i) => new Gtk.Label({ halign: Gtk.Align.START, use_markup: true, label: `${i}. ${x}` })),
                { spacing: 2, orientation: Gtk.Orientation.VERTICAL }, false),
            }),
            label: _('Tips'), halign: Gtk.Align.CENTER, direction: Gtk.ArrowType.NONE,
        });
    }

    _buildLicense() {
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html',
            license  = _GTK('GNU General Public License, version 3 or later'),
            statement = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.';
        return this._buildLabel(`<small>\n\n${_GTK(statement).format(gpl, license)}</small>`);
    }
}

class PrefsBasic extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset) {
        super(param);
        this._buildWidgets(gset);
        this._buildUI();
        this._buildOCR(gset);
    }

    _buildWidgets(gset) {
        this._blk = UI.block({
            PGSZ: ['value',    new UI.Spin(1, 10, 1)],
            ATHD: ['value',    new UI.Spin(500, 10000, 250)],
            LCMD: ['value',    new UI.LazyEntry('notify-send LDWORD')],
            RCMD: ['value',    new UI.LazyEntry('notify-send LDWORD')],
            TFLT: ['value',    new UI.LazyEntry('^[^\\n\\.\\t/,{3,50}$')],
            APPS: ['value',    new Apps(_('Click the app icon to remove'))],
            PSV:  ['selected', new UI.Drop([_('Proactive'), _('Passive')])],
            APP:  ['selected', new UI.Drop([_('Allowlist'), _('Blocklist')])],
            TSTP: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            STRY: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            TIP:  ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            HDTT: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            TRG:  ['selected', new UI.Drop([_('Swift'), _('Popup'), _('Disable')])],
        }, gset);
    }

    _buildOCR(gset) {
        // EGO: if(!fopen(`${ROOT_DIR}/ldocr.py`).query_exists(null)) return;
        Object.assign(this._blk, UI.block({
            OCRP: ['value',    new UI.LazyEntry()],
            KEY:  ['active',   new Gtk.CheckButton()],
            DOCR: ['active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            OCRS: ['selected', new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line'), _('Dialog')])],
            OCR:  ['enable-expansion', new Adw.ExpanderRow({ title: _('OCR'), subtitle: _('Depends on python-opencv and python-pytesseract'), show_enable_switch: true })],
        }, gset));
        this._blk.KEYS = new UI.Keys({ gset, key: Field.KEYS });
        this._blk.HELP = new Gtk.MenuButton({ label: _('Parameters'), direction: Gtk.ArrowType.NONE, valign: Gtk.Align.CENTER });
        this._buildHelpPopover().then(scc => this._blk.HELP.set_popover(scc)).catch(noop);
        [
            [this._blk.KEY, [_('Shortcut')], this._blk.KEYS],
            [[_('Dwell OCR')], this._blk.DOCR],
            [[_('Work mode')], this._blk.OCRS],
            [this._blk.HELP, [], this._blk.OCRP],
        ].forEach(xs => this._blk.OCR.add_row(new UI.PrefRow(...xs)));
        this._add(this._blk.OCR);
    }

    _buildUI() {
        [
            [[_('Enable systray')], this._blk.STRY],
            [[_('Trigger style'), _('Passive means that pressing Alt to trigger')], this._blk.PSV, this._blk.TRG],
            [[_('Application list')], this._blk.APPS, this._blk.APP],
        ].forEach(xs => this._add(new UI.PrefRow(...xs)));
        [this._buildExpander(_('Other'),
            [[_('Trim blank lines')], this._blk.TSTP],
            [[_('Autohide interval')], this._blk.ATHD],
            [[_('RegExp filter')], this._blk.TFLT]),
        this._buildExpander(_('Panel'),
            [[_('Hide title')], this._blk.HDTT],
            [[_('Right command'), _('Right click to run and hide panel')], this._blk.RCMD],
            [[_('Left command'), _('Left click to run')], this._blk.LCMD]),
        this._buildExpander(_('Popup'),
            [[_('Enable tooltip')], this._blk.TIP],
            [[_('Page size')], this._blk.PGSZ])].forEach(x => this._add(x));
    }


    _buildExpander(title, ...list) {
        let expander = new Adw.ExpanderRow({ title });
        list.forEach(xs => expander.add_row(new UI.PrefRow(...xs)));
        return expander;
    }

    async _buildHelpPopover() {
        try {
            let label = await execute(`python ${ROOT_DIR}/ldocr.py -h`);
            return new Gtk.Popover({ child: new Gtk.Label({ label }) });
        } catch(e) {
            return new Gtk.Popover({ child: new Gtk.Label({ label: e.message }) });
        }
    }
}

class PrefsPopup extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(param, gset, key) {
        super(param);
        this._saveCommands = () => gset.set_value(key, pickle(this._cmds));
        this._cmds = gset.get_value(key).recursiveUnpack();
        this._buildWidgets();
        this._buildUI();
    }

    _buildWidgets() {
        this._pane = new PopupPane();
        this._side = new PopupSide(this._cmds, null);
    }

    _buildUI() {
        hook({
            added: this._onAdded.bind(this), moved: this._onMoved.bind(this),
            copied: this._onCopied.bind(this), selected: this._onSelected.bind(this),
            removed: this._onRemoved.bind(this), changed: this._onChanged.bind(this),
        }, this._side);
        hook({ changed: (_w, prop) => this._onChanged(null, this._side.selected, prop) }, this._pane);
        this._add(new Gtk.Frame({ child: new UI.Box([this._side, new Gtk.Separator(), this._pane], { hexpand: true }, false) }));
        this._pane.set_sensitive(!!this._cmds.length);
        this._side.grabFocus(0);
    }

    _onSelected(_w, index) {
        this._pane.config = this._cmds[index] ?? {};
    }

    _onChanged(_w, index, prop) {
        if(!this._cmds[index]) return;
        Object.assign(this._cmds[index], prop);
        if('enable' in prop) this._side.grabFocus(index);
        this._saveCommands();
    }

    _onAdded(_w, index, cmd) {
        if(index < 0) {
            this._cmds.push(cmd);
            this._pane.set_sensitive(true);
        } else {
            this._cmds.splice(index + 1, 0, cmd);
        }
        this._side.grabFocus(index + 1);
        this._saveCommands();
    }

    _onRemoved(_w, index) {
        this._cmds.splice(index, 1);
        this._pane.config = this._cmds[index] || this._cmds[index - 1] || {};
        if(this._cmds.length > 0 ^ this._pane.sensitive) this._pane.set_sensitive(this._cmds.length > 0);
        this._side.grabFocus(Math.min(index, this._cmds.length - 1));
        this._saveCommands();
    }

    _onMoved(_w, source, target) {
        this._cmds.splice(target, 0, this._cmds.splice(source, 1).at(0));
        this._side.grabFocus(target);
        this._saveCommands();
    }

    _onCopied(_w, index) {
        let cmd = this._cmds[index];
        if(!cmd) return;
        this.get_clipboard().set(JSON.stringify(cmd));
        this.get_root().add_toast(new Adw.Toast({ title: _('Content copied'), timeout: 5 }));
    }
}

class PrefsSwift extends PrefsPopup {
    static {
        GObject.registerClass({
            Properties: gprops({
                enabled: ['int', -1, GLib.MAXINT32, 0],
            }),
        }, this);
    }

    constructor(param, gset, key) {
        super(param, gset, key);
        this.connect('notify::enabled', () => this._side.setEnabled(this.enabled));
        gset.bind(Field.SCMD, this, 'enabled', Gio.SettingsBindFlags.DEFAULT);
    }

    _buildWidgets() {
        this._pane = new SwiftPane();
        this._side = new SwiftSide(this._cmds, new Gtk.CheckButton());
    }

    _onChanged(_w, index, prop) {
        if('enable' in prop) {
            if(!prop.enable) return;
            this.enabled = index;
            this._side.grabFocus(index);
        } else {
            super._onChanged(_w, index, prop);
        }
    }

    _onAdded(_w, index, cmd) {
        super._onAdded(_w, index, cmd);
        if(index >= 0 && this.enabled > index) this.enabled += 1;
    }

    _onRemoved(_w, index) {
        if(this._enabled >= index) this.enabled = this.enabled === index ? -1 : this.enabled - 1;
        super._onRemoved(_w, index);
    }

    _onMoved(_w, source, target) {
        if(this.enabled <= Math.max(source, target) && this.enabled >= Math.min(source, target)) {
            if(this.enabled > source) this.enabled -= 1;
            else if(this.enabled === source) this.enabled = target;
            else this.enabled += 1;
        }
        super._onMoved(_w, source, target);
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
        Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(`${ROOT_DIR}/icons`);
        let gset = this.getSettings();
        [
            new PrefsBasic({ title: _('Basic'), icon_name: 'ld-disable-passive-symbolic' }, gset),
            new PrefsSwift({ title: _('Swift'), icon_name: 'ld-swift-passive-symbolic' }, gset, Field.SCMDS),
            new PrefsPopup({ title: _('Popup'), icon_name: 'ld-popup-passive-symbolic' }, gset, Field.PCMDS),
            new PrefsAbout({ title: _('About'), icon_name: 'help-about-symbolic' }, gset),
        ].forEach(x => win.add(x));
    }
}
