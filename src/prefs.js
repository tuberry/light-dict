// vim:fdm=syntax
// by tuberry
/* exported init fillPreferencesWindow */
'use strict';

const { Adw, Gtk, GObject, Gio, GLib, Gdk, Graphene } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
const _GTK = imports.gettext.domain('gtk40').gettext;
const { Fields, Block } = Me.imports.fields;
const UI = Me.imports.ui;
const noop = () => {};
const genColor = (r, g, b, alpha = 1) => new Gdk.RGBA({ red: r / 255, green: g / 255, blue: b / 255, alpha });
const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);
const genRect = (width, height, x = 0, y = 0) => new Graphene.Rect({ origin: new Graphene.Point({ x, y }), size: new Graphene.Size({ width, height }) });

Gio._promisify(Gdk.Clipboard.prototype, 'read_text_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

function init() {
    ExtensionUtils.initTranslations();
}

function fillPreferencesWindow(win) {
    let provider = new Gtk.CssProvider();
    // Ref: https://gist.github.com/JMoerman/6f2fa1494847ce7b7044b99787ccc769
    provider.load_from_data(`.ld-drop-up { background: linear-gradient(to bottom, #000a 0%, #0000 35%); }
                            .ld-drop-down { background: linear-gradient(to bottom, #0000 65%, #000a 100%); }
                            .ld-drop-up-dark { background: linear-gradient(to bottom, #fffa 0%, #fff0 35%); }
                            .ld-drop-down-dark { background: linear-gradient(to bottom, #fff0 65%, #fffa 100%); }`, -1);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(Me.dir.get_child('icons').get_path());
    [
        new LightDictBasic({ title: _('Basic'), icon_name: 'disable-passive-symbolic' }),
        new LightDictJSON({ title: _('Swift'),  icon_name: 'swift-passive-symbolic' }, Fields.SCOMMANDS),
        new LightDictJSON({ title: _('Popup'),  icon_name: 'popup-passive-symbolic' }, Fields.PCOMMANDS),
        new LightDictAbout({ title: _('About'), icon_name: 'help-about-symbolic' }),
    ].forEach(x => win.add(x));
}

class PrefPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        this._group = new Adw.PreferencesGroup();
        this.add(this._group);
    }

    _add(widget) {
        this._group.add(widget);
    }
}

class IconBtn extends UI.File {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({ filter: 'image/svg+xml' }, Gio.FILE_ATTRIBUTE_STANDARD_NAME);
    }

    set_icon(icon) {
        this.file = icon;
    }

    _checkIcon(path) {
        let name = GLib.basename(path).replace('.svg', '');
        return Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).has_icon(name) ? name : '';
    }

    async _setFile(path) {
        let file = Gio.File.new_for_path(path);
        let info = await file.query_info_async(this._attr, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null);
        this._setLabel(info.get_name().replace(RegExp(/(-symbolic)*.svg$/), ''));
        let icon = this._checkIcon(path);
        icon ? this._icon.set_from_icon_name(icon) : this._icon.set_from_gicon(Gio.Icon.new_for_string(path));
        if(!this.file) this.chooser.set_file(file);
        this._file = path;
        this._icon.show();
    }

    _setEmpty() {
        this._icon.hide();
        this._setLabel(null);
        this._file = null;
    }
}

class AppsBox extends Gtk.Box {
    static {
        GObject.registerClass({
            Properties: {
                apps: genParam('string', 'apps', ''),
            },
            Signals: {
                changed: { param_types: [GObject.TYPE_STRING] },
            },
        }, this);
    }

    constructor(tip1, tip2) {
        super({ valign: Gtk.Align.CENTER, hexpand: true, css_classes: ['linked'] });
        this._box = new Gtk.Box({ hexpand: true, tooltip_text: tip1 || '', css_name: 'entry', css_classes: ['linked'] });
        this._btn = new Gtk.Button({ tooltip_text: tip2 || '', icon_name: 'list-add-symbolic' });
        this._btn.connect('clicked', this._onActivated.bind(this));
        [new Gtk.ScrolledWindow({ child: this._box, vscrollbar_policy: Gtk.PolicyType.NEVER }), this._btn].forEach(x => this.append(x));
        this._buildChooser();
    }

    vfunc_mnemonic_activate() {
        this._btn.activate();
    }

    set apps(apps) {
        let widgets = [];
        let children = this._box.observe_children();
        for(let i = 0, x; (x = children.get_item(i)); i++) widgets.push(x);
        widgets.forEach(w => this._box.remove(w));
        apps.split(',').forEach(a => this._appendApp(a));
        this._apps = apps;
        this.notify('apps');
    }

    get apps() {
        return this._apps ?? '';
    }

    set_apps(apps) { // set new apps
        this.apps = apps;
    }

    _buildChooser() {
        this.chooser = new Gtk.AppChooserDialog({ modal: Gtk.DialogFlags.MODAL });
        this.chooser.get_widget().set({ show_all: true, show_other: true });
        this.chooser.get_widget().connect('application-selected', () => this._updateResponse());
        this.chooser.connect('response', (wdg, res) => {
            if(res === Gtk.ResponseType.OK) {
                let id = wdg.get_widget().get_app_info().get_id();
                this._apps = this.apps ? [this.apps, id].join(',') : id;
                this._appendApp(id);
                this.emit('changed', this.apps);
                this.notify('apps');
            }
            this.chooser.hide();
        });
    }

    _updateResponse() {
        let app = this.chooser.get_widget().get_app_info();
        this.chooser.set_response_sensitive(Gtk.ResponseType.OK, app && !this.apps.includes(app.get_id()));
    }

    _onActivated(w) {
        this.chooser.set_transient_for(w.get_root());
        this._updateResponse();
        this.chooser.show();
    }

    _appendApp(id) {
        let appInfo = Gio.DesktopAppInfo.new(id);
        if(!appInfo) return;
        let app = new Gtk.Button({ tooltip_text: appInfo.get_display_name(), has_frame: false });
        app.set_child(new Gtk.Image({ gicon: appInfo.get_icon(), css_classes: ['icon-dropshadow'] }));
        app.connect('clicked', widget => {
            this._box.remove(widget);
            this._apps = this.apps.split(',').filter(x => x !== id).join(',');
            this.emit('changed', this.apps);
            this.notify('apps');
        });
        this._box.append(app);
    }
}

class SideItem extends GObject.Object { // required GObject.Object by Gtk.SignalListItemFactory
    static {
        GObject.registerClass({
            Properties: {
                name: genParam('string', 'name', 'name'),
                enable: genParam('boolean', 'enable', false),
            },
        }, this);
    }

    constructor(param) {
        super();
        if(param) Object.assign(this, param);
    }

    copy() {
        return new SideItem({ enable: this.enable, name: this.name });
    }

    from_string(str) {
        try {
            let { enable, name } = JSON.parse(str);
            this.name = name || 'name';
            this.enable = enable ?? false;
        } catch(e) {
            //
        }
        return this;
    }

    to_string() {
        return JSON.stringify({ enable: this.enable || undefined, name: this.name || 'name' }, null, 0);
    }
}

class SideRow extends Gtk.Box {
    static {
        GObject.registerClass({
            Signals: {
                drag: {},
                edit: { param_types: [GObject.TYPE_STRING] },
                drop: { param_types: [GObject.TYPE_BOOLEAN] },
                toggle: { param_types: [GObject.TYPE_BOOLEAN] },
            },
        }, this);
    }

    constructor(group) {
        super({ spacing: 5, hexpand: false });
        this._btn = new Gtk.CheckButton({ group });
        this._btn.connect('toggled', () => this.emit('toggle', this._btn.active));
        this._txt = new Gtk.EditableLabel({ max_width_chars: 9 });
        this._txt.get_delegate().connect('activate', () => this.emit('edit', this._txt.text));
        this._txt.connect('changed', () => !this._txt.get_position() && this.emit('edit', this._txt.text));
        this._img = new Gtk.Image({ icon_name: 'open-menu-symbolic' });
        ['_btn', '_txt', '_img'].forEach(x => this.append(this[x]));
        this._buildDND(group);
    }

    _buildDND(group) {
        // Ref: https://blog.gtk.org/2017/06/01/drag-and-drop-in-lists-revisited/
        this._type = !group;
        let drag = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
        drag.connect('prepare', dg => {
            this.emit('drag');
            let { width: x, height: y } = this.get_allocation(),
                ss = new Gtk.Snapshot(),
                fg = this.get_style_context().get_color().red;
            ss.append_color(fg ? genColor(53, 132, 228) : genColor(255, 255, 255), genRect(x, y));
            new Gtk.WidgetPaintable({ widget: this }).snapshot(ss, x, y);
            let cr = ss.append_cairo(genRect(x, y));
            cr.setSourceRGBA(0, 0, 0, 1);
            cr.setLineWidth(2);
            cr.rectangle(0, 0, x, y);
            cr.stroke();
            let { width: a, height: b } = this._img.get_allocation();
            dg.set_icon(ss.to_paintable(null), x - a / 2, y - b / 2); // ?? wrong pos on Wayland
            return Gdk.ContentProvider.new_for_value(this);
        });
        this._img.add_controller(drag);
        let drop = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE });
        drop.set_gtypes([this.constructor.$gtype]);
        drop.connect('motion', (_a, _x, y) => {
            let dark = this.get_style_context().get_color().red ? '-dark' : '';
            let [add, del] = y > this.get_allocation().height / 2 ? ['down', 'up'] : ['up', 'down'];
            this.get_style_context().add_class(`ld-drop-${add}${dark}`);
            this.get_style_context().remove_class(`ld-drop-${del}`);
            this.get_style_context().remove_class(`ld-drop-${del}-dark`);
            return Gdk.DragAction.MOVE;
        });
        drop.connect('leave', () => this._clearDropStyle());
        drop.connect('drop', (_a, t, _x, y) => {
            this._clearDropStyle();
            if(t._type === this._type) this.emit('drop', y > this.get_allocation().height / 2);
        });
        this.add_controller(drop);
    }

    _clearDropStyle() {
        ['up', 'down', 'up-dark', 'down-dark'].forEach(x => this.get_style_context().remove_class(`ld-drop-${x}`));
    }

    binds(item) {
        if(this._item === item) return;
        this._item = item;
        item.bind_property('name', this._txt, 'text', GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
        item.bind_property('enable', this._btn, 'active', GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);
    }
}

class SideBar extends Gtk.Box {
    static {
        GObject.registerClass({
            Signals: {
                copy:   { param_types: [GObject.TYPE_INT] },
                remove: { param_types: [GObject.TYPE_INT] },
                select: { param_types: [GObject.TYPE_INT] },
                move:   { param_types: [GObject.TYPE_INT, GObject.TYPE_INT] },
                change: { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                add:    { param_types: [GObject.TYPE_INT, GObject.TYPE_STRING] },
                enable: { param_types: [GObject.TYPE_INT, GObject.TYPE_BOOLEAN] },
            },
        }, this);
    }

    constructor(cmds, swift) {
        super({ orientation: Gtk.Orientation.VERTICAL, sensitive: !!cmds.length });
        [this._buildExpander(cmds, swift), new Gtk.Separator(), this._buildTool()].forEach(x => this.append(x));
    }

    _buildExpander(cmds, swift) {
        // Ref: https://blog.gtk.org/2020/09/05/a-primer-on-gtklistview/
        this.swift = swift ? new Gtk.CheckButton() : null;
        this._model = new Gio.ListStore({ item_type: SideItem });
        cmds.forEach(x => this._model.append(new SideItem(x)));
        this._select = new Gtk.SingleSelection({ model: this._model });
        this._select.connect('selection-changed', () => this.emit('select', this.selected));
        let factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_f, x) => x.set_child(new SideRow(this.swift)));
        factory.connect('bind', (_f, x) => {
            let w = x.get_child();
            w.binds(x.get_item());
            w._dragId ??= w.connect('drag', a => { this.drag = this.getPos(a); });
            w._dropId ??= w.connect('drop', (a, down) => this.drop(this.getPos(a) + down));
            w._editId ??= w.connect('edit', (a, name) => this.emit('change', this.getPos(a), name));
            w._toggleId ??= w.connect('toggle', (a, enable) => {
                if(this.swift && !enable) return;
                this.emit('enable', this.getPos(a), enable);
                this.emit('select', this.getPos(a));
            });
        });
        // do not `unbind` on small lists, also avoid offending gjs warnings
        this._list = new Gtk.ListView({ model: this._select, factory, vexpand: true });
        this._list.connect('activate', () => this.emit('select', this.selected));
        return new Gtk.ScrolledWindow({ child: this._list });
    }

    getPos(x) {
        return this._model.find(x._item)[1];
    }

    drop(drop) {
        let to = drop > this.drag ? drop - 1 : drop;
        if(this.drag === to) return;
        let item = this._model.get_item(this.drag).copy();
        this._model.remove(this.drag);
        this._model.insert(to, item);
        this.emit('move', this.drag, to);
    }

    add(text = '{"name": "name"}') {
        let index = this.selected;
        let item = new SideItem().from_string(text);
        if(this.swift) item.enable = false;
        if(index === Gtk.INVALID_LIST_POSITION) {
            this._model.append(item);
            this.emit('add', -1, text);
        } else {
            this._model.insert(index + 1, item);
            this.emit('add', index, text);
        }
    }

    _buildTool() {
        let box = new Gtk.Box({ css_classes: ['linked'] });
        [['list-add-symbolic', _('Add'), () => {
            this.add();
        }], ['list-remove-symbolic', _('Remove'), () => {
            let index = this.selected;
            if(index === Gtk.INVALID_LIST_POSITION) return;
            this._model.remove(index);
            this.emit('remove', index);
        }], ['edit-copy-symbolic', _('Copy'), () => {
            this.emit('copy', this.selected);
        }], ['edit-paste-symbolic', _('Paste'), async () => {
            try {
                this.add(await this.get_clipboard().read_text_async(null));
            } catch(e) {
                this.get_root().add_toast(new Adw.Toast({ title: _('Paste content parsing failed'), timeout: 5 }));
            }
        }]].map(([icon_name, tooltip_text, y]) => {
            let btn = new Gtk.Button({ icon_name, tooltip_text, has_frame: false });
            btn.connect('clicked', y);
            return btn;
        }).forEach(x => box.append(x));
        return box;
    }

    get selected() {
        return this._select.get_selected();
    }

    grabFocus(index) {
        this._select.set_selected(index);
        this.emit('select', this.selected);
    }

    setEnabled(index) {
        if(index >= 0 && index < this._model.n_items) this._model.get_item(index).enable = true;
        else if(this.swift) this.swift.active = true;
    }
}

class SwiftBox extends Adw.PreferencesPage {
    static {
        GObject.registerClass({
            Signals: {
                change: { param_types: [GObject.TYPE_JSOBJECT] },
            },
        }, this);
    }

    constructor() {
        super({ hexpand: true });
        this._temp = { type: 0, copy: false, commit: false, select: false, popup: false, apps: '', command: '', regexp: '' };
        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._type    = new UI.Drop(['sh', 'JS']);
        this._command = new UI.LazyEntry('gio open LDWORD');
        this._regexp  = new UI.LazyEntry('(https?|ftp|file)://.*');
        this._commit  = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._copy    = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._popup   = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._select  = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._apps    = new AppsBox(_('Click the app icon to remove'), _('Allowlist'));
    }

    _buildUI() {
        let details = new Adw.PreferencesGroup();
        [
            [[_('Run command')], this._command],
            [[_('Command type')], this._type],
            [[_('Show result')], this._popup],
            [[_('Copy result')], this._copy],
            [[_('Select result')], this._select],
            [[_('Commit result')], this._commit],
            [[_('Application list')], this._apps],
            [[_('RegExp matcher')], this._regexp],
        ].forEach(xs => details.add(new UI.PrefRow(...xs)));
        this.add(details);
    }

    _bindValues() {
        this._popup.connect('state-set', (_w, state) => this._emit('popup', state));
        this._commit.connect('state-set', (_w, state) => this._emit('commit', state));
        this._select.connect('state-set', (_w, state) => this._emit('select', state));
        this._copy.connect('state-set', (_w, state) => this._emit('copy', state));
        this._apps.connect('changed', (_w, apps) => this._emit('apps', apps));
        this._type.connect('notify::selected', widget => this._emit('type', widget.get_selected()));
        this._regexp.connect('changed', widget => this._emit('regexp', widget.get_text()));
        this._command.connect('changed', widget => this._emit('command', widget.get_text()));
    }

    _emit(key, value) {
        if(this._blocked) return;
        this.emit('change', { [key]: value || undefined });
    }

    set config(config) {
        this._blocked = true;
        let temp = { ...this._temp, ...config };
        Object.keys(temp).forEach(x => {
            let prop = temp[x];
            let widget = this[`_${x}`];
            if(widget === undefined) return;
            switch(typeof prop) {
            case 'boolean': widget.set_state(prop); break;
            case 'number':  widget.set_selected(prop); break;
            case 'string': switch(x) {
            case 'apps': widget.set_apps(prop); break;
            case 'icon': widget.set_icon(prop); break;
            default: widget.set_text(prop); break;
            } break;
            }
        });
        this._blocked = false;
    }
}

class PopupBox extends SwiftBox {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
        this._temp = { type: 0, copy: false, commit: false, select: false, popup: false, apps: '', command: '', regexp: '', tooltip: '', icon: '' };
    }

    _buildWidgets() {
        super._buildWidgets();
        this._icon = new IconBtn();
        this._tooltip = new UI.LazyEntry('Open URL');
    }

    _buildUI() {
        let details = new Adw.PreferencesGroup();
        [
            [[_('Run command')], this._command],
            [[_('Command type')], this._type],
            [[_('Icon name')], this._icon],
            [[_('Show result')], this._popup],
            [[_('Copy result')], this._copy],
            [[_('Select result')], this._select],
            [[_('Commit result')], this._commit],
            [[_('Application list')], this._apps],
            [[_('RegExp matcher')], this._regexp],
            [[_('Icon tooltip')], this._tooltip],
        ].forEach(xs => details.add(new UI.PrefRow(...xs)));
        this.add(details);
    }

    _bindValues() {
        super._bindValues();
        this._icon.connect('changed', (_w, icon) => this._emit('icon', icon));
        this._tooltip.connect('changed', w => this._emit('tooltip', w.get_text()));
    }
}

class LightDictAbout extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        let box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, margin_top: 30, margin_bottom: 30 });
        [this._buildIcon(), this._buildInfo(), this._buildTips(), new Gtk.Box({ vexpand: true }), this._buildLicense()].forEach(x => box.append(x));
        this._add(box);
    }

    _buildIcon() {
        let box = new Gtk.Box({ halign: Gtk.Align.CENTER, margin_bottom: 30 }),
            gsettings = ExtensionUtils.getSettings(),
            active = gsettings.get_strv(Fields.PCOMMANDS).slice(0, gsettings.get_uint(Fields.PAGESIZE)).flatMap(x => (y => y?.icon ? [y.icon] : [])(JSON.parse(x)));
        if(active.length) {
            active.forEach(x => {
                let icon = this._checkIcon(x);
                let img = new Gtk.Image({ icon_size: Gtk.IconSize.LARGE });
                icon ? img.set_from_icon_name(icon) : img.set_from_gicon(Gio.Icon.new_for_string(x));
                box.append(img);
            });
        } else { box.append(new Gtk.Image({ icon_size: Gtk.IconSize.LARGE, icon_name: 'accessories-dictionary-symbolic' })); }
        return box;
    }

    _checkIcon(path) {
        let name = GLib.basename(path).replace('.svg', '');
        return Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).has_icon(name) ? name : '';
    }

    _buildInfo() {
        return this._buildLabel([
            `<b><big>${Me.metadata.name}</big></b>`,
            _('Version %d').format(Me.metadata.version),
            _('Lightweight extension for on-the-fly manipulation to primary selections, especially optimized for Dictionary lookups.'),
            `<span><a href="${Me.metadata.url}">${_GTK('Website')}\n</a></span>`,
        ].join('\n\n'));
    }

    _buildLabel(label) {
        return new Gtk.Label({ label, wrap: true, use_markup: true, justify: Gtk.Justification.CENTER });
    }

    _buildTips() {
        let box = new Gtk.Box({ spacing: 2, orientation: Gtk.Orientation.VERTICAL });
        [
            _('Leave RegExp/application list blank for no restriction'),
            _('Middle click the panel to copy the result to clipboard'),
            _('Substitute <b>LDWORD</b> for the selected text in the command'),
            _('Simulate keyboard input in JS statement: <i>key("Control_L+c")</i>'),
        ].forEach((x, i) => box.append(new Gtk.Label({ halign: Gtk.Align.START, use_markup: true, label: `${i}. ${x}` })));
        return new Gtk.MenuButton({
            label: _('Tips'),
            halign: Gtk.Align.CENTER,
            direction: Gtk.ArrowType.NONE,
            popover: new Gtk.Popover({ child: box }),
        });
    }

    _buildLicense() {
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html',
            license  = _GTK('GNU General Public License, version 3 or later'),
            statement = 'This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.';
        return this._buildLabel(`<small>\n\n${_GTK(statement).format(gpl, license)}</small>`);
    }
}

class LightDictBasic extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params) {
        super(params);
        this._buildWidgets();
        this._buildUI();
    }

    _buildWidgets() {
        this._block = new Block({
            param:   [Fields.OCRPARAMS, 'text',     new UI.LazyEntry()],
            size:    [Fields.PAGESIZE,  'value',    new UI.Spin(1, 10, 1)],
            en_keys: [Fields.SHORTOCR,  'active',   new Gtk.CheckButton()],
            hide:    [Fields.AUTOHIDE,  'value',    new UI.Spin(500, 10000, 250)],
            lcmd:    [Fields.LCOMMAND,  'text',     new UI.LazyEntry('notify-send LDWORD')],
            rcmd:    [Fields.RCOMMAND,  'text',     new UI.LazyEntry('notify-send LDWORD')],
            filter:  [Fields.TXTFILTER, 'text',     new UI.LazyEntry('^[^\\n\\.\\t/,{3,50}$')],
            passive: [Fields.PASSIVE,   'selected', new UI.Drop([_('Proactive'), _('Passive')])],
            list:    [Fields.LISTTYPE,  'selected', new UI.Drop([_('Allowlist'), _('Blocklist')])],
            dwell:   [Fields.DWELLOCR,  'active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            strip:   [Fields.TXTSTRIP,  'active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            tray:    [Fields.SYSTRAY,   'active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            tip:     [Fields.TOOLTIP,   'active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            title:   [Fields.HIDETITLE, 'active',   new Gtk.Switch({ valign: Gtk.Align.CENTER })],
            apps:    [Fields.APPLIST,   'apps',     new AppsBox(_('Click the app icon to remove'))],
            trigger: [Fields.TRIGGER,   'selected', new UI.Drop([_('Swift'), _('Popup'), _('Disable')])],
            mode:    [Fields.OCRMODE,   'selected', new UI.Drop([_('Word'), _('Paragraph'), _('Area'), _('Line')])],
            en_ocr:  [Fields.ENABLEOCR, 'enable-expansion', new Adw.ExpanderRow({ title: _('OCR'), subtitle: _('Depends on python-opencv and python-pytesseract'), show_enable_switch: true })],
        });
        this._block.keys = new UI.Keys(this._block.gset, Fields.OCRSHORTCUT);
        this._block.help = new Gtk.MenuButton({ label: _('Parameters'), direction: Gtk.ArrowType.NONE, valign: Gtk.Align.CENTER });
        this._buildHelpPopover().then(scc => this._block.help.set_popover(scc)).catch(noop);
    }

    _buildUI() {
        [
            [[_('Enable systray')], this._block.tray],
            [[_('Trigger style'), _('Passive means that pressing Alt to trigger')], this._block.passive, this._block.trigger],
            [[_('Application list')], this._block.apps, this._block.list],
        ].forEach(xs => this._add(new UI.PrefRow(...xs)));
        [
            [this._block.en_keys, [_('Shortcut')], this._block.keys],
            [[_('Dwell OCR')], this._block.dwell],
            [[_('Work mode')], this._block.mode],
            [this._block.help, [], this._block.param],
        ].forEach(xs => this._block.en_ocr.add_row(new UI.PrefRow(...xs)));
        [this._buildExpander(_('Other'),
            [[_('Trim blank lines')], this._block.strip],
            [[_('Autohide interval')], this._block.hide],
            [[_('RegExp filter')], this._block.filter]),
        this._buildExpander(_('Panel'),
            [[_('Hide title')], this._block.title],
            [[_('Right command'), _('Right click to run and hide panel')], this._block.rcmd],
            [[_('Left command'), _('Left click to run')], this._block.lcmd]),
        this._buildExpander(_('Popup'),
            [[_('Enable tooltip')], this._block.tip],
            [[_('Page size')], this._block.size])].forEach(x => this._add(x));
        this._add(this._block.en_ocr);
    }

    _buildExpander(title, ...list) {
        let expander = new Adw.ExpanderRow({ title });
        list.forEach(xs => expander.add_row(new UI.PrefRow(...xs)));
        return expander;
    }

    async _buildHelpPopover() {
        let proc = new Gio.Subprocess({
            argv: ['python', Me.dir.get_child('ldocr.py').get_path(), '-h'],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        let label = proc.get_successful() ? stdout : stderr;
        return new Gtk.Popover({ child: new Gtk.Label({ label: label.trim() }) });
    }
}

class LightDictJSON extends PrefPage {
    static {
        GObject.registerClass(this);
    }

    constructor(params, key) {
        super(params);
        this._key = key;
        this._swift = key === Fields.SCOMMANDS;
        this._gset = ExtensionUtils.getSettings();
        this._cmds = this._gset.get_strv(key);
        this._buildWidgets();
        this._bindValues();
    }

    _buildWidgets() {
        let box = new Gtk.Box({ hexpand: true });
        let cmds = this._cmds.map(x => JSON.parse(x));
        if(this._swift) {
            this._enable = this.enable;
            if(cmds[this._enable]) cmds[this._enable].enable = true;
        }
        this._pane = this._swift ? new SwiftBox() : new PopupBox();
        this._side = new SideBar(cmds, this._swift);
        [this._side, new Gtk.Separator(), this._pane].forEach(x => box.append(x));
        this._add(new Gtk.Frame({ child: box }));
    }

    _bindValues() {
        this._side.connect('add',    this._onAdd.bind(this));
        this._side.connect('move',   this._onMove.bind(this));
        this._side.connect('copy',   this._onCopy.bind(this));
        this._side.connect('enable', this._onEnable.bind(this));
        this._side.connect('select', this._onSelect.bind(this));
        this._side.connect('remove', this._onRemove.bind(this));
        this._side.connect('change', this._onSideChange.bind(this));
        this._pane.connect('change', this._onPaneChange.bind(this));
        if(this._swift) this._gset.connect(`changed::${Fields.SCOMMAND}`, () => this._onSettingChanged());
        this._side.grabFocus(0);
    }

    _onSettingChanged() {
        let index = this.enable;
        if(this._enable === index) return;
        this._side.setEnabled(index);
    }

    _onEnable(_w, index, enable) {
        if(this._swift) {
            this.enable = index;
        } else {
            this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), enable: enable || undefined }, null, 0);
            this._saveCommands();
        }
    }

    get enable() {
        return this._gset.get_int(Fields.SCOMMAND);
    }

    set enable(index) {
        if(!this._swift || this._enable === index) return;
        this._enable = index;
        this._gset.set_int(Fields.SCOMMAND, index);
    }

    _onSelect(_w, index) {
        this._pane.config = JSON.parse(this._cmds[index] || '{}');
    }

    _onSideChange(_w, index, name) {
        this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), name }, null, 0);
        this._saveCommands();
    }

    _onAdd(_w, index, text) {
        if(index < 0) {
            this._cmds.push(text);
            this._pane.set_sensitive(true);
        } else {
            this._cmds.splice(index + 1, 0, text);
            if(this._enable > index) this.enable = this._enable + 1;
        }
        this._side.grabFocus(index + 1);
        this._saveCommands();
    }

    _onRemove(_w, index) {
        this._cmds.splice(index, 1);
        if(this._enable >= index) this.enable = this._enable === index ? -1 : this._enable - 1;
        this._pane.config = JSON.parse(this._cmds[index] || this._cmds[index - 1] || '{}');
        if(this._cmds.length > 0 ^ this._pane.sensitive) this._pane.set_sensitive(this._cmds.length > 0);
        this._saveCommands();
    }

    _onMove(_w, f, t) {
        this._cmds.splice(t, 0, this._cmds.splice(f, 1)[0]);
        if(this._enable <= Math.max(f, t) && this._enable >= Math.min(f, t)) {
            if(this._enable > f) this.enable = this._enable - 1;
            else if(this._enable === f) this.enable = t;
            else this.enable = this._enable + 1;
        }
        this._side.grabFocus(t);
        this._saveCommands();
    }

    _onCopy(_w, index) {
        let text = this._cmds[index];
        if(!text) return;
        this.get_clipboard().set(text);
        this.get_root().add_toast(new Adw.Toast({ title: _('Content copied'), timeout: 5 }));
    }

    _onPaneChange(_w, prop) {
        let index = this._side.selected;
        if(!this._cmds[index]) return;
        this._cmds[index] = JSON.stringify({ ...JSON.parse(this._cmds[index]), ...prop }, null, 0);
        this._saveCommands();
    }

    _saveCommands() {
        this._gset.set_strv(this._key, this._cmds);
    }
}
