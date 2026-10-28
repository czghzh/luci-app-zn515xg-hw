#!/bin/sh
# Installed as the apk post-install / post-upgrade script.
#
# Takes the four stock overview blocks that this package replaces out of the
# directory scan.  LuCI's overview page discovers its includes at runtime:
#
#   index.js: fs.list('/www' + L.resource('view/status/include'))
#             -> filter /\.js$/ -> sort -> L.require()
#
# so renaming a file to *.js.disabled is enough to stop it being loaded, and it
# never touches a path owned by luci-mod-status (which keeps this package
# installable with a plain `apk add` and safe across luci-mod-status upgrades).
[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="luci-app-zn515xg-hw"
add_group_and_user
default_postinst
[ -n "${IPKG_INSTROOT}" ] && exit 0

INC=/www/luci-static/resources/view/status/include
for f in 10_system 20_memory 25_storage 40_dhcp; do
	if [ -f "$INC/$f.js" ]; then
		cp -p "$INC/$f.js" "$INC/$f.js.disabled" && rm -f "$INC/$f.js"
	fi
done
exit 0
