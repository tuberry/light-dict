icons = []
foreach p: ['passive', 'proactive']
  foreach t: ['disable', 'swift', 'popup']
      icons += 'ld-' + t + '-' + p + '-symbolic.svg'
  endforeach
endforeach

custom_target(
  'icons',
  build_by_default: true,
  build_always_stale: true,
  output: icons,
  command: [
    find_program('gjs'),
    meson.source_root() / 'cli/gen-icons.js',
    '@OUTDIR@',
    ],
  install: true,
  install_dir: TARGET_DIR / 'icons/hicolor/scalable/status'
  )
