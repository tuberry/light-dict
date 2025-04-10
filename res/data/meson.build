# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: metadata,
  install_dir: target_dir,
)

subdir('scalable/status') # HACK: for https://github.com/mesonbuild/meson/issues/2320
foreach name: ['dbus', 'path']
  icon.set(name, metadata[name])
endforeach

subdir('theme')
icon.set('theme', theme)

dbus = configure_file(
  input: 'dbus.xml.in',
  output: '@0@.xml'.format(metadata['dbus']),
  configuration: metadata,
  install_dir: (target == 'system') ? datadir / 'dbus-1/interfaces' : '',
)

foreach name: ['extension', 'prefs']
  gres = configure_file(
    input: f'@name@.gresource.xml.in',
    output: f'@name@.gresource.xml',
    configuration: icon,
  )
  gnome.compile_resources(
    name, gres,
    source_dir: '@OUTDIR@',
    dependencies: [tray, scss, dbus],
    gresource_bundle: true,
    install: true,
    install_dir: target_dir / 'resource',
  )
endforeach
