icons = []
foreach p: ['passive', 'proactive']
  foreach t: ['disable', 'swift', 'popup']
      icons += 'ld-' + t + '-' + p + '-symbolic.svg'
  endforeach
endforeach

custom_target(
  output: icons,
  build_by_default: true,
  build_always_stale: true,
  command: [
    find_program('gjs'),
    '-m',
    meson.source_root() / 'cli/gen-icons.js',
    '@OUTDIR@',
  ],
  install: true,
  install_dir: (target == 'system' ? datadir : target_dir)  / 'icons/hicolor/scalable/status'
)

if(target == 'system')
  gnome.post_install(gtk_update_icon_cache: true)
endif
