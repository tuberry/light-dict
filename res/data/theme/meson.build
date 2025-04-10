# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

theme = 'style.css'

scss = custom_target(
  input: fs.replace_suffix(theme, '.scss'),
  output: theme,
  command: [
    find_program('sassc'),
    '-t',
    'compressed',
    '-a',
    '@INPUT@',
    '@OUTPUT@'
  ],
)
