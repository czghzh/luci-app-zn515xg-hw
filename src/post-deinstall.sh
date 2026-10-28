#!/bin/sh
# Installed as the apk post-deinstall script (postrm).
#
# Puts the four stock overview blocks back, so removing this package leaves the
# page exactly as luci-mod-status ships it.  The files were only ever renamed,
# never overwritten, so this is a straight move back.
[ -n "${IPKG_INSTROOT}" ] && exit 0

INC=/www/luci-static/resources/view/status/include
for f in 10_system 20_memory 25_storage 40_dhcp; do
	if [ -f "$INC/$f.js.disabled" ]; then
		cp -p "$INC/$f.js.disabled" "$INC/$f.js" && rm -f "$INC/$f.js.disabled"
	fi
done
exit 0
