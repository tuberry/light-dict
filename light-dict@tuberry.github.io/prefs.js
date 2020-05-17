// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Pango, GLib, Gtk, Gdk, GtkSource, GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const gsettings = ExtensionUtils.getSettings();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;

var Fields = {
    OPENURL:    'open-url',
    XOFFSET:    'x-offset',
    YOFFSET:    'y-offset',
    LAZYMODE:   'lazy-mode',
    LOGSLEVEL:  'log-level',
    DCOMMAND:   'dict-command',
    TEXTSTRIP:  'enable-strip',
    CCOMMAND:   'click-command',
    DEFAULT:    'default-theme',
    ICOMMANDS:  'icon-commands',
    PAGESIZE:   'icon-pagesize',
    TRIGGER:    'trigger-style',
    BLACKWHITE: 'black-or-white',
    SENSITIVE:  'sensitive-mode',
    MINLINES:   'panel-min-lines',
    SHORTCUT:   'enable-shortcut',
    STYLESHEET: 'user-stylesheet',
    TOGGLE:     'toggle-shortcut',
    TOOLTIPS:   'enable-tooltips',
    APPSLIST:   'application-list',
    AUTOHIDE:   'autohide-timeout',
    FILTER:     'selection-filter',
    HIDETITLE:  'hide-panel-title',
    ACOMMANDS:  'icon-commands-active',
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
            window.resize(700,550);
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
    }

    _bulidIcons() {
        let hbox = new Gtk.Box({
            halign: Gtk.Align.CENTER,
        });
        let active = gsettings.get_strv(Fields.ACOMMANDS);
        let count = gsettings.get_uint(Fields.PAGESIZE);
        let icons = [];
        let icon_size = 5;
        if(active.length) {
            active.forEach(x => JSON.parse(x).entries.forEach(y => {
                icons.push(new Gtk.Image({
                    icon_size: icon_size,
                    icon_name: y.icon,
                }));
            }));
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
        frame.override_background_color(Gtk.StateType.NORMAL, new Gdk.RGBA({red: 245/255, green: 212/255, blue: 217/255, alpha: 1}));
        frame.add(hbox)
        this.add(frame);
    }

    _buildInfo() {
        this._gpl = "https://www.gnu.org/licenses/gpl-3.0.html";
        this._license  = _("GNU General Public License, version 3 or later");
        this._info = [
            "<b>" + Me.metadata.name + "</b>",
            _("Version %d").format(Me.metadata.version),
            _("Lightweight selection-popup extension with icon bar and tooltips-style panel, especially optimized for Dictionary."),
            "<span><a href=\"" + Me.metadata.url + "\">" + Me.metadata.url + "</a></span>",
            "<small>" + _("This program comes with absolutely no warranty.\nSee the <a href=\"%s\">%s</a> for details.").format(this._gpl, this._license) + "</small>"
        ];
        let about = new Gtk.Label({
            wrap: true,
            justify: 2,
            use_markup: true,
            label: this._info.join('\n\n'),
        });
        this.add(about);
    }
});

const LightDictBasic = GObject.registerClass(
class LightDictBasic extends Gtk.Box {
    _init() {
        super._init({
            margin_left: 30,
            margin_right: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this._buildWidgets();
        this._bulidUI();
        this._bindValues();
        this._syncStatus();
    }

    _buildWidgets() {
        this._field_black_or_white   = new Gtk.Switch();
        this._field_default_theme    = new Gtk.Switch();
        this._field_enable_strip     = new Gtk.Switch();
        this._field_enable_tooltips  = new Gtk.Switch();
        this._field_hide_panel_title = new Gtk.Switch();
        this._field_lazy_mode        = new Gtk.Switch();
        this._field_sensitive_mode   = new Gtk.Switch();

        this._field_auto_hide        = this._spinMaker(500, 10000, 250);
        this._field_min_lines        = this._spinMaker(0, 40, 2);
        this._field_icon_pagesize    = this._spinMaker(0, 10, 1);
        this._field_icon_xoffset     = this._spinMaker(-400,400,5);
        this._field_icon_yoffset     = this._spinMaker(-400,400,5);

        this._field_trigger_style    = this._comboMaker([_('Icon'), _('Keyboard'), _('Auto')]);
        this._field_log_level        = this._comboMaker([_('Never'), _('Click'), _('Hover'), _('Always')]);

        this._field_enable_toggle    = new Gtk.CheckButton({ active: gsettings.get_boolean(Fields.SHORTCUT) });
        this._field_toggle           = this._shortCutMaker(Fields.TOGGLE);

        this._field_dict_command     = this._entryMaker("dict -- LDWORD", _('Command to run in auto mode'));
        this._field_apps_list        = this._entryMaker('Yelp#Evince', _('App white/black list (asterisk for all)'));
        this._field_filter           = this._entryMaker('^[^\\n\\.\\t/:]{3,50}$', _('Text RegExp filter for auto mode'));
        this._field_click_command    = this._entryMaker('notify-send LDWORD', _('Left click: command to run when clicking panel'));
        this._field_open_url         = this._entryMaker('https://zh.wikipedia.org/w/?search=LDWORD', _('Right click: search in default browser'));
    }

    _bulidUI() {
        this._common = this._listFrameMaker(_('Common'));
        this._common._add(this._field_enable_strip,   _("Trim whitespaces"));
        this._common._add(this._field_black_or_white, _("Black/whitelist"));
        this._common._add(this._field_default_theme,  _("Default theme"));
        this._common._add(this._field_trigger_style,  _("Trigger style"));
        this._common._add(this._field_auto_hide,      _("Autohide interval"));
        this._common._add(this._field_toggle,         _("Toggle style or show panel"), this._field_enable_toggle);
        this._common._add(this._field_apps_list);

        this._iconbar = this._listFrameMaker(_('Icon Bar'));
        this._iconbar._add(this._field_enable_tooltips, _("Enable tooltips"));
        this._iconbar._add(this._field_lazy_mode,       _("Lazy mode"));
        this._iconbar._add(this._field_icon_pagesize,   _("Page size"));
        this._iconbar._add(this._field_icon_xoffset,    _("Horizontal offset"));
        this._iconbar._add(this._field_icon_yoffset,    _("Vertical offset"));

        this._panel = this._listFrameMaker(_('Panel'));
        this._panel._add(this._field_hide_panel_title,  _("Hide title"));
        this._panel._add(this._field_sensitive_mode,    _("Seamless mode"));
        this._panel._add(this._field_log_level,         _("Logs level"));
        this._panel._add(this._field_min_lines,         _("Min lines to scroll"));
        this._panel._add(this._field_dict_command);
        this._panel._add(this._field_open_url);
        this._panel._add(this._field_click_command);
        this._panel._add(this._field_filter);
    }

    _syncStatus() {
        this._field_enable_toggle.connect("notify::active", widget => {
            this._field_toggle.set_sensitive(widget.active);
        });
        this._field_toggle.set_sensitive(this._field_enable_toggle.active);
    }

    _bindValues() {
        gsettings.bind(Fields.FILTER,     this._field_filter,           'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.DCOMMAND,   this._field_dict_command,     'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.OPENURL,    this._field_open_url,         'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.CCOMMAND,   this._field_click_command,    'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.APPSLIST,   this._field_apps_list,        'text',   Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.AUTOHIDE,   this._field_auto_hide,        'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGESIZE,   this._field_icon_pagesize,    'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.MINLINES,   this._field_min_lines,        'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.XOFFSET,    this._field_icon_xoffset,     'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.YOFFSET,    this._field_icon_yoffset,     'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SENSITIVE,  this._field_sensitive_mode,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LOGSLEVEL,  this._field_log_level,        'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TRIGGER,    this._field_trigger_style,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.SHORTCUT,   this._field_enable_toggle,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.HIDETITLE,  this._field_hide_panel_title, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TEXTSTRIP,  this._field_enable_strip,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.BLACKWHITE, this._field_black_or_white,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.TOOLTIPS,   this._field_enable_tooltips,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.LAZYMODE,   this._field_lazy_mode,        'active', Gio.SettingsBindFlags.DEFAULT);
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
        return new Gtk.Entry({
            hexpand: true,
            placeholder_text: x,
            secondary_icon_sensitive: true,
            secondary_icon_tooltip_text: y,
            secondary_icon_activatable: true,
            secondary_icon_name: "dialog-information-symbolic",
        });
    }

    _comboMaker(ops) {
        let l = new Gtk.ListStore();
        l.set_column_types([GObject.TYPE_STRING]);
        ops.map(name => ({name})).forEach((p,i) => l.set(l.append(),[0],[p.name]));
        let c = new Gtk.ComboBox({ model: l, });
        let r = new Gtk.CellRendererText();
        c.pack_start(r, false);
        c.add_attribute(r, "text", 0);
        return c;
    }

    _shortCutMaker(hotkey) {
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_INT, GObject.TYPE_INT]);

        const row = model.insert(0);
        let [key, mods] = Gtk.accelerator_parse(gsettings.get_strv(hotkey)[0]);
        model.set(row, [0, 1], [mods, key]);

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
class LightDictAdvanced extends Gtk.Box {
    _init() {
        super._init({
            margin: 30,
            orientation: Gtk.Orientation.VERTICAL,
        });
        this._initStrings();
        this._add = false;
        this._boxes = [];
        this._row = 0;

        this._cmdsList   = gsettings.get_strv(Fields.ICOMMANDS);
        this._cmdsActive = gsettings.get_strv(Fields.ACOMMANDS);
        this._templete   = JSON.stringify(JSON.parse(this.TEMPLETE), null, 0);
        this._default    = JSON.stringify(JSON.parse(this.DEFAULTLINK), null, 0);
        this._buildUI();
    }

    _buildUI() {
        let frame = new Gtk.Frame({
            label_yalign: 1,
        });
        this.add(frame);

        this._grid = new Gtk.Grid({
            margin: 10,
            hexpand: true,
            row_spacing: 12,
            column_spacing: 18,
            row_homogeneous: false,
            column_homogeneous: false,
        });
        frame.add(this._grid);

        this._grid.attach(this._defaultRowMaker(this._default), 0, this._row++, 1, 1);
        this._cmdsList.slice(1).forEach(x => this._grid.attach(this._customRowMaker(x), 0, this._row++, 1, 1));
    }

    _checkJSON(str) {
        try {
            let obj = JSON.parse(str);
            let req = ['icon', 'type', 'command'];
            if(!obj.hasOwnProperty('name') || !obj.hasOwnProperty('entries') || obj.entries.some(x => req.some(y => !x.hasOwnProperty(y)))) {
                GLib.spawn_command_line_async('notify-send ' + GLib.shell_quote(Me.metadata.name) + ' ' + GLib.shell_quote(_("Missing some required properties in JSON data")));
                return false;
            }
        } catch (e) {
            GLib.spawn_command_line_async('notify-send ' + GLib.shell_quote(Me.metadata.name) + ' ' + GLib.shell_quote(e.message));
            return false;
        }
        return true;
    }

    _initStrings() {
        this.TIPS = [
            _('Add the icon to <u>~/.local/share/icons/xxxx</u>'),
            _('Use relative position when both X and Y offset are <b>0</b>'),
            _('Substitute <b>LDWORD</b> for the selection in commands'),
            _('Do <b>NOT</b> set the <i>clip</i> to <i>true</i> if the command will change clipboard'),
            _("Fake keyboard input is supported in JS statement: <u>key('Control_L+c')</u>"),
            _('Log file locates in <u>~/.cache/gnome-shell-extension-light-dict/</u>')
        ];

        this.COMMENTS = [
            _('Required / text showing on the entry'),
            _('Optional / additional information about the entry'),
            _('Required / the icon name'),
            _('Required / Bash command (false) or JS statement (true)'),
            _('Required / command to run when clicking icon'),
            _('Optional / popup the panel or not'),
            _('Optional / write the clipboard or not'),
            _('Optional / paste the result (Ctrl+v) or not'),
            _('Optional / tooltip of icon when hovering'),
            _('Optional / app white list of the icon'),
            _('Optional / show the icon only when matching the RegExp'),
            _('Required / the details of the entry, which is convenient to enable or disable a group of icons in one click')
        ];

        // xgettext might be conflicted with templete string, do NOT put any translatable text after this.DEFAULTLINK
        this.DEFAULTLINK =
`{
    "name" : "link",
    "?name" : "%s",
    "description" : "open URL with gio open",
    "?description" : "%s",
    "entries" : [
        {
            "icon" : "link",
            "?icon" : "%s",
            "type" : false,
            "?type" : "%s",
            "command" : "gio open LDWORD",
            "?command" : "%s",
            "popup" : false,
            "?popup" : "%s",
            "clip"  : false,
            "?clip" : "%s",
            "paste" : false,
            "?paste" : "%s",
            "tooltip" : "open URL in default browser",
            "?tooltip" : "%s",
            "windows" : ["Yelp", "Evince", "Gedit"],
            "?windows" : "%s",
            "regexp" : "^(https?://)?(www\\\\.)?([-a-z0-9]{1,63}\\\\.)*?[a-z0-9][-a-z0-9]{0,61}[a-z0-9]\\\\.[a-z]{2,6}(/[-\\\\w@\\\\+\\\\.~#\\\\?&/=]*)?$",
            "?regexp" : "%s"
        }
    ],
    "?entries" : "%s"
}`.format(...this.COMMENTS);
        this.TEMPLETE =
`{
    "name" : "name",
    "description" : "",
    "entries" : [
        {
            "icon" : "",
            "type" : false,
            "command" : "",
            "popup" : false,
            "clip"  : false,
            "paste" : false,
            "tooltip" : "",
            "windows" : [],
            "regexp" : ""
        }
    ]
}`;
    }

    _defaultRowMaker(cmd) {
        let hbox = new Gtk.HBox({ hexpand: true, });
        let cmdj = JSON.parse(cmd);

        hbox._text = cmd;
        hbox.row = this._row;
        this._boxes.push(hbox);

        hbox.check = new Gtk.CheckButton({ active: this._cmdsActive.includes(cmd) });
        hbox.check.connect("toggled", () => this._updateCommands(true));

        hbox.label = new Gtk.Label({
            xalign: 0,
            selectable: true,
            use_markup: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        hbox.label.set_line_wrap(false);
        hbox.label.set_markup('<b>' + cmdj.name + '</b> ' + cmdj.description);

        hbox.view = this._popSourceviewMaker('');
        hbox.view.set_image(new Gtk.Image({ icon_name: 'view-hidden' }));
        hbox.view.connect('clicked', () => {
            hbox.view.buf.text = JSON.stringify(cmdj, null, 2);
            hbox.view.pop.show_all();
        });

        hbox.add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'entry-new', sensitive: false }) });
        hbox.add.set_sensitive(this._cmdsList.length < 2);
        hbox.add.connect("clicked", () => {
            hbox.add.set_sensitive(false);
            if(this._boxes.length > 1) return;
            this._grid.attach(this._customRowMaker(''), 0, this._row++, 1, 1);
            this._updateCommands(false);
            this.show_all();
        });

        hbox.tips = this._popLabelViewMaker(this.TIPS);
        hbox.tips.connect("clicked", () => {
            hbox.tips.pop.show_all();
            hbox.add.set_sensitive(this._boxes.length === 1);
        });

        hbox.pack_start(hbox.check, false, false, 0);
        hbox.pack_start(hbox.view, false, false, 10);
        hbox.pack_start(hbox.label, true, true, 10);
        hbox.pack_start(hbox.add, false, false, 10);
        hbox.pack_end(hbox.tips, false, false, 0);

        return hbox;
    }

    _customRowMaker(cmd) {
        let hbox = new Gtk.HBox({ hexpand: true, });
        let cmdj = JSON.parse(cmd ? cmd : this._templete);

        hbox.row = this._row;
        this._boxes.push(hbox);
        hbox._text = cmd ? cmd : this._templete;

        hbox.label = new Gtk.Label({
            xalign : 0,
            hexpand : true,
            use_markup: true,
            ellipsize: Pango.EllipsizeMode.END,
        });
        hbox.label.set_line_wrap(false);
        hbox.label.set_markup('<b>' + cmdj.name + '</b> ' + cmdj.description);

        hbox.edit = this._popSourceviewMaker(JSON.stringify(cmdj, null, 2));
        hbox.edit.src.set_editable(cmd ? !this._cmdsActive.includes(cmd) : true);
        hbox.edit.set_image(new Gtk.Image({ icon_name: hbox.edit.src.editable ? 'entry-edit' : 'view-hidden' }));
        hbox.edit.connect('clicked', () => hbox.edit.pop.show_all());
        hbox.edit.pop.connect('closed', () => {
            if(!hbox.edit.src.editable || !this._checkJSON(hbox.edit.buf.text)) return;
            let json = JSON.parse(hbox.edit.buf.text);
            let text = JSON.stringify(json, null, 0);
            if(hbox._text === text) return;
            hbox._text = text;
            hbox.label.set_markup('<b>' + json.name + '</b> ' + json.description);
            this._updateCommands(false);
        });

        hbox.check = new Gtk.CheckButton({ active: cmd ? this._cmdsActive.includes(cmd) : false});
        hbox.check.connect("toggled", widget => {
            hbox.edit.src.set_editable(!widget.active);
            hbox.edit.set_image(new Gtk.Image({ icon_name: hbox.edit.src.editable ? 'entry-edit' : 'view-hidden' }));
            if(!this._add) this._updateCommands(true);
        });

        hbox.add = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'entry-new' }) });
        hbox.add.connect("clicked", () => {
            this._grid.attach(this._customRowMaker(''), 0, this._row++, 1, 1);
            let idx = this._boxes.findIndex(x => x.row == hbox.row);
            this._add = true;
            for(let i = this._boxes.length - 1; i > idx + 1; i--) {
                ['.check.active', '._text', '.label.label', '.edit.buf.text'].forEach(x => {
                    eval(`let tmp = this._boxes[i]${x}; this._boxes[i]${x} = this._boxes[i-1]${x}; this._boxes[i-1]${x} = tmp;`);
                });
            }
            this._updateCommands(false);
            this._add = false;
            this.show_all();
        });

        hbox.delete = new Gtk.Button({ image: new Gtk.Image({ icon_name: 'entry-delete' }) });
        hbox.delete.connect("clicked", () => {
            this._boxes = this._boxes.filter(x => x.row != hbox.row);
            if(hbox.check.active) this._updateCommands(true);
            this._updateCommands(false);
            this._grid.remove(hbox);
        });

        hbox.pack_start(hbox.check, false, false, 0);
        hbox.pack_start(hbox.edit, false, false, 10);
        hbox.pack_start(hbox.label, true, true, 10);
        hbox.pack_start(hbox.add, false, false, 10);
        hbox.pack_end(hbox.delete, false, false, 0);

        return hbox;
    }

    _popSourceviewMaker(text) {
        const btn = new Gtk.Button();
        btn.pop = new Gtk.Popover(btn);
        btn.pop.set_relative_to(btn);

        btn.buf = new GtkSource.Buffer();
        btn.buf.set_highlight_matching_brackets(true);
        btn.buf.set_language(new GtkSource.LanguageManager().get_language("json"));
        btn.buf.set_style_scheme(new GtkSource.StyleSchemeManager().get_scheme("oblivion"));
        btn.buf.text = text;

        btn.src = GtkSource.View.new_with_buffer(btn.buf);
        btn.src.set_tab_width(2);
        btn.src.set_indent_width(2);
        btn.src.set_auto_indent(true);
        btn.src.set_indent_on_tab(true);
        btn.src.set_show_line_numbers(true);
        btn.src.set_show_right_margin(true);
        btn.src.set_right_margin_position(10);
        btn.src.set_highlight_current_line(true);
        btn.src.set_insert_spaces_instead_of_tabs(true);
        btn.src.modify_font(Pango.font_description_from_string("Hack 13"));

        let scroll = new Gtk.ScrolledWindow({
            min_content_height: 400,
            min_content_width: 660,
        });
        scroll.add(btn.src);
        btn.pop.add(scroll);

        return btn;
    }

    _popLabelViewMaker(msgs) {
        const tips = new Gtk.Button({ image: new Gtk.Image({ icon_name: "help-about" }) });
        tips.pop = new Gtk.Popover(tips);
        tips.pop.set_relative_to(tips);

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
        tips.pop.add(vbox);

        return tips;
    }

    _updateCommands(type) {
        if(type) {
            gsettings.set_strv(Fields.ACOMMANDS, Array.from(this._boxes.filter(x => x.check.active), y => y._text));
        } else {
            gsettings.set_strv(Fields.ICOMMANDS, Array.from(this._boxes, x => x._text));
        }
    }
});

