# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: me,
  install_dir: target_dir,
  install_tag: fs.name(meson.current_source_dir()),
)

_icon = {}
foreach p: ['passive', 'proactive']
  foreach t: ['swift', 'popup', 'disable']
    _icon += {f'icon_@t@_@p@': f'ld-@t@-@p@-symbolic.svg'}
  endforeach
endforeach
_theme = 'style.css'

_gres = me + _icon + {'theme': _theme}

_deps = [] + custom_target(
  input: ['../../cli/gen-icon.js'],
  output: _icon.values(),
  build_subdir: 'scalable/status',
  command: [
    find_program('gjs'),
    '-m',
    '@INPUT@',
    '@OUTDIR@',
  ],
) + custom_target(
  input: 'prefs.scss',
  output: _theme,
  command: [
    find_program('sassc'),
    '-t',
    'compact',
    '-a',
    '@INPUT@',
    '@OUTPUT@'
  ],
) + configure_file(
  input: 'dbus.xml.in',
  output: '@0@.xml'.format(me['dbus']),
  configuration: me,
  install_dir: target == 'system' ? get_option('datadir') / 'dbus-1/interfaces' : ''
)

foreach x: ['extension', 'prefs']
  gnome.compile_resources(
    x, configure_file(
      input: f'@x@.gresource.xml.in',
      output: f'@x@.gresource.xml',
      configuration: _gres,
    ),
    source_dir: '@OUTDIR@',
    dependencies: _deps,
    gresource_bundle: true,
    install: true,
    install_dir: target_dir / 'resource',
  )
endforeach
