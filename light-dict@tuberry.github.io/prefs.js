// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Pango, GLib, Gtk, Gdk, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const _GTK = imports.gettext.domain('gtk30').gettext;

var Fields = {
    APPLIST:   'app-list',
    LISTTYPE:  'list-type',
    HIDETITLE: 'hide-title',
    TXTFILTER: 'text-filter',
    LCOMMAND:  'left-command',
    PASSIVE:   'passive-mode',
    TEXTSTRIP: 'enable-strip',
    PAGESIZE:  'icon-pagesize',
    RCOMMAND:  'right-command',
    SCOMMAND:  'swift-command',
    TRIGGER:   'trigger-style',
    PCOMMANDS: 'popup-commands',
    SCOMMANDS: 'swift-commands',
    SYSTRAY:   'enable-systray',
    TOOLTIP:   'enable-tooltip',
    AUTOHIDE:  'autohide-timeout',
};

function init() {
    ExtensionUtils.initTranslations();
}

function buildPrefsWidget() {
    return new LightDictPrefsWidget();
}

const LightDictPrefsWidget = GObject.registerClass(
class LightDictPrefsWidget extends Gtk.Stack {
    _init() {
        super._init({
            expand: true,
            transition_type: Gtk.StackTransitionType.NONE,
        });

        this._add_tab(new LightDictBasic(), 'basic', _('Basic'));
        this._add_tab(new LightDictSwift(), 'swift', _('Swift'));
        this._add_tab(new LightDictPopup(), 'popup', _('Popup'));
        this._add_tab(new LightDictAbout(), 'about', _('About'));

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            let window = this.get_toplevel();
            window.resize(700, 520);
            let headerBar = window.get_titlebar();
            headerBar.custom_title = new Gtk.StackSwitcher({ halign: Gtk.Align.CENTER, visible: true, stack: this });
            return GLib.SOURCE_REMOVE;
        });
        this.show_all();
    }

    _add_tab(tab, name, title) {
        let win = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        win.add(tab);
        this.add_titled(win, name, title);
    }
});

function clear(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v));
}

function toggleEdit(entry, str) {
    entry.set_editable(!str);
    entry.secondary_icon_name = !str ? 'document-edit-symbolic' : 'action-unavailable-symbolic';
}

function renderBgColor(widget) {
    const entry = new Gtk.Entry(); // hack for background color
    const bgcolor = entry.get_style_context().get_background_color(Gtk.STATE_FLAG_NORMAL);
    const context = widget.get_style_context();
    const cssProvider = new Gtk.CssProvider();
    cssProvider.load_from_data('* { background-color: %s; }'.format(bgcolor.to_string()));
    context.add_provider(cssProvider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
}

const LightDictWiget = {
    _listGridMaker: () => {
        let grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
            row_homogeneous: true,
            column_homogeneous: false,
        });

        grid._row = 0;
        grid._add = (x, y, z) => {
            const hbox = new Gtk.Box();
            hbox.pack_start(x, true, true, 0);
            hbox.pack_start(y, false, false, 0)
            if(z) hbox.pack_start(z, false, false, 0);
            grid.attach(hbox, 0, grid._row++, 2, 1);
        }
        grid._att = (x, y, z) => {
            let r = grid._row++;
            if(z) {
                let hbox = new Gtk.Box();
                hbox.pack_start(y, true, true, 0);
                hbox.pack_end(z, false, false, 0);
                grid.attach(x, 0, r, 1, 1);
                grid.attach(hbox, 1, r, 1, 1);
            } else if(y) {
                grid.attach(x, 0, r, 1, 1);
                grid.attach(y, 1, r, 1, 1);
            } else {
                grid.attach(x, 0, r, 1, 2)
            }
        }

        return grid;
    },

    _frameWrapper: (widget) => {
        let frame = new Gtk.Frame();
        frame.add(widget);
        return frame;
    },

    _spinMaker: (l, u, s) => {
        return new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: l,
                upper: u,
                step_increment: s,
            }),
        });
    },

    _labelMaker: (x, y) => {
        return new Gtk.Label({
            label: x,
            hexpand: y ? false : true,
            halign: Gtk.Align.START,
        });
    },

    _entryMaker: (x, y, z) => {
        let entry = new Gtk.Entry({
            hexpand: !z,
            editable: false,
            placeholder_text: x,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y || '',
            secondary_icon_activatable: true,
            secondary_icon_name: 'action-unavailable',
        });
        entry.connect('icon-press', () => {
            if(entry.get_editable()) {
                entry.set_editable(false);
                entry.secondary_icon_name = 'action-unavailable'
            } else {
                entry.set_editable(true);
                entry.secondary_icon_name = 'document-edit-symbolic';
            }
        });

        return entry;
    },

    _comboMaker: (ops, tip) => {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.forEach(op => l.set(l.append(), [0], [op]));
        let c = new Gtk.ComboBox({ model: l, tooltip_text: tip || '' });
        let r = new Gtk.CellRendererText();
        c.pack_start(r, false);
        c.add_attribute(r, 'text', 0);
        return c;
    },
}

const LightDictNewApp = GObject.registerClass(
class LightDictNewApp extends Gtk.AppChooserDialog {
    _init(parent, ids) {
        super._init({
            transient_for: parent,
            modal: true,
        });

        this._ids = ids;
        this.get_widget().set({ show_all: true, show_other: true, });
        this.get_widget().connect('application-selected', this._updateSensitivity.bind(this));
        this._updateSensitivity();
        this.show();
    }

    _updateSensitivity() {
        const appInfo = this.get_widget().get_app_info();
        this.set_response_sensitive(Gtk.ResponseType.OK, appInfo && !this._ids.includes(appInfo.get_id()));
    }
});

const LightDictAppBox = GObject.registerClass({
    Properties: {
        'apps': GObject.param_spec_string('apps', 'apps', 'apps', '', GObject.ParamFlags.READWRITE),
    },
    Signals: {
        'changed': { param_types: [GObject.TYPE_STRING] },
    },
}, class LightDictAppBox extends Gtk.Frame {
    _init(ids, tip1, tip2) {
        super._init();

        let box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, });
        renderBgColor(box);

        this._box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, tooltip_text: tip1 || '' });
        box.pack_start(this._box, true, true, 5);
        box.pack_start(new Gtk.Separator(), false, false, 0);
        box.pack_end(this._addBtnMaker(tip2), false, false, 10);
        this._ids = ids || '';
        this.add(box);
        this.show_all();
    }

    set_apps(apps) {
        this._ids = apps;
    }

    get_apps(apps) {
        return this.apps;
    }

    set _ids(apps) {
        this.apps = apps;
        let ids = apps.split(',');
        this._box.get_children().forEach(x => this._box.remove(x));
        this._ids.forEach(x => { if(x) this._genAppBtn(x); });
        this.show_all();
    }

    get _ids() {
        return this.apps.split(',');
    }

    _onAddActivated(widget) {
        const dialog = new LightDictNewApp(this.get_toplevel(), this._ids);
        dialog.connect('response', (dlg, id) => {
            const appInfo = id === Gtk.ResponseType.OK
                ? dialog.get_widget().get_app_info() : null;
            if(appInfo) {
                this._ids = [this.apps, appInfo.get_id()].join(',');
                this.emit('changed', this.apps);
                this.show_all()
            }
            dialog.destroy();
        });
    }

    _addBtnMaker(tips) {
        let add = new Gtk.EventBox({ tooltip_text: tips || '' });
        add.add(new Gtk.Image({ icon_name: 'list-add-symbolic' }));
        add.connect('button-press-event', this._onAddActivated.bind(this));

        return add;
    }

    _genAppBtn(id) {
        let appInfo = Gio.DesktopAppInfo.new(id);
        if(!appInfo) return;
        const icon = new Gtk.Image({ gicon: appInfo.get_icon() });
        icon.get_style_context().add_class('icon-dropshadow');

        let app = new Gtk.EventBox({ tooltip_text: appInfo.get_display_name() });
        app.add(icon);
        app.connect('button-press-event', widget => {
            this._ids = this._ids.filter(x => x !== id).join(',');
            this.emit('changed', this.apps)
            widget.destroy();
        })
        this._box.pack_start(app, false, false, 4);
    }
});

const LightDictAbout = GObject.registerClass(
class LightDictAbout extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this._buildIcon();
        this._buildInfo();
        this._buildTips();
    }

    _buildIcon() {
        let hbox = new Gtk.Box({
            margin_bottom: 30,
            halign: Gtk.Align.CENTER,
        });
        let active = gsettings.get_strv(Fields.PCOMMANDS);
        let count  = gsettings.get_uint(Fields.PAGESIZE);
        let icons  = [];
        let icon_size = 5;
        if(active.length) {
            active.forEach(x => {
                icons.push(new Gtk.Image({ icon_size: icon_size, icon_name: JSON.parse(x)?.icon ?? 'help', }));
            });
        } else {
            icons.push(new Gtk.Image({ icon_size: icon_size, icon_name: 'accessories-dictionary', }));
        }
        count = count ? count : icons.length;
        icons.slice(0, count).forEach(x => hbox.pack_start(x, false, false, 0));
        this.add(hbox);
    }

    _buildInfo() {
        let gpl = 'https://www.gnu.org/licenses/gpl-3.0.html';
        let license  = _GTK('GNU General Public License, version 3 or later');
        let info = [
            '<b><big>%s</big></b>'.format(Me.metadata.name),
            _('Version %d').format(Me.metadata.version),
            _('Lightweight extension for instant action to primary selection, especially optimized for Dictionary lookup.'),
            '<span><a href="' + Me.metadata.url + '">' + _GTK('Website') + '</a></span>',
            '<small>' + _GTK('This program comes with absolutely no warranty.\nSee the <a href="%s">%s</a> for details.').format(gpl, license) + '</small>'
        ];
        let about = new Gtk.Label({
            wrap: true,
            justify: 2,
            use_markup: true,
            label: info.join('\n\n'),
        });
        this.add(about);
    }

    _buildTips() {
        let tips = new Gtk.Button({
            hexpand: false,
            label: _('Tips'),
            halign: Gtk.Align.END,
        });
        let pop = new Gtk.Popover(tips);
        pop.set_relative_to(tips);

        let msgs = [
            _('Leave RegExp/application list blank for no restriction'),
            _('Middle click the panel to copy the result to clipboard'),
            _('Substitute <b>LDWORD</b> for the selected text in the command'),
            _('Add the icon to <i>~/.local/share/icons/hicolor/symbolic/apps/</i>'),
            _('Simulate keyboard input in JS statement: <i>key("Control_L+c")</i>'),
            _('Hold <b>Alt/Shift</b> to function when highlighting in <b>Passive mode</b>'),
        ];

        let vbox = new Gtk.VBox({ margin: 10 });
        msgs.map((msg, i) => {
            let label = new Gtk.Label({ margin_top: 5, wrap: true });
            label.set_alignment(0, 0.5);
            label.set_markup((i + 1) + '. ' + msg);
            return label;
        }).forEach(l => vbox.add(l));
        pop.add(vbox);
        tips.connect('clicked', () => { pop.show_all(); });

        this.pack_end(tips, false, false, 0);
    }
});

const LightDictBasic = GObject.registerClass(
class LightDictBasic extends Gtk.Box {
    _init() {
        super._init({
            margin_left: 90,
            margin_right: 90,
            margin_bottom: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this._buildWidgets();
        this._bulidUI();
        this._bindValues();
        this._syncStatus();
    }

    _buildWidgets() {
        this._field_enable_strip    = new Gtk.Switch();
        this._field_enable_systray  = new Gtk.Switch();
        this._field_enable_tooltip = new Gtk.Switch();
        this._field_hide_title      = new Gtk.Switch();

        this._field_page_size    = LightDictWiget._spinMaker(1, 10, 1);
        this._field_auto_hide    = LightDictWiget._spinMaker(500, 10000, 250);

        this._field_list_type     = LightDictWiget._comboMaker([_('Allowlist'), _('Blocklist')]);
        this._field_trigger_style = LightDictWiget._comboMaker([_('Swift'), _('Popup'), _('Disable')]);
        this._field_passive_mode  = LightDictWiget._comboMaker([_('Proactive'), _('Passive')], _('Need modifier to trigger or not'));
        this._field_app_list      = new LightDictAppBox(gsettings.get_string(Fields.APPLIST), _('Click the app icon to remove'));

        this._field_text_filter   = LightDictWiget._entryMaker('^[^\\n\\.\\t/:]{3,50}$');
        this._field_left_command  = LightDictWiget._entryMaker('notify-send LDWORD', _('Left click to run'));
        this._field_right_command = LightDictWiget._entryMaker('gio open https://www.google.com/search?q=LDWORD', _('Right click to run and hide panel'));
    }

    _bulidUI() {
        let common = this._listFrameMaker(_('Common'));
        common._add(LightDictWiget._labelMaker(_('Enable systray')), this._field_enable_systray);
        common._add(LightDictWiget._labelMaker(_('Trim whitespaces')), this._field_enable_strip);
        common._add(LightDictWiget._labelMaker(_('Autohide interval')), this._field_auto_hide);
        common._add(LightDictWiget._labelMaker(_('Trigger style')), this._field_passive_mode, this._field_trigger_style);
        common._att(LightDictWiget._labelMaker(_('Application list'), true), this._field_app_list, this._field_list_type);
        common._att(LightDictWiget._labelMaker(_('RegExp filter'), true), this._field_text_filter);

        let panel = this._listFrameMaker(_('Panel'));
        panel._add(LightDictWiget._labelMaker(_('Hide title')), this._field_hide_title);
        panel._att(LightDictWiget._labelMaker(_('Right command'), true), this._field_right_command);
        panel._att(LightDictWiget._labelMaker(_('Left command'), true), this._field_left_command);

        let popup = this._listFrameMaker(_('Popup'));
        popup._add(LightDictWiget._labelMaker(_('Enable tooltip')), this._field_enable_tooltip);
        popup._add(LightDictWiget._labelMaker(_('Page size')), this._field_page_size);
    }

    _syncStatus() {
        toggleEdit(this._field_left_command,  gsettings.get_string(Fields.LCOMMAND));
        toggleEdit(this._field_right_command, gsettings.get_string(Fields.RCOMMAND));
        toggleEdit(this._field_text_filter,   gsettings.get_string(Fields.TXTFILTER));
    }

    _bindValues() {
        gsettings.bind(Fields.TXTFILTER, this._field_text_filter,    'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.RCOMMAND,  this._field_right_command,  'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LCOMMAND,  this._field_left_command,   'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.APPLIST,   this._field_app_list,       'apps',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.AUTOHIDE,  this._field_auto_hide,      'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGESIZE,  this._field_page_size,      'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,   this._field_trigger_style,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LISTTYPE,  this._field_list_type,      'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SYSTRAY,   this._field_enable_systray, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE, this._field_hide_title,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP, this._field_enable_strip,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TOOLTIP,   this._field_enable_tooltip, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PASSIVE,   this._field_passive_mode,   'active', Gio.SettingsBindFlags.DEFAULT);
    }

    _listFrameMaker(lbl) {
        let frame = new Gtk.Frame({
            label_yalign: 1,
            shadow_type: Gtk.ShadowType.IN,
        });
        frame.set_label_widget(new Gtk.Label({
            use_markup: true,
            margin_top: 30,
            label: '<b><big>' + lbl + '</big></b>',
        }));
        this.add(frame);

        frame.grid = LightDictWiget._listGridMaker();
        frame.add(frame.grid);
        frame._add = frame.grid._add;
        frame._att = frame.grid._att;

        return frame;
    }
});

const LightDictPopup = GObject.registerClass(
class LightDictPopup extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
        });

        this.isNew = true;
        this.isSetting = false;

        this._commands = gsettings.get_strv(Fields.PCOMMANDS);
        this._buildWidgets();
        this._buildUI();
        this._syncStatus();
    }

    _buildWidgets() {
        this._tre = this._treeViewMaker(this._commands);

        this._add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-add-symbolic' }) });
        this._del = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-remove-symbolic' }) });
        this._nxt = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-down-symbolic' }) });
        this._prv = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-up-symbolic' }) });

        this._pop = new Gtk.Switch();
        this._cmt = new Gtk.Switch();
        this._sel = new Gtk.Switch();
        this._cpy = new Gtk.Switch();
        this._app = new LightDictAppBox('', _('Click the app icon to remove'), _('Allowlist'));
        this._typ = LightDictWiget._comboMaker(['sh', 'JS']);
        this._ico = LightDictWiget._entryMaker('face-cool-symbolic', '', true);
        this._cmd = LightDictWiget._entryMaker('gio open LDWORD');
        this._tip = LightDictWiget._entryMaker('Open URL with gio open');
        this._reg = LightDictWiget._entryMaker('(https?|ftp|file)://.*');
    }

    _buildUI() {
        let leftBox = new Gtk.VBox({});
        let toolBar = new Gtk.HBox({});
        toolBar.pack_start(this._add, false, false, 2);
        toolBar.pack_start(this._del, false, false, 2);
        toolBar.pack_start(this._nxt, false, false, 2);
        toolBar.pack_start(this._prv, false, false, 2);
        leftBox.pack_start(this._tre, true, true, 0);
        leftBox.pack_start(new Gtk.Separator(), false, false, 0);
        leftBox.pack_end(toolBar, false, false, 0);

        let rightBox = new Gtk.VBox({});
        let details = LightDictWiget._listGridMaker();
        details._add(LightDictWiget._labelMaker(_('Icon name')), this._ico);
        details._att(LightDictWiget._labelMaker(_('Run command'), true), this._cmd);
        details._add(LightDictWiget._labelMaker(_('Command type')), this._typ);
        details._add(LightDictWiget._labelMaker(_('Show result')), this._pop);
        details._add(LightDictWiget._labelMaker(_('Copy result')), this._cpy);
        details._add(LightDictWiget._labelMaker(_('Select result')), this._sel);
        details._add(LightDictWiget._labelMaker(_('Commit result')), this._cmt);
        rightBox.pack_start(details, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let addition = LightDictWiget._listGridMaker();
        addition._att(LightDictWiget._labelMaker(_('Application list'), true), this._app);
        addition._att(LightDictWiget._labelMaker(_('RegExp matcher'), true), this._reg);
        addition._att(LightDictWiget._labelMaker(_('Icon tooltip'), true), this._tip);
        rightBox.pack_start(addition, false, false, 0);

        let outBox = new Gtk.HBox();
        outBox.pack_start(leftBox, false, false, 0);
        outBox.pack_start(new Gtk.Separator(), false, false, 0);
        outBox.pack_end(rightBox, true, true, 0);

        this.add(LightDictWiget._frameWrapper(outBox));
    }

    _syncStatus() {
        this._tre.get_selection().connect('changed', this._onSelected.bind(this));

        this._add.connect('clicked', this._onAddClicked.bind(this));
        this._del.connect('clicked', this._onDelClicked.bind(this));
        this._prv.connect('clicked', this._onPrvClicked.bind(this));
        this._nxt.connect('clicked', this._onNxtClicked.bind(this));

        this._pop.connect('state-set', (widget, state) => { this._setConfig('popup', state); });
        this._cmt.connect('state-set', (widget, state) => { this._setConfig('commit', state); });
        this._sel.connect('state-set', (widget, state) => { this._setConfig('select', state); });
        this._cpy.connect('state-set', (widget, state) => { this._setConfig('copy', state); });
        this._app.connect('changed', widget => { this._setConfig('apps', widget.get_apps()); });
        this._typ.connect('changed', widget => { this._setConfig('type', widget.get_active()); });
        this._reg.connect('changed', widget => { this._setConfig('regexp', widget.get_text()); });
        this._cmd.connect('changed', widget => { this._setConfig('command', widget.get_text()); });
        this._tip.connect('changed', widget => { this._setConfig('tooltip', widget.get_text()); });
        this._ico.connect('changed', widget => { this._setConfig('icon', widget.get_text()); });
    }

    _onSelected() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.isSetting = true;
        let conf = JSON.parse(this._commands[index]);
        let keys = ['type', 'copy', 'commit', 'select', 'popup', 'icon', 'apps', 'command', 'regexp', 'tooltip'];
        for(let key in conf)
            if(!keys.includes(key) || !conf[key]) delete conf[key];
        this.conf = conf;

        this._typ.set_active(this.conf?.type ?? 0);
        this._cpy.set_state(this.conf?.copy ?? false);
        this._cmt.set_state(this.conf?.commit ?? false);
        this._sel.set_state(this.conf?.select ?? false);
        this._pop.set_state(this.conf?.popup ?? false);
        this._ico.set_text(this.conf?.icon ?? '');
        this._app.set_apps(this.conf?.apps ?? '')
        this._cmd.set_text(this.conf?.command ?? '');
        this._reg.set_text(this.conf?.regexp ?? '');
        this._tip.set_text(this.conf?.tooltip ?? '');
        this._toggleEditable();
        this.isSetting = false;
    }

    _toggleEditable() {
        toggleEdit(this._ico, this.conf.icon);
        toggleEdit(this._cmd, this.conf.command);
        toggleEdit(this._reg, this.conf.regexp);
        toggleEdit(this._tip, this.conf.tooltip);
    }

    get selected() {
        let [ok, model, iter] = this._tre.get_selection().get_selected();
        return [ok, model, iter, ok ? model.get_path(iter).get_indices()[0] : -1];
    }

    _onPrvClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index === 0) return;

        [this._commands[index], this._commands[index - 1]] = [this._commands[index - 1], this._commands[index]]
        let p = JSON.parse(this._commands[index]);
        let q = JSON.parse(this._commands[index - 1]);
        model.set(iter, [0, 1], [!!p.enable, p.name]);
        model.iter_previous(iter);
        model.set(iter, [0, 1], [!!q.enable, q.name]);
        this._tre.get_selection().select_iter(iter);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _onNxtClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index >= this._commands.length - 1) return;

        [this._commands[index], this._commands[index + 1]] = [this._commands[index + 1], this._commands[index]]
        let p = JSON.parse(this._commands[index]);
        let q = JSON.parse(this._commands[index + 1]);
        model.set(iter, [0, 1], [!!p.enable, p.name]);
        model.iter_next(iter);
        model.set(iter, [0, 1], [!!q.enable, q.name]);
        this._tre.get_selection().select_iter(iter);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _onDelClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;

        this._commands.splice(index, 1);
        model.remove(iter);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _onAddClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) {
            this._commands.splice(0, 0, '{"name":"name"}');
            model.set(model.insert(0), [0, 1], [false, 'name']);
            gsettings.set_strv(Fields.PCOMMANDS, this._commands);
            return;
        }

        this._commands.splice(index + 1, 0, '{"name":"name"}');
        model.set(model.insert(index + 1), [1], ['name']);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _setConfig(key, value) {
        if(this.isSetting) return;
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.conf[key] = value;
        let conf = { name: model.get_value(iter, [1]) };
        if(model.get_value(iter, [0])) conf.enable = true;
        Object.assign(conf, clear(this.conf));

        this._commands[index] = JSON.stringify(conf, null, 0);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _setEnable(selected, enable) {
        let model = this._tre.model;
        let index = model.get_path(selected).get_indices()[0];
        let conf = JSON.parse(this._commands[index]);
        conf.enable = enable;
        this._commands[index] = JSON.stringify(clear(conf), null, 0);
        model.set(selected, [0], [enable]);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _setName(selected, text) {
        let model = this._tre.model;
        let name = text ? text : 'name';
        let index = model.get_path(selected).get_indices()[0];
        let conf = JSON.parse(this._commands[index]);
        conf.name = name;
        this._commands[index] = JSON.stringify(conf, null, 0);
        model.set(selected, [1], [name]);
        gsettings.set_strv(Fields.PCOMMANDS, this._commands);
    }

    _treeViewMaker(commands) {
        let listStore = new Gtk.ListStore();
        listStore.set_column_types([GObject.TYPE_BOOLEAN, GObject.TYPE_STRING]);
        let treeView = new Gtk.TreeView({ model: listStore, headers_visible: false });
        commands.forEach(x => {
            let conf = JSON.parse(x);
            listStore.set(listStore.append(), [0, 1], [!!conf.enable, conf.name]);
        });

        let enable = new Gtk.CellRendererToggle({ radio: false });
        let status = new Gtk.TreeViewColumn({ title: 'Enable' });
        status.pack_start(enable, true);
        status.add_attribute(enable, 'active', 0);
        treeView.append_column(status);
        enable.connect('toggled', (actor, path) => {
            let active = !actor.get_active();
            let [ok, iter] = listStore.get_iter_from_string(path);
            this._setEnable(iter, active);
        });

        let text = new Gtk.CellRendererText({ editable: true });
        let name = new Gtk.TreeViewColumn({ title: 'Name' });
        name.pack_start(text, true);
        name.add_attribute(text, 'text', 1);
        treeView.append_column(name);
        text.connect('edited', (actor, path, text) => {
            let [ok, iter] = listStore.get_iter_from_string(path);
            this._setName(iter, text);
        });

        return treeView;
    }
});

const LightDictSwift = GObject.registerClass(
class LightDictSwift extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
        });

        this.isNew = true;
        this.isSetting = false;

        this._commands = gsettings.get_strv(Fields.SCOMMANDS);
        this._buildWidgets();
        this._buildUI();
        this._syncStatus();
    }

    _buildWidgets() {
        this._tre = this._treeViewMaker(this._commands);

        this._add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-add-symbolic' }) });
        this._del = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'list-remove-symbolic' }) });
        this._nxt = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-down-symbolic' }) });
        this._prv = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'go-up-symbolic' }) });

        this._pop = new Gtk.Switch();
        this._cmt = new Gtk.Switch();
        this._cpy = new Gtk.Switch();
        this._sel = new Gtk.Switch();
        this._typ = LightDictWiget._comboMaker(['sh', 'JS']);
        this._app = new LightDictAppBox('', _('Click the app icon to remove'), _('Allowlist'));
        this._cmd = LightDictWiget._entryMaker('gio open LDWORD');
        this._reg = LightDictWiget._entryMaker('(https?|ftp|file)://.*');
    }

    _buildUI() {
        let leftBox = new Gtk.VBox({});
        let toolBar = new Gtk.HBox({});
        toolBar.pack_start(this._add, false, false, 2);
        toolBar.pack_start(this._del, false, false, 2);
        toolBar.pack_start(this._nxt, false, false, 2);
        toolBar.pack_start(this._prv, false, false, 2);
        leftBox.pack_start(this._tre, true, true, 0);
        leftBox.pack_start(new Gtk.Separator(), false, false, 0);
        leftBox.pack_end(toolBar, false, false, 0);

        let rightBox = new Gtk.VBox({});
        let details = LightDictWiget._listGridMaker();
        details._att(LightDictWiget._labelMaker(_('Run command'), true), this._cmd);
        details._add(LightDictWiget._labelMaker(_('Command type')), this._typ);
        details._add(LightDictWiget._labelMaker(_('Show result')), this._pop);
        details._add(LightDictWiget._labelMaker(_('Copy result')), this._cpy);
        details._add(LightDictWiget._labelMaker(_('Select result')), this._sel);
        details._add(LightDictWiget._labelMaker(_('Commit result')), this._cmt);
        rightBox.pack_start(details, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let addition = LightDictWiget._listGridMaker();
        addition._att(LightDictWiget._labelMaker(_('Application list'), true), this._app);
        addition._att(LightDictWiget._labelMaker(_('RegExp matcher'), true), this._reg);
        rightBox.pack_start(addition, false, false, 0);
        rightBox.pack_start(new Gtk.Separator(), false, false, 0);
        let info = LightDictWiget._listGridMaker();
        info._att(LightDictWiget._labelMaker(_('Only one item can be enabled in swift style.\n') +
                                             _('The first one will be used by default if none is enabled.\n') +
                                             _('Double click a list item on the left to change the name.')
        ));
        rightBox.pack_start(info, false, false, 0);

        let outBox = new Gtk.HBox();
        outBox.pack_start(leftBox, false, false, 0);
        outBox.pack_start(new Gtk.Separator(), false, false, 0);
        outBox.pack_end(rightBox, true, true, 0);

        this.add(LightDictWiget._frameWrapper(outBox));
    }

    _syncStatus() {
        this._tre.get_selection().connect('changed', this._onSelected.bind(this));

        this._add.connect('clicked', this._onAddClicked.bind(this));
        this._del.connect('clicked', this._onDelClicked.bind(this));
        this._prv.connect('clicked', this._onPrvClicked.bind(this));
        this._nxt.connect('clicked', this._onNxtClicked.bind(this));

        this._pop.connect('state-set', (widget, state) => { this._setConfig('popup', state); });
        this._cmt.connect('state-set', (widget, state) => { this._setConfig('commit', state); });
        this._sel.connect('state-set', (widget, state) => { this._setConfig('select', state); });
        this._cpy.connect('state-set', (widget, state) => { this._setConfig('copy', state); });
        this._app.connect('changed', widget => { this._setConfig('apps', widget.get_apps()); });
        this._typ.connect('changed', widget => { this._setConfig('type', widget.get_active()); });
        this._reg.connect('changed', widget => { this._setConfig('regexp', widget.get_text()); });
        this._cmd.connect('changed', widget => { this._setConfig('command', widget.get_text()); });
    }

    _onSelected() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.isSetting = true;
        let conf = JSON.parse(this._commands[index]);
        let keys = ['type', 'copy', 'commit', 'select', 'popup', 'apps', 'command', 'regexp'];
        for(let key in conf)
            if(!keys.includes(key) || !conf[key]) delete conf[key];
        this.conf = conf;

        this._typ.set_active(this.conf?.type ?? 0);
        this._cpy.set_state(this.conf?.copy ?? false);
        this._cmt.set_state(this.conf?.commit ?? false);
        this._sel.set_state(this.conf?.select ?? false);
        this._pop.set_state(this.conf?.popup ?? false);
        this._app.set_apps(this.conf?.apps ?? '')
        this._cmd.set_text(this.conf?.command ?? '');
        this._reg.set_text(this.conf?.regexp ?? '');
        this._toggleEditable();
        this.isSetting = false;
    }

    _toggleEditable() {
        toggleEdit(this._cmd, this.conf.command);
        toggleEdit(this._reg, this.conf.regexp);
    }

    get selected() {
        let [ok, model, iter] = this._tre.get_selection().get_selected();
        return [ok, model, iter, ok ? model.get_path(iter).get_indices()[0] : -1];
    }

    get enabled() {
        return gsettings.get_int(Fields.SCOMMAND);
    }

    get enable() {
        return this._commands.findIndex(c => !!JSON.parse(c).enable);
    }

    _onPrvClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index === 0) return;

        [this._commands[index], this._commands[index - 1]] = [this._commands[index - 1], this._commands[index]]
        let enable = this.enable;
        model.set(iter, [0, 1], [enable == index, JSON.parse(this._commands[index]).name]);
        model.iter_previous(iter);
        model.set(iter, [0, 1], [enable == index - 1, JSON.parse(this._commands[index - 1]).name]);
        this._tre.get_selection().select_iter(iter);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _onNxtClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index >= this._commands.length - 1) return;

        [this._commands[index], this._commands[index + 1]] = [this._commands[index + 1], this._commands[index]]
        let enable = this.enable;
        model.set(iter, [0, 1], [enable == index, JSON.parse(this._commands[index]).name]);
        model.iter_next(iter);
        model.set(iter, [0, 1], [enable == index + 1, JSON.parse(this._commands[index + 1]).name]);
        this._tre.get_selection().select_iter(iter);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _onDelClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;

        this._commands.splice(index, 1);
        let enable = this.enable;
        model.remove(iter);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _onAddClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) {
            this._commands.splice(0, 0, '{"name":"name"}');
            model.set(model.insert(0), [0, 1], [false, 'name']);
            gsettings.set_strv(Fields.SCOMMANDS, this._commands);
            return;
        }

        this._commands.splice(index + 1, 0, '{"name":"name"}');
        let enable = this.enable;
        model.set(model.insert(index + 1), [0, 1], [false, 'name']);
        if(enable != this.enabled) gsettings.set_int(Fields.SCOMMAND, enable);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _setConfig(key, value) {
        if(this.isSetting) return;
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.conf[key] = value;
        let conf = { name: model.get_value(iter, [1]) };
        if(model.get_value(iter, [0])) conf.enable = true;
        Object.assign(conf, clear(this.conf));

        this._commands[index] = JSON.stringify(conf, null, 0);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _setEnable(selected, enable) {
        let model = this._tre.model;
        let [ok, iter] = model.get_iter_first();
        if(!ok) return;
        do {
            model.set(iter, [0], [false]);
        } while(model.iter_next(iter));
        let index = model.get_path(selected).get_indices()[0];
        this._commands = this._commands.map((c, i) => {
            let conf = JSON.parse(c);
            if(i == index && enable) {
                conf.enable = true;
                gsettings.set_int(Fields.SCOMMAND, index);
            } else {
                delete conf.enable;
            }
            return JSON.stringify(conf, null, 0);
        });
        model.set(selected, [0], [enable]);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _setName(selected, text) {
        let model = this._tre.model;
        let name = text ? text : 'name';
        let index = model.get_path(selected).get_indices()[0];
        let conf = JSON.parse(this._commands[index]);
        conf.name = name;
        this._commands[index] = JSON.stringify(clear(conf), null, 0);
        model.set(selected, [1], [name]);
        gsettings.set_strv(Fields.SCOMMANDS, this._commands);
    }

    _treeViewMaker(commands) {
        let listStore = new Gtk.ListStore();
        listStore.set_column_types([GObject.TYPE_BOOLEAN, GObject.TYPE_STRING]);
        let treeView = new Gtk.TreeView({ model: listStore, headers_visible: false });
        commands.forEach(x => {
            let conf = JSON.parse(x);
            listStore.set(listStore.append(), [0, 1], [!!conf.enable, conf.name]);
        });

        let enable = new Gtk.CellRendererToggle({ radio: true });
        let status = new Gtk.TreeViewColumn({ title: 'Enable' });
        status.pack_start(enable, true);
        status.add_attribute(enable, 'active', 0);
        treeView.append_column(status);
        enable.connect('toggled', (actor, path) => {
            let active = !actor.get_active();
            let [ok, iter] = listStore.get_iter_from_string(path);
            this._setEnable(iter, active);
        });

        let text = new Gtk.CellRendererText({ editable: true });
        let name = new Gtk.TreeViewColumn({ title: 'Name' });
        name.pack_start(text, true);
        name.add_attribute(text, 'text', 1);
        treeView.append_column(name);
        text.connect('edited', (actor, path, text) => {
            let [ok, iter] = listStore.get_iter_from_string(path);
            this._setName(iter, text);
        });

        return treeView;
    }
});

