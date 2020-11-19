// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Pango, GLib, Gtk, Gdk, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

var Fields = {
    XOFFSET:   'x-offset',
    LOGSLEVEL: 'log-level',
    DCOMMAND:  'dict-command',
    PASSIVE:   'passive-mode',
    TEXTSTRIP: 'enable-strip',
    DEFAULT:   'default-theme',
    LISTTYPE:  'app-list-type',
    PAGESIZE:  'icon-pagesize',
    TRIGGER:   'trigger-style',
    SENSITIVE: 'sensitive-mode',
    SYSTRAY:   'enable-systray',
    SHORTCUT:  'enable-shortcut',
    TOOLTIPS:  'enable-tooltips',
    APPSLIST:  'application-list',
    AUTOHIDE:  'autohide-timeout',
    BCOMMANDS: 'iconbar-commands',
    FILTER:    'selection-filter',
    HIDETITLE: 'hide-panel-title',
    LCOMMAND:  'left-click-command',
    RCOMMAND:  'right-click-command',
    TOGGLE:    'light-dict-toggle-shortcut',
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
        this._basic = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._basic.add(new LightDictBasic());
        this.add_titled(this._basic, 'basic', _('Basic'));

        this._advanced = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._advanced.add(new LightDictAdvanced());
        this.add_titled(this._advanced, 'advanced', _('Advanced'));

        this._about = new Gtk.ScrolledWindow({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._about.add(new LightDictAbout());
        this.add_titled(this._about, 'about', _('About'));

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            let window = this.get_toplevel();
            window.resize(650,550);
            let headerBar = window.get_titlebar();
            headerBar.custom_title = new Gtk.StackSwitcher({ halign: Gtk.Align.CENTER, visible: true, stack: this });
            return GLib.SOURCE_REMOVE;
        });
        this.show_all();
    }
});

const LightDictAbout = GObject.registerClass(
class LightDictAbout extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this._bulidIcons();
        this._buildInfo();
        this._buildTips();
    }

    _buildTips() {
        const tips = new Gtk.Button({
            label: _('Tips'),
            margin_left: 550,
            margin_right: 30,
        });
        let pop = new Gtk.Popover(tips);
        pop.set_relative_to(tips);

        let msgs = [
            _('Substitute <b>LDWORD</b> for the selection in commands'),
            _('Add the icon to <i>~/.local/share/icons/hicolor/symbolic/apps</i>'),
            _("Fake keyboard input is supported in JS statement: <i>key('Control_L+c')</i>"),
            _('Log file locates in <i>~/.cache/gnome-shell-extension-light-dict/</i>'),
            _('Hold <b>Alt|Shift</b> to invoke when highlighting in <b>Passive mode</b>')
        ];

        const vbox = new Gtk.VBox();
        msgs.map((msg, i) => {
            const label = new Gtk.Label();
            label.set_margin_top(5);
            label.set_line_wrap(true);
            label.set_alignment(0, 0.5);
            label.set_max_width_chars(60);
            label.set_markup((i + 1) + '. ' + msg);
            return label;
        }).forEach(l => vbox.add(l));
        pop.add(vbox);

        tips.connect('clicked', () => { pop.show_all(); });

        this.pack_end(tips, false, false, 0);
    }

    _bulidIcons() {
        let hbox = new Gtk.Box({
            halign: Gtk.Align.CENTER,
        });
        let active = gsettings.get_strv(Fields.BCOMMANDS);
        let count = gsettings.get_uint(Fields.PAGESIZE);
        let icons = [];
        let icon_size = 5;
        if(active.length) {
            active.forEach(x => {
                let y = JSON.parse(x)
                icons.push(new Gtk.Image({
                    icon_size: icon_size,
                    icon_name: y.icon,
                }));
            });
        } else {
            icons.push(new Gtk.Image({
                icon_size: icon_size,
                icon_name: 'accessories-dictionary',
            }));
        }
        count = count ? count : icons.length;
        icons.slice(0, count).forEach(x => hbox.pack_start(x, false, false, 0));
        let frame = new Gtk.Frame({
            margin_bottom: 30,
            margin_left: 350 - (icon_size * 4 + 2) * count,
            margin_right: 350 - (icon_size * 4 + 2) * count,
            shadow_type: Gtk.ShadowType.ETCHED_IN,
        });
        frame.add(hbox)
        this.add(frame);
    }

    _buildInfo() {
        let gpl = "https://www.gnu.org/licenses/gpl-3.0.html";
        let license  = _("GNU General Public License, version 3 or later");
        let info = [
            '<b><big>%s</big></b>'.format(Me.metadata.name),
            _("Version %d").format(Me.metadata.version),
            _("Lightweight selection-popup extension with icon bar and tooltips-style panel, especially optimized for Dictionary."),
            "<span><a href=\"" + Me.metadata.url + "\">" + Me.metadata.url + "</a></span>",
            "<small>" + _("This program comes with absolutely no warranty.\nSee the <a href=\"%s\">%s</a> for details.").format(gpl, license) + "</small>"
        ];
        let about = new Gtk.Label({
            wrap: true,
            justify: 2,
            use_markup: true,
            label: info.join('\n\n'),
        });
        this.add(about);
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
        this._field_default_theme    = new Gtk.Switch();
        this._field_enable_systray   = new Gtk.Switch();
        this._field_enable_strip     = new Gtk.Switch();
        this._field_enable_tooltips  = new Gtk.Switch();
        this._field_hide_panel_title = new Gtk.Switch();
        this._field_passive_mode     = new Gtk.Switch();

        this._field_auto_hide     = this._spinMaker(500, 10000, 250);
        this._field_icon_pagesize = this._spinMaker(0, 10, 1);
        this._field_icon_xoffset  = this._spinMaker(-400,400,5);

        this._field_list_type     = this._comboMaker([_('Blocklist'), _('Allowlist')]);
        this._field_trigger_style = this._comboMaker([_('Box'), _('Bar'), _('Nil')]);
        this._field_log_level     = this._comboMaker([_('Never'), _('Click'), _('Hover'), _('Always')]);

        this._field_enable_toggle = new Gtk.CheckButton({ active: gsettings.get_boolean(Fields.SHORTCUT) });
        this._field_toggle        = this._shortCutMaker(Fields.TOGGLE);

        this._field_dict_command  = this._entryMaker("dict -- LDWORD", _('Command to run in auto mode'));
        this._field_apps_list     = this._entryMaker('Yelp#Evince', _('App white/black list (empty for all)'));
        this._field_filter        = this._entryMaker('^[^\\n\\.\\t/:]{3,50}$', _('Text RegExp filter for auto mode'));
        this._field_left_command  = this._entryMaker('notify-send LDWORD', _('Left click to run'));
        this._field_right_command = this._entryMaker('gio open https://www.google.com/search?q=LDWORD', _('Right click to run and hide box'));
    }

    _bulidUI() {
        this._common = this._listFrameMaker(_('Common'));
        this._common._add(this._labelMaker(_("Enable systray")),    this._field_enable_systray);
        this._common._add(this._labelMaker(_("Trim whitespaces")),  this._field_enable_strip);
        this._common._add(this._labelMaker(_("Passive mode")),      this._field_passive_mode);
        this._common._add(this._labelMaker(_("Default theme")),     this._field_default_theme);
        this._common._add(this._labelMaker(_("Trigger style")),     this._field_trigger_style);
        this._common._add(this._labelMaker(_("Autohide interval")), this._field_auto_hide);
        this._common._add(this._field_enable_toggle, this._labelMaker(_("Toggle style")), this._field_toggle);
        this._common._add(this._field_list_type, this._field_apps_list);

        this._panel = this._listFrameMaker(_('Box'));
        this._panel._add(this._labelMaker(_("Hide title")), this._field_hide_panel_title);
        this._panel._add(this._labelMaker(_("Logs level")), this._field_log_level);
        this._panel._add(this._field_dict_command);
        this._panel._add(this._field_right_command);
        this._panel._add(this._field_left_command);
        this._panel._add(this._field_filter);

        this._iconbar = this._listFrameMaker(_('Bar'));
        this._iconbar._add(this._labelMaker(_("Enable tooltips")),   this._field_enable_tooltips);
        this._iconbar._add(this._labelMaker(_("Page size")),      this._field_icon_pagesize);
        this._iconbar._add(this._labelMaker(_("Horizontal offset")), this._field_icon_xoffset);
    }

    _syncStatus() {
        this._field_enable_toggle.connect("notify::active", widget => {
            this._field_toggle.set_sensitive(widget.active);
        });
        this._field_toggle.set_sensitive(this._field_enable_toggle.active);
        this._toggleEditable(this._field_filter, gsettings.get_string(Fields.FILTER));
        this._toggleEditable(this._field_apps_list, gsettings.get_string(Fields.APPSLIST));
        this._toggleEditable(this._field_dict_command, gsettings.get_string(Fields.DCOMMAND));
        this._toggleEditable(this._field_left_command, gsettings.get_string(Fields.LCOMMAND));
        this._toggleEditable(this._field_right_command, gsettings.get_string(Fields.RCOMMAND));
    }

    _toggleEditable(entry, str) {
        entry.set_editable(!str);
        entry.secondary_icon_name = !str ? "document-edit-symbolic" : "action-unavailable-symbolic";
    }

    _bindValues() {
        gsettings.bind(Fields.FILTER,     this._field_filter,           'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DCOMMAND,   this._field_dict_command,     'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.RCOMMAND,   this._field_right_command,    'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LCOMMAND,   this._field_left_command,     'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.APPSLIST,   this._field_apps_list,        'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.AUTOHIDE,   this._field_auto_hide,        'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGESIZE,   this._field_icon_pagesize,    'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.XOFFSET,    this._field_icon_xoffset,     'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LOGSLEVEL,  this._field_log_level,        'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,    this._field_trigger_style,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LISTTYPE,   this._field_list_type,        'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SHORTCUT,   this._field_enable_toggle,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SYSTRAY,    this._field_enable_systray,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE,  this._field_hide_panel_title, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP,  this._field_enable_strip,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TOOLTIPS,   this._field_enable_tooltips,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PASSIVE,    this._field_passive_mode,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DEFAULT,    this._field_default_theme,    'active', Gio.SettingsBindFlags.DEFAULT);
    }

    _listFrameMaker(lbl) {
        let frame = new Gtk.Frame({
            label_yalign: 1,
        });
        frame.set_label_widget(new Gtk.Label({
            use_markup: true,
            margin_top: 30,
            label: "<b><big>" + lbl + "</big></b>",
        }));
        this.add(frame);

        frame.grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
            row_homogeneous: false,
            column_homogeneous: false,
        });

        frame.grid._row = 0;
        frame.add(frame.grid);
        frame._add = (x, y, z) => {
            const hbox = new Gtk.Box();
            if(z) {
                hbox.pack_start(x, false, false, 4);
                hbox.pack_start(y, true, true, 0);
                hbox.pack_start(z, false, false, 4);
            } else if(y) {
                let etr = (y instanceof Gtk.Entry) && !y.adjustment;
                hbox.pack_start(x, !etr, !etr, 0);
                hbox.pack_start(y, etr, etr, 4);
            } else {
                hbox.pack_start(x, true, true, 0);
            }
            frame.grid.attach(hbox, 0, frame.grid._row++, 1, 1);
        }
        return frame;
    }

    _spinMaker(l, u, s) {
        return new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: l,
                upper: u,
                step_increment: s,
            }),
        });
    }

    _labelMaker(x) {
        return new Gtk.Label({
            label: x,
            hexpand: true,
            halign: Gtk.Align.START,
        });
    }

    _entryMaker(x, y) {
        let entry = new Gtk.Entry({
            hexpand: true,
            editable: false,
            placeholder_text: x,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_name: "action-unavailable",
        });
        entry.connect('icon-press', () => {
            if(entry.get_editable()) {
                entry.set_editable(false);
                entry.secondary_icon_name = "action-unavailable"
            } else {
                entry.set_editable(true);
                entry.secondary_icon_name = "document-edit-symbolic";
            }
        });
        return entry;
    }

    _comboMaker(ops) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.forEach(op => l.set(l.append(), [0], [op]));
        let c = new Gtk.ComboBox({ model: l });
        let r = new Gtk.CellRendererText();
        c.pack_start(r, false);
        c.add_attribute(r, "text", 0);
        return c;
    }

    _shortCutMaker(hotkey) {
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_INT, GObject.TYPE_INT]);

        let [key, mods] = Gtk.accelerator_parse(gsettings.get_strv(hotkey)[0]);
        model.set(model.insert(0), [0, 1], [mods, key]);

        let treeView = new Gtk.TreeView({ model: model, });
        treeView.set_headers_visible(false);
        let accelerator = new Gtk.CellRendererAccel({
            'editable': true,
            'accel-mode': Gtk.CellRendererAccelMode.GTK
        });

        accelerator.connect('accel-edited', (r, iter, key, mods) => {
            let value = Gtk.accelerator_name(key, mods);
            let [succ, iterator] = model.get_iter_from_string(iter);
            model.set(iterator, [0, 1], [mods, key]);
            if (key != 0) {
                gsettings.set_strv(hotkey, [value]);
            }
        });

        let column = new Gtk.TreeViewColumn({});
        column.pack_start(accelerator, false);
        column.add_attribute(accelerator, 'accel-mods', 0);
        column.add_attribute(accelerator, 'accel-key', 1);
        treeView.append_column(column);

        return treeView;
    }
});

const LightDictAdvanced = GObject.registerClass(
class LightDictAdvanced extends Gtk.HBox {
    _init() {
        super._init({
            margin: 30,
        });

        this.isNew = true;
        this.isSetting = false;

        this._commands = gsettings.get_strv(Fields.BCOMMANDS);
        this._default =
`{
    "name" : "name",
    "icon" : "",
    "type" : 0,
    "command" : "",
    "popup" : false,
    "enable" : false,
    "clip"  : false,
    "commit" : false,
    "tooltip" : "",
    "windows" : "",
    "regexp" : ""
}`;
        this._buildWidgets();
        this._buildUI();
        this._syncStatus();
    }

    _buildWidgets() {
        let listStore = new Gtk.ListStore();
        listStore.set_column_types([GObject.TYPE_STRING]);
        this._treeView = new Gtk.TreeView({ model: listStore });

        let cell = new Gtk.CellRendererText({ editable: false });
        let name = new Gtk.TreeViewColumn({ title: 'Name' });
        name.pack_start(cell, true);
        name.add_attribute(cell, 'text', 0);
        this._treeView.append_column(name);
        this._treeView.set_headers_visible(false);
        this._commands.forEach(x => {
            let conf = JSON.parse(x);
            this._treeView.model.set(this._treeView.model.append(), [0], [conf.name]);
        });
        this._treeView.expand_all();

        this._add = new Gtk.Button({ image: new Gtk.Image({ icon_name: "list-add-symbolic" }) });
        this._del = new Gtk.Button({ image: new Gtk.Image({ icon_name: "list-remove-symbolic" }) });
        this._nxt = new Gtk.Button({ image: new Gtk.Image({ icon_name: "go-down-symbolic" }) });
        this._prv = new Gtk.Button({ image: new Gtk.Image({ icon_name: "go-up-symbolic" }) });

        this._enable = new Gtk.Switch();
        this._popup = new Gtk.Switch();
        this._commit = new Gtk.Switch();
        this._clip = new Gtk.Switch();
        this._type = this._comboMaker(['Bash', 'Javascript']);
        this._name = this._entryMaker('Link', _('Name showing on left side'));
        this._icon = this._entryMaker('face-cool-symbolic', _('Icon showing in the bar'));
        this._regx = this._entryMaker('(https?|ftp|file)://.*', _('Regexp to filter selected text'));
        this._cmd = this._entryMaker('gio open LDWORD', _('Command to run when clicking'));
        this._win = this._entryMaker('Yelp,Evince,Gedit', _('Windows allowed to function'));
        this._tip = this._entryMaker('Open URL with gio open', _('Tooltip showing when hovering'));
    }

    _buildUI() {
        let leftBox = new Gtk.VBox({ margin_right: 30 });

        let toolBar = new Gtk.HBox({});
        toolBar.pack_start(this._add, false, false, 2);
        toolBar.pack_start(this._del, false, false, 2);
        toolBar.pack_start(this._nxt, false, false, 2);
        toolBar.pack_start(this._prv, false, false, 2);

        leftBox.pack_start(this._treeView, true, true, 2);
        leftBox.pack_end(toolBar, false, false, 2);

        let rightBox = this._listFrameMaker();
        rightBox._add(this._enable, _('Enable'));
        rightBox._add(this._name);
        rightBox._add(this._icon);
        rightBox._add(this._cmd);
        rightBox._add(this._type, _('Command type'));
        rightBox._add(this._popup, _('Show result'));
        rightBox._add(this._clip, _('Copy result'));
        rightBox._add(this._commit, _('Commit result'));
        rightBox._add(this._regx);
        rightBox._add(this._win);
        rightBox._add(this._tip);

        this.pack_start(leftBox, false, false, 0);
        this.pack_end(rightBox, true, true, 0);
    }

    _syncStatus() {
        this._treeView.get_selection().connect('changed', this._onSelected.bind(this));

        this._add.connect('clicked', this._onAddClicked.bind(this));
        this._del.connect('clicked', this._onDelClicked.bind(this));
        this._prv.connect('clicked', this._onPrvClicked.bind(this));
        this._nxt.connect('clicked', this._onNxtClicked.bind(this));

        this._name.connect('changed', this._onNameChanged.bind(this));
        this._enable.connect('state-set', (widget, state) => { this._setConfig('enable', state); });
        this._popup.connect('state-set', (widget, state) => { this._setConfig('popup', state); });
        this._commit.connect('state-set', (widget, state) => { this._setConfig('commit', state); });
        this._clip.connect('state-set', (widget, state) => { this._setConfig('clip', state); });
        this._type.connect('changed', () => { this._setConfig('type', this._type.get_active()); });
        this._icon.connect('changed', () => { this._setConfig('icon', this._icon.get_text()); });
        this._regx.connect('changed', () => { this._setConfig('regexp', this._regx.get_text()); });
        this._cmd.connect('changed', () => { this._setConfig('command', this._cmd.get_text()); });
        this._win.connect('changed', () => { this._setConfig('windows', this._win.get_text()); });
        this._tip.connect('changed', () => { this._setConfig('tooltip', this._tip.get_text()); });
    }

    _onSelected() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.isSetting = true;
        this.conf = JSON.parse(this._commands[index]);
        this._clip.set_state(this.conf.clip);
        this._type.set_active(this.conf.type);
        this._commit.set_state(this.conf.commit);
        this._popup.set_state(this.conf.popup);
        this._enable.set_state(this.conf.enable);
        this._icon.set_text(this.conf.icon || "");
        this._name.set_text(this.conf.name || "");
        this._win.set_text(this.conf.windows || "")
        this._cmd.set_text(this.conf.command || "");
        this._regx.set_text(this.conf.regexp || "");
        this._tip.set_text(this.conf.tooltip || "");
        this._toggleEditable();
        this.isSetting = false;
    }

    _saveConf() {
        this._commands = this._commands.map(x => {
            let cmd = JSON.parse(x);
            for(let attr in cmd) {
                if(cmd[attr] !== "")
                    continue;
                delete cmd[attr];
            }
            return JSON.stringify(cmd, null, 0);
        });
        gsettings.set_strv(Fields.BCOMMANDS, this._commands);
    }

    _toggleEditable() {
        let toggle = (x, y) => {
            x.set_editable(y);
            x.secondary_icon_name = y ? "document-edit-symbolic" : "action-unavailable-symbolic";
        };
        toggle(this._name, !this.conf.name || this.conf.name == 'name');
        toggle(this._icon, !this.conf.icon);
        toggle(this._cmd, !this.conf.command);
        toggle(this._win, !this.conf.windows);
        toggle(this._regx, !this.conf.regexp);
        toggle(this._tip, !this.conf.tooltip);
    }

    _onNameChanged() {
        let name = this._name.get_text();
        this._setConfig('name', name);
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        model.set(iter, [0], [name]);
    }

    get selected() {
        let [ok, model, iter] = this._treeView.get_selection().get_selected();
        return [ok, model, iter, ok ? model.get_path(iter).get_indices()[0] : -1];
    }

    _swapArray(index1, index2) {
        let tmp = this._commands[index1];
        this._commands[index1] = this._commands[index2];
        this._commands[index2] = tmp;
    }

    _onPrvClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index === 0) return;

        this._swapArray(index, index - 1);
        model.set(iter, [0], [JSON.parse(this._commands[index]).name]);
        model.iter_previous(iter);
        model.set(iter, [0], [JSON.parse(this._commands[index - 1]).name]);
        this._treeView.get_selection().select_iter(iter);
        this._saveConf();
    }

    _onNxtClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok || index >= this._commands.length - 1) return;

        this._swapArray(index, index + 1);
        model.set(iter, [0], [JSON.parse(this._commands[index]).name]);
        model.iter_next(iter);
        model.set(iter, [0], [JSON.parse(this._commands[index + 1]).name]);
        this._treeView.get_selection().select_iter(iter);
        this._saveConf();
    }

    _onDelClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;

        this._commands.splice(index, 1);
        model.remove(iter);
        this._saveConf();
    }

    _onAddClicked() {
        let [ok, model, iter, index] = this.selected;
        if(!ok) {
            this._commands.splice(0, 0, this._default);
            model.set(model.insert(0), [0], ['name']);
            this._saveConf();
            return;
        }

        this._commands.splice(index + 1, 0, this._default);
        model.set(model.insert(index + 1), [0], ['name']);
        this._saveConf();
    }

    _setConfig(key, value) {
        if(this.isSetting) return;
        let [ok, model, iter, index] = this.selected;
        if(!ok) return;
        this.conf[key] = value;
        this._commands[index] = JSON.stringify(this.conf, null, 0);
        this._saveConf();
    }

    _listFrameMaker() {
        let frame = new Gtk.Frame();

        frame.grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
        });

        frame.grid._row = 0;
        frame.add(frame.grid);
        frame._add = (x, y, z) => {
            const hbox = new Gtk.Box();
            if(z) {
                hbox.pack_start(z, false, false, 4);
                hbox.pack_start(this._labelMaker(y), true, true, 0);
                hbox.pack_start(x, false, false, 4);
            } else if(y) {
                hbox.pack_start(this._labelMaker(y), true, true, 4);
                hbox.pack_start(x, false, false, 4);
            } else {
                hbox.pack_start(x, true, true, 4);
            }
            frame.grid.attach(hbox, 0, frame.grid._row++, 1, 1);
        }

        return frame;
    }

    _labelMaker(x) {
        return new Gtk.Label({
            label: x,
            hexpand: true,
            halign: Gtk.Align.START,
        });
    }

    _entryMaker(x, y) {
        let entry = new Gtk.Entry({
            hexpand: true,
            editable: false,
            placeholder_text: x,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_name: "action-unavailable",
        });
        entry.connect('icon-press', () => {
            if(entry.get_editable()) {
                entry.set_editable(false);
                entry.secondary_icon_name = "action-unavailable"
            } else {
                entry.set_editable(true);
                entry.secondary_icon_name = "document-edit-symbolic";
            }
        });
        return entry;
    }

    _comboMaker(ops) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.forEach(op => l.set(l.append(), [0], [op]));
        let c = new Gtk.ComboBox({ model: l });
        let r = new Gtk.CellRendererText();
        c.pack_start(r, false);
        c.add_attribute(r, "text", 0);
        return c;
    }
});

