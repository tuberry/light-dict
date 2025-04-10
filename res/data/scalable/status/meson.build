# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

icon = configuration_data()
icons = []
count = 0
foreach p: ['passive', 'proactive']
  foreach t: ['swift', 'popup', 'disable']
    name = 'ld-' + t + '-' + p + '-symbolic.svg'
    icon.set(count.to_string(), 'scalable/status' / name)
    icons += name
    count += 1
  endforeach
endforeach

tray = custom_target(
  output: icons,
  build_by_default: true,
  build_always_stale: true,
  command: [
    find_program('gjs'),
    '-m',
    '@SOURCE_ROOT@' / 'cli/gen-icon.js',
    '@OUTDIR@',
  ],
)
